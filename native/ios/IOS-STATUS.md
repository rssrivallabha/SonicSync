# iOS Native Track — v10

Status: **source implemented; integration-ready; Xcode/device validation remains platform-dependent**.

- `AVAudioSession` configures playback and route behavior.
- `AVAudioEngine` + `AVAudioPlayerNode` is the actual native render path.
- `AVAudioTime(hostTime:)` is used for future scheduled playback rather than `Date.now()`.
- `Network.framework` provides Bonjour discovery and local TCP connections.
- Multipeer Connectivity is not used for the core transport because Apple's current documentation marks `MCNearbyServiceBrowser` deprecated and directs developers toward Network framework. citeturn820368search1turn820368search5
- Local network declaration and Bonjour service are included in `Info.plist`.

Apple's current AVAudioSession documentation describes it as the app/OS/hardware audio-session boundary, including playback category, route changes and interruption handling; AVAudioEngine provides the native realtime render graph. citeturn836657search1turn820368search3
