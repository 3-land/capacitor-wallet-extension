import Foundation
import Security

enum CryptoSupport {
    static func randomBytes(count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)

        guard status == errSecSuccess else {
            throw WalletExtensionError.cryptography("Failed to generate secure random bytes.")
        }

        return Data(bytes)
    }

    static func verifyDetachedSignature(message: String, signature: String, publicKey: String) throws -> Bool {
        let messageData = try Base58Coder.decode(message)
        let signatureData = try Base58Coder.decode(signature)
        let publicKeyData = try Base58Coder.decode(publicKey)

        return try NaclSign.signDetachedVerify(
            message: messageData,
            sig: signatureData,
            publicKey: publicKeyData
        )
    }
}
