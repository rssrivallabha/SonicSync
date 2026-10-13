# Native build guide

## Android

Open `native/android` in Android Studio. The project targets API 36, uses Google Nearby Connections `19.5.1`, and uses Oboe `1.11.0`.

Build with Android SDK/NDK installed and run on a physical device. The Oboe path requests low-latency performance mode, exclusive sharing when available, 48 kHz and callback-driven output. `NativeMediaPlayer` streams PCM16 WAV data in bounded chunks into the native ring, and the engine exposes Oboe's platform-reported `calculateLatencyMillis()` value when available. Oboe documents that this latency API estimates app-to-DAC latency and can omit unknown external-device delay. citeturn294301view0turn200387search0

## iOS

Open `native/ios/SonicSyncIOS/Package.swift` in Xcode or embed the package in an iOS app target. Add `Info.plist` and the required Local Network/Bonjour/background-audio capabilities. Use a physical iPhone for route, interruption, screen-lock and scheduling validation.

## Desktop

```bash
cmake -S native/desktop -B build/native-desktop
cmake --build build/native-desktop --config Release
```

Windows requires the Windows SDK; macOS requires Xcode/Core Audio headers; Linux requires PipeWire development headers (`libpipewire-0.3`). The sample executable emits a native test tone at a future monotonic deadline and reports the selected backend/format. It is a timing instrument, not acoustic validation.
