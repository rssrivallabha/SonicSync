package com.sonicsync.android

object NativeAudio {
    init {
        System.loadLibrary("sonicsync_audio")
    }

    external fun open(sampleRate: Int, framesPerBurst: Int)
    external fun start()
    external fun stop()
    external fun close()
    external fun schedule(startNanos: Long)
    external fun setVolume(gain: Float)
    external fun latencyMillis(): Double
    external fun framesWritten(): Long
    external fun sampleRate(): Int
    external fun markerFired(): Boolean
    external fun failed(): Boolean
}
