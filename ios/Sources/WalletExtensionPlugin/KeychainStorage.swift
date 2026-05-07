import Foundation
import Security

final class KeychainStorage {
    private let service: String
    private let synchronizable: Bool

    init(service: String, synchronizable: Bool) {
        self.service = service
        self.synchronizable = synchronizable
    }

    func load(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        if synchronizable {
            query[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny
        }

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess else {
            throw WalletExtensionError.cryptography("Keychain read failed with status \(status).")
        }

        return result as? Data
    }

    func save(_ data: Data, account: String) throws {
        var query = baseQuery(account: account)

        if synchronizable {
            query[kSecAttrSynchronizable as String] = kCFBooleanTrue
        }

        let attributes: [String: Any] = [
            kSecValueData as String: data
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        if updateStatus == errSecSuccess {
            return
        }

        if updateStatus != errSecItemNotFound {
            throw WalletExtensionError.cryptography("Keychain update failed with status \(updateStatus).")
        }

        var insertQuery = baseQuery(account: account)
        insertQuery[kSecValueData as String] = data
        insertQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked

        if synchronizable {
            insertQuery[kSecAttrSynchronizable as String] = kCFBooleanTrue
        }

        let insertStatus = SecItemAdd(insertQuery as CFDictionary, nil)

        guard insertStatus == errSecSuccess else {
            throw WalletExtensionError.cryptography("Keychain write failed with status \(insertStatus).")
        }
    }

    func delete(account: String) throws {
        var query = baseQuery(account: account)

        if synchronizable {
            query[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny
        }

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw WalletExtensionError.cryptography("Keychain delete failed with status \(status).")
        }
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
