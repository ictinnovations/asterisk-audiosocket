import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import {
  FRAME_BYTES,
  FRAME_MS,
  FrameParser,
  FrameType,
  encodeAudio,
  encodeHangup,
  parseUuid,
  SILENCE_FRAME,
} from './frame.js';

export interface AudioSocketConnectionEvents {
  /** UUID frame received — the call id from AudioSocket(<uuid>,host:port). */
  id: (uuid: string) => void;
  /** One 320-byte slin16 @ 8 kHz frame of caller audio. */
  audio: (pcm: Buffer) => void;
  /** Asterisk signalled hangup, or the socket closed. Fires exactly once. */
  hangup: () => void;
  /** ERROR frame (1-byte code) or a decode/socket error. */
  error: (err: Error) => void;
}

export declare interface AudioSocketConnection {
  on<E extends keyof AudioSocketConnectionEvents>(event: E, listener: AudioSocketConnectionEvents[E]): this;
  once<E extends keyof AudioSocketConnectionEvents>(event: E, listener: AudioSocketConnectionEvents[E]): this;
  emit<E extends keyof AudioSocketConnectionEvents>(event: E, ...args: Parameters<AudioSocketConnectionEvents[E]>): boolean;
}

/**
 * One live AudioSocket call. Emits `id`, `audio`, `hangup`, `error`.
 *
 * Outbound audio MUST be paced to the 20 ms frame cadence. `app_audiosocket`
 * forwards each AUDIO frame to the channel (and out as RTP) the moment it
 * arrives — bursting a whole utterance overruns the far end's jitter buffer
 * and the caller hears only the tail of each chunk. Use `play()` for anything
 * longer than a single frame; it does deadline-based pacing with a per-frame
 * clamp so upstream synthesis latency can't leave the schedule stale.
 */
export class AudioSocketConnection extends EventEmitter {
  /** The call UUID, once the UUID frame has arrived (else ""). */
  public uuid = '';

  private readonly parser = new FrameParser();
  private closed = false;

  private playQueue: Buffer[] = [];
  private playTimer: NodeJS.Timeout | null = null;
  private deadline = 0;
  /** Total frames ever pushed to the queue, and total frames sent so far. */
  private enqueued = 0;
  private played = 0;
  /** Pending play() promises, keyed by the frame index at which they complete. */
  private waiters: Array<{ target: number; resolve: () => void }> = [];

  constructor(private readonly socket: Socket) {
    super();
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => this.onClose());
  }

  /** Remote peer address, for logging. */
  get remoteAddress(): string {
    return `${this.socket.remoteAddress ?? '?'}:${this.socket.remotePort ?? '?'}`;
  }

  private onData(chunk: Buffer): void {
    this.parser.push(chunk);
    for (const frame of this.parser.drain()) {
      switch (frame.type) {
        case FrameType.UUID:
          this.uuid = parseUuid(frame.payload);
          this.emit('id', this.uuid);
          break;
        case FrameType.AUDIO:
          this.emit('audio', frame.payload);
          break;
        case FrameType.HANGUP:
          this.onClose();
          return;
        case FrameType.ERROR: {
          const code = frame.payload.length ? frame.payload.readUInt8(0) : -1;
          this.emit('error', new Error(`AudioSocket ERROR frame, code=${code}`));
          break;
        }
      }
    }
  }

  /**
   * Send a single raw 320-byte slin16 frame, unpaced. Prefer `play()` for
   * anything longer than one frame — sending many frames back-to-back with
   * this will overrun the far-end jitter buffer.
   */
  writeFrame(pcm320: Buffer): void {
    if (this.closed) return;
    this.socket.write(encodeAudio(pcm320));
  }

  /**
   * Queue arbitrary-length slin16 @ 8 kHz PCM for paced playback. Audio is
   * split into 320-byte frames and emitted one per 20 ms. Calls concatenate,
   * so you can stream TTS chunks as they arrive. The returned promise resolves
   * once THIS buffer has finished playing (or the call closed).
   */
  play(pcm: Buffer): Promise<void> {
    if (this.closed || pcm.length === 0) return Promise.resolve();
    for (let off = 0; off < pcm.length; off += FRAME_BYTES) {
      let frame = pcm.subarray(off, off + FRAME_BYTES);
      if (frame.length < FRAME_BYTES) {
        // Pad the final short frame with silence to a full 320 bytes.
        frame = Buffer.concat([frame, SILENCE_FRAME.subarray(0, FRAME_BYTES - frame.length)]);
      }
      this.playQueue.push(frame);
      this.enqueued++;
    }
    const target = this.enqueued;
    return new Promise((resolve) => {
      this.waiters.push({ target, resolve });
      this.startPump();
    });
  }

  /** Drop any queued-but-unplayed audio (e.g. on barge-in) and resolve waiters. */
  flushPlayback(): void {
    this.playQueue = [];
    this.played = this.enqueued;
    this.settleWaiters();
  }

  private startPump(): void {
    if (this.playTimer || this.closed) return;
    // Reset the pacing deadline to "now" so a fresh talk-spurt starts promptly.
    this.deadline = Date.now();
    this.pump();
  }

  private pump = (): void => {
    if (this.closed) return;
    const frame = this.playQueue.shift();
    if (frame === undefined) {
      this.playTimer = null;
      this.settleWaiters();
      return;
    }
    this.socket.write(encodeAudio(frame));
    this.played++;
    this.settleWaiters();

    // Deadline-based pacing: next frame FRAME_MS after the last deadline, but
    // clamped to "now" so synthesis stalls don't make us burst to catch up.
    this.deadline += FRAME_MS;
    const now = Date.now();
    if (this.deadline < now) this.deadline = now;
    this.playTimer = setTimeout(this.pump, this.deadline - now);
  };

  private settleWaiters(): void {
    if (this.waiters.length === 0) return;
    this.waiters = this.waiters.filter((w) => {
      if (this.played >= w.target) {
        w.resolve();
        return false;
      }
      return true;
    });
  }

  /** Ask Asterisk to hang up (sends a HANGUP frame) and close the socket. */
  hangup(): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeHangup());
    } catch {
      /* socket may already be gone */
    }
    this.socket.end();
    this.onClose();
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
    this.playQueue = [];
    // Resolve any outstanding play() promises so callers don't hang forever.
    for (const w of this.waiters) w.resolve();
    this.waiters = [];
    this.emit('hangup');
    this.socket.destroy();
  }
}
