import Foundation
import UIKit

private struct ExternalConnectResponse: Decodable {
    let public_key: String
    let session: String
}

private struct ExternalSignMessageResponse: Decodable {
    let signature: String
}

private struct ExternalSignTransactionsResponse: Decodable {
    let transactions: [String]
}

final class ExternalWalletCoordinator {
    private enum PendingRequest {
        case connect(
            provider: WalletProvider,
            dappPublicKey: String,
            dappSecretKey: String,
            completion: (Result<ConnectedWalletSession, WalletExtensionError>) -> Void
        )
        case signMessage(
            provider: WalletProvider,
            session: ConnectedWalletSession,
            originalMessage: String,
            completion: (Result<String, WalletExtensionError>) -> Void
        )
        case signTransactions(
            provider: WalletProvider,
            session: ConnectedWalletSession,
            expectedCount: Int,
            completion: (Result<[String], WalletExtensionError>) -> Void
        )

        var redirectPath: String {
            switch self {
            case .connect:
                return "/connect"
            case .signMessage:
                return "/sign-message"
            case .signTransactions:
                return "/sign-transactions"
            }
        }
    }

    private let redirectHost = "wallet-extension"
    private let cluster = "mainnet-beta"
    private let requestTimeout: TimeInterval = 120

    private var pendingRequest: PendingRequest?
    private var timeoutWorkItem: DispatchWorkItem?

    func connect(
        using provider: WalletProvider,
        completion: @escaping (Result<ConnectedWalletSession, WalletExtensionError>) -> Void
    ) {
        guard pendingRequest == nil else {
            completion(.failure(.requestAlreadyPending))
            return
        }

        guard let connectURLString = provider.connectURLString else {
            completion(.failure(.invalidWalletType(provider.rawValue)))
            return
        }

        do {
            let keyPair = try NaclBox.keyPair()
            let dappPublicKey = try Base58Coder.encode(Data(keyPair.publicKey))
            let dappSecretKey = try Base58Coder.encode(Data(keyPair.secretKey))

            let request = PendingRequest.connect(
                provider: provider,
                dappPublicKey: dappPublicKey,
                dappSecretKey: dappSecretKey,
                completion: completion
            )

            let url = try buildURL(
                baseURLString: connectURLString,
                queryItems: [
                    URLQueryItem(name: "app_url", value: try baseAppURL().absoluteString),
                    URLQueryItem(name: "dapp_encryption_public_key", value: dappPublicKey),
                    URLQueryItem(name: "redirect_link", value: try redirectURL(path: request.redirectPath).absoluteString),
                    URLQueryItem(name: "cluster", value: cluster)
                ]
            )

            pendingRequest = request
            scheduleTimeout()
            open(url: url)
        } catch let error as WalletExtensionError {
            completion(.failure(error))
        } catch {
            completion(.failure(.cryptography("Failed to begin external wallet connection.")))
        }
    }

    func signMessage(
        _ message: String,
        session: ConnectedWalletSession,
        completion: @escaping (Result<String, WalletExtensionError>) -> Void
    ) {
        guard pendingRequest == nil else {
            completion(.failure(.requestAlreadyPending))
            return
        }

        guard let provider = externalProvider(from: session),
              let urlString = provider.signMessageURLString,
              let walletEncryptionPublicKey = session.walletEncryptionPublicKey,
              let dappPublicKey = session.dappEncryptionPublicKey,
              let dappSecretKey = session.dappEncryptionSecretKey,
              let externalSession = session.session else {
            completion(.failure(.missingConnectedWallet))
            return
        }

        do {
            let nonce = try CryptoSupport.randomBytes(count: 24)
            let payloadData = try JSONSerialization.data(
                withJSONObject: [
                    "message": message,
                    "session": externalSession
                ],
                options: []
            )
            let encryptedPayload = try NaclBox.box(
                message: payloadData,
                nonce: nonce,
                publicKey: try Base58Coder.decode(walletEncryptionPublicKey),
                secretKey: try Base58Coder.decode(dappSecretKey)
            )

            let request = PendingRequest.signMessage(
                provider: provider,
                session: session,
                originalMessage: message,
                completion: completion
            )

            let url = try buildURL(
                baseURLString: urlString,
                queryItems: [
                    URLQueryItem(name: "dapp_encryption_public_key", value: dappPublicKey),
                    URLQueryItem(name: "nonce", value: try Base58Coder.encode(nonce)),
                    URLQueryItem(name: "redirect_link", value: try redirectURL(path: request.redirectPath).absoluteString),
                    URLQueryItem(name: "payload", value: try Base58Coder.encode(encryptedPayload))
                ]
            )

            pendingRequest = request
            scheduleTimeout()
            open(url: url)
        } catch let error as WalletExtensionError {
            completion(.failure(error))
        } catch {
            completion(.failure(.cryptography("Failed to begin external wallet message signing.")))
        }
    }

