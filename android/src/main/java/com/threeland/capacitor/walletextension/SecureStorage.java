package com.threeland.capacitor.walletextension;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONException;
import org.json.JSONObject;

final class SecureStorage {
    private static final String PREFS_NAME = "com.3land.capacitor-wallet-extension.secure";
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_LENGTH_BITS = 128;

    private final SharedPreferences sharedPreferences;
    private final String keyAlias;

    SecureStorage(Context context, String keyAlias) {
        this.sharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.keyAlias = keyAlias;
    }

    void saveString(String storageKey, String value) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey());

        byte[] encryptedBytes = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();

        JSONObject record = new JSONObject();
        record.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
        record.put("ciphertext", Base64.encodeToString(encryptedBytes, Base64.NO_WRAP));

        sharedPreferences.edit().putString(storageKey, record.toString()).apply();
    }

    String loadString(String storageKey) throws Exception {
        String storedValue = sharedPreferences.getString(storageKey, null);
        if (storedValue == null) {
            return null;
        }

        JSONObject record = new JSONObject(storedValue);
        byte[] iv = Base64.decode(record.getString("iv"), Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(record.getString("ciphertext"), Base64.NO_WRAP);

        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(
            Cipher.DECRYPT_MODE,
            getOrCreateSecretKey(),
            new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        );

        byte[] decryptedBytes = cipher.doFinal(ciphertext);
        return new String(decryptedBytes, StandardCharsets.UTF_8);
    }

    void delete(String storageKey) {
        sharedPreferences.edit().remove(storageKey).apply();
    }

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
        keyStore.load(null);

        if (!keyStore.containsAlias(keyAlias)) {
            KeyGenerator keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                KEYSTORE_PROVIDER
            );
            keyGenerator.init(
                new KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
                )
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            );
            keyGenerator.generateKey();
        }

        Key key = keyStore.getKey(keyAlias, null);
        if (!(key instanceof SecretKey)) {
            throw new JSONException("The Android keystore key was not available.");
        }

        return (SecretKey) key;
    }
}
