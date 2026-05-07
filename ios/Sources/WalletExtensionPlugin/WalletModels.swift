import Foundation

enum WalletProvider: String, CaseIterable, Codable {
    case icloud
    case phantom
    case solflare
    case backpack

    var isExternal: Bool {
        self != .icloud
    }

    var queryScheme: String? {
        switch self {
        case .icloud:
            return nil
        case .phantom:
            return "phantom"
        case .solflare:
            return "solflare"
        case .backpack:
            return "backpack"
        }
    }

    var connectURLString: String? {
        switch self {
        case .icloud:
            return nil
        case .phantom:
            return "https://phantom.app/ul/v1/connect"
        case .solflare:
            return "https://solflare.com/ul/v1/connect"
        case .backpack:
            return "https://backpack.app/ul/v1/connect"
        }
    }

    var signMessageURLString: String? {
        switch self {
        case .icloud:
            return nil
        case .phantom:
            return "https://phantom.app/ul/v1/signMessage"
        case .solflare:
            return "https://solflare.com/ul/v1/signMessage"
        case .backpack:
            return "https://backpack.app/ul/v1/signMessage"
        }
    }

    var signAllTransactionsURLString: String? {
        switch self {
        case .icloud:
            return nil
        case .phantom:
            return "https://phantom.app/ul/v1/signAllTransactions"
        case .solflare:
            return "https://solflare.com/ul/v1/signAllTransactions"
        case .backpack:
            return "https://backpack.app/ul/v1/signAllTransactions"
        }
    }
}

struct ConnectedWalletSession: Codable {
    let walletType: WalletProvider
    let publicKey: String
    let session: String?
    let dappEncryptionPublicKey: String?
    let dappEncryptionSecretKey: String?
    let walletEncryptionPublicKey: String?

    var canReuseWithoutReconnect: Bool {
        if walletType == .icloud {
            return !publicKey.isEmpty
        }

        return !publicKey.isEmpty
            && session?.isEmpty == false
            && dappEncryptionPublicKey?.isEmpty == false
            && dappEncryptionSecretKey?.isEmpty == false
            && walletEncryptionPublicKey?.isEmpty == false
    }
}

struct ICloudWalletRecord: Codable {
    let publicKey: String
    let secretKey: String
}

struct ICloudWallet {
    let publicKey: String
    let secretKey: Data
}

enum WalletExtensionError: LocalizedError {
    case invalidWalletType(String)
    case missingParameter(String)
    case missingConnectedWallet
    case walletNotInstalled(String)
    case invalidBase58(String)
    case invalidRedirectScheme
    case requestAlreadyPending
    case callbackError(String)
    case deeplinkFailure(String)
    case cryptography(String)
    case invalidTransaction(String)
    case malformedCallback(String)

    var code: String {
        switch self {
        case .invalidWalletType:
            return "INVALID_WALLET_TYPE"
        case .missingParameter:
            return "MISSING_PARAMETER"
        case .missingConnectedWallet:
            return "MISSING_CONNECTED_WALLET"
        case .walletNotInstalled:
            return "WALLET_NOT_INSTALLED"
        case .invalidBase58:
            return "INVALID_BASE58"
        case .invalidRedirectScheme:
            return "INVALID_REDIRECT_SCHEME"
        case .requestAlreadyPending:
            return "REQUEST_ALREADY_PENDING"
        case .callbackError:
            return "CALLBACK_ERROR"
        case .deeplinkFailure:
            return "DEEPLINK_FAILURE"
        case .cryptography:
            return "CRYPTOGRAPHY_FAILURE"
        case .invalidTransaction:
            return "INVALID_TRANSACTION"
        case .malformedCallback:
            return "MALFORMED_CALLBACK"
        }
    }

    var errorDescription: String? {
        switch self {
        case .invalidWalletType(let walletType):
            return "Unsupported wallet type '\(walletType)'."
        case .missingParameter(let parameter):
            return "Missing required parameter '\(parameter)'."
        case .missingConnectedWallet:
            return "No wallet is currently connected."
        case .walletNotInstalled(let walletType):
            return "The '\(walletType)' wallet app is not installed or cannot be queried from Info.plist."
        case .invalidBase58(let message):
            return message
        case .invalidRedirectScheme:
            return "No app URL scheme was found. Configure CFBundleURLTypes in your iOS app."
        case .requestAlreadyPending:
            return "A wallet request is already in progress."
        case .callbackError(let message):
            return message
        case .deeplinkFailure(let message):
            return message
        case .cryptography(let message):
            return message
        case .invalidTransaction(let message):
            return message
        case .malformedCallback(let message):
            return message
        }
    }
}
