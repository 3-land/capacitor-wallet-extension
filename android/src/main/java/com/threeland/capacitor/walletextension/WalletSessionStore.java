package com.threeland.capacitor.walletextension;

import android.content.Context;

final class WalletSessionStore {
    private static final String SESSION_STORAGE_KEY = "connected-wallet-session";

    private final SecureStorage secureStorage;

    WalletSessionStore(Context context) {
        secureStorage = new SecureStorage(
            context,
            "com.3land.capacitor-wallet-extension.session.master"
        );
    }

    String load() {
        try {
            return secureStorage.loadString(SESSION_STORAGE_KEY);
        } catch (Exception ignored) {
            secureStorage.delete(SESSION_STORAGE_KEY);
            return null;
        }
    }

    void save(String session) throws Exception {
        secureStorage.saveString(SESSION_STORAGE_KEY, session);
    }

    void clear() {
        secureStorage.delete(SESSION_STORAGE_KEY);
    }
}
