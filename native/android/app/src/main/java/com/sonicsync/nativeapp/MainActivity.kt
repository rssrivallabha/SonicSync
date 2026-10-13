package com.sonicsync.nativeapp

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : Activity() {
    private var nearby: NearbyRoomTransport? = null
    private var playback: SonicSyncPlaybackService? = null
    private var bound = false
    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            playback = (service as SonicSyncPlaybackService.LocalBinder).service()
            bound = true
        }
        override fun onServiceDisconnected(name: ComponentName?) { playback = null }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        requestNativePermissions()
        ContextCompat.startForegroundService(this, Intent(this, SonicSyncPlaybackService::class.java))
        bindService(Intent(this, SonicSyncPlaybackService::class.java), serviceConnection, BIND_AUTO_CREATE)

        val state = findViewById<TextView>(R.id.state)
        val telemetry = findViewById<TextView>(R.id.telemetry)
        val room = findViewById<EditText>(R.id.roomCode)
        findViewById<Button>(R.id.join).setOnClickListener {
            val code = room.text.toString().trim().uppercase()
            if (code.length != 6) { state.text = "FAILED · room code must be 6 characters"; return@setOnClickListener }
            nearby?.stop()
            nearby = NearbyRoomTransport(this, "SonicSync-${Build.MODEL}", code).also { transport ->
                transport.onControl = { message -> runOnUiThread { telemetry.text = "Control RX:\n$message" } }
                transport.onStatus = { message -> runOnUiThread { state.text = message } }
                transport.start()
            }
            state.text = "DISCOVERING · $code"
        }
        findViewById<Button>(R.id.testTone).setOnClickListener {
            try {
                playback?.playTestTone() ?: error("Native playback service is still starting")
                state.text = "PLAYING · Oboe native output"
                refreshTelemetry(telemetry)
            } catch (e: Exception) { state.text = "FAILED · ${e.message}" }
        }
        findViewById<Button>(R.id.playMedia).setOnClickListener {
            try {
                playback?.playValidationMedia() ?: error("Native playback service is still starting")
                state.text = "SCHEDULED · STREAMING PCM16"
                refreshTelemetry(telemetry)
            } catch (e: Exception) { state.text = "FAILED · ${e.message}" }
        }
        telemetry.text = "Clock offset: measured by NTP probes\nClock drift: model pending\nClock uncertainty: —\nPlayback phase error: —\nOutput latency: native query after stream start"
    }

    private fun refreshTelemetry(view: TextView) {
        val p = playback ?: return
        val latency = p.outputLatencyMs().takeIf { it >= 0 }?.let { "%.2f ms".format(it) } ?: "not reported"
        view.text = "Clock offset: measured by NTP probes\nClock drift: model pending\nClock uncertainty: —\nPlayback phase error: —\nOutput latency: $latency\nUnderruns: ${p.underruns()}"
    }

    private fun requestNativePermissions() {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT <= 30) permissions += Manifest.permission.ACCESS_FINE_LOCATION
        if (Build.VERSION.SDK_INT >= 31) {
            permissions += Manifest.permission.BLUETOOTH_SCAN
            permissions += Manifest.permission.BLUETOOTH_CONNECT
            permissions += Manifest.permission.BLUETOOTH_ADVERTISE
        }
        if (Build.VERSION.SDK_INT >= 33) {
            permissions += "android.permission.NEARBY_WIFI_DEVICES"
            permissions += Manifest.permission.POST_NOTIFICATIONS
        }
        ActivityCompat.requestPermissions(this, permissions.toTypedArray(), 100)
    }

    override fun onDestroy() {
        if (bound) { unbindService(serviceConnection); bound = false }
        nearby?.stop()
        super.onDestroy()
    }
}
