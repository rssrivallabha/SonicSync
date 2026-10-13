package com.sonicsync.nativeapp

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Monotonic NTP-style estimator. All timestamps are elapsedRealtimeNanos(). */
data class ClockSample(val t1: Long, val t2: Long, val t3: Long, val t4: Long) {
    val rttNs: Long get() = max(0L, ((t4 - t1) - (t3 - t2)))
    val offsetNs: Long get() = ((t2 - t1) + (t3 - t4)) / 2
}

data class ClockModel(val offsetNs: Long, val driftPpm: Double, val jitterNs: Long, val uncertaintyNs: Long, val confidence: Double, val sampleCount: Int)

class ClockEstimator {
    private val samples = ArrayDeque<ClockSample>()
    fun add(sample: ClockSample): ClockModel {
        if (sample.rttNs < 0) return model()
        samples.add(sample)
        while (samples.size > 32) samples.removeFirst()
        return model()
    }
    fun model(): ClockModel {
        if (samples.isEmpty()) return ClockModel(0, 0.0, 0, Long.MAX_VALUE, 0.0, 0)
        val list = samples.sortedBy { it.rttNs }
        val minRtt = list.first().rttNs
        val eligible = list.filter { it.rttNs <= minRtt + max(2_000_000L, list.map { s -> s.rttNs }.median() / 4) }
        val offsets = eligible.map { it.offsetNs }.sorted()
        val center = offsets.median()
        val deviations = offsets.map { abs(it - center) }.sorted()
        val jitter = deviations.median()
        val uncertainty = max(500_000L, jitter + minRtt / 2)
        var driftPpm = 0.0
        if (eligible.size >= 3) {
            val t0 = eligible.first().t1.toDouble()
            var sx=0.0; var sy=0.0; var sxx=0.0; var sxy=0.0
            eligible.forEach { val x=(it.t1 + it.t4).toDouble()/2.0 - t0; val y=it.offsetNs.toDouble(); sx+=x; sy+=y; sxx+=x*x; sxy+=x*y }
            val den = eligible.size*sxx - sx*sx
            if (kotlin.math.abs(den) > 1e-9) driftPpm=((eligible.size*sxy - sx*sy)/den)*1e6
        }
        val confidence = min(1.0, eligible.size / 8.0) * (1.0 / (1.0 + uncertainty / 8_000_000.0))
        return ClockModel(center, driftPpm.coerceIn(-500.0,500.0), jitter, uncertainty, confidence, samples.size)
    }
    private fun List<Long>.median(): Long = if (isEmpty()) 0 else if (size % 2 == 1) this[size / 2] else (this[size/2 - 1] + this[size/2]) / 2
}
