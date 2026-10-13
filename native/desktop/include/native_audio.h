#pragma once
#include <cstdint>
#include <string>

struct NativeAudioMetrics {
    // Exact physical output latency is only reported when the backend provides it. -1 means unmeasured.
    double outputLatencyMs = -1.0;
    double sampleRate = 0.0;
    int channels = 0;
    bool running = false;
    std::string backend;
    std::string latencySource;
};

class NativeAudio {
public:
    struct Impl;
    NativeAudio();
    ~NativeAudio();
    bool startTestTone(uint64_t startHostNs);
    void stop();
    NativeAudioMetrics metrics() const;
private:
    Impl* impl_;
};
