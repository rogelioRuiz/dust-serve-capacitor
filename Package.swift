// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DustServeCapacitor",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "DustServeCapacitor",
            targets: ["ServePlugin"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/rogelioRuiz/dust-core-swift.git", from: "0.1.3"),
        .package(url: "https://github.com/rogelioRuiz/dust-serve-swift.git", from: "0.1.3"),
    ],
    targets: [
        .target(
            name: "ServePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "DustCore", package: "dust-core-swift"),
                .product(name: "DustServe", package: "dust-serve-swift"),
            ],
            path: "ios/Sources/ServePlugin"
        )
    ]
)
