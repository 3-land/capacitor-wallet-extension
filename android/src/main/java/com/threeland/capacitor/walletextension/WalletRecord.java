package com.threeland.capacitor.walletextension;

import org.json.JSONException;
import org.json.JSONObject;

final class WalletRecord {
    private final String publicKey;
    private final String secretKey;

    WalletRecord(String publicKey, String secretKey) {
        this.publicKey = publicKey;
        this.secretKey = secretKey;
    }

    String getPublicKey() {
        return publicKey;
    }

    String getSecretKey() {
        return secretKey;
    }

    String toJson() throws JSONException {
        JSONObject object = new JSONObject();
        object.put("publicKey", publicKey);
        object.put("secretKey", secretKey);
        return object.toString();
    }

    static WalletRecord fromJson(String json) throws JSONException {
        JSONObject object = new JSONObject(json);
        String publicKey = object.optString("publicKey", "");
        String secretKey = object.optString("secretKey", "");

        if (publicKey.isEmpty() || secretKey.isEmpty()) {
            throw new JSONException("Wallet record was incomplete.");
        }

        return new WalletRecord(publicKey, secretKey);
    }
}
