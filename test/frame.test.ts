import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FRAME_BYTES,
  FrameParser,
  FrameType,
  encodeAudio,
  encodeFrame,
  encodeHangup,
  parseUuid,
} from '../src/frame.js';

test('encodeFrame writes type + big-endian length header', () => {
  const out = encodeFrame(FrameType.AUDIO, Buffer.from([1, 2, 3]));
  assert.equal(out.readUInt8(0), FrameType.AUDIO);
  assert.equal(out.readUInt16BE(1), 3);
  assert.deepEqual(out.subarray(3), Buffer.from([1, 2, 3]));
});

test('encodeHangup has zero-length payload', () => {
  const out = encodeHangup();
  assert.equal(out.length, 3);
  assert.equal(out.readUInt8(0), FrameType.HANGUP);
  assert.equal(out.readUInt16BE(1), 0);
});

test('encodeFrame rejects oversized payloads', () => {
  assert.throws(() => encodeFrame(FrameType.AUDIO, Buffer.alloc(0x10000)), RangeError);
});

test('parseUuid formats 16 bytes as 8-4-4-4-12', () => {
  const bytes = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  assert.equal(parseUuid(bytes), '01234567-89ab-cdef-0123-456789abcdef');
});

test('parseUuid returns "" for wrong length', () => {
  assert.equal(parseUuid(Buffer.alloc(15)), '');
  assert.equal(parseUuid(Buffer.alloc(17)), '');
});

test('FrameParser reassembles a frame split across chunks', () => {
  const whole = encodeAudio(Buffer.alloc(FRAME_BYTES, 7));
  const parser = new FrameParser();
  // Feed byte-at-a-time to prove boundary handling.
  let got = null;
  for (const b of whole) {
    parser.push(Buffer.from([b]));
    got = parser.next();
    if (got) break;
  }
  assert.ok(got);
  assert.equal(got!.type, FrameType.AUDIO);
  assert.equal(got!.payload.length, FRAME_BYTES);
  assert.equal(got!.payload[0], 7);
});

test('FrameParser drains multiple frames from one chunk', () => {
  const parser = new FrameParser();
  parser.push(Buffer.concat([encodeHangup(), encodeAudio(Buffer.alloc(FRAME_BYTES))]));
  const frames = [...parser.drain()];
  assert.equal(frames.length, 2);
  assert.equal(frames[0].type, FrameType.HANGUP);
  assert.equal(frames[1].type, FrameType.AUDIO);
});

test('FrameParser holds back an incomplete frame', () => {
  const parser = new FrameParser();
  const whole = encodeAudio(Buffer.alloc(FRAME_BYTES, 1));
  parser.push(whole.subarray(0, 100));
  assert.equal(parser.next(), null);
  parser.push(whole.subarray(100));
  const f = parser.next();
  assert.ok(f);
  assert.equal(f!.payload.length, FRAME_BYTES);
});

test('unknown frame type byte is coerced to ERROR', () => {
  const parser = new FrameParser();
  parser.push(encodeFrame(0x42 as FrameType, Buffer.alloc(0)));
  const f = parser.next();
  assert.equal(f!.type, FrameType.ERROR);
});
