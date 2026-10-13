import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const checks = [
  ['Android Nearby transport', /Nearby\.getConnectionsClient/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/NearbyRoomTransport.kt')) && /requestConnection/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/NearbyRoomTransport.kt')) && /addOnFailureListener/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/NearbyRoomTransport.kt'))],
  ['Android Oboe low-latency path', /LowLatency/.test(read('native/android/app/src/main/cpp/sonicsync_audio.cpp')) && /Exclusive/.test(read('native/android/app/src/main/cpp/sonicsync_audio.cpp'))],
  ['Android monotonic clock', /elapsedRealtimeNanos/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/ClockModel.kt'))],
  ['Android bounded native media', /class WavPcmStream/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/WavPcmDecoder.kt')) && /SonicSync-media-refill/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/NativeMediaPlayer.kt'))],
  ['Android measured output-latency API', /calculateLatencyMillis/.test(read('native/android/app/src/main/cpp/sonicsync_audio.cpp')) && /outputLatencyMs/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/AudioEngine.kt'))],
  ['Android foreground native playback service', /NativeMediaPlayer/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/SonicSyncPlaybackService.kt')) && /startForeground/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/SonicSyncPlaybackService.kt'))],
  ['Android safe service unbind', /private var bound = false/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/MainActivity.kt')) && /if \(bound\)/.test(read('native/android/app/src/main/java/com/sonicsync/nativeapp/MainActivity.kt'))],
  ['iOS AVAudioEngine path', /AVAudioEngine/.test(read('native/ios/SonicSyncIOS/Sources/SonicSyncIOS/NativeAudioEngine.swift')) && /AVAudioPlayerNode/.test(read('native/ios/SonicSyncIOS/Sources/SonicSyncIOS/NativeAudioEngine.swift'))],
  ['iOS Network framework transport', /NWBrowser/.test(read('native/ios/SonicSyncIOS/Sources/SonicSyncIOS/LocalTransport.swift')) && /NWListener/.test(read('native/ios/SonicSyncIOS/Sources/SonicSyncIOS/LocalTransport.swift'))],
  ['iOS future scheduling', /AVAudioTime\(hostTime:/.test(read('native/ios/SonicSyncIOS/Sources/SonicSyncIOS/NativeAudioEngine.swift'))],
  ['iOS clock-drift estimation', /estimateDriftPpm/.test(read('native/ios/SonicSyncIOS/Sources/SonicSyncIOS/ClockModel.swift')) && /testDriftEstimate/.test(read('native/ios/SonicSyncIOS/Tests/SonicSyncIOSTests/ClockModelTests.swift'))],
  ['Windows WASAPI path', /IAudioClient/.test(read('native/desktop/src/native_audio.cpp')) && /AUDCLNT_STREAMFLAGS_EVENTCALLBACK/.test(read('native/desktop/src/native_audio.cpp'))],
  ['macOS CoreAudio path', /AudioComponentFindNext/.test(read('native/desktop/src/native_audio.cpp')) && /AudioUnitSetProperty/.test(read('native/desktop/src/native_audio.cpp'))],
  ['Linux PipeWire path', /pw_stream_new_simple/.test(read('native/desktop/src/native_audio.cpp')) && /pw_stream_connect/.test(read('native/desktop/src/native_audio.cpp'))],
  ['Desktop no fake output latency', /unmeasured/.test(read('native/desktop/src/native_audio.cpp')) && /latencySource/.test(read('native/desktop/include/native_audio.h'))],
  ['Desktop local discovery transport', /239\.255\.42\.99/.test(read('native/desktop/src/local_transport.cpp')) && /SOCK_STREAM|SOCK_STREAM/.test(read('native/desktop/src/local_transport.cpp')) && /startHost/.test(read('native/desktop/src/main.cpp')) && /discoverAndConnect/.test(read('native/desktop/src/main.cpp'))],
  ['ESP32 I2S audio path', /i2s_new_channel/.test(read('hardware/esp32s3-speaker-node/main/main.cpp')) && /i2s_channel_write/.test(read('hardware/esp32s3-speaker-node/main/main.cpp'))],
  ['ESP32 scheduled start conversion', /hostToLocalOffsetUs/.test(read('hardware/esp32s3-speaker-node/main/main.cpp')) && /scheduledStartUs\s*-\s*=\s*hostToLocalOffsetUs/.test(read('hardware/esp32s3-speaker-node/main/main.cpp'))],
  ['ESP32 WAV chunk-boundary handling', /next=ftell\(f\)\+.*\+\(.*&1L\)/.test(read('hardware/esp32s3-speaker-node/main/main.cpp')) && /fseek\(f,next,SEEK_SET\)/.test(read('hardware/esp32s3-speaker-node/main/main.cpp'))],
  ['GPIO measurement marker', /MEASURE_GPIO/.test(read('hardware/esp32s3-speaker-node/main/main.cpp')) && /gpio_set_level\(MEASURE_GPIO/.test(read('hardware/esp32s3-speaker-node/main/main.cpp'))],
  ['GPIO timestamp fixture', /esp_timer_get_time/.test(read('hardware/measurement/gpio-timestamp-fixture/main/main.cpp')) && /gpio_isr_handler_add/.test(read('hardware/measurement/gpio-timestamp-fixture/main/main.cpp'))],
];
let failed=0; for (const [name,ok] of checks) { console.log(`${ok?'PASS':'FAIL'}  ${name}`); if(!ok) failed++; }
if(failed) process.exit(1); console.log(`All ${checks.length} native/hardware source checks passed.`);
