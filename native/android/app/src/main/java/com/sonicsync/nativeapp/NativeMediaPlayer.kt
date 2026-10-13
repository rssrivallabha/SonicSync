package com.sonicsync.nativeapp

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Streaming native media adapter. Keeps RAM bounded and feeds Oboe's native ring ahead of the
 * scheduled deadline; transport timing never becomes the sample playback clock.
 */
class NativeMediaPlayer(private val audio: AudioEngine) {
    private var worker: Thread? = null
    private var active = AtomicBoolean(false)
    private var stream: WavPcmStream? = null

    fun playWav(path: String, delayMs: Long = 1500) {
        stop()
        audio.open()
        val wav = WavPcmStream.open(path)
        require(wav.sampleRate == 48_000) { "SonicSync native validation media must be 48 kHz; resample before queueing" }
        stream = wav
        active.set(true)
        val target = android.os.SystemClock.elapsedRealtimeNanos() + delayMs.coerceAtLeast(500) * 1_000_000L
        val minimumPrebufferFrames = minOf(48_000, maxOf(24_000, (delayMs.coerceAtMost(4_000) * 48).toInt()))
        fillUntil(minimumPrebufferFrames)
        audio.scheduleQueuedPcmAt(target)
        worker = Thread {
            try {
                while (active.get()) {
                    val queued = audio.queuedFrames()
                    if (queued < 24_000 && stream?.eof == false) fillUntil(48_000)
                    if (stream?.eof == true && queued == 0) break
                    Thread.sleep(20)
                }
            } catch (_: InterruptedException) {
                // stop() owns teardown.
            } finally {
                active.set(false)
                stream?.close()
                stream = null
            }
        }.also { it.name = "SonicSync-media-refill"; it.isDaemon = true; it.start() }
    }

    fun stop() {
        active.set(false)
        worker?.interrupt()
        worker = null
        stream?.close()
        stream = null
    }

    private fun fillUntil(targetFrames: Int) {
        val wav = stream ?: return
        while (active.get() && audio.queuedFrames() < targetFrames && !wav.eof) {
            val chunk = wav.readFrames(960)
            if (chunk.isEmpty()) break
            while (active.get() && audio.tryQueuePcm(chunk, wav.channels) == 0) Thread.sleep(5)
            if (!active.get()) break
        }
    }
}
