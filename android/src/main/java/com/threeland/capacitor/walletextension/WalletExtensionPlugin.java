package com.threeland.capacitor.walletextension;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WalletExtension")
public class WalletExtensionPlugin extends Plugin {
    private static final String CALLBACK_HOST = "wallet-extension";
    private static final long REQUEST_TIMEOUT_MS = 60000L;
    private static final String PENDING_PREFS_NAME =
        "com.3land.capacitor-wallet-extension.pending";
    private static final String PENDING_CALL_ID_KEY = "pending-deeplink-call-id";
    private static final String PENDING_REDIRECT_URL_KEY =
        "pending-deeplink-redirect-url";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private AndroidWalletStore walletStore;
    private WalletSessionStore sessionStore;
    private String pendingDeeplinkCallId;
    private Uri pendingRedirectUri;
    private Runnable pendingTimeoutRunnable;

    @Override
    public void load() {
        walletStore = new AndroidWalletStore(getContext());
        sessionStore = new WalletSessionStore(getContext());
        pendingDeeplinkCallId = getPendingPreferences().getString(PENDING_CALL_ID_KEY, null);
        String pendingRedirectUrl = getPendingPreferences()
            .getString(PENDING_REDIRECT_URL_KEY, null);
        pendingRedirectUri =
            pendingRedirectUrl == null || pendingRedirectUrl.isEmpty()
                ? null
                : Uri.parse(pendingRedirectUrl);
        maybeHandleCallbackIntent(getActivity() != null ? getActivity().getIntent() : null);
    }

    @PluginMethod
    public void getInstalledWallets(PluginCall call) {
        JSArray wallets = new JSArray();

        for (WalletProvider provider : WalletProvider.values()) {
            if (isInstalled(provider)) {
                wallets.put(provider.getWalletType());
            }
        }

        JSObject result = new JSObject();
        result.put("wallets", wallets);
        call.resolve(result);
    }

    @PluginMethod
    public void getWalletRecord(PluginCall call) {
        walletStore.load(
            new AndroidWalletStore.LoadCallback() {
                @Override
                public void onLoaded(WalletRecord walletRecord) {
                    JSObject result = new JSObject();
                    result.put("present", true);
                    result.put("publicKey", walletRecord.getPublicKey());
                    result.put("secretKey", walletRecord.getSecretKey());
                    call.resolve(result);
                }

                @Override
                public void onMissing() {
                    JSObject result = new JSObject();
                    result.put("present", false);
                    call.resolve(result);
                }

                @Override
                public void onError(String message) {
                    reject(call, "CRYPTOGRAPHY_FAILURE", message);
                }
            }
        );
    }

    @PluginMethod
    public void saveWalletRecord(PluginCall call) {
        String publicKey = call.getString("publicKey");
        String secretKey = call.getString("secretKey");

        if (publicKey == null || publicKey.isEmpty()) {
            reject(call, "MISSING_PARAMETER", "Missing required parameter 'publicKey'.");
            return;
        }

        if (secretKey == null || secretKey.isEmpty()) {
            reject(call, "MISSING_PARAMETER", "Missing required parameter 'secretKey'.");
            return;
        }

        walletStore.save(
            new WalletRecord(publicKey, secretKey),
            new AndroidWalletStore.SaveCallback() {
                @Override
                public void onSaved() {
                    call.resolve();
                }

                @Override
                public void onError(String message) {
                    reject(call, "CRYPTOGRAPHY_FAILURE", message);
                }
            }
        );
    }

    @PluginMethod
    public void getCachedSession(PluginCall call) {
        String session = sessionStore.load();
        JSObject result = new JSObject();

        if (session != null) {
            result.put("session", session);
        }

        call.resolve(result);
    }

    @PluginMethod
    public void saveCachedSession(PluginCall call) {
        String session = call.getString("session");
        if (session == null || session.isEmpty()) {
            reject(call, "MISSING_PARAMETER", "Missing required parameter 'session'.");
            return;
        }

        try {
            sessionStore.save(session);
            call.resolve();
        } catch (Exception error) {
            reject(
                call,
                "CRYPTOGRAPHY_FAILURE",
                "Failed to cache the connected wallet session."
            );
        }
    }

    @PluginMethod
    public void getRedirectScheme(PluginCall call) {
        JSObject result = new JSObject();
        result.put("scheme", getContext().getPackageName());
        call.resolve(result);
    }

    @PluginMethod
    public void hasWalletBeenBackedUp(PluginCall call) {
        JSObject result = new JSObject();
        result.put("backedUp", walletStore.hasWalletBeenBackedUp());
        call.resolve(result);
    }

