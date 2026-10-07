package com.sonicsync.android

import android.app.Activity
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var running = false
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val audioManager = getSystemService(AudioManager::class.java)
        val sampleRate = audioManager
            .getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)
            ?.toIntOrNull()
            ?: 48000
        val framesPerBurst = audioManager
            .getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER)
            ?.toIntOrNull()
            ?: 192

        NativeAudio.open(sampleRate, framesPerBurst)

        status = TextView(this).apply {
            textSize = 14f
            setPadding(24, 24, 24, 24)
        }

        val start = Button(this).apply {
            text = "Start audio stream"
            setOnClickListener {
                NativeAudio.start()
                running = true
                update()
            }
        }

        val sync = Button(this).apply {
            text = "Schedule test click +1s"
            setOnClickListener {
                NativeAudio.schedule(System.nanoTime() + 1_000_000_000L)
                update()
            }
        }

        val stop = Button(this).apply {
            text = "Stop"
            setOnClickListener {
                NativeAudio.stop()
                running = false
                update()
            }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 48, 24, 24)
            addView(status)
            addView(start)
            addView(sync)
            addView(stop)
        }

        setContentView(root)
        update()
    }

    private fun update() {
        val audioManager = getSystemService(AudioManager::class.java)
        val route = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .joinToString { it.productName.toString() }

        status.text =
            "SonicSync Android native audio\n" +
            "Running: " + running + "\n" +
            "Native sample rate: " + NativeAudio.sampleRate() + "\n" +
            "Latency estimate: " + NativeAudio.latencyMillis() + " ms\n" +
            "Frames written: " + NativeAudio.framesWritten() + "\n" +
            "Marker fired: " + NativeAudio.markerFired() + "\n" +
            "Native error: " + NativeAudio.failed() + "\n" +
            "Outputs: " + if (route.isEmpty()) "unknown" else route

        if (running) {
            handler.postDelayed(::update, 500)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        NativeAudio.close()
        super.onDestroy()
    }
}
