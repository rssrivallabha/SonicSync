#include "native_audio.h"
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>

struct NativeAudio::Impl {
    std::atomic<bool> running{false};
    std::atomic<uint64_t> startNs{0};
    NativeAudioMetrics metrics;
    double phase = 0.0;
#if defined(_WIN32)
    void* thread = nullptr; void* stopEvent = nullptr; void* audioClient = nullptr; void* renderClient = nullptr;
#elif defined(__APPLE__)
    void* audioUnit = nullptr;
#elif defined(__linux__)
    void* loop = nullptr; void* stream = nullptr;
#endif
};

static uint64_t steadyNs() {
    return (uint64_t)std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <avrt.h>
#include <wrl/client.h>
using Microsoft::WRL::ComPtr;

static DWORD WINAPI wasapiThread(LPVOID arg) {
    auto* p = static_cast<NativeAudio::Impl*>(arg);
    auto* client = static_cast<IAudioClient*>(p->audioClient);
    auto* render = static_cast<IAudioRenderClient*>(p->renderClient);
    HANDLE event = static_cast<HANDLE>(p->stopEvent);
    HRESULT co = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    HANDLE task = AvSetMmThreadCharacteristicsW(L"Pro Audio", nullptr);
    client->Start();
    p->running.store(true);
    WAVEFORMATEX* fmt=nullptr; client->GetMixFormat(&fmt);
    const double sr = fmt ? (double)fmt->nSamplesPerSec : 48000.0;
    const int channels = fmt ? (int)fmt->nChannels : 2;
    while (p->running.load()) {
        if (WaitForSingleObject(event, 1000) != WAIT_OBJECT_0) continue;
        UINT32 padding=0, bufferFrames=0; client->GetCurrentPadding(&padding); client->GetBufferSize(&bufferFrames);
        const UINT32 avail = bufferFrames - padding;
        BYTE* data=nullptr;
        if (avail && SUCCEEDED(render->GetBuffer(avail, &data))) {
            auto* out=reinterpret_cast<float*>(data);
            const bool active = steadyNs() >= p->startNs.load();
            for(UINT32 i=0;i<avail;i++){
                const float s=active?(float)(0.08*std::sin(p->phase)):0.0f;
                p->phase += 2.0*M_PI*440.0/sr; if(p->phase>2.0*M_PI)p->phase-=2.0*M_PI;
                for(int c=0;c<channels;c++) out[i*channels+c]=s;
            }
            render->ReleaseBuffer(avail,0);
        }
    }
    client->Stop(); CoTaskMemFree(fmt); if(task) AvRevertMmThreadCharacteristics(task); if(SUCCEEDED(co)) CoUninitialize();
    return 0;
}
#endif

#if defined(__APPLE__)
#include <AudioToolbox/AudioToolbox.h>
#include <AudioUnit/AudioUnit.h>
#include <mach/mach_time.h>
static OSStatus renderCallback(void* ref, AudioUnitRenderActionFlags*, const AudioTimeStamp* ts, UInt32, UInt32 nFrames, AudioBufferList* io) {
    auto* p=static_cast<NativeAudio::Impl*>(ref); const bool active=ts && ts->mHostTime>=p->startNs.load();
    for(UInt32 b=0;b<io->mNumberBuffers;b++){
        auto* out=static_cast<float*>(io->mBuffers[b].mData); const UInt32 channels=io->mBuffers[b].mNumberChannels;
        for(UInt32 i=0;i<nFrames;i++){
            float s=active?(float)(0.08*std::sin(p->phase)):0.0f;
            p->phase += 2.0*M_PI*440.0/48000.0; if(p->phase>2.0*M_PI)p->phase-=2.0*M_PI;
            for(UInt32 c=0;c<channels;c++) out[i*channels+c]=s;
        }
    }
    return noErr;
}
#endif

#if defined(__linux__) && SONICSYNC_HAS_PIPEWIRE
#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>
static void pwProcess(void* user){
    auto* p=static_cast<NativeAudio::Impl*>(user); auto* b=pw_stream_dequeue_buffer((pw_stream*)p->stream); if(!b)return;
    auto* d=&b->buffer->datas[0]; if(!d->data){pw_stream_queue_buffer((pw_stream*)p->stream,b);return;}
    const uint32_t frames=d->chunk->size/sizeof(float)/2; auto* out=(float*)d->data; const bool active=steadyNs()>=p->startNs.load();
    for(uint32_t i=0;i<frames;i++){float s=active?(float)(0.08*std::sin(p->phase)):0.0f; p->phase+=2*M_PI*440.0/48000.0; if(p->phase>2*M_PI)p->phase-=2*M_PI; out[i*2]=s; out[i*2+1]=s;}
    pw_stream_queue_buffer((pw_stream*)p->stream,b);
}
#endif

NativeAudio::NativeAudio():impl_(new Impl){}
NativeAudio::~NativeAudio(){stop();delete impl_;}

bool NativeAudio::startTestTone(uint64_t startHostNs){
#if defined(__APPLE__)
    mach_timebase_info_data_t tb{}; mach_timebase_info(&tb);
    const uint64_t nowHost=mach_absolute_time(); const uint64_t nowMono=steadyNs(); const uint64_t delta=startHostNs>nowMono?startHostNs-nowMono:0;
    const uint64_t q=delta/uint64_t(tb.numer), r=delta%uint64_t(tb.numer);
    impl_->startNs.store(nowHost + q*uint64_t(tb.denom) + (r*uint64_t(tb.denom))/uint64_t(tb.numer));
#else
    impl_->startNs.store(startHostNs);
#endif
#if defined(_WIN32)
    ComPtr<IMMDeviceEnumerator> enumerator; HRESULT hr=CoInitializeEx(nullptr,COINIT_MULTITHREADED); (void)hr;
    if(FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&enumerator))))return false;
    ComPtr<IMMDevice> device; if(FAILED(enumerator->GetDefaultAudioEndpoint(eRender,eMultimedia,&device)))return false;
    ComPtr<IAudioClient> client; if(FAILED(device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,&client)))return false;
    WAVEFORMATEX* fmt=nullptr; if(FAILED(client->GetMixFormat(&fmt)))return false;
    REFERENCE_TIME period=0;client->GetDevicePeriod(&period,nullptr);HANDLE ev=CreateEvent(nullptr,FALSE,FALSE,nullptr);if(!ev){CoTaskMemFree(fmt);return false;}
    if(FAILED(client->Initialize(AUDCLNT_SHAREMODE_SHARED,AUDCLNT_STREAMFLAGS_EVENTCALLBACK,period*2,0,fmt,nullptr))){CloseHandle(ev);CoTaskMemFree(fmt);return false;}
    client->SetEventHandle(ev);ComPtr<IAudioRenderClient> render;if(FAILED(client->GetService(IID_PPV_ARGS(&render)))){CloseHandle(ev);CoTaskMemFree(fmt);return false;}
    impl_->audioClient=client.Detach();impl_->renderClient=render.Detach();impl_->stopEvent=ev;impl_->metrics={(double)period/10000.0,(double)fmt->nSamplesPerSec,(int)fmt->nChannels,false,"WASAPI","device-period estimate; physical output latency unmeasured"};CoTaskMemFree(fmt);
    impl_->running.store(true); impl_->thread=CreateThread(nullptr,0,wasapiThread,impl_,0,nullptr); return impl_->thread!=nullptr;
