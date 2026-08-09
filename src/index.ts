/**
 * asterisk-audiosocket — a zero-dependency TypeScript implementation of the
 * Asterisk AudioSocket protocol (TCP transport). Build voice bots, live
 * transcription, recording, and real-time media apps on top of Asterisk in
 * Node.js.
 *
 * Derived from the AudioSocket media sidecar in ICTContact
 * (https://www.ictcontact.com). Maintained by ICT Innovations
 * (https://www.ictinnovations.com) and ICT Vision (https://ict.vision).
 * Original author: Tahir Almas.
 *
 * @packageDocumentation
 */

export {
  FrameType,
  FRAME_BYTES,
  FRAME_MS,
  SAMPLE_RATE,
  SILENCE_FRAME,
  FrameParser,
  encodeFrame,
  encodeAudio,
  encodeHangup,
  parseUuid,
  type Frame,
} from './frame.js';

export { AudioSocketConnection, type AudioSocketConnectionEvents } from './connection.js';
export {
  AudioSocketServer,
  type AudioSocketServerOptions,
  type AudioSocketServerEvents,
} from './server.js';
