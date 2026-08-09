import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { AudioSocketServer } from '../src/server.js';
import { FRAME_BYTES, FrameParser, FrameType, encodeAudio, encodeFrame, encodeHangup } from '../src/frame.js';

/**
 * Spin up a server on an ephemeral port and connect a raw client to it.
 *
 * The `connection` listener has to be attached before the client dials, because
 * the server accepts and emits before the client's own `connect` event fires.
 */
async function harness(): Promise<{
  server: AudioSocketServer;
  client: net.Socket;
  call: import('../src/connection.js').AudioSocketConnection;
  port: number;
}> {
  const server = new AudioSocketServer({ host: '127.0.0.1', port: 0 });
  await server.listen();
  const { port } = server.address;
  const accepted = new Promise<import('../src/connection.js').AudioSocketConnection>((r) =>
    server.once('connection', r),
  );
  const client = net.connect(port, '127.0.0.1');
  await new Promise((r) => client.once('connect', r));
  const call = await accepted;
  return { server, client, call, port };
}

test('emits id on a UUID frame and audio on an AUDIO frame', async () => {
  const { server, client, call } = await harness();
  const uuidBytes = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');

  const gotId = new Promise<string>((r) => call.once('id', r));
  const gotAudio = new Promise<Buffer>((r) => call.once('audio', r));

  client.write(encodeFrame(FrameType.UUID, uuidBytes));
  client.write(encodeAudio(Buffer.alloc(FRAME_BYTES, 9)));

  assert.equal(await gotId, '01234567-89ab-cdef-0123-456789abcdef');
  const audio = await gotAudio;
  assert.equal(audio.length, FRAME_BYTES);
  assert.equal(audio[0], 9);

  client.destroy();
  await server.close();
});

test('play() paces audio out as AUDIO frames the client can read back', async () => {
  const { server, client, call } = await harness();

  const parser = new FrameParser();
  const frames: number[] = [];
  client.on('data', (chunk) => {
    parser.push(chunk);
    for (const f of parser.drain()) frames.push(f.type);
  });

  // 5 frames worth of PCM.
  await call.play(Buffer.alloc(FRAME_BYTES * 5, 3));
  // Give the socket a tick to flush to the client.
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(frames.length, 5);
  assert.ok(frames.every((t) => t === FrameType.AUDIO));

  client.destroy();
  await server.close();
});

test('client HANGUP frame fires the hangup event once', async () => {
  const { server, client, call } = await harness();

  let hangups = 0;
  call.on('hangup', () => hangups++);
  client.write(encodeHangup());

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(hangups, 1);

  client.destroy();
  await server.close();
});
