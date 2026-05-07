import Foundation

final class ICloudWalletManager {
    private let storage = KeychainStorage(
        service: "com.3land.capacitor-wallet-extension.icloud",
        synchronizable: true
    )
    private let account = "primary-wallet"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    func loadOrCreateWallet() throws -> ICloudWallet {
        if let existing = try loadWallet() {
            return existing
        }

        let seed = try CryptoSupport.randomBytes(count: 32)
        let keyPair = try NaclSign.KeyPair.keyPair(fromSeed: seed)
        let publicKey = try Base58Coder.encode(Data(keyPair.publicKey))
        let secretKey = try Base58Coder.encode(Data(keyPair.secretKey))

        let record = ICloudWalletRecord(
            publicKey: publicKey,
            secretKey: secretKey
        )

        try storage.save(try encoder.encode(record), account: account)

        return ICloudWallet(
            publicKey: publicKey,
            secretKey: Data(keyPair.secretKey)
        )
    }

    func signMessage(_ message: String) throws -> String {
        let wallet = try loadOrCreateWallet()
        let messageData = try Base58Coder.decode(message)
        let signature = try NaclSign.signDetached(
            message: messageData,
            secretKey: wallet.secretKey
        )

        return try Base58Coder.encode(signature)
    }

    func signTransactions(_ transactions: [String]) throws -> [String] {
        let wallet = try loadOrCreateWallet()

        return try transactions.map { transaction in
            try SolanaTransactionSigner.sign(
                serializedTransaction: transaction,
                signerPublicKey: wallet.publicKey,
                signerSecretKey: wallet.secretKey
            )
        }
    }

    private func loadWallet() throws -> ICloudWallet? {
        guard let data = try storage.load(account: account) else {
            return nil
        }

        let record = try decoder.decode(ICloudWalletRecord.self, from: data)

        return ICloudWallet(
            publicKey: record.publicKey,
            secretKey: try Base58Coder.decode(record.secretKey)
        )
    }
}
