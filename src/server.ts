import { EventEmitter } from 'node:events';
import net, { type Server, type Socket } from 'node:net';
import { AudioSocketConnection } from './connection.js';

export interface AudioSocketServerOptions {
  /** Bind address. Default 127.0.0.1 — keep AudioSocket loopback-only. */
  host?: string;
  /** TCP port Asterisk's AudioSocket() dials. Default 9092. */
  port?: number;
}

export interface AudioSocketServerEvents {
  /** A new call connected. The UUID frame arrives shortly after via `id`. */
  connection: (call: AudioSocketConnection) => void;
  /** The underlying TCP server is listening. */
  listening: () => void;
  /** A server-level error (e.g. EADDRINUSE). */
  error: (err: Error) => void;
}

export declare interface AudioSocketServer {
  on<E extends keyof AudioSocketServerEvents>(event: E, listener: AudioSocketServerEvents[E]): this;
  once<E extends keyof AudioSocketServerEvents>(event: E, listener: AudioSocketServerEvents[E]): this;
  emit<E extends keyof AudioSocketServerEvents>(event: E, ...args: Parameters<AudioSocketServerEvents[E]>): boolean;
}

/**
 * A TCP server that speaks the Asterisk AudioSocket protocol. Each accepted
 * socket becomes an {@link AudioSocketConnection}.
 *
 * @example
 * const server = new AudioSocketServer({ port: 9092 });
 * server.on('connection', (call) => {
 *   call.on('id', (uuid) => console.log('call', uuid));
 *   call.on('audio', (pcm) => call.play(pcm)); // echo
 *   call.on('hangup', () => console.log('bye'));
 * });
 * await server.listen();
 */
export class AudioSocketServer extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly tcp: Server;

  constructor(opts: AudioSocketServerOptions = {}) {
    super();
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 9092;
    this.tcp = net.createServer((socket: Socket) => {
      socket.setNoDelay(true); // 20 ms audio frames — never Nagle-buffer them.
      this.emit('connection', new AudioSocketConnection(socket));
    });
    this.tcp.on('error', (err) => this.emit('error', err));
    this.tcp.on('listening', () => this.emit('listening'));
  }

  /** Start listening. Resolves once bound. */
  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.tcp.once('error', onError);
      this.tcp.listen(this.port, this.host, () => {
        this.tcp.removeListener('error', onError);
        resolve();
      });
    });
  }

  /** The bound port (useful when constructed with port 0 for tests). */
  get address(): { host: string; port: number } {
    const a = this.tcp.address();
    if (a && typeof a === 'object') return { host: a.address, port: a.port };
    return { host: this.host, port: this.port };
  }

  /** Stop accepting new calls and close the server. */
  close(): Promise<void> {
    return new Promise((resolve) => this.tcp.close(() => resolve()));
  }
}