    func signTransactions(
        _ transactions: [String],
        session: ConnectedWalletSession,
        completion: @escaping (Result<[String], WalletExtensionError>) -> Void
    ) {
        guard pendingRequest == nil else {
            completion(.failure(.requestAlreadyPending))
            return
        }

        guard let provider = externalProvider(from: session),
              let urlString = provider.signAllTransactionsURLString,
              let walletEncryptionPublicKey = session.walletEncryptionPublicKey,
              let dappPublicKey = session.dappEncryptionPublicKey,
              let dappSecretKey = session.dappEncryptionSecretKey,
              let externalSession = session.session else {
            completion(.failure(.missingConnectedWallet))
            return
        }

        do {
            let nonce = try CryptoSupport.randomBytes(count: 24)
            let payloadData = try JSONSerialization.data(
                withJSONObject: [
                    "transactions": transactions,
                    "session": externalSession
                ],
                options: []
            )
            let encryptedPayload = try NaclBox.box(
                message: payloadData,
                nonce: nonce,
                publicKey: try Base58Coder.decode(walletEncryptionPublicKey),
                secretKey: try Base58Coder.decode(dappSecretKey)
            )

            let request = PendingRequest.signTransactions(
                provider: provider,
                session: session,
                expectedCount: transactions.count,
                completion: completion
            )

            let url = try buildURL(
                baseURLString: urlString,
                queryItems: [
                    URLQueryItem(name: "dapp_encryption_public_key", value: dappPublicKey),
                    URLQueryItem(name: "nonce", value: try Base58Coder.encode(nonce)),
                    URLQueryItem(name: "redirect_link", value: try redirectURL(path: request.redirectPath).absoluteString),
                    URLQueryItem(name: "payload", value: try Base58Coder.encode(encryptedPayload))
                ]
            )

            pendingRequest = request
            scheduleTimeout()
            open(url: url)
        } catch let error as WalletExtensionError {
            completion(.failure(error))
        } catch {
            completion(.failure(.cryptography("Failed to begin external wallet transaction signing."))
            )
        }
    }

    func handleRedirect(_ url: URL) {
        guard let pendingRequest else {
            return
        }

        guard url.host == redirectHost else {
            return
        }

        let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let queryMap = Dictionary(uniqueKeysWithValues: queryItems.compactMap { item in
            item.value.map { (item.name, $0) }
        })

        if let errorMessage = queryMap["errorMessage"] {
            failPendingRequest(.callbackError(errorMessage))
            return
        }

        switch pendingRequest {
        case let .connect(provider, dappPublicKey, dappSecretKey, completion):
            guard url.path == pendingRequest.redirectPath else {
                return
            }

            do {
                let walletEncryptionPublicKey = queryMap["phantom_encryption_public_key"]
                    ?? queryMap["solflare_encryption_public_key"]
                    ?? queryMap["wallet_encryption_public_key"]

                guard let publicKey = walletEncryptionPublicKey else {
                    throw WalletExtensionError.malformedCallback("Wallet encryption public key was missing from the connect callback.")
                }

                let decryptedPayload = try decryptPayload(
                    queryMap: queryMap,
                    walletEncryptionPublicKey: publicKey,
                    dappSecretKey: dappSecretKey
                )
                let response = try JSONDecoder().decode(ExternalConnectResponse.self, from: decryptedPayload)

                clearPendingState()
                completion(
                    .success(
                        ConnectedWalletSession(
                            walletType: provider,
                            publicKey: response.public_key,
                            session: response.session,
                            dappEncryptionPublicKey: dappPublicKey,
                            dappEncryptionSecretKey: dappSecretKey,
                            walletEncryptionPublicKey: publicKey
                        )
                    )
                )
            } catch let error as WalletExtensionError {
                failPendingRequest(error)
            } catch {
                failPendingRequest(.malformedCallback("Failed to process the external wallet connect callback."))
            }

        case let .signMessage(_, session, originalMessage, completion):
            guard url.path == pendingRequest.redirectPath else {
                return
            }

            do {
                guard let walletEncryptionPublicKey = session.walletEncryptionPublicKey,
                      let dappSecretKey = session.dappEncryptionSecretKey else {
                    throw WalletExtensionError.missingConnectedWallet
                }

                let decryptedPayload = try decryptPayload(
                    queryMap: queryMap,
                    walletEncryptionPublicKey: walletEncryptionPublicKey,
                    dappSecretKey: dappSecretKey
                )
                let response = try JSONDecoder().decode(ExternalSignMessageResponse.self, from: decryptedPayload)
                let verified = try CryptoSupport.verifyDetachedSignature(
                    message: originalMessage,
                    signature: response.signature,
                    publicKey: session.publicKey
                )

                guard verified else {
                    throw WalletExtensionError.callbackError("The external wallet returned a signature that could not be verified.")
                }

                clearPendingState()
                completion(.success(response.signature))
            } catch let error as WalletExtensionError {
                failPendingRequest(error)
            } catch {
                failPendingRequest(.malformedCallback("Failed to process the external wallet signMessage callback."))
            }

        case let .signTransactions(_, session, expectedCount, completion):
            guard url.path == pendingRequest.redirectPath else {
                return
            }

            do {
                guard let walletEncryptionPublicKey = session.walletEncryptionPublicKey,
                      let dappSecretKey = session.dappEncryptionSecretKey else {
                    throw WalletExtensionError.missingConnectedWallet
                }

                let decryptedPayload = try decryptPayload(
                    queryMap: queryMap,
                    walletEncryptionPublicKey: walletEncryptionPublicKey,
                    dappSecretKey: dappSecretKey
                )
                let response = try JSONDecoder().decode(ExternalSignTransactionsResponse.self, from: decryptedPayload)

                guard response.transactions.count == expectedCount else {
                    throw WalletExtensionError.callbackError("The external wallet returned an unexpected number of signed transactions.")
                }

                clearPendingState()
                completion(.success(response.transactions))
            } catch let error as WalletExtensionError {
                failPendingRequest(error)
            } catch {
                failPendingRequest(.malformedCallback("Failed to process the external wallet signAllTransactions callback."))
            }
        }
    }

