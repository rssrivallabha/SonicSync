import { ProtectedCommand, SessionRole, isCommandAuthorized } from "./authorization.js";
import { ReplayGuard } from "./replay.js";
import { TokenBucket } from "./rate-limit.js";

export interface GateRequest {
  readonly senderId: string;
  readonly role: SessionRole;
  readonly command: ProtectedCommand;
  readonly messageId: string;
  readonly sequence: number;
  readonly nowSeconds: number;
  readonly expirySeconds?: number;
}

export interface GateDecision { readonly accepted: boolean; readonly reason: string; }

export class CommandGate {
  private readonly replay = new ReplayGuard();
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly burst = 10, private readonly refillPerSecond = 2) {}

  check(request: GateRequest): GateDecision {
    if (!isCommandAuthorized(request.role, request.command)) return { accepted: false, reason: "unauthorized command" };

    let bucket = this.buckets.get(request.senderId);
    if (!bucket) {
      bucket = new TokenBucket(this.burst, this.refillPerSecond, request.nowSeconds);
      this.buckets.set(request.senderId, bucket);
    }
    if (!bucket.allow(1, request.nowSeconds)) return { accepted: false, reason: "rate limit exceeded" };

    return this.replay.accept(request.senderId, request.messageId, request.sequence, request.nowSeconds, request.expirySeconds);
  }
}
