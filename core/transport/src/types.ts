export type TransportKind = "LAN" | "WEBRTC" | "ANDROID_NEARBY" | "APPLE_P2P" | "IN_MEMORY";

export interface PeerAddress { readonly peerId: string; readonly kind: TransportKind; readonly endpoint: string; }

export interface TransportQuality { readonly rttMs: number; readonly jitterMs: number; readonly packetLossRatio: number; readonly throughputKbps: number; }

export interface Transport {
  readonly kind: TransportKind;
  connect(address: PeerAddress): Promise<void>;
  close(): Promise<void>;
  send(payload: Uint8Array): Promise<void>;
  onMessage(handler: (payload: Uint8Array) => void): () => void;
  getQuality(): TransportQuality;
}
