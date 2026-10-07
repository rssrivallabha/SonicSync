import { createConnection, createServer, Server, Socket } from "node:net";
import { decodeFrames, encodeFrame } from "./framing.js";
import { PeerAddress, Transport, TransportQuality } from "./types.js";

function parseEndpoint(endpoint: string): { readonly host: string; readonly port: number } {
  const split = endpoint.lastIndexOf(":");
  if (split <= 0) throw new RangeError("TCP endpoint must be host:port");
  const host = endpoint.slice(0, split);
  const port = Number(endpoint.slice(split + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("invalid TCP port");
  return { host, port };
}

export class TcpTransport implements Transport {
  readonly kind = "LAN" as const;
  private socket: Socket | null = null;
  private remainder: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private listeners = new Set<(payload: Uint8Array) => void>();
  private quality: TransportQuality = { rttMs: Number.NaN, jitterMs: Number.NaN, packetLossRatio: Number.NaN, throughputKbps: Number.NaN };

  static fromSocket(socket: Socket): TcpTransport {
    const transport = new TcpTransport();
    transport.attach(socket);
    return transport;
  }

  private attach(socket: Socket): void {
    this.socket = socket.setNoDelay(true);
    socket.on("data", (data) => {
      const joined = new Uint8Array(this.remainder.length + data.length);
      joined.set(this.remainder);
      joined.set(data, this.remainder.length);
      try {
        const decoded = decodeFrames(joined);
        this.remainder = decoded.remainder;
        for (const frame of decoded.frames) {
          for (const listener of this.listeners) listener(new Uint8Array(frame));
        }
      } catch {
        socket.destroy();
        this.socket = null;
        this.listeners.clear();
      }
    });
  }

  async connect(address: PeerAddress): Promise<void> {
    if (this.socket !== null) throw new Error("transport already connected");
    const endpoint = parseEndpoint(address.endpoint);
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(endpoint);
      let settled = false;
      const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
      socket.on("error", fail);
      socket.on("connect", () => {
        if (settled) return;
        settled = true;
        this.attach(socket);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.listeners.clear();
    if (socket !== null) socket.end();
  }

  async send(payload: Uint8Array): Promise<void> {
    const socket = this.socket;
    if (socket === null) throw new Error("TCP transport not connected");
    const frame = encodeFrame(payload);
    if (socket.write(frame)) return;
    await new Promise<void>((resolve) => socket.on("drain", resolve));
  }

  onMessage(handler: (payload: Uint8Array) => void): () => void {
    this.listeners.add(handler);
    return () => { this.listeners.delete(handler); };
  }

  getQuality(): TransportQuality { return { ...this.quality }; }
}

export interface TcpListener {
  readonly port: number;
  readonly close: () => Promise<void>;
}

export async function listenTcp(
  host: string,
  port: number,
  onConnection: (transport: TcpTransport) => void,
): Promise<TcpListener> {
  const server: Server = createServer();
  server.on("connection", (socket) => onConnection(TcpTransport.fromSocket(socket)));
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    server.on("error", fail);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("TCP listener did not expose an address");
  }

  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
