// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorWalletExtension",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "CapacitorWalletExtension",
            targets: ["WalletExtensionPlugin"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")
    ],
    targets: [
        .target(
            name: "CTweetNacl",
            path: "ios/Sources/CTweetNacl",
            publicHeadersPath: "include"
        ),
        .target(
            name: "WalletExtensionPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                "CTweetNacl"
            ],
            path: "ios/Sources",
            exclude: [
                "module.map",
                "TweetNacl.LICENSE"
            ],
            sources: [
                "WalletExtensionPlugin",
                "TweetNacl"
            ]
        ),
        .testTarget(
            name: "WalletExtensionPluginTests",
            dependencies: ["WalletExtensionPlugin"],
            path: "ios/Tests/WalletExtensionPluginTests"
        )
    ]
)
