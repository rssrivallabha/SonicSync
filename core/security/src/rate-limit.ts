export class TokenBucket {
  private tokens: number;
  private lastRefillSeconds: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    nowSeconds = 0,
  ) {
    if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(refillPerSecond) || refillPerSecond <= 0) throw new RangeError("invalid token bucket");
    this.tokens = capacity;
    this.lastRefillSeconds = nowSeconds;
  }

  allow(cost = 1, nowSeconds = this.lastRefillSeconds): boolean {
    if (!Number.isFinite(cost) || cost <= 0) throw new RangeError("invalid token cost");
    if (!Number.isFinite(nowSeconds) || nowSeconds < this.lastRefillSeconds) throw new RangeError("invalid time");
    const elapsed = nowSeconds - this.lastRefillSeconds;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefillSeconds = nowSeconds;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  remaining(nowSeconds = this.lastRefillSeconds): number {
    if (!Number.isFinite(nowSeconds) || nowSeconds < this.lastRefillSeconds) throw new RangeError("invalid time");
    return Math.min(this.capacity, this.tokens + (nowSeconds - this.lastRefillSeconds) * this.refillPerSecond);
  }
}
