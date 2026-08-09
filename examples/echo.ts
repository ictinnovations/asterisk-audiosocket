/**
 * Minimal echo bot: whatever the caller says is played straight back, paced.
 *
 * Dialplan side (extensions.conf):
 *   exten => s,1,Answer()
 *    same => n,AudioSocket(${UUID},127.0.0.1:9092)
 *    same => n,Hangup()
 *
 * Run:  npx tsx examples/echo.ts   (or build then `node dist/examples/echo.js`)
 */
import { AudioSocketServer } from '../src/index.js';

const server = new AudioSocketServer({ host: '127.0.0.1', port: 9092 });

server.on('connection', (call) => {
  console.log('call connected from', call.remoteAddress);

  call.on('id', (uuid) => console.log('  uuid:', uuid));
  call.on('audio', (pcm) => {
    // Echo the caller's own audio back to them, paced to 20 ms/frame.
    void call.play(pcm);
  });
  call.on('error', (err) => console.error('  error:', err.message));
  call.on('hangup', () => console.log('  hangup'));
});

server.on('error', (err) => console.error('server error:', err));

await server.listen();
console.log('AudioSocket echo server listening on 127.0.0.1:9092');
