package com.threeland.capacitor.walletextension;

import android.content.Context;
import java.nio.charset.StandardCharsets;

final class AndroidWalletStore {
    interface LoadCallback {
        void onLoaded(WalletRecord walletRecord);

        void onMissing();

        void onError(String message);
    }

    interface SaveCallback {
        void onSaved();

        void onError(String message);
    }

    private static final String LOCAL_STORAGE_KEY = "android-wallet-record";
    private static final String BACKUP_STORAGE_KEY = "android-wallet-record";

    private final SecureStorage secureStorage;
    private final BlockStoreWalletBackup blockStoreWalletBackup;

    AndroidWalletStore(Context context) {
        secureStorage = new SecureStorage(
            context,
            "com.3land.capacitor-wallet-extension.wallet.master"
        );
        blockStoreWalletBackup = new BlockStoreWalletBackup(context);
    }

    void load(LoadCallback callback) {
        try {
            String localWalletRecord = secureStorage.loadString(LOCAL_STORAGE_KEY);
            if (localWalletRecord != null) {
                callback.onLoaded(WalletRecord.fromJson(localWalletRecord));
                return;
            }
        } catch (Exception ignored) {
            secureStorage.delete(LOCAL_STORAGE_KEY);
        }

        blockStoreWalletBackup.retrieve(
            BACKUP_STORAGE_KEY,
            new BlockStoreWalletBackup.RetrieveCallback() {
                @Override
                public void onSuccess(byte[] bytes) {
                    if (bytes == null) {
                        callback.onMissing();
                        return;
                    }

                    try {
                        String restoredRecord = new String(bytes, StandardCharsets.UTF_8);
                        WalletRecord walletRecord = WalletRecord.fromJson(restoredRecord);
                        secureStorage.saveString(LOCAL_STORAGE_KEY, restoredRecord);
                        callback.onLoaded(walletRecord);
                    } catch (Exception error) {
                        callback.onError(
                            "Failed to restore the Android wallet from Block Store."
                        );
                    }
                }

                @Override
                public void onError(Exception error) {
                    callback.onError(
                        "Failed to restore the Android wallet from Block Store."
                    );
                }
            }
        );
    }

    void save(WalletRecord walletRecord, SaveCallback callback) {
        try {
            String serializedWallet = walletRecord.toJson();
            secureStorage.saveString(LOCAL_STORAGE_KEY, serializedWallet);
            blockStoreWalletBackup.store(
                BACKUP_STORAGE_KEY,
                serializedWallet.getBytes(StandardCharsets.UTF_8),
                ignored -> callback.onSaved()
            );
        } catch (Exception error) {
            callback.onError("Failed to store the Android wallet.");
        }
    }
}
