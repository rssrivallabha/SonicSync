import { Transport, TransportQuality } from "./types";

export interface NetworkProfile {
  readonly latencyMs: number;
  readonly jitterMs: number;
  readonly packetLossRatio: number;
  readonly duplicateRatio: number;
}

export class NetworkEmulator implements Transport {
  readonly kind = "IN_MEMORY" as const;
  private readonly unsubscribe: () => void;
  private profile: NetworkProfile;
  private readonly listeners = new Set<(payload: Uint8Array) => void>();

  constructor(private readonly inner: Transport, profile: NetworkProfile) {
    this.validate(profile);
    this.profile = { ...profile };
    this.unsubscribe = inner.onMessage((payload) => {
      for (const listener of this.listeners) listener(new Uint8Array(payload));
    });
  }

  private validate(profile: NetworkProfile): void {
    if (![profile.latencyMs, profile.jitterMs].every(Number.isFinite) || profile.latencyMs < 0 || profile.jitterMs < 0) throw new RangeError("invalid latency profile");
    if (![profile.packetLossRatio, profile.duplicateRatio].every(Number.isFinite) || profile.packetLossRatio < 0 || profile.packetLossRatio > 1 || profile.duplicateRatio < 0 || profile.duplicateRatio > 1) throw new RangeError("invalid loss/duplicate ratio");
  }

  setProfile(profile: NetworkProfile): void { this.validate(profile); this.profile = { ...profile }; }
  async connect(address: Parameters<Transport["connect"]>[0]): Promise<void> { await this.inner.connect(address); }
  async close(): Promise<void> { this.unsubscribe(); await this.inner.close(); this.listeners.clear(); }
  getQuality(): TransportQuality {
    return { rttMs: this.profile.latencyMs * 2, jitterMs: this.profile.jitterMs, packetLossRatio: this.profile.packetLossRatio, throughputKbps: Number.POSITIVE_INFINITY };
  }
  onMessage(handler: (payload: Uint8Array) => void): () => void { this.listeners.add(handler); return () => { this.listeners.delete(handler); }; }

  async send(payload: Uint8Array): Promise<void> {
    if (Math.random() < this.profile.packetLossRatio) return;
    const delay = Math.max(0, this.profile.latencyMs + (Math.random() * 2 - 1) * this.profile.jitterMs);
    const message = new Uint8Array(payload);
    await new Promise<void>((resolve, reject) => setTimeout(() => this.inner.send(message).then(() => resolve()).catch(reject), delay));
    if (Math.random() < this.profile.duplicateRatio) await new Promise<void>((resolve, reject) => this.inner.send(message).then(() => resolve()).catch(reject));
  }
}
