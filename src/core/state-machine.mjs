export const STATES = Object.freeze({
  DISCONNECTED: 'DISCONNECTED', DISCOVERING: 'DISCOVERING', CONNECTING: 'CONNECTING', AUTHENTICATING: 'AUTHENTICATING',
  JOINED: 'JOINED', PREPARING: 'PREPARING', BUFFERING: 'BUFFERING', CLOCK_SYNCING: 'CLOCK_SYNCING', READY: 'READY',
  SCHEDULED: 'SCHEDULED', PLAYING: 'PLAYING', PAUSED: 'PAUSED', STOPPED: 'STOPPED', SEEKING: 'SEEKING', RESYNCING: 'RESYNCING',
  DEGRADED: 'DEGRADED', RECONNECTING: 'RECONNECTING', FAILED: 'FAILED'
});

const ALLOWED = {
  DISCONNECTED: new Set(['DISCOVERING','CONNECTING','FAILED']),
  DISCOVERING: new Set(['CONNECTING','FAILED','DISCONNECTED']),
  CONNECTING: new Set(['AUTHENTICATING','RECONNECTING','FAILED','DISCONNECTED']),
  AUTHENTICATING: new Set(['JOINED','FAILED','DISCONNECTED']),
  JOINED: new Set(['PREPARING','CLOCK_SYNCING','DEGRADED','RECONNECTING','FAILED','DISCONNECTED']),
  PREPARING: new Set(['BUFFERING','CLOCK_SYNCING','READY','DEGRADED','FAILED']),
  BUFFERING: new Set(['PREPARING','CLOCK_SYNCING','READY','DEGRADED','FAILED']),
  CLOCK_SYNCING: new Set(['READY','PREPARING','DEGRADED','FAILED']),
  READY: new Set(['SCHEDULED','PLAYING','SEEKING','PREPARING','DEGRADED','RECONNECTING','FAILED']),
  SCHEDULED: new Set(['PLAYING','READY','PAUSED','STOPPED','RESYNCING','DEGRADED','FAILED']),
  PLAYING: new Set(['PAUSED','STOPPED','SEEKING','RESYNCING','DEGRADED','RECONNECTING','FAILED']),
  PAUSED: new Set(['SCHEDULED','PLAYING','READY','SEEKING','STOPPED','DEGRADED','RECONNECTING','FAILED']),
  STOPPED: new Set(['SCHEDULED','PLAYING','READY','SEEKING','DEGRADED','RECONNECTING','FAILED']),
  SEEKING: new Set(['SCHEDULED','PLAYING','PAUSED','STOPPED','READY','DEGRADED','FAILED']),
  RESYNCING: new Set(['PLAYING','READY','DEGRADED','FAILED']),
  DEGRADED: new Set(['RECONNECTING','RESYNCING','READY','PLAYING','PAUSED','STOPPED','FAILED','DISCONNECTED']),
  RECONNECTING: new Set(['CONNECTING','AUTHENTICATING','JOINED','DEGRADED','FAILED','DISCONNECTED']),
  FAILED: new Set(['RECONNECTING','CONNECTING','DISCONNECTED','DISCOVERING'])
};

export class SyncStateMachine {
  constructor(initial = STATES.DISCONNECTED) {
    if (!Object.values(STATES).includes(initial)) throw new Error(`Unknown initial state: ${initial}`);
    this.state = initial;
    this.generation = 0;
    this.history = [{ state: initial, at: 0, reason: 'init' }];
  }
  can(next) { return next === this.state || Boolean(ALLOWED[this.state]?.has(next)); }
  transition(next, { at = performance.timeOrigin + performance.now(), reason = '' } = {}) {
    if (!this.can(next)) throw new Error(`Illegal transition ${this.state} -> ${next}`);
    if (next !== this.state) {
      this.state = next;
      this.generation += 1;
      this.history.push({ state: next, at, reason });
      if (this.history.length > 64) this.history.shift();
    }
    return this.snapshot();
  }
  invalidate(reason = 'generation invalidated') {
    this.generation += 1;
    this.history.push({ state: this.state, at: performance.timeOrigin + performance.now(), reason });
    if (this.history.length > 64) this.history.shift();
    return this.generation;
  }
  snapshot() { return { state: this.state, generation: this.generation, history: [...this.history] }; }
}
