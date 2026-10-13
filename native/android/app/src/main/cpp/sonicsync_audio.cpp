#include <oboe/Oboe.h>
#include <jni.h>
#include <android/log.h>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>
#include <algorithm>
#include <ctime>

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "SonicSyncAudio", __VA_ARGS__)

class SonicSyncAudio final : public oboe::AudioStreamDataCallback {
public:
    static constexpr uint32_t RING_FRAMES = 48000 * 10;
    oboe::AudioStream *stream = nullptr;
    std::vector<float> ring{RING_FRAMES * 2, 0.0f};
    std::atomic<uint32_t> readFrame{0}, writeFrame{0};
    std::atomic<bool> enabled{false}, toneMode{false};
    std::atomic<uint64_t> startHostNs{0};
    std::atomic<uint64_t> underruns{0};
    double phase = 0.0;

    static uint64_t nowMonotonicNs() {
        timespec ts{}; clock_gettime(CLOCK_MONOTONIC, &ts);
        return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
    }

    uint32_t queuedFrames() const {
        uint32_t w=writeFrame.load(std::memory_order_acquire), r=readFrame.load(std::memory_order_acquire);
        return (w + RING_FRAMES - r) % RING_FRAMES;
    }

    bool push(const float* src, uint32_t frames, int channels) {
        if (channels < 1 || channels > 2) return false;
        if (frames >= RING_FRAMES || queuedFrames() + frames >= RING_FRAMES - 1) return false;
        uint32_t w=writeFrame.load(std::memory_order_relaxed);
        for(uint32_t i=0;i<frames;i++) {
            const float l=src[i*channels], r=(channels==2?src[i*channels+1]:l);
            ring[((w+i)%RING_FRAMES)*2]=l; ring[((w+i)%RING_FRAMES)*2+1]=r;
        }
        writeFrame.store((w+frames)%RING_FRAMES, std::memory_order_release);
        return true;
    }

    oboe::DataCallbackResult onAudioReady(oboe::AudioStream*, void* audioData, int32_t numFrames) override {
        auto* out=static_cast<float*>(audioData); const int32_t channels=stream?stream->getChannelCount():2;
        const bool active=enabled.load(std::memory_order_relaxed) && nowMonotonicNs() >= startHostNs.load(std::memory_order_acquire);
        if(!active){std::fill(out,out+numFrames*channels,0.0f);return oboe::DataCallbackResult::Continue;}
        if(toneMode.load(std::memory_order_relaxed)){
            const int32_t sr=stream?stream->getSampleRate():48000;
            for(int32_t i=0;i<numFrames;i++){float s=(float)(0.08*std::sin(phase));phase+=2*M_PI*440.0/sr;if(phase>2*M_PI)phase-=2*M_PI;for(int32_t c=0;c<channels;c++)out[i*channels+c]=s;}
            return oboe::DataCallbackResult::Continue;
        }
        uint32_t r=readFrame.load(std::memory_order_relaxed), w=writeFrame.load(std::memory_order_acquire);
        uint32_t avail=(w+RING_FRAMES-r)%RING_FRAMES; uint32_t n=std::min<uint32_t>(avail,(uint32_t)numFrames);
        for(uint32_t i=0;i<n;i++){out[i*channels]=ring[((r+i)%RING_FRAMES)*2];if(channels>1)out[i*channels+1]=ring[((r+i)%RING_FRAMES)*2+1];}
        for(uint32_t i=n;i<(uint32_t)numFrames;i++){for(int32_t c=0;c<channels;c++)out[i*channels+c]=0.0f;}
        if(n < (uint32_t)numFrames) underruns.fetch_add(1,std::memory_order_relaxed);
        readFrame.store((r+n)%RING_FRAMES,std::memory_order_release);
        return oboe::DataCallbackResult::Continue;
    }

    bool open() {
        oboe::AudioStreamBuilder builder;
        builder.setDirection(oboe::Direction::Output)->setPerformanceMode(oboe::PerformanceMode::LowLatency)
            ->setSharingMode(oboe::SharingMode::Exclusive)->setFormat(oboe::AudioFormat::Float)
            ->setChannelCount(2)->setSampleRate(48000)->setDataCallback(this)->setUsage(oboe::Usage::Media);
        auto r=builder.openStream(&stream);if(r!=oboe::Result::OK){LOGI("openStream failed: %s",oboe::convertToText(r));return false;}
        r=stream->requestStart();if(r!=oboe::Result::OK){LOGI("requestStart failed: %s",oboe::convertToText(r));stream->close();stream=nullptr;return false;}return true;
    }
    void close(){enabled.store(false);if(stream){stream->requestStop();stream->close();stream=nullptr;}}
    void schedule(uint64_t hostStartNs,bool tone){startHostNs.store(hostStartNs,std::memory_order_release);toneMode.store(tone,std::memory_order_release);readFrame.store(0);if(!tone)writeFrame.store(0);enabled.store(true,std::memory_order_release);}
};

static SonicSyncAudio g_audio;
extern "C" JNIEXPORT jboolean JNICALL Java_com_sonicsync_nativeapp_AudioEngine_nativeOpen(JNIEnv*,jobject){return g_audio.open();}
extern "C" JNIEXPORT void JNICALL Java_com_sonicsync_nativeapp_AudioEngine_nativeClose(JNIEnv*,jobject){g_audio.close();}
extern "C" JNIEXPORT void JNICALL Java_com_sonicsync_nativeapp_AudioEngine_nativeScheduleTestTone(JNIEnv*,jobject,jlong hostStartNs){g_audio.schedule((uint64_t)hostStartNs,true);}
extern "C" JNIEXPORT jboolean JNICALL Java_com_sonicsync_nativeapp_AudioEngine_nativeQueuePcm(JNIEnv* env,jobject,jobject floatBuffer,jint frames,jint channels){
    if(frames<=0||channels<1||channels>2)return JNI_FALSE;
    auto* ptr=static_cast<float*>(env->GetDirectBufferAddress(floatBuffer));if(!ptr)return JNI_FALSE;
    return g_audio.push(ptr,(uint32_t)frames,channels)?JNI_TRUE:JNI_FALSE;
}
extern "C" JNIEXPORT void JNICALL Java_com_sonicsync_nativeapp_AudioEngine_nativeSchedulePcm(JNIEnv*,jobject,jlong hostStartNs){g_audio.schedule((uint64_t)hostStartNs,false);}
extern "C" JNIEXPORT jlong JNICALL Java_com_sonicsync_nativeapp_AudioEngine_nativeUnderruns(JNIEnv*,jobject){return (jlong)g_audio.underruns.load();}
extern "C" JNIEXPORT jint JNICALL Java_com_sonicsync_nativeapp_AudioEngine_nativeQueuedFrames(JNIEnv*,jobject){return (jint)g_audio.queuedFrames();}
extern "C" JNIEXPORT jdouble JNICALL Java_com_sonicsync_nativeapp_AudioEngine_nativeLatencyMillis(JNIEnv*,jobject){
    if(!g_audio.stream) return -1.0;
    auto result=g_audio.stream->calculateLatencyMillis();
    return result ? result.value() : -1.0;
}