#elif defined(__APPLE__)
    AudioComponentDescription desc{};desc.componentType=kAudioUnitType_Output;desc.componentSubType=kAudioUnitSubType_DefaultOutput;desc.componentManufacturer=kAudioUnitManufacturer_Apple;
    AudioComponent comp=AudioComponentFindNext(nullptr,&desc);if(!comp)return false;AudioUnit unit=nullptr;if(AudioComponentInstanceNew(comp,&unit)!=noErr)return false;
    AURenderCallbackStruct cb{renderCallback,impl_};AudioUnitSetProperty(unit,kAudioUnitProperty_SetRenderCallback,kAudioUnitScope_Input,0,&cb,sizeof(cb));
    AudioStreamBasicDescription asbd{48000,kAudioFormatLinearPCM,kAudioFormatFlagIsFloat|kAudioFormatFlagIsPacked,32,8,2,2,0,0};AudioUnitSetProperty(unit,kAudioUnitProperty_StreamFormat,kAudioUnitScope_Input,0,&asbd,sizeof(asbd));
    if(AudioUnitInitialize(unit)!=noErr){AudioComponentInstanceDispose(unit);return false;}if(AudioOutputUnitStart(unit)!=noErr){AudioUnitUninitialize(unit);AudioComponentInstanceDispose(unit);return false;}
    impl_->audioUnit=unit;impl_->metrics={-1,48000,2,true,"CoreAudio","unmeasured; validate route latency with loopback/tap fixture"};impl_->running.store(true);return true;
