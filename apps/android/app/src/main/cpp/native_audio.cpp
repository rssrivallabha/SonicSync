#include <oboe/Oboe.h>
#include <android/log.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <ctime>
#include <memory>
#include <mutex>

#define LOG_TAG "SonicSyncAudio"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

static int64_t monotonicNanos() {
    timespec ts{};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000000000LL + ts.tv_nsec;
}

class SonicSyncCallback final : public oboe::AudioStreamDataCallback,
                                public oboe::AudioStreamErrorCallback {
public:
    explicit SonicSyncCallback(int32_t sampleRate)
        : sampleRate_(sampleRate) {}

    oboe::DataCallbackResult onAudioReady(
            oboe::AudioStream *,
            void *audioData,
            int32_t numFrames) override {
        auto *out = static_cast<float *>(audioData);
        const int64_t callbackNow = monotonicNanos();
        const int64_t start = scheduledStartNanos_.load(std::memory_order_acquire);
        const float gain = volume_.load(std::memory_order_relaxed);

        for (int32_t frame = 0; frame < numFrames; ++frame) {
            const int64_t frameTime =
                    callbackNow +
                    (static_cast<int64_t>(frame) * 1000000000LL) / sampleRate_;

            float sample = 0.0f;
            if (start > 0 && frameTime >= start) {
                const int64_t delta = frameTime - start;
                if (delta < 8000000LL) {
                    const double t = static_cast<double>(delta) / 1000000000.0;
                    const double envelope = 1.0 - std::min(1.0, t / 0.008);
                    sample = static_cast<float>(
                            0.8 * envelope *
                            std::sin(2.0 * M_PI * 1000.0 * t));
                    markerFired_.store(true, std::memory_order_release);
                }
            }

            out[frame * 2] = sample * gain;
            out[frame * 2 + 1] = sample * gain;
        }

        return oboe::DataCallbackResult::Continue;
    }

    void onErrorAfterClose(
            oboe::AudioStream *,
            oboe::Result result) override {
        LOGE("audio stream closed after error: %s", oboe::convertToText(result));
        streamFailed_.store(true, std::memory_order_release);
    }

    void onErrorBeforeClose(
            oboe::AudioStream *,
            oboe::Result result) override {
        LOGE("audio stream error: %s", oboe::convertToText(result));
        streamFailed_.store(true, std::memory_order_release);
    }

    void schedule(int64_t startNanos) {
        markerFired_.store(false, std::memory_order_release);
        streamFailed_.store(false, std::memory_order_release);
        scheduledStartNanos_.store(startNanos, std::memory_order_release);
    }

    void setVolume(float gain) {
        volume_.store(
                std::max(0.0f, std::min(1.0f, gain)),
                std::memory_order_release);
    }

    bool markerFired() const {
        return markerFired_.load(std::memory_order_acquire);
    }

    bool failed() const {
        return streamFailed_.load(std::memory_order_acquire);
    }

private:
    const int32_t sampleRate_;
    std::atomic<int64_t> scheduledStartNanos_{0};
    std::atomic<float> volume_{1.0f};
    std::atomic<bool> markerFired_{false};
    std::atomic<bool> streamFailed_{false};
};

class SonicSyncAudioEngine {
public:
    bool open(int32_t sampleRate, int32_t framesPerBurst) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (stream_) {
            return true;
        }

        if (sampleRate > 0) {
            oboe::DefaultStreamValues::SampleRate = sampleRate;
        }
        if (framesPerBurst > 0) {
            oboe::DefaultStreamValues::FramesPerBurst = framesPerBurst;
        }

        const int32_t effectiveRate =
                sampleRate > 0
                ? sampleRate
                : oboe::DefaultStreamValues::SampleRate;

        callback_ = std::make_shared<SonicSyncCallback>(effectiveRate);

        oboe::AudioStreamBuilder builder;
        builder.setDirection(oboe::Direction::Output)
                ->setFormat(oboe::AudioFormat::Float)
                ->setChannelCount(2)
                ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
                ->setDataCallback(callback_)
                ->setErrorCallback(callback_);

        oboe::Result result = builder.openStream(stream_);

        if (result != oboe::Result::OK) {
            builder.setSharingMode(oboe::SharingMode::Exclusive);
            result = builder.openStream(stream_);
        }

        if (result != oboe::Result::OK || !stream_) {
            LOGE("failed to open audio stream: %s", oboe::convertToText(result));
            stream_.reset();
            callback_.reset();
            return false;
        }

        sampleRate_ = stream_->getSampleRate();
        return true;
    }

    bool start() {
        std::lock_guard<std::mutex> lock(mutex_);
        return stream_ && stream_->requestStart() == oboe::Result::OK;
    }

    bool stop() {
        std::lock_guard<std::mutex> lock(mutex_);
        return stream_ && stream_->requestStop() == oboe::Result::OK;
    }

    bool schedule(int64_t startNanos) {
        if (!stream_ || !callback_) {
            return false;
        }
        callback_->schedule(startNanos);
        return true;
    }

    void setVolume(float gain) {
        if (callback_) {
            callback_->setVolume(gain);
        }
    }

    double latencyMillis() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!stream_) {
            return -1.0;
        }
        auto result = stream_->calculateLatencyMillis();
        return result ? result.value() : -1.0;
    }

    int64_t framesWritten() {
        std::lock_guard<std::mutex> lock(mutex_);
        return stream_ ? stream_->getFramesWritten() : -1;
    }

    int32_t sampleRate() const {
        return sampleRate_;
    }

    bool markerFired() const {
        return callback_ && callback_->markerFired();
    }

    bool failed() const {
        return callback_ && callback_->failed();
    }

    void close() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (stream_) {
            stream_->requestStop();
            stream_->close();
            stream_.reset();
        }
        callback_.reset();
    }

private:
    std::mutex mutex_;
    std::shared_ptr<oboe::AudioStream> stream_;
    std::shared_ptr<SonicSyncCallback> callback_;
    int32_t sampleRate_{0};
};

SonicSyncAudioEngine gEngine;

}  // namespace

extern "C" {

void ssAudioOpen(int32_t sampleRate, int32_t framesPerBurst) {
    gEngine.open(sampleRate, framesPerBurst);
}

void ssAudioStart() {
    gEngine.start();
}

void ssAudioStop() {
    gEngine.stop();
}

void ssAudioClose() {
    gEngine.close();
}

void ssAudioSchedule(int64_t startNanos) {
    gEngine.schedule(startNanos);
}

void ssAudioSetVolume(float gain) {
    gEngine.setVolume(gain);
}

double ssAudioLatencyMillis() {
    return gEngine.latencyMillis();
}

int64_t ssAudioFramesWritten() {
    return gEngine.framesWritten();
}

int32_t ssAudioSampleRate() {
    return gEngine.sampleRate();
}

int ssAudioMarkerFired() {
    return gEngine.markerFired() ? 1 : 0;
}

int ssAudioFailed() {
    return gEngine.failed() ? 1 : 0;
}

}
