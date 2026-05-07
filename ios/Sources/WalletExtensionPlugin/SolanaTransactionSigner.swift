import Foundation

enum SolanaShortVec {
    static func decodeLength(from bytes: [UInt8], offset: Int) throws -> (value: Int, nextOffset: Int) {
        var result = 0
        var shift = 0
        var index = offset

        while true {
            guard index < bytes.count else {
                throw WalletExtensionError.invalidTransaction("Unexpected end of transaction while decoding compact length.")
            }

            let byte = Int(bytes[index])
            result |= (byte & 0x7f) << shift
            index += 1

            if byte & 0x80 == 0 {
                return (result, index)
            }

            shift += 7

            if shift > 28 {
                throw WalletExtensionError.invalidTransaction("Invalid compact length in serialized transaction.")
            }
        }
    }
}

enum SolanaTransactionSigner {
    static func sign(
        serializedTransaction: String,
        signerPublicKey: String,
        signerSecretKey: Data
    ) throws -> String {
        let serializedTransactionData = try Base58Coder.decode(serializedTransaction)
        let signerPublicKeyData = try Base58Coder.decode(signerPublicKey)
        let signedTransaction = try sign(
            serializedTransactionData: serializedTransactionData,
            signerPublicKey: signerPublicKeyData,
            signerSecretKey: signerSecretKey
        )

        return try Base58Coder.encode(signedTransaction)
    }

    private static func sign(
        serializedTransactionData: Data,
        signerPublicKey: Data,
        signerSecretKey: Data
    ) throws -> Data {
        var transactionBytes = [UInt8](serializedTransactionData)
        let signatureLength = 64

        let (signatureCount, signaturesStart) = try SolanaShortVec.decodeLength(
            from: transactionBytes,
            offset: 0
        )
        let messageStart = signaturesStart + (signatureCount * signatureLength)

        guard messageStart <= transactionBytes.count else {
            throw WalletExtensionError.invalidTransaction("Serialized transaction is shorter than its signature header.")
        }

        let messageBytes = Array(transactionBytes[messageStart...])
        let signerIndex = try findSignerIndex(
            inMessage: messageBytes,
            signerPublicKey: [UInt8](signerPublicKey),
            signatureCount: signatureCount
        )

        let signature = try NaclSign.signDetached(
            message: Data(messageBytes),
            secretKey: signerSecretKey
        )
        let signatureBytes = [UInt8](signature)

        guard signatureBytes.count == signatureLength else {
            throw WalletExtensionError.cryptography("Detached signature length was not 64 bytes.")
        }

        let signatureOffset = signaturesStart + (signerIndex * signatureLength)
        let signatureEnd = signatureOffset + signatureLength

        guard signatureEnd <= transactionBytes.count else {
            throw WalletExtensionError.invalidTransaction("Serialized transaction does not have space for the signer signature.")
        }

        transactionBytes.replaceSubrange(signatureOffset..<signatureEnd, with: signatureBytes)

        return Data(transactionBytes)
    }

    private static func findSignerIndex(
        inMessage messageBytes: [UInt8],
        signerPublicKey: [UInt8],
        signatureCount: Int
    ) throws -> Int {
        guard !messageBytes.isEmpty else {
            throw WalletExtensionError.invalidTransaction("Serialized transaction message is empty.")
        }

        let isVersioned = (messageBytes[0] & 0x80) != 0
        let headerOffset = isVersioned ? 1 : 0

        guard messageBytes.count >= headerOffset + 3 else {
            throw WalletExtensionError.invalidTransaction("Serialized transaction header is incomplete.")
        }

        let numRequiredSignatures = Int(messageBytes[headerOffset])
        let accountKeysLengthOffset = headerOffset + 3
        let (accountKeysCount, accountKeysStart) = try SolanaShortVec.decodeLength(
            from: messageBytes,
            offset: accountKeysLengthOffset
        )

        guard numRequiredSignatures <= accountKeysCount else {
            throw WalletExtensionError.invalidTransaction("Serialized transaction signer count exceeds account key count.")
        }

        guard numRequiredSignatures <= signatureCount else {
            throw WalletExtensionError.invalidTransaction("Serialized transaction signature array is smaller than the required signer count.")
        }

        let requiredBytes = accountKeysStart + (accountKeysCount * 32)
        guard requiredBytes <= messageBytes.count else {
            throw WalletExtensionError.invalidTransaction("Serialized transaction account key list is truncated.")
        }

        for signerIndex in 0..<numRequiredSignatures {
            let start = accountKeysStart + (signerIndex * 32)
            let end = start + 32
            let accountKey = Array(messageBytes[start..<end])

            if accountKey == signerPublicKey {
                return signerIndex
            }
        }

        throw WalletExtensionError.invalidTransaction("The connected wallet is not a required signer on one of the provided transactions.")
    }
}
