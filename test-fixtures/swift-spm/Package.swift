// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MySwiftLib",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(name: "MySwiftLib", targets: ["MySwiftLib"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser", from: "1.3.0"),
    ],
    targets: [
        .target(name: "MySwiftLib", dependencies: [
            .product(name: "ArgumentParser", package: "swift-argument-parser")
        ]),
        .testTarget(name: "MySwiftLibTests", dependencies: ["MySwiftLib"]),
    ]
)
