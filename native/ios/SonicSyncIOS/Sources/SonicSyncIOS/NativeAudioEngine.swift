import AVFoundation
import AudioToolbox
import Foundation

public final class NativeAudioEngine: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var started = false

    public init() {
        engine.attach(player)
        let format = engine.mainMixerNode.outputFormat(forBus: 0)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    public func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .moviePlayback, options: [.allowBluetooth, .allowBluetoothA2DP])
        try session.setActive(true)
        try engine.start()
        started = true
    }

    public func stop() {
        player.stop(); engine.stop(); started = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    public func scheduleFile(url: URL, hostTime: UInt64, completion: (() -> Void)? = nil) throws {
        guard started else { throw NSError(domain: "SonicSyncAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Audio engine is not started"]) }
        let file = try AVAudioFile(forReading: url)
        let time = AVAudioTime(hostTime: hostTime)
        player.stop()
        player.scheduleFile(file, at: time, completionHandler: completion)
        player.play()
    }

    public func schedulePCM(buffer: AVAudioPCMBuffer, hostTime: UInt64) throws {
        guard started else { throw NSError(domain: "SonicSyncAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Audio engine is not started"]) }
        player.stop()
        player.scheduleBuffer(buffer, at: AVAudioTime(hostTime: hostTime), options: [])
        player.play()
    }

    public var outputLatencySeconds: Double {
        let session = AVAudioSession.sharedInstance()
        return session.outputLatency + session.ioBufferDuration
    }
}

public enum HostClock {
    public static func nowHostTime() -> UInt64 { mach_absolute_time() }
    public static func nanosToHostTime(_ nanos: UInt64) -> UInt64 {
        var info = mach_timebase_info_data_t(); mach_timebase_info(&info)
        let n = UInt64(info.numer), d = UInt64(info.denom)
        let q = nanos / n, r = nanos % n
        return q &* d &+ (r &* d) / n
    }
    public static func hostTime(afterMonotonicTargetNs targetNs: UInt64) -> UInt64 {
        let nowNs = DispatchTime.now().uptimeNanoseconds
        let nowHost = nowHostTime()
        let delta = targetNs > nowNs ? targetNs - nowNs : 0
        return nowHost &+ nanosToHostTime(delta)
    }
    public static func addMilliseconds(_ hostTime: UInt64, _ ms: UInt64) -> UInt64 { hostTime &+ nanosToHostTime(ms * 1_000_000) }
}
