// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SonicSyncIOS",
    platforms: [.iOS(.v16)],
    products: [.library(name: "SonicSyncIOS", targets: ["SonicSyncIOS"])],
    targets: [
        .target(name: "SonicSyncIOS"),
        .testTarget(name: "SonicSyncIOSTests", dependencies: ["SonicSyncIOS"])
    ]
)
