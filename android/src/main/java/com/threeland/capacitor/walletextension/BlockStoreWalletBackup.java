package com.threeland.capacitor.walletextension;

import android.content.Context;
import androidx.annotation.Nullable;
import com.google.android.gms.auth.blockstore.Blockstore;
import com.google.android.gms.auth.blockstore.BlockstoreClient;
import com.google.android.gms.auth.blockstore.RetrieveBytesRequest;
import com.google.android.gms.auth.blockstore.RetrieveBytesResponse;
import com.google.android.gms.auth.blockstore.StoreBytesData;
import java.util.Collections;
import java.util.Map;

final class BlockStoreWalletBackup {
    interface RetrieveCallback {
        void onSuccess(@Nullable byte[] bytes);

        void onError(Exception error);
    }

    interface StoreCallback {
        void onComplete(@Nullable Exception error);
    }

    private final BlockstoreClient client;

    BlockStoreWalletBackup(Context context) {
        client = Blockstore.getClient(context);
    }

    void retrieve(String key, RetrieveCallback callback) {
        RetrieveBytesRequest request = new RetrieveBytesRequest.Builder()
            .setKeys(Collections.singletonList(key))
            .build();

        client
            .retrieveBytes(request)
            .addOnSuccessListener(response -> {
                Map<String, RetrieveBytesResponse.BlockstoreData> dataMap =
                    response.getBlockstoreDataMap();
                RetrieveBytesResponse.BlockstoreData data = dataMap.get(key);
                callback.onSuccess(data == null ? null : data.getBytes());
            })
            .addOnFailureListener(callback::onError);
    }

    void store(String key, byte[] bytes, StoreCallback callback) {
        StoreBytesData storeBytesData = new StoreBytesData.Builder()
            .setKey(key)
            .setBytes(bytes)
            .setShouldBackupToCloud(true)
            .build();

        client
            .storeBytes(storeBytesData)
            .addOnSuccessListener(unused -> callback.onComplete(null))
            .addOnFailureListener(callback::onComplete);
    }
}