    @PluginMethod
    public void retryBackUp(PluginCall call) {
        walletStore.retryBackUp(backedUp -> {
            JSObject result = new JSObject();
            result.put("backedUp", backedUp);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void openWalletDeeplink(PluginCall call) {
        String walletType = call.getString("walletType");
        String url = call.getString("url");

        if (walletType == null || walletType.isEmpty()) {
            reject(call, "MISSING_PARAMETER", "Missing required parameter 'walletType'.");
            return;
        }

        if (url == null || url.isEmpty()) {
            reject(call, "MISSING_PARAMETER", "Missing required parameter 'url'.");
            return;
        }

        WalletProvider provider = WalletProvider.fromWalletType(walletType);
        if (provider == null) {
            reject(
                call,
                "INVALID_WALLET_TYPE",
                "Unsupported wallet type '" + walletType + "'."
            );
            return;
        }

        if (pendingDeeplinkCallId != null) {
            reject(call, "REQUEST_ALREADY_PENDING", "A wallet request is already in progress.");
            return;
        }

        if (!isInstalled(provider)) {
            reject(
                call,
                "WALLET_NOT_INSTALLED",
                "The '" + walletType + "' wallet app is not installed or cannot be queried on Android."
            );
            return;
        }

        try {
            Uri deeplinkUri = Uri.parse(url);
            String redirectLink = deeplinkUri.getQueryParameter("redirect_link");
            Uri redirectUri = parseRedirectUri(redirectLink);
            Intent intent = new Intent(Intent.ACTION_VIEW, deeplinkUri);
            intent.setPackage(provider.getPackageName());
            intent.addCategory(Intent.CATEGORY_BROWSABLE);

            bridge.saveCall(call);
            pendingDeeplinkCallId = call.getCallbackId();
            pendingRedirectUri = redirectUri;
            persistPendingCallId(pendingDeeplinkCallId);
            persistPendingRedirectUrl(redirectUri.toString());
            scheduleTimeout();

            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
        } catch (Exception error) {
            clearPendingState();
            bridge.releaseCall(call);
            reject(
                call,
                "DEEPLINK_FAILURE",
                "The wallet deeplink could not be opened."
            );
        }
    }

    @PluginMethod
    public void logout(PluginCall call) {
        cancelPendingRequest("The current wallet session was cleared.");
        sessionStore.clear();
        call.resolve();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        maybeHandleCallbackIntent(intent);
    }

    @Override
    protected void handleOnResume() {
        maybeHandleCallbackIntent(getActivity() != null ? getActivity().getIntent() : null);
    }

    private void maybeHandleCallbackIntent(Intent intent) {
        if (pendingDeeplinkCallId == null || intent == null) {
            return;
        }

        Uri data = intent.getData();
        if (!isWalletCallback(data)) {
            return;
        }

        PluginCall savedCall = bridge.getSavedCall(pendingDeeplinkCallId);
        clearPendingState();

        if (savedCall == null) {
            return;
        }

        JSObject result = new JSObject();
        result.put("callbackUrl", data.toString());
        savedCall.resolve(result);
        bridge.releaseCall(savedCall);
    }

    private boolean isInstalled(WalletProvider provider) {
        PackageManager packageManager = getContext().getPackageManager();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(
                    provider.getPackageName(),
                    PackageManager.PackageInfoFlags.of(0)
                );
            } else {
                packageManager.getPackageInfo(provider.getPackageName(), 0);
            }

            return true;
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
    }

    private boolean isWalletCallback(Uri uri) {
        if (uri == null) {
            return false;
        }

        if (pendingRedirectUri != null) {
            return urlsMatch(uri, pendingRedirectUri);
        }

        return CALLBACK_HOST.equals(uri.getHost())
            && getContext().getPackageName().equals(uri.getScheme());
    }

    private void scheduleTimeout() {
        clearTimeout();

        pendingTimeoutRunnable =
            () ->
                cancelPendingRequest(
                    "The wallet request timed out before the app received a callback."
                );
        mainHandler.postDelayed(pendingTimeoutRunnable, REQUEST_TIMEOUT_MS);
    }

    private void clearTimeout() {
        if (pendingTimeoutRunnable != null) {
            mainHandler.removeCallbacks(pendingTimeoutRunnable);
            pendingTimeoutRunnable = null;
        }
    }

    private void clearPendingState() {
        persistPendingCallId(null);
        persistPendingRedirectUrl(null);
        pendingDeeplinkCallId = null;
        pendingRedirectUri = null;
        clearTimeout();
    }

    private void persistPendingCallId(String callbackId) {
        getPendingPreferences().edit().putString(PENDING_CALL_ID_KEY, callbackId).apply();
    }

    private void persistPendingRedirectUrl(String redirectUrl) {
        getPendingPreferences().edit().putString(PENDING_REDIRECT_URL_KEY, redirectUrl).apply();
    }

    private void cancelPendingRequest(String message) {
        if (pendingDeeplinkCallId == null) {
            return;
        }

        PluginCall savedCall = bridge.getSavedCall(pendingDeeplinkCallId);
        clearPendingState();

        if (savedCall != null) {
            reject(savedCall, "DEEPLINK_FAILURE", message);
            bridge.releaseCall(savedCall);
        }
    }

    private void reject(PluginCall call, String code, String message) {
        call.reject(message, code);
    }

    private android.content.SharedPreferences getPendingPreferences() {
        return getContext().getSharedPreferences(PENDING_PREFS_NAME, Context.MODE_PRIVATE);
    }

    private Uri parseRedirectUri(String redirectLink) {
        if (redirectLink == null || redirectLink.isEmpty()) {
            throw new IllegalArgumentException("Missing redirect_link.");
        }

        Uri redirectUri = Uri.parse(redirectLink);
        if (redirectUri.getScheme() == null || redirectUri.getScheme().isEmpty()) {
            throw new IllegalArgumentException("Missing redirect scheme.");
        }

        if (redirectUri.getAuthority() == null || redirectUri.getAuthority().isEmpty()) {
            throw new IllegalArgumentException("Missing redirect authority.");
        }

        return redirectUri;
    }

    private boolean urlsMatch(Uri left, Uri right) {
        return stringEquals(left.getScheme(), right.getScheme())
            && stringEquals(left.getAuthority(), right.getAuthority())
            && normalizePath(left.getPath()).equals(normalizePath(right.getPath()));
    }

    private boolean stringEquals(String left, String right) {
        if (left == null) {
            return right == null;
        }

        return left.equals(right);
    }

    private String normalizePath(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) {
            return "";
        }

        return path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
    }
}
