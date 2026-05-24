import Foundation
import Capacitor

@objc(WalletExtensionPlugin)
public class WalletExtensionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WalletExtensionPlugin"
    public let jsName = "WalletExtension"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configureExternalWalletUrls", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAvailableWallets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connectUsing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signMessage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signTransactions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWalletRecord", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWalletRecord", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCachedSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveCachedSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logout", returnType: CAPPluginReturnPromise)
    ]

    private let implementation = WalletExtension()

    public override func load() {
        super.load()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleUrlOpened(notification:)),
            name: Notification.Name.capacitorOpenURL,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleUniversalLink(notification:)),
            name: Notification.Name.capacitorOpenUniversalLink,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc public func configureExternalWalletUrls(_ call: CAPPluginCall) {
        guard let appUrl = call.getString("appUrl"), !appUrl.isEmpty else {
            reject(.missingParameter("appUrl"), call: call)
            return
        }

        guard let redirectBaseUrl = call.getString("redirectBaseUrl"),
              !redirectBaseUrl.isEmpty else {
            reject(.missingParameter("redirectBaseUrl"), call: call)
            return
        }

        do {
            try implementation.configureExternalWalletUrls(
                appUrl: appUrl,
                redirectBaseUrl: redirectBaseUrl
            )
            call.resolve()
        } catch let error as WalletExtensionError {
            reject(error, call: call)
        } catch {
            reject(
                .invalidExternalWalletConfiguration(
                    "Failed to configure the external wallet callback URLs."
                ),
                call: call
            )
        }
    }

    @objc public func getAvailableWallets(_ call: CAPPluginCall) {
        call.resolve([
            "wallets": implementation.getAvailableWallets()
        ])
    }

    @objc public func connectUsing(_ call: CAPPluginCall) {
        guard let walletType = call.getString("walletType"), !walletType.isEmpty else {
            reject(.missingParameter("walletType"), call: call)
            return
        }

        bridge?.saveCall(call)

        implementation.connect(using: walletType) { [weak self] result in
            self?.bridge?.releaseCall(call)

            switch result {
            case .success(let result):
                call.resolve([
                    "publicKey": result.session.publicKey,
                    "walletType": result.session.walletType.rawValue,
                    "cached": result.cached
                ])
            case .failure(let error):
                self?.reject(error, call: call)
            }
        }
    }

    @objc public func signMessage(_ call: CAPPluginCall) {
        guard let message = call.getString("message"), !message.isEmpty else {
            reject(.missingParameter("message"), call: call)
            return
        }

        bridge?.saveCall(call)

        implementation.signMessage(message) { [weak self] result in
            self?.bridge?.releaseCall(call)

            switch result {
            case .success(let result):
                call.resolve([
                    "signature": result.signature,
                    "walletType": result.walletType.rawValue
                ])
            case .failure(let error):
                self?.reject(error, call: call)
            }
        }
    }

    @objc public func signTransactions(_ call: CAPPluginCall) {
        guard let transactions = call.getArray("transactions", String.self),
              !transactions.isEmpty else {
            reject(.missingParameter("transactions"), call: call)
            return
        }

        bridge?.saveCall(call)

        implementation.signTransactions(transactions) { [weak self] result in
            self?.bridge?.releaseCall(call)

            switch result {
            case .success(let result):
                call.resolve([
                    "transactions": result.transactions,
                    "walletType": result.walletType.rawValue
                ])
            case .failure(let error):
                self?.reject(error, call: call)
            }
        }
    }

    @objc public func logout(_ call: CAPPluginCall) {
        do {
            try implementation.logout()
            call.resolve()
        } catch let error as WalletExtensionError {
            reject(error, call: call)
        } catch {
            reject(.cryptography("Failed to clear the connected wallet session."), call: call)
        }
    }

    @objc public func getWalletRecord(_ call: CAPPluginCall) {
        do {
            guard let record = try implementation.getWalletRecord() else {
                call.resolve([
                    "present": false
                ])
                return
            }

            call.resolve([
                "present": true,
                "publicKey": record.publicKey,
                "secretKey": record.secretKey
            ])
        } catch let error as WalletExtensionError {
            reject(error, call: call)
        } catch {
            reject(.cryptography("Failed to load the iCloud wallet record."), call: call)
        }
    }

    @objc public func saveWalletRecord(_ call: CAPPluginCall) {
        guard let publicKey = call.getString("publicKey"), !publicKey.isEmpty else {
            reject(.missingParameter("publicKey"), call: call)
            return
        }

        guard let secretKey = call.getString("secretKey"), !secretKey.isEmpty else {
            reject(.missingParameter("secretKey"), call: call)
            return
        }

        do {
            try implementation.saveWalletRecord(publicKey: publicKey, secretKey: secretKey)
            call.resolve()
        } catch let error as WalletExtensionError {
            reject(error, call: call)
        } catch {
            reject(.cryptography("Failed to store the iCloud wallet record."), call: call)
        }
    }

    @objc public func getCachedSession(_ call: CAPPluginCall) {
        do {
            if let session = try implementation.getCachedSession() {
                call.resolve([
                    "session": session
                ])
                return
            }

            call.resolve()
        } catch let error as WalletExtensionError {
            reject(error, call: call)
        } catch {
            reject(.cryptography("Failed to load the cached wallet session."), call: call)
        }
    }

    @objc public func saveCachedSession(_ call: CAPPluginCall) {
        guard let session = call.getString("session"), !session.isEmpty else {
            reject(.missingParameter("session"), call: call)
            return
        }

        do {
            try implementation.saveCachedSession(session)
            call.resolve()
        } catch let error as WalletExtensionError {
            reject(error, call: call)
        } catch {
            reject(.cryptography("Failed to cache the connected wallet session."), call: call)
        }
    }

    @objc private func handleUrlOpened(notification: NSNotification) {
        if let url = extractURL(from: notification) {
            implementation.handleRedirect(url)
        }
    }

    @objc private func handleUniversalLink(notification: NSNotification) {
        if let url = extractURL(from: notification) {
            implementation.handleRedirect(url)
        }
    }

    private func extractURL(from notification: NSNotification) -> URL? {
        guard let object = notification.object as? [String: Any] else {
            return nil
        }

        if let url = object["url"] as? URL {
            return url
        }

        if let url = object["url"] as? NSURL {
            return url as URL
        }

        return nil
    }

    private func reject(_ error: WalletExtensionError, call: CAPPluginCall) {
        call.reject(error.errorDescription ?? "Unknown wallet extension error.", error.code, nil)
    }
}
