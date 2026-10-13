import Foundation

public actor SonicSyncParticipant {
    public enum State: String { case disconnected, discovering, connected, preparing, clockSyncing, ready, scheduled, playing, paused, degraded, reconnecting, failed }
    public private(set) var state: State = .disconnected
    public private(set) var timelineEpoch: UInt64 = 0
    public private(set) var revision: UInt64 = 0
    public private(set) var clock = ClockEstimate(offsetNs: 0, driftPpm: 0, uncertaintyNs: .infinity, confidence: 0, sampleCount: 0)
    private let estimator = ClockEstimator()

    public func applyRemoteRevision(_ newRevision: UInt64, epoch: UInt64) -> Bool {
        guard epoch >= timelineEpoch, newRevision >= revision else { return false }
        timelineEpoch = epoch; revision = newRevision; return true
    }
    public func applyClockSample(_ sample: ClockSample) { clock = estimator.add(sample) }
    public func transition(_ next: State) {
        switch (state, next) {
        case (.disconnected, .discovering), (.discovering, .connected), (.connected, .preparing), (.preparing, .clockSyncing),
             (.clockSyncing, .ready), (.ready, .scheduled), (.scheduled, .playing), (.playing, .paused), (.paused, .playing),
             (.playing, .degraded), (.degraded, .reconnecting), (.reconnecting, .connected), (.connected, .failed), (.failed, .reconnecting),
             (_, .failed), (_, .disconnected): state = next
        default: break
        }
    }
}
