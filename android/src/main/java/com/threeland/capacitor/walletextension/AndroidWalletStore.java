package com.threeland.capacitor.walletextension;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
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

    interface RetryBackupCallback {
        void onComplete(boolean backedUp);
    }

    private static final String LOCAL_STORAGE_KEY = "android-wallet-record";
    private static final String BACKUP_STORAGE_KEY = "android-wallet-record";
    private static final String BACKUP_PREFS_NAME =
        "com.3land.capacitor-wallet-extension.wallet-backup";
    private static final String BACKUP_SYNCED_KEY = "android-wallet-record-backed-up";
    private static final String TAG = "AndroidWalletStore";

    private final SecureStorage secureStorage;
    private final BlockStoreWalletBackup blockStoreWalletBackup;
    private final SharedPreferences backupPreferences;

    AndroidWalletStore(Context context) {
        secureStorage = new SecureStorage(
            context,
            "com.3land.capacitor-wallet-extension.wallet.master"
        );
        blockStoreWalletBackup = new BlockStoreWalletBackup(context);
        backupPreferences = context.getSharedPreferences(BACKUP_PREFS_NAME, Context.MODE_PRIVATE);
    }

    void load(LoadCallback callback) {
        try {
            String localWalletRecord = secureStorage.loadString(LOCAL_STORAGE_KEY);
            if (localWalletRecord != null) {
                syncBackupIfNeeded(localWalletRecord);
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
                        setBackupSynced(true);
                        Log.i(TAG, "Restored the Android wallet from Block Store.");
                        callback.onLoaded(walletRecord);
                    } catch (Exception error) {
                        Log.w(TAG, "Failed to persist the wallet restored from Block Store.", error);
                        callback.onError(
                            "Failed to restore the Android wallet from Block Store."
                        );
                    }
                }

                @Override
                public void onError(Exception error) {
                    Log.w(TAG, "Failed to retrieve the Android wallet from Block Store.", error);
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
            setBackupSynced(false);
            syncBackup(serializedWallet, error -> callback.onSaved());
        } catch (Exception error) {
            callback.onError("Failed to store the Android wallet.");
        }
    }

    boolean hasWalletBeenBackedUp() {
        return isBackupSynced();
    }

    void retryBackUp(RetryBackupCallback callback) {
        try {
            String localWalletRecord = secureStorage.loadString(LOCAL_STORAGE_KEY);
            if (localWalletRecord == null) {
                callback.onComplete(false);
                return;
            }

            syncBackup(localWalletRecord, error -> callback.onComplete(error == null));
        } catch (Exception error) {
            secureStorage.delete(LOCAL_STORAGE_KEY);
            setBackupSynced(false);
            Log.w(TAG, "Failed to load the Android wallet for a manual Block Store retry.", error);
            callback.onComplete(false);
        }
    }

    private void syncBackupIfNeeded(String serializedWallet) {
        if (isBackupSynced()) {
            return;
        }

        syncBackup(serializedWallet, error -> {});
    }

    private void syncBackup(String serializedWallet, BlockStoreWalletBackup.StoreCallback callback) {
        blockStoreWalletBackup.store(
            BACKUP_STORAGE_KEY,
            serializedWallet.getBytes(StandardCharsets.UTF_8),
            error -> {
                if (error == null) {
                    setBackupSynced(true);
                    Log.i(TAG, "Backed up the Android wallet to Block Store.");
                } else {
                    setBackupSynced(false);
                    Log.w(TAG, "Failed to back up the Android wallet to Block Store.", error);
                }

                callback.onComplete(error);
            }
        );
    }

    private boolean isBackupSynced() {
        return backupPreferences.getBoolean(BACKUP_SYNCED_KEY, false);
    }

    private void setBackupSynced(boolean synced) {
        backupPreferences.edit().putBoolean(BACKUP_SYNCED_KEY, synced).apply();
    }
}
