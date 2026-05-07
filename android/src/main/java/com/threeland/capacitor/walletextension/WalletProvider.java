package com.threeland.capacitor.walletextension;

enum WalletProvider {
    PHANTOM("phantom", "app.phantom"),
    SOLFLARE("solflare", "com.solflare.mobile"),
    BACKPACK("backpack", "app.backpack.mobile");

    private final String walletType;
    private final String packageName;

    WalletProvider(String walletType, String packageName) {
        this.walletType = walletType;
        this.packageName = packageName;
    }

    String getWalletType() {
        return walletType;
    }

    String getPackageName() {
        return packageName;
    }

    static WalletProvider fromWalletType(String walletType) {
        for (WalletProvider provider : values()) {
            if (provider.walletType.equals(walletType)) {
                return provider;
            }
        }

        return null;
    }
}
