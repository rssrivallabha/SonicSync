package com.sonicsync.android

object NativeAudio {
    init {
        System.loadLibrary("sonicsync_audio")
    }

    @JvmStatic
    external fun open(sampleRate: Int, framesPerBurst: Int)
    @JvmStatic
    external fun start()
    @JvmStatic
    external fun stop()
    @JvmStatic
    external fun close()
    @JvmStatic
    external fun schedule(startNanos: Long)
    @JvmStatic
    external fun setVolume(gain: Float)
    @JvmStatic
    external fun latencyMillis(): Double
    @JvmStatic
    external fun framesWritten(): Long
    @JvmStatic
    external fun sampleRate(): Int
    @JvmStatic
    external fun markerFired(): Boolean
    @JvmStatic
    external fun failed(): Boolean
}
