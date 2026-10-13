import XCTest
@testable import SonicSyncIOS

final class ClockModelTests: XCTestCase {
    func testNTPOffsetAndUncertainty() {
        let e = ClockEstimator()
        let model = e.add(ClockSample(t1: 1_000, t2: 1_500, t3: 1_600, t4: 2_100))
        XCTAssertEqual(model.offsetNs, 0)
        XCTAssertGreaterThan(model.uncertaintyNs, 0)
    }

    func testDriftEstimate() {
        let e = ClockEstimator()
        let base: UInt64 = 1_000_000_000
        let driftNsPerSecond = 150_000.0
        var last = ClockEstimate(offsetNs: 0, driftPpm: 0, uncertaintyNs: .infinity, confidence: 0, sampleCount: 0)
        for second in 0..<16 {
            let t = base + UInt64(second) * 1_000_000_000
            let offset = Int64(Double(second) * driftNsPerSecond)
            last = e.add(ClockSample(t1: t, t2: t &+ UInt64(offset), t3: t &+ UInt64(offset), t4: t &+ 1_000_000))
        }
        XCTAssertGreaterThan(last.driftPpm, 100)
        XCTAssertLessThan(last.driftPpm, 200)
    }
}
