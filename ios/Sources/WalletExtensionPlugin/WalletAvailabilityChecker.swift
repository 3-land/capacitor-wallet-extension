import Foundation
import UIKit

final class WalletAvailabilityChecker {
    func availableWallets() -> [WalletProvider] {
        var wallets: [WalletProvider] = [.icloud]

        for provider in WalletProvider.allCases where provider.isExternal {
            if isInstalled(provider) {
                wallets.append(provider)
            }
        }

        return wallets
    }

    func isInstalled(_ provider: WalletProvider) -> Bool {
        guard let queryScheme = provider.queryScheme,
              let url = URL(string: "\(queryScheme)://") else {
            return false
        }

        return UIApplication.shared.canOpenURL(url)
    }
}
