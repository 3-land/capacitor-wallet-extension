import Foundation

final class WalletSessionStore {
    private let storage = KeychainStorage(
        service: "com.3land.capacitor-wallet-extension.session",
        synchronizable: false
    )
    private let account = "connected-wallet"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private(set) var currentSession: ConnectedWalletSession?

    init() {
        currentSession = try? load()
    }

    func save(_ session: ConnectedWalletSession) throws {
        let data = try encoder.encode(session)
        try storage.save(data, account: account)
        currentSession = session
    }

    func clear() throws {
        try storage.delete(account: account)
        currentSession = nil
    }

    private func load() throws -> ConnectedWalletSession? {
        guard let data = try storage.load(account: account) else {
            return nil
        }

        return try decoder.decode(ConnectedWalletSession.self, from: data)
    }
}
