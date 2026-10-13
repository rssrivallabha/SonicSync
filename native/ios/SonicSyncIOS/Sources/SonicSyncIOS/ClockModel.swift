import Foundation

public struct ClockSample: Sendable {
    public let t1: UInt64
    public let t2: UInt64
    public let t3: UInt64
    public let t4: UInt64
    public var rtt: Int64 { (Int64(bitPattern: t4) - Int64(bitPattern: t1)) - (Int64(bitPattern: t3) - Int64(bitPattern: t2)) }
    public var offset: Int64 { ((Int64(bitPattern: t2) - Int64(bitPattern: t1)) + (Int64(bitPattern: t3) - Int64(bitPattern: t4))) / 2 }
}

public struct ClockEstimate: Sendable {
    public var offsetNs: Int64
    public var driftPpm: Double
    public var uncertaintyNs: Double
    public var confidence: Double
    public var sampleCount: Int
}

public final class ClockEstimator: @unchecked Sendable {
    private struct Point { let t: Double; let offset: Double }
    private var samples: [ClockSample] = []
    public init() {}
    public func add(_ sample: ClockSample) -> ClockEstimate {
        guard sample.rtt >= 0 else { return estimate() }
        samples.append(sample)
        if samples.count > 64 { samples.removeFirst(samples.count - 64) }
        return estimate()
    }
    public func estimate() -> ClockEstimate {
        guard !samples.isEmpty else { return ClockEstimate(offsetNs: 0, driftPpm: 0, uncertaintyNs: .infinity, confidence: 0, sampleCount: 0) }
        let rtts = samples.map(\.rtt).sorted()
        let minRTT = rtts.first ?? 0
        let medianRTT = median(rtts)
        let eligible = samples.filter { $0.rtt <= minRTT + max(2_000_000, Int64(Double(medianRTT) * 0.25)) }
        let offsets = eligible.map(\.offset).sorted()
        let center = median(offsets)
        let deviations = offsets.map { abs($0 - center) }.sorted()
        let jitter = Double(median(deviations))
        let uncertainty = max(500_000, jitter + Double(minRTT) / 2)
        let driftPpm = estimateDriftPpm(from: eligible)
        let confidence = min(1, Double(eligible.count) / 8) * (1 / (1 + uncertainty / 8_000_000))
        return ClockEstimate(offsetNs: center, driftPpm: driftPpm, uncertaintyNs: uncertainty, confidence: confidence, sampleCount: samples.count)
    }
    private func estimateDriftPpm(from samples: [ClockSample]) -> Double {
        guard samples.count >= 3 else { return 0 }
        let points = samples.map {
            Point(t: (Double($0.t1) + Double($0.t4)) / 2.0, offset: Double($0.offset))
        }
        let meanT = points.reduce(0) { $0 + $1.t } / Double(points.count)
        let meanO = points.reduce(0) { $0 + $1.offset } / Double(points.count)
        var num = 0.0
        var den = 0.0
        for p in points {
            let dt = p.t - meanT
            num += dt * (p.offset - meanO)
            den += dt * dt
        }
        guard den > 0 else { return 0 }
        return (num / den) * 1_000_000
    }

    private func median(_ x: [Int64]) -> Int64 {
        guard !x.isEmpty else { return 0 }
        let m = x.count / 2
        return x.count % 2 == 1 ? x[m] : (x[m - 1] + x[m]) / 2
    }
}
