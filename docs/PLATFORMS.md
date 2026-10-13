# Platform Matrix — v10 continuation

| Platform | Native path | Local transport | Current verification | Missing proof |
|---|---|---|---|---|
| Web/PWA | Web Audio / WebRTC/LAN | browser/LAN | existing v10 validation | device matrix |
| Android | Oboe + JNI PCM queue | Nearby Connections | source/static | Android Studio device build + audio measurement |
| iOS | AVAudioEngine | Network.framework Bonjour/TCP | Swift parser + source/static | Xcode/iPhone build + route/interruption tests |
| Windows | WASAPI | local TCP/UDP boundary | source + common C++ build on Linux | Windows build/device audio test |
| macOS | CoreAudio | local TCP/UDP boundary | source/static | macOS build/device test |
| Linux | PipeWire | local TCP/UDP boundary | common C++ build; PipeWire dev package absent here | actual PipeWire-linked run |
| ESP32-S3 | I2S → DAC/amp | local UDP control | source/static | ESP-IDF flash + scope/acoustic measurement |

Native APIs are intentionally used rather than treating the browser path as production-equivalent.
