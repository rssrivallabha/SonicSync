import { PeerAddress, Transport, TransportQuality } from "./types.js";

export class InMemoryTransport implements Transport {
  readonly kind = "IN_MEMORY" as const;
  private peer: InMemoryTransport | null = null;
  private connected = false;
  private listeners = new Set<(payload: Uint8Array) => void>();
  private quality: TransportQuality = { rttMs: 0, jitterMs: 0, packetLossRatio: 0, throughputKbps: Number.POSITIVE_INFINITY };

  static pair(): readonly [InMemoryTransport, InMemoryTransport] {
    const a = new InMemoryTransport();
    const b = new InMemoryTransport();
    a.peer = b; b.peer = a;
    return [a, b];
  }

  async connect(_address: PeerAddress): Promise<void> { this.connected = true; }
  async close(): Promise<void> { this.connected = false; }

  async send(payload: Uint8Array): Promise<void> {
    if (!this.connected || this.peer === null || !this.peer.connected) throw new Error("transport not connected");
    const message = new Uint8Array(payload);
    for (const listener of this.peer.listeners) listener(new Uint8Array(message));
  }

  onMessage(handler: (payload: Uint8Array) => void): () => void {
    this.listeners.add(handler);
    return () => { this.listeners.delete(handler); };
  }

  getQuality(): TransportQuality { return { ...this.quality }; }
}
