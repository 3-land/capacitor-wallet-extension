import Foundation

final class WalletExtension {
    private let sessionStore = WalletSessionStore()
    private let iCloudWalletManager = ICloudWalletManager()
    private let externalWalletCoordinator = ExternalWalletCoordinator()
    private let walletAvailabilityChecker = WalletAvailabilityChecker()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    func getAvailableWallets() -> [String] {
        walletAvailabilityChecker.availableWallets().map(\.rawValue)
    }

    func connect(
        using walletType: String,
        completion: @escaping (Result<(session: ConnectedWalletSession, cached: Bool), WalletExtensionError>) -> Void
    ) {
        guard let provider = WalletProvider(rawValue: walletType) else {
            completion(.failure(.invalidWalletType(walletType)))
            return
        }

        if let existingSession = sessionStore.currentSession,
           existingSession.walletType == provider,
           existingSession.canReuseWithoutReconnect {
            completion(.success((existingSession, true)))
            return
        }

        if provider == .icloud {
            do {
                let wallet = try iCloudWalletManager.loadOrCreateWallet()
                let session = ConnectedWalletSession(
                    walletType: .icloud,
                    publicKey: wallet.publicKey,
                    session: nil,
                    dappEncryptionPublicKey: nil,
                    dappEncryptionSecretKey: nil,
                    walletEncryptionPublicKey: nil
                )

                try sessionStore.save(session)
                completion(.success((session, false)))
            } catch let error as WalletExtensionError {
                completion(.failure(error))
            } catch {
                completion(.failure(.cryptography("Failed to load or create the iCloud wallet.")))
            }

            return
        }

        guard walletAvailabilityChecker.isInstalled(provider) else {
            completion(.failure(.walletNotInstalled(provider.rawValue)))
            return
        }

        externalWalletCoordinator.connect(using: provider) { [weak self] result in
            switch result {
            case .success(let session):
                do {
                    try self?.sessionStore.save(session)
                    completion(.success((session, false)))
                } catch let error as WalletExtensionError {
                    completion(.failure(error))
                } catch {
                    completion(.failure(.cryptography("Failed to cache the connected wallet session.")))
                }
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    func signMessage(
        _ message: String,
        completion: @escaping (Result<(signature: String, walletType: WalletProvider), WalletExtensionError>) -> Void
    ) {
        guard !message.isEmpty else {
            completion(.failure(.missingParameter("message")))
            return
        }

        guard let session = sessionStore.currentSession else {
            completion(.failure(.missingConnectedWallet))
            return
        }

        if session.walletType == .icloud {
            do {
                let signature = try iCloudWalletManager.signMessage(message)
                completion(.success((signature, .icloud)))
            } catch let error as WalletExtensionError {
                completion(.failure(error))
            } catch {
                completion(.failure(.cryptography("Failed to sign the message with the iCloud wallet.")))
            }

            return
        }

        externalWalletCoordinator.signMessage(message, session: session) { result in
            switch result {
            case .success(let signature):
                completion(.success((signature, session.walletType)))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    func signTransactions(
        _ transactions: [String],
        completion: @escaping (Result<(transactions: [String], walletType: WalletProvider), WalletExtensionError>) -> Void
    ) {
        guard !transactions.isEmpty else {
            completion(.failure(.missingParameter("transactions")))
            return
        }

        guard let session = sessionStore.currentSession else {
            completion(.failure(.missingConnectedWallet))
            return
        }

        if session.walletType == .icloud {
            do {
                let signedTransactions = try iCloudWalletManager.signTransactions(transactions)
                completion(.success((signedTransactions, .icloud)))
            } catch let error as WalletExtensionError {
                completion(.failure(error))
            } catch {
                completion(.failure(.invalidTransaction("Failed to sign one or more serialized transactions with the iCloud wallet.")))
            }

            return
        }

        externalWalletCoordinator.signTransactions(transactions, session: session) { result in
            switch result {
            case .success(let signedTransactions):
                completion(.success((signedTransactions, session.walletType)))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    func logout() throws {
        externalWalletCoordinator.cancelPendingRequest(reason: "The current wallet session was cleared.")
        try sessionStore.clear()
    }

    func getWalletRecord() throws -> ICloudWalletRecord? {
        try iCloudWalletManager.loadWalletRecord()
    }

    func saveWalletRecord(publicKey: String, secretKey: String) throws {
        let record = ICloudWalletRecord(
            publicKey: publicKey,
            secretKey: secretKey
        )

        try iCloudWalletManager.saveWalletRecord(record)
    }

    func getCachedSession() throws -> String? {
        guard let session = sessionStore.currentSession else {
            return nil
        }

        let data = try encoder.encode(session)
        return String(data: data, encoding: .utf8)
    }

    func saveCachedSession(_ session: String) throws {
        let data = Data(session.utf8)
        let decodedSession = try decoder.decode(ConnectedWalletSession.self, from: data)
        try sessionStore.save(decodedSession)
    }

    func handleRedirect(_ url: URL) {
        externalWalletCoordinator.handleRedirect(url)
    }
}
