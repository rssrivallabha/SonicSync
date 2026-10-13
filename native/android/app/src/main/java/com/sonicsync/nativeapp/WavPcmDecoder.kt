package com.sonicsync.nativeapp

import java.io.Closeable
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Streaming PCM16 WAV reader: only bounded chunks are decoded into RAM. */
class WavPcmStream private constructor(private val file: RandomAccessFile) : Closeable {
    val sampleRate: Int
    val channels: Int
    val bitsPerSample: Int
    private var bytesRemaining: Long

    init {
        require(readAscii(4) == "RIFF") { "Not a RIFF WAV" }
        readIntLE()
        require(readAscii(4) == "WAVE") { "Not WAVE" }
        var localChannels = 0
        var localSampleRate = 0
        var localBits = 0
        var localDataOffset = -1L
        var localDataSize = 0L
        while (file.filePointer + 8L <= file.length()) {
            val id = readAscii(4)
            val rawSize = Integer.toUnsignedLong(readIntLE())
            require(rawSize <= file.length() - file.filePointer) { "WAV chunk exceeds file" }
            val next = file.filePointer + rawSize
            when (id) {
                "fmt " -> {
                    require(rawSize >= 16) { "Invalid fmt chunk" }
                    val format = readShortLE().toInt() and 0xffff
                    localChannels = readShortLE().toInt() and 0xffff
                    localSampleRate = readIntLE()
                    readIntLE()
                    readShortLE()
                    localBits = readShortLE().toInt() and 0xffff
                    require(format == 1 && localChannels in 1..2 && localBits == 16) { "Only PCM16 mono/stereo WAV is supported" }
                }
                "data" -> {
                    localDataOffset = file.filePointer
                    localDataSize = rawSize
                }
            }
            file.seek(next + (rawSize and 1L))
        }
        require(localDataOffset >= 0 && localDataSize > 0) { "WAV data chunk missing" }
        sampleRate = localSampleRate
        channels = localChannels
        bitsPerSample = localBits
        bytesRemaining = localDataSize
        file.seek(localDataOffset)
    }

    val remainingFrames: Long get() = bytesRemaining / (channels * 2L)
    val eof: Boolean get() = bytesRemaining < channels * 2L

    /** Read at most [maxFrames]; returns interleaved normalized float PCM. */
    fun readFrames(maxFrames: Int): FloatArray {
        require(maxFrames > 0)
        val frameBytes = channels * 2L
        val frames = minOf(maxFrames.toLong(), bytesRemaining / frameBytes).toInt()
        if (frames <= 0) return FloatArray(0)
        val raw = ByteArray(frames * channels * 2)
        file.readFully(raw)
        bytesRemaining -= raw.size.toLong()
        val bb = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN)
        return FloatArray(raw.size / 2) { bb.short.toInt() / 32768f }
    }

    override fun close() = file.close()

    private fun readAscii(n: Int): String = ByteArray(n).also(file::readFully).toString(Charsets.US_ASCII)
    private fun readIntLE(): Int = Integer.reverseBytes(file.readInt())
    private fun readShortLE(): Short = java.lang.Short.reverseBytes(file.readShort())

    companion object {
        fun open(path: String): WavPcmStream = WavPcmStream(RandomAccessFile(path, "r"))
    }
}

/** Compatibility helper for small deterministic tests; production playback should stream. */
object WavPcmDecoder {
    fun decode(path: String): PcmWav {
        WavPcmStream.open(path).use { stream ->
            val all = FloatArray((stream.remainingFrames * stream.channels).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
            var cursor = 0
            while (!stream.eof) {
                val chunk = stream.readFrames(4096)
                if (chunk.isEmpty()) break
                chunk.copyInto(all, cursor)
                cursor += chunk.size
            }
            return PcmWav(stream.sampleRate, stream.channels, all.copyOf(cursor))
        }
    }
}

data class PcmWav(val sampleRate: Int, val channels: Int, val samples: FloatArray)
