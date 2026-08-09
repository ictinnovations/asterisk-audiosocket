# asterisk-audiosocket

[![npm](https://img.shields.io/npm/v/asterisk-audiosocket.svg)](https://www.npmjs.com/package/asterisk-audiosocket)
[![CI](https://github.com/ictinnovations/asterisk-audiosocket/actions/workflows/ci.yml/badge.svg)](https://github.com/ictinnovations/asterisk-audiosocket/actions)
[![license](https://img.shields.io/npm/l/asterisk-audiosocket.svg)](./LICENSE)

A tiny, **zero-dependency TypeScript implementation of the Asterisk [AudioSocket](https://docs.asterisk.org/Configuration/Channel-Drivers/AudioSocket/) protocol.** Point Asterisk's `AudioSocket()` dialplan app at a Node.js process and receive the caller's audio as PCM, send audio back, and react to the call lifecycle — the plumbing for voice bots, AI voice agents, live transcription, call recording, and real-time media processing.

```ts
import { AudioSocketServer } from 'asterisk-audiosocket';

const server = new AudioSocketServer({ port: 9092 });

server.on('connection', (call) => {
  call.on('id',    (uuid) => console.log('call', uuid));
  call.on('audio', (pcm)  => call.play(pcm));   // echo the caller back, paced
  call.on('hangup', ()    => console.log('bye'));
});

await server.listen();
```

## Why

AudioSocket is the easiest way to get a live Asterisk call into your own code — it's just a TCP socket carrying framed 8 kHz PCM. The catch is that everyone ends up re-implementing the byte protocol by hand, and most people get the outbound pacing wrong the first time, so callers hear only the tail end of each phrase. This library saves you both: a typed codec, an event-driven server, and a paced writer that actually works.

It has no runtime dependencies — just Node's own `net` and `events`. It handles the whole protocol (UUID, AUDIO, HANGUP, ERROR) including reassembling frames that arrive split across TCP reads. And `play()` meters audio to the 20 ms frame clock with a per-frame deadline clamp, so a slow synthesizer can't make it burst and overrun the far end's jitter buffer. Written in TypeScript, ships ESM plus type declarations, works fine from plain JS.

## Install

```bash
npm install asterisk-audiosocket
```

Requires Node.js ≥ 18. Requires Asterisk built with `app_audiosocket` (Asterisk 18+; the `res_audiosocket`/`app_audiosocket` modules).

## The protocol in one paragraph

AudioSocket runs over TCP. Every message is a 3-byte header — 1 byte type, 2 bytes big-endian payload length — followed by the payload:

| Type | Byte | Payload |
|------|------|---------|
| `HANGUP` | `0x00` | none |
| `UUID`   | `0x01` | 16 raw bytes — the id from `AudioSocket(<uuid>,host:port)` |
| `AUDIO`  | `0x10` | signed-linear 16-bit, 8 kHz, mono (**slin16**) — 320 bytes per 20 ms |
| `ERROR`  | `0xff` | 1 byte error code |

Audio is **always slin16 @ 8 kHz mono**: one 20 ms frame is exactly 320 bytes. Resample your TTS/STT to that. Constants `FRAME_BYTES` (320), `FRAME_MS` (20), and `SAMPLE_RATE` (8000) are exported.

## Dialplan

```asterisk
; extensions.conf — bridge a call to the Node process
exten => s,1,Answer()
 same => n,AudioSocket(${UUID},127.0.0.1:9092)   ; UUID must be canonical 8-4-4-4-12
 same => n,Hangup()
```

`AudioSocket()`'s first argument is a UUID it sends to you as the first frame — use it to correlate the call. A common pattern is to derive it deterministically: `Set(UUID=${SHA1(${UNIQUEID})...})` formatted 8-4-4-4-12, and pre-register call context out-of-band keyed by that UUID.

## API

### `new AudioSocketServer(opts?)`

| Option | Default | Meaning |
|--------|---------|---------|
| `host` | `127.0.0.1` | Bind address — keep AudioSocket loopback-only. |
| `port` | `9092` | TCP port Asterisk dials. |

- `await server.listen()` — start accepting calls.
- `server.on('connection', (call) => …)` — a new call arrived.
- `server.address` → `{ host, port }` (resolve the real port when you bind to `0`).
- `await server.close()` — stop.

### `AudioSocketConnection` (one per call)

Events:

| Event | Arg | When |
|-------|-----|------|
| `id` | `uuid: string` | UUID frame received (canonical 8-4-4-4-12). |
| `audio` | `pcm: Buffer` | One 320-byte slin16 frame of caller audio. |
| `hangup` | — | Asterisk hung up or the socket closed. Fires once. |
| `error` | `err: Error` | ERROR frame or a socket/decode error. |

Methods:

- `call.play(pcm: Buffer): Promise<void>` — queue arbitrary-length slin16 for **paced** playback (320-byte frames, one per 20 ms). Calls concatenate, so you can stream TTS chunks in as they arrive. Resolves when this buffer has finished playing. **Use this for anything longer than one frame.**
- `call.writeFrame(pcm320: Buffer)` — send a single raw 320-byte frame, unpaced.
- `call.flushPlayback()` — drop queued audio (barge-in / interrupt).
- `call.hangup()` — send a HANGUP frame and close.
- `call.uuid` / `call.remoteAddress` — call id and peer, for logging.

### Low-level codec

For custom transports/testing: `FrameParser`, `encodeFrame`, `encodeAudio`, `encodeHangup`, `parseUuid`, `FrameType`.

## Recipes

**Live transcription** — feed `audio` frames to your STT of choice (Whisper, Deepgram, Vosk):

```ts
call.on('audio', (pcm) => stt.write(pcm)); // pcm is slin16 8 kHz mono
```

**Speak text back** — synthesize to slin16 @ 8 kHz, then `play()`:

```ts
const pcm = await tts.synthesize('Hello!'); // resample to 8 kHz mono s16le
await call.play(pcm);
```

**Barge-in** — stop talking the moment the caller does:

```ts
call.on('audio', (pcm) => { if (isSpeech(pcm)) call.flushPlayback(); });
```

See [`examples/echo.ts`](./examples/echo.ts) for a runnable echo bot.

## Roadmap

- `slin16`↔`slin` (16 kHz) helpers and a resampling utility.
- Optional µ-law/a-law helpers.
- A `Readable`/`Writable` stream adapter for pipe-based pipelines.

Contributions welcome.

## Related open source

- **[asterisk-ai-voice-agent](https://github.com/ictinnovations/asterisk-ai-voice-agent)** - a working speech-to-text, LLM and text-to-speech voice agent built on this protocol. Start here if you want the full picture rather than the plumbing.
- **[asterisk-ami-node](https://github.com/ictinnovations/asterisk-ami-node)** - Asterisk Manager Interface client, also zero dependency. Use it alongside this one to originate calls and watch channel state while AudioSocket carries the media.
- **[freeswitch-esl-node](https://github.com/ictinnovations/freeswitch-esl-node)** - the same idea for the FreeSWITCH Event Socket.
- **[pbx-mcp](https://github.com/ictinnovations/pbx-mcp)** - a Model Context Protocol server that gives AI assistants a read-only window into Asterisk and FreeSWITCH.
- **[ICTCore](https://github.com/ictinnovations/ictcore)** - the open source telephony framework behind our products.

## About / Provenance

This codec comes from [ICTContact](https://www.ictcontact.com), our Voice, Fax, SMS and Email broadcasting and contact center platform, where it drives the AI Voice Agent and the voice translation media sidecar. We rewrote the protocol layer in TypeScript and released it on its own so the rest of the Asterisk and Node crowd doesn't have to reinvent it.

Maintained by [ICT Innovations](https://www.ictinnovations.com) and [ICT Vision](https://ict.vision), who have been shipping open source and commercial telephony since 2005. Written by Tahir Almas.

If this is useful to you, the wider stack behind it might be too:

- **[ICTPBX](https://ictpbx.com)** - white label multi tenant IP PBX, with a free community edition on GitHub
- **[ICTContact](https://ictcontact.com)** - contact center and unified communications, where this codec came from
- **[ICTDialer](https://ictdialer.com)** - auto and predictive dialer
- **[ICTFax](https://ictfax.org)** - open source fax server

Questions about the commercial products go through [the ICT Innovations support portal](https://service.ictinnovations.com/contact.php). Questions about this package belong in GitHub issues, where everyone can read the answer.

## License

[MIT](./LICENSE) — © Tahir Almas / ICT Innovations, derived from ICTContact.
