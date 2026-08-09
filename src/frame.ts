/**
 * Asterisk AudioSocket frame codec.
 *
 * Wire format (binary, big-endian, over a plain TCP stream):
 *
 *   Byte 0:    type   (1 byte)
 *   Bytes 1-2: length (2 bytes, uint16 big-endian — payload length only)
 *   Bytes 3+:  payload
 *
 * Frame types (see app_audiosocket.c in the Asterisk source tree):
 *
 *   0x00  HANGUP  no payload — Asterisk asks us to end, or we ask Asterisk to
 *   0x01  UUID    16 raw bytes — the call id from AudioSocket(<uuid>,host:port)
 *   0x10  AUDIO   signed-linear 16-bit, 8 kHz, mono (slin16) — 320 bytes / 20 ms
 *   0xff  ERROR   1 byte error code
 *
 * Audio is always slin16 @ 8 kHz mono: one 20 ms frame is exactly 320 bytes
 * (160 samples * 2 bytes). Everything downstream assumes that framing.
 */

export enum FrameType {
  HANGUP = 0x00,
  UUID = 0x01,
  AUDIO = 0x10,
  ERROR = 0xff,
}

/** Bytes in one 20 ms slin16 @ 8 kHz mono AUDIO frame. */
export const FRAME_BYTES = 320;

/** Duration of one AUDIO frame, in milliseconds. */
export const FRAME_MS = 20;

/** slin16 sample rate Asterisk uses on the AudioSocket leg. */
export const SAMPLE_RATE = 8000;

/** A single silent AUDIO payload (used for comfort noise / pre-roll). */
export const SILENCE_FRAME = Buffer.alloc(FRAME_BYTES);

const HEADER_BYTES = 3;

export interface Frame {
  type: FrameType;
  payload: Buffer;
}

/** Encode a frame to its on-the-wire byte representation. */
export function encodeFrame(type: FrameType, payload: Buffer = Buffer.alloc(0)): Buffer {
  if (payload.length > 0xffff) {
    throw new RangeError(`AudioSocket payload too large: ${payload.length} > 65535`);
  }
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header.writeUInt8(type, 0);
  header.writeUInt16BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export function encodeAudio(pcm: Buffer): Buffer {
  return encodeFrame(FrameType.AUDIO, pcm);
}

export function encodeHangup(): Buffer {
  return encodeFrame(FrameType.HANGUP);
}

/**
 * Format a 16-byte UUID payload as the canonical 8-4-4-4-12 hex string.
 * Returns "" if the payload is not exactly 16 bytes.
 */
export function parseUuid(payload: Buffer): string {
  if (payload.length !== 16) return '';
  const h = payload.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Incremental frame parser for a TCP byte stream. TCP does not preserve
 * message boundaries, so bytes are buffered until a whole frame is present.
 * Feed raw chunks with `push()` and drain complete frames with `next()`,
 * or iterate everything currently buffered via `drain()`.
 */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0);

  /** Append a chunk received from the socket. */
  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }

  /** Pull the next complete frame, or null if one isn't fully buffered yet. */
  next(): Frame | null {
    if (this.buf.length < HEADER_BYTES) return null;
    const type = this.buf.readUInt8(0);
    const length = this.buf.readUInt16BE(1);
    const total = HEADER_BYTES + length;
    if (this.buf.length < total) return null;

    const payload = this.buf.subarray(HEADER_BYTES, total);
    // Copy out so the retained buffer can be freed and the payload is stable.
    const frame: Frame = { type: coerceType(type), payload: Buffer.from(payload) };
    this.buf = this.buf.subarray(total);
    return frame;
  }

  /** Yield every complete frame currently buffered. */
  *drain(): Generator<Frame> {
    let f: Frame | null;
    while ((f = this.next()) !== null) yield f;
  }
}

function coerceType(raw: number): FrameType {
  switch (raw) {
    case FrameType.HANGUP:
    case FrameType.UUID:
    case FrameType.AUDIO:
    case FrameType.ERROR:
      return raw;
    default:
      // Unknown type byte — surface it as ERROR rather than throwing mid-stream.
      return FrameType.ERROR;
  }
}
