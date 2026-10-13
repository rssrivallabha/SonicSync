#include "native_audio.h"
#include "local_transport.h"
#include <chrono>
#include <iostream>
#include <thread>

static uint64_t monoNs() {
    return (uint64_t)std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

int main(int argc, char** argv) {
    uint64_t leadMs = 1000;
    std::string room;
    bool host = false, discover = false;
    for (int i = 1; i + 1 < argc; ++i) {
        if (std::string(argv[i]) == "--lead-ms") leadMs = std::stoull(argv[i+1]);
        if (std::string(argv[i]) == "--host") { host = true; room = argv[i+1]; }
        if (std::string(argv[i]) == "--discover") { discover = true; room = argv[i+1]; }
    }
    LocalTransport transport([](const std::string& message) { std::cout << "control-rx=" << message << '\n'; });
    if (host && !transport.startHost(room)) { std::cerr << "local transport host initialization failed\n"; return 3; }
    if (discover && !transport.discoverAndConnect(room)) { std::cerr << "local transport discovery initialization failed\n"; return 3; }
    NativeAudio audio;
    const auto target = monoNs() + leadMs * 1000000ull;
    if (!audio.startTestTone(target)) {
        std::cerr << "SonicSync native audio: backend initialization failed\n";
        return 2;
    }
    for (int i = 0; i < 15; ++i) {
        const auto m = audio.metrics();
        std::cout << "backend=" << m.backend << " sampleRate=" << m.sampleRate
                  << " channels=" << m.channels << " outputLatencyMs=" << m.outputLatencyMs
                  << " latencySource=\"" << m.latencySource << "\" running=" << (m.running ? "true" : "false") << '\n';
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    audio.stop();
    transport.stop();
    return 0;
}
