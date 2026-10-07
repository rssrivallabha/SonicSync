export interface ReplayDecision { readonly accepted: boolean; readonly reason: string; }

interface SenderWindow {
  highestSequence: number;
  readonly seenMessageIds: Map<string, number>;
}

export class ReplayGuard {
  private readonly senders = new Map<string, SenderWindow>();

  constructor(private readonly retentionSeconds = 60) {
    if (!Number.isFinite(retentionSeconds) || retentionSeconds <= 0) throw new RangeError("invalid replay retention");
  }

  accept(senderId: string, messageId: string, sequence: number, nowSeconds: number, expirySeconds?: number): ReplayDecision {
    if (!senderId || !messageId) return { accepted: false, reason: "missing sender or message id" };
    if (!Number.isSafeInteger(sequence) || sequence < 0) return { accepted: false, reason: "invalid sequence" };
    if (!Number.isFinite(nowSeconds) || nowSeconds < 0) return { accepted: false, reason: "invalid current time" };
    if (expirySeconds !== undefined && (!Number.isFinite(expirySeconds) || expirySeconds < nowSeconds)) return { accepted: false, reason: "message expired" };

    const minRetained = nowSeconds - this.retentionSeconds;
    let window = this.senders.get(senderId);
    if (!window) { window = { highestSequence: -1, seenMessageIds: new Map() }; this.senders.set(senderId, window); }

    for (const [id, seenAt] of window.seenMessageIds) if (seenAt < minRetained) window.seenMessageIds.delete(id);

    if (window.seenMessageIds.has(messageId)) return { accepted: false, reason: "duplicate message id" };
    if (sequence < window.highestSequence) return { accepted: false, reason: "replayed sequence" };

    window.highestSequence = Math.max(window.highestSequence, sequence);
    window.seenMessageIds.set(messageId, nowSeconds);
    return { accepted: true, reason: "accepted" };
  }
}
