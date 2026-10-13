package com.sonicsync.nativeapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder

class SonicSyncPlaybackService : Service() {
    private lateinit var audio: AudioEngine
    private lateinit var media: NativeMediaPlayer
    private val binder = LocalBinder()

    inner class LocalBinder : android.os.Binder() {
        fun service(): SonicSyncPlaybackService = this@SonicSyncPlaybackService
    }

    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel("sonicsync", "SonicSync playback", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        startForeground(
            7,
            Notification.Builder(this, "sonicsync")
                .setContentTitle("SonicSync")
                .setContentText("Synchronized native playback active")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .build()
        )
        audio = AudioEngine()
        media = NativeMediaPlayer(audio)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    fun playTestTone() {
        audio.open()
        audio.scheduleTestTone()
    }

    fun playValidationMedia() {
        val file = java.io.File(cacheDir, "sonicsync_smoke.wav")
        if (!file.exists()) {
            resources.openRawResource(R.raw.sonicsync_smoke).use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
        }
        media.playWav(file.absolutePath)
    }

    fun stopPlayback() = media.stop()
    fun outputLatencyMs(): Double = audio.outputLatencyMs()
    fun underruns(): Long = audio.underruns()

    override fun onDestroy() {
        media.stop()
        audio.close()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder = binder
}