#elif defined(__linux__) && SONICSYNC_HAS_PIPEWIRE
    pw_init(nullptr,nullptr);auto* loop=pw_thread_loop_new("sonicsync",nullptr);if(!loop)return false;impl_->loop=loop;
    pw_stream_events events{};events.version=PW_VERSION_STREAM_EVENTS;events.process=[](void*u){pwProcess(u);};
    auto* props=pw_properties_new(PW_KEY_MEDIA_TYPE,"Audio",PW_KEY_MEDIA_CATEGORY,"Playback",PW_KEY_MEDIA_ROLE,"Music",nullptr);
    auto* stream=pw_stream_new_simple(pw_thread_loop_get_loop(loop),"SonicSync",props,&events,impl_);if(!stream)return false;
    uint8_t podBuf[1024];spa_pod_builder builder=SPA_POD_BUILDER_INIT(podBuf,sizeof(podBuf));const spa_pod* params[1]={spa_format_audio_raw_build(&builder,SPA_AUDIO_FORMAT_F32,48000,2,1,2,0)};
    if(pw_stream_connect(stream,PW_DIRECTION_OUTPUT,PW_ID_ANY,(pw_stream_flags)(PW_STREAM_FLAG_AUTOCONNECT|PW_STREAM_FLAG_MAP_BUFFERS),params,1)<0){pw_stream_destroy(stream);return false;}
    impl_->stream=stream;impl_->metrics={-1,48000,2,true,"PipeWire","unmeasured; validate route latency with loopback/tap fixture"};impl_->running.store(true);pw_thread_loop_start(loop);return true;
#else
    (void)startHostNs; impl_->metrics={-1,0,0,false,"Native backend unavailable","unavailable"}; return false;
#endif
}

void NativeAudio::stop(){
    if(!impl_||!impl_->running.exchange(false))return;
#if defined(_WIN32)
    if(impl_->stopEvent)SetEvent((HANDLE)impl_->stopEvent);if(impl_->thread){WaitForSingleObject((HANDLE)impl_->thread,2000);CloseHandle((HANDLE)impl_->thread);impl_->thread=nullptr;}if(impl_->audioClient){((IAudioClient*)impl_->audioClient)->Release();impl_->audioClient=nullptr;}if(impl_->renderClient){((IAudioRenderClient*)impl_->renderClient)->Release();impl_->renderClient=nullptr;}if(impl_->stopEvent){CloseHandle((HANDLE)impl_->stopEvent);impl_->stopEvent=nullptr;}
#elif defined(__APPLE__)
    if(impl_->audioUnit){AudioOutputUnitStop((AudioUnit)impl_->audioUnit);AudioUnitUninitialize((AudioUnit)impl_->audioUnit);AudioComponentInstanceDispose((AudioUnit)impl_->audioUnit);impl_->audioUnit=nullptr;}
#elif defined(__linux__) && SONICSYNC_HAS_PIPEWIRE
    if(impl_->stream){pw_stream_destroy((pw_stream*)impl_->stream);impl_->stream=nullptr;}if(impl_->loop){pw_thread_loop_stop((pw_thread_loop*)impl_->loop);pw_thread_loop_destroy((pw_thread_loop*)impl_->loop);impl_->loop=nullptr;}pw_deinit();
#endif
    impl_->metrics.running=false;
}

NativeAudioMetrics NativeAudio::metrics() const{return impl_->metrics;}