    func cancelPendingRequest(reason: String) {
        failPendingRequest(.deeplinkFailure(reason))
    }

    private func externalProvider(from session: ConnectedWalletSession) -> WalletProvider? {
        session.walletType.isExternal ? session.walletType : nil
    }

    private func redirectURL(path: String) throws -> URL {
        guard let scheme = firstURLScheme() else {
            throw WalletExtensionError.invalidRedirectScheme
        }

        var components = URLComponents()
        components.scheme = scheme
        components.host = redirectHost
        components.path = path

        guard let url = components.url else {
            throw WalletExtensionError.invalidRedirectScheme
        }

        return url
    }

    private func baseAppURL() throws -> URL {
        guard let scheme = firstURLScheme() else {
            throw WalletExtensionError.invalidRedirectScheme
        }

        var components = URLComponents()
        components.scheme = scheme
        components.host = redirectHost
        components.path = "/app"

        guard let url = components.url else {
            throw WalletExtensionError.invalidRedirectScheme
        }

        return url
    }

    private func buildURL(baseURLString: String, queryItems: [URLQueryItem]) throws -> URL {
        guard var components = URLComponents(string: baseURLString) else {
            throw WalletExtensionError.deeplinkFailure("Failed to construct the wallet deeplink URL.")
        }

        components.queryItems = queryItems

        guard let url = components.url else {
            throw WalletExtensionError.deeplinkFailure("Failed to encode the wallet deeplink URL.")
        }

        return url
    }

    private func firstURLScheme() -> String? {
        guard let urlTypes = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] else {
            return nil
        }

        for urlType in urlTypes {
            if let schemes = urlType["CFBundleURLSchemes"] as? [String],
               let scheme = schemes.first,
               !scheme.isEmpty {
                return scheme
            }
        }

        return nil
    }

    private func decryptPayload(
        queryMap: [String: String],
        walletEncryptionPublicKey: String,
        dappSecretKey: String
    ) throws -> Data {
        guard let nonce = queryMap["nonce"],
              let data = queryMap["data"] else {
            throw WalletExtensionError.malformedCallback("Wallet callback is missing its encrypted payload.")
        }

        return try NaclBox.open(
            message: try Base58Coder.decode(data),
            nonce: try Base58Coder.decode(nonce),
            publicKey: try Base58Coder.decode(walletEncryptionPublicKey),
            secretKey: try Base58Coder.decode(dappSecretKey)
        )
    }

    private func open(url: URL) {
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                if !success {
                    self.failPendingRequest(.deeplinkFailure("The wallet deeplink could not be opened."))
                }
            }
        }
    }

    private func scheduleTimeout() {
        clearTimeout()

        let workItem = DispatchWorkItem { [weak self] in
            self?.failPendingRequest(.deeplinkFailure("The wallet request timed out before the app received a callback."))
        }

        timeoutWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + requestTimeout, execute: workItem)
    }

    private func clearTimeout() {
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
    }

    private func clearPendingState() {
        pendingRequest = nil
        clearTimeout()
    }

    private func failPendingRequest(_ error: WalletExtensionError) {
        guard let request = pendingRequest else {
            return
        }

        clearPendingState()

        switch request {
        case .connect(_, _, _, let completion):
            completion(.failure(error))
        case .signMessage(_, _, _, let completion):
            completion(.failure(error))
        case .signTransactions(_, _, _, let completion):
            completion(.failure(error))
        }
    }
}
