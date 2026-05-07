import XCTest
@testable import WalletExtensionPlugin

final class WalletExtensionPluginTests: XCTestCase {
    func testBase58EncodingKnownVectors() throws {
        XCTAssertEqual(try Base58Coder.encode(Data()), "")
        XCTAssertEqual(try Base58Coder.encode(Data([0x61])), "2g")
        XCTAssertEqual(try Base58Coder.encode(Data([0x62, 0x62, 0x62])), "a3gV")
        XCTAssertEqual(try Base58Coder.encode(Data("hello world".utf8)), "StV1DL6CwTryKyV")
    }

    func testBase58DecodingKnownVectors() throws {
        XCTAssertEqual(try Base58Coder.decode(""), Data())
        XCTAssertEqual(try Base58Coder.decode("2g"), Data([0x61]))
        XCTAssertEqual(try Base58Coder.decode("a3gV"), Data([0x62, 0x62, 0x62]))
        XCTAssertEqual(try Base58Coder.decode("StV1DL6CwTryKyV"), Data("hello world".utf8))
    }

    func testBase58RejectsInvalidCharacters() {
        XCTAssertThrowsError(try Base58Coder.decode("0OIl"))
    }
}
