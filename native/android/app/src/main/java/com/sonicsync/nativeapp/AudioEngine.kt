package com.sonicsync.nativeapp

import android.os.SystemClock
import java.nio.ByteBuffer
import java.nio.ByteOrder

class AudioEngine {
    private var opened = false
    init { System.loadLibrary("sonicsync_audio") }
    fun open() { if (opened) return; check(nativeOpen()) { "Oboe output stream could not be opened" }; opened = true }
    fun close() { if (opened) nativeClose(); opened = false }
    fun scheduleTestTone(delayMs: Long = 500) {
        ensureOpen()
        nativeScheduleTestTone(SystemClock.elapsedRealtimeNanos() + delayMs * 1_000_000L)
    }
    fun queuePcm(samples: FloatArray, channels: Int = 2): Int {
        val frames = tryQueuePcm(samples, channels)
        check(frames > 0) { "Native PCM ring is full; media decoder must wait and retry" }
        return frames
    }
    fun tryQueuePcm(samples: FloatArray, channels: Int = 2): Int {
        ensureOpen(); require(channels in 1..2); require(samples.size % channels == 0)
        val buffer=ByteBuffer.allocateDirect(samples.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        buffer.put(samples).flip()
        val frames=samples.size/channels
        return if (nativeQueuePcm(buffer,frames,channels)) frames else 0
    }
    fun scheduleQueuedPcm(delayMs: Long = 500) {
        ensureOpen(); scheduleQueuedPcmAt(SystemClock.elapsedRealtimeNanos() + delayMs * 1_000_000L)
    }
    fun scheduleQueuedPcmAt(hostStartNs: Long) {
        ensureOpen(); nativeSchedulePcm(hostStartNs)
    }
    fun underruns(): Long = nativeUnderruns()
    fun queuedFrames(): Int = nativeQueuedFrames()
    fun outputLatencyMs(): Double = nativeLatencyMillis()
    private fun ensureOpen(){check(opened){"Audio engine is not open"}}
    protected fun finalize(){close()}
    private external fun nativeOpen(): Boolean
    private external fun nativeClose()
    private external fun nativeScheduleTestTone(hostStartNs: Long)
    private external fun nativeQueuePcm(buffer: java.nio.FloatBuffer, frames: Int, channels: Int): Boolean
    private external fun nativeSchedulePcm(hostStartNs: Long)
    private external fun nativeUnderruns(): Long
    private external fun nativeQueuedFrames(): Int
    private external fun nativeLatencyMillis(): Double
}
