import SwiftUI
import SonicSyncIOS

@main
struct SonicSyncApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    @State private var status = "DISCONNECTED"
    private let audio = NativeAudioEngine()
    var body: some View {
        VStack(spacing: 18) {
            Text("SonicSync Native").font(.largeTitle.bold())
            Text(status).font(.system(.headline, design: .monospaced))
            Button("Prime + Test Audio") {
                do { try audio.start(); status = "AUDIO ENGINE READY · AVAudioEngine" }
                catch { status = "FAILED · \(error.localizedDescription)" }
            }
        }.padding()
    }
}
