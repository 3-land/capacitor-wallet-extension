# `@3land/capacitor-wallet-extension`

Capacitor 7 plugin for Solana wallet connectivity in a Capacitor app.

It exposes seven native methods:

- `getAvailableWallets()`
- `connectUsing({ walletType })`
- `signMessage({ message })`
- `signTransactions({ transactions })`
- `hasWalletBeenBackedUp()`
- `retryBackUp()`
- `logout()`

The plugin supports:

- `icloud`: native wallet generated and stored through iCloud Keychain
- `android`: native wallet generated locally, stored encrypted with Android Keystore, and recovered from Block Store when available
- `phantom`: external wallet via deeplink
- `solflare`: external wallet via deeplink
- `backpack`: external wallet via deeplink

No web implementation is included.

## Install

```bash
npm install @3land/capacitor-wallet-extension
npx cap sync
```

## iOS Setup

External wallet flows need your app to have a custom URL scheme so the wallet can redirect back into your Capacitor app.
Installed-wallet detection also needs `LSApplicationQueriesSchemes`, because `getAvailableWallets()` now checks the device for wallet apps and only returns the ones that are actually available, plus `icloud`.

Add a URL type in `ios/App/App/Info.plist` if you do not already have one:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.yourcompany.yourapp</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.yourcompany.yourapp</string>
    </array>
  </dict>
</array>
```

The plugin uses the first registered URL scheme it finds and builds its redirect links from that.

Add wallet query schemes too:

```xml
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>phantom</string>
  <string>solflare</string>
  <string>backpack</string>
</array>
```

These query schemes are only used for installed-app detection.
The actual connect and signing requests still use the wallets' documented `https://.../ul/v1/...` deeplink endpoints.

## Android Setup

The Android implementation ships its own package-visibility queries for Phantom, Solflare, and Backpack, plus a redirect activity that listens on:

```text
${applicationId}://wallet-extension/...
```

So most Capacitor apps do not need any extra Android manifest changes just to use wallet discovery or deeplink callbacks.

The native `android` wallet uses two storage layers:

- Android Keystore-backed encrypted local storage for day-to-day use
- Google Block Store as the recovery channel when the app is reinstalled or restored and the local keystore copy is gone

For silent recovery after uninstall/reinstall, the device still needs:

- Google Play services
- Android Backup enabled for the user/device restore flow

If Block Store is unavailable, the wallet still works locally on that device, but cross-reinstall recovery is not guaranteed.
If backup is temporarily unavailable when the wallet is first created, the plugin now retries the Block Store sync on later wallet loads.

To verify the Android backup flow during development:

- Confirm `Settings > Google > Backup` is enabled on the device.
- Create the `android` wallet, fully close the app, reopen it once so any retry can run, then uninstall and reinstall.
- Watch Logcat for the `AndroidWalletStore` tag. A successful backup logs `Backed up the Android wallet to Block Store.` and a successful restore logs `Restored the Android wallet from Block Store.`

The Android-only backup helper method exposes one signal:

- `hasWalletBeenBackedUp()` reports whether this plugin has successfully stored the current Android wallet into Block Store on this device. It does not guarantee that a later cloud sync has already completed.
- `retryBackUp()` forces a fresh Block Store write for the current Android wallet and resolves immediately with whether that specific write succeeded.

## Vue Usage

```ts
import { WalletExtension, type WalletType } from '@3land/capacitor-wallet-extension';

const { wallets } = await WalletExtension.getAvailableWallets();

const walletType: WalletType = wallets[0] ?? 'android';

const { publicKey } = await WalletExtension.connectUsing({ walletType });

const { signature } = await WalletExtension.signMessage({
  message: '3vQB7B6MrGQZaxCuFg4oh',
});

const { transactions } = await WalletExtension.signTransactions({
  transactions: ['2M9n7m7yJtmY8Y9m6aXvP7hL9Xy7xG4vYvL1Y9EwPq...'],
});

await WalletExtension.logout();
```

## API

### `getAvailableWallets()`

Returns:

```ts
{
  wallets: ['android', 'phantom'];
}
```

On iOS, this method always returns `icloud`.
On Android, this method always returns `android`.
External wallets are only returned when their apps are actually installed and queryable on the device.
If `LSApplicationQueriesSchemes` is missing from `Info.plist`, iOS can report those wallets as unavailable.

### `connectUsing({ walletType })`

Connects the requested wallet type.

- If the same wallet type is already cached, the plugin returns the cached public key.
- If `walletType === 'icloud'`, the plugin creates the wallet on first use and stores it in iCloud Keychain.
- If `walletType === 'android'`, the plugin creates the wallet on first use, stores it encrypted locally, and restores it from Block Store when local state is missing and a backup exists.
- If `walletType` is external, the plugin opens the matching wallet app using its deeplink flow.
- If `walletType` is external and the wallet app is not installed, the call rejects.

Returns:

```ts
{
  publicKey: string;
  walletType: 'icloud' | 'android' | 'phantom' | 'solflare' | 'backpack';
  cached: boolean;
}
```

### `signMessage({ message })`

Signs a message and returns a base58 signature string.

- `message` must be a base58-encoded byte payload.
- The currently connected wallet is used.

Returns:

```ts
{
  signature: string;
  walletType: 'icloud' | 'android' | 'phantom' | 'solflare' | 'backpack';
}
```

### `signTransactions({ transactions })`

Signs one or more base58-encoded serialized Solana transactions.

- For `icloud` and `android`, the plugin signs each serialized transaction locally and returns the updated serialized transactions.
- For external wallets, the plugin uses the wallet's `signAllTransactions` deeplink flow so all transactions are signed in one wallet prompt.

Returns:

```ts
{
  transactions: string[];
  walletType: 'icloud' | 'android' | 'phantom' | 'solflare' | 'backpack';
}
```

### `logout()`

Clears the remembered connected wallet session from memory and local cache.
It does not delete the native `icloud` or `android` wallet itself.

### `hasWalletBeenBackedUp()`

Android only.

Returns:

```ts
{
  backedUp: true,
}
```

Notes:

- `true` means the plugin successfully stored the wallet in Block Store.
- `false` means the wallet either does not exist yet or the last Block Store write has not succeeded yet.

### `retryBackUp()`

Android only.

Returns:

```ts
true
```

Notes:

- `true` means the manual Block Store retry succeeded during that call.
- `false` means there was no local Android wallet to back up, or the manual Block Store write failed.
