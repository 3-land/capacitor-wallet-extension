import { Capacitor, registerPlugin } from '@capacitor/core';
import nacl from 'tweetnacl';
import { decodeBase58, encodeBase58 } from './base58';
import { signSerializedTransaction } from './solana';
const WalletExtensionNative = registerPlugin('WalletExtension');
const REDIRECT_HOST = 'wallet-extension';
const CLUSTER = 'mainnet-beta';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const externalWallets = {
    phantom: {
        connectUrl: 'https://phantom.app/ul/v1/connect',
        signMessageUrl: 'https://phantom.app/ul/v1/signMessage',
        signAllTransactionsUrl: 'https://phantom.app/ul/v1/signAllTransactions',
    },
    solflare: {
        connectUrl: 'https://solflare.com/ul/v1/connect',
        signMessageUrl: 'https://solflare.com/ul/v1/signMessage',
        signAllTransactionsUrl: 'https://solflare.com/ul/v1/signAllTransactions',
    },
    backpack: {
        connectUrl: 'https://backpack.app/ul/v1/connect',
        signMessageUrl: 'https://backpack.app/ul/v1/signMessage',
        signAllTransactionsUrl: 'https://backpack.app/ul/v1/signAllTransactions',
    },
};
let cachedSession;
let cachedAndroidWallet;
let cachedRedirectScheme;
const WalletExtension = {
    async getAvailableWallets() {
        if (Capacitor.getPlatform() !== 'android') {
            return requireNativeMethod('getAvailableWallets')();
        }
        const installedWallets = await requireNativeMethod('getInstalledWallets')();
        return {
            wallets: ['android', ...installedWallets.wallets.filter(isExternalWalletType)],
        };
    },
    async connectUsing(options) {
        if (Capacitor.getPlatform() !== 'android') {
            return requireNativeMethod('connectUsing')(options);
        }
        const walletType = options.walletType;
        if (!walletType) {
            throw walletError('MISSING_PARAMETER', "Missing required parameter 'walletType'.");
        }
        if (walletType === 'icloud') {
            throw walletError('INVALID_WALLET_TYPE', "Unsupported wallet type 'icloud' on Android.");
        }
        const currentSession = await getCurrentAndroidSession();
        if (currentSession &&
            currentSession.walletType === walletType &&
            canReuseWithoutReconnect(currentSession)) {
            return {
                publicKey: currentSession.publicKey,
                walletType: currentSession.walletType,
                cached: true,
            };
        }
        if (walletType === 'android') {
            const wallet = await ensureAndroidWallet();
            const nextSession = {
                walletType: 'android',
                publicKey: wallet.publicKey,
            };
            await saveCurrentAndroidSession(nextSession);
            return {
                publicKey: wallet.publicKey,
                walletType: 'android',
                cached: false,
            };
        }
        await assertExternalWalletInstalled(walletType);
        const dappEncryptionKeyPair = nacl.box.keyPair();
        const dappPublicKey = encodeBase58(dappEncryptionKeyPair.publicKey);
        const dappSecretKey = encodeBase58(dappEncryptionKeyPair.secretKey);
        const callback = await openWalletDeeplink(walletType, buildExternalWalletUrl(externalWallets[walletType].connectUrl, {
            app_url: await buildBaseAppUrl(),
            dapp_encryption_public_key: dappPublicKey,
            redirect_link: await buildRedirectUrl('/connect'),
            cluster: CLUSTER,
        }));
        const query = parseWalletCallback(callback, '/connect');
        const errorMessage = query.get('errorMessage');
        if (errorMessage) {
            throw walletError('CALLBACK_ERROR', errorMessage);
        }
        const walletEncryptionPublicKey = query.get('phantom_encryption_public_key') ??
            query.get('solflare_encryption_public_key') ??
            query.get('wallet_encryption_public_key');
        if (!walletEncryptionPublicKey) {
            throw walletError('MALFORMED_CALLBACK', 'Wallet encryption public key was missing from the connect callback.');
        }
        const decryptedPayload = decryptPayload(query, walletEncryptionPublicKey, dappSecretKey);
        const response = parseJson(decryptedPayload, 'Failed to process the external wallet connect callback.');
        const nextSession = {
            walletType,
            publicKey: response.public_key,
            session: response.session,
            dappEncryptionPublicKey: dappPublicKey,
            dappEncryptionSecretKey: dappSecretKey,
            walletEncryptionPublicKey,
        };
        await saveCurrentAndroidSession(nextSession);
        return {
            publicKey: response.public_key,
            walletType,
            cached: false,
        };
    },
    async signMessage(options) {
        if (Capacitor.getPlatform() !== 'android') {
            return requireNativeMethod('signMessage')(options);
        }
        const message = options.message;
        if (!message) {
            throw walletError('MISSING_PARAMETER', "Missing required parameter 'message'.");
        }
        const session = await requireCurrentAndroidSession();
        if (session.walletType === 'android') {
            const wallet = await requireAndroidWallet();
            const signature = nacl.sign.detached(decodeBase58(message), decodeBase58(wallet.secretKey));
            return {
                signature: encodeBase58(signature),
                walletType: 'android',
            };
        }
        const externalSession = requireExternalSession(session);
        const nonce = nacl.randomBytes(24);
        const payload = textEncoder.encode(JSON.stringify({
            message,
            session: externalSession.session,
        }));
        const encryptedPayload = nacl.box(payload, nonce, decodeBase58(externalSession.walletEncryptionPublicKey), decodeBase58(externalSession.dappEncryptionSecretKey));
        const callback = await openWalletDeeplink(externalSession.walletType, buildExternalWalletUrl(externalWallets[externalSession.walletType].signMessageUrl, {
            dapp_encryption_public_key: externalSession.dappEncryptionPublicKey,
            nonce: encodeBase58(nonce),
            redirect_link: await buildRedirectUrl('/sign-message'),
            payload: encodeBase58(encryptedPayload),
        }));
        const query = parseWalletCallback(callback, '/sign-message');
        const errorMessage = query.get('errorMessage');
        if (errorMessage) {
            throw walletError('CALLBACK_ERROR', errorMessage);
        }
        const decryptedPayload = decryptPayload(query, externalSession.walletEncryptionPublicKey, externalSession.dappEncryptionSecretKey);
        const response = parseJson(decryptedPayload, 'Failed to process the external wallet signMessage callback.');
        const verified = nacl.sign.detached.verify(decodeBase58(message), decodeBase58(response.signature), decodeBase58(session.publicKey));
        if (!verified) {
            throw walletError('CALLBACK_ERROR', 'The external wallet returned a signature that could not be verified.');
        }
        return {
            signature: response.signature,
            walletType: externalSession.walletType,
        };
    },
    async signTransactions(options) {
        if (Capacitor.getPlatform() !== 'android') {
            return requireNativeMethod('signTransactions')(options);
        }
        const transactions = options.transactions;
        if (!Array.isArray(transactions) || transactions.length === 0) {
            throw walletError('MISSING_PARAMETER', "Missing required parameter 'transactions'.");
        }
        const session = await requireCurrentAndroidSession();
        if (session.walletType === 'android') {
            const wallet = await requireAndroidWallet();
            const signerSecretKey = decodeBase58(wallet.secretKey);
            return {
                transactions: transactions.map((transaction) => signSerializedTransaction(transaction, wallet.publicKey, signerSecretKey)),
                walletType: 'android',
            };
        }
        const externalSession = requireExternalSession(session);
        const nonce = nacl.randomBytes(24);
        const payload = textEncoder.encode(JSON.stringify({
            transactions,
            session: externalSession.session,
        }));
        const encryptedPayload = nacl.box(payload, nonce, decodeBase58(externalSession.walletEncryptionPublicKey), decodeBase58(externalSession.dappEncryptionSecretKey));
        const callback = await openWalletDeeplink(externalSession.walletType, buildExternalWalletUrl(externalWallets[externalSession.walletType].signAllTransactionsUrl, {
            dapp_encryption_public_key: externalSession.dappEncryptionPublicKey,
            nonce: encodeBase58(nonce),
            redirect_link: await buildRedirectUrl('/sign-transactions'),
            payload: encodeBase58(encryptedPayload),
        }));
        const query = parseWalletCallback(callback, '/sign-transactions');
        const errorMessage = query.get('errorMessage');
        if (errorMessage) {
            throw walletError('CALLBACK_ERROR', errorMessage);
        }
        const decryptedPayload = decryptPayload(query, externalSession.walletEncryptionPublicKey, externalSession.dappEncryptionSecretKey);
        const response = parseJson(decryptedPayload, 'Failed to process the external wallet signAllTransactions callback.');
        if (response.transactions.length !== transactions.length) {
            throw walletError('CALLBACK_ERROR', 'The external wallet returned an unexpected number of signed transactions.');
        }
        return {
            transactions: response.transactions,
            walletType: externalSession.walletType,
        };
    },
    async logout() {
        if (Capacitor.getPlatform() !== 'android') {
            return requireNativeMethod('logout')();
        }
        cachedSession = null;
        cachedAndroidWallet = undefined;
        await requireNativeMethod('logout')();
    },
};
export * from './definitions';
export { WalletExtension };
function requireNativeMethod(method) {
    const nativeMethod = WalletExtensionNative[method];
    if (!nativeMethod) {
        throw walletError('UNAVAILABLE', `WalletExtension.${String(method)} is not available on this platform.`);
    }
    return nativeMethod.bind(WalletExtensionNative);
}
async function getCurrentAndroidSession() {
    if (cachedSession !== undefined) {
        return cachedSession;
    }
    const result = await requireNativeMethod('getCachedSession')();
    if (!result.session) {
        cachedSession = null;
        return null;
    }
    cachedSession = parseJson(result.session, 'Failed to read the cached wallet session.');
    return cachedSession;
}
async function saveCurrentAndroidSession(session) {
    await requireNativeMethod('saveCachedSession')({
        session: JSON.stringify(session),
    });
    cachedSession = session;
}
async function requireCurrentAndroidSession() {
    const session = await getCurrentAndroidSession();
    if (!session) {
        throw walletError('MISSING_CONNECTED_WALLET', 'No wallet is currently connected.');
    }
    return session;
}
async function getStoredAndroidWallet() {
    if (cachedAndroidWallet !== undefined) {
        return cachedAndroidWallet;
    }
    const result = await requireNativeMethod('getWalletRecord')();
    if (!result.present) {
        cachedAndroidWallet = null;
        return null;
    }
    if (!result.publicKey || !result.secretKey) {
        throw walletError('CRYPTOGRAPHY_FAILURE', 'The Android wallet record is incomplete.');
    }
    cachedAndroidWallet = {
        publicKey: result.publicKey,
        secretKey: result.secretKey,
    };
    return cachedAndroidWallet;
}
async function ensureAndroidWallet() {
    const existingWallet = await getStoredAndroidWallet();
    if (existingWallet) {
        return existingWallet;
    }
    const keyPair = nacl.sign.keyPair();
    const nextWallet = {
        publicKey: encodeBase58(keyPair.publicKey),
        secretKey: encodeBase58(keyPair.secretKey),
    };
    await requireNativeMethod('saveWalletRecord')(nextWallet);
    cachedAndroidWallet = nextWallet;
    return nextWallet;
}
async function requireAndroidWallet() {
    const wallet = await ensureAndroidWallet();
    if (!wallet.publicKey || !wallet.secretKey) {
        throw walletError('CRYPTOGRAPHY_FAILURE', 'Failed to load the Android wallet record.');
    }
    return wallet;
}
async function assertExternalWalletInstalled(walletType) {
    const installedWallets = await requireNativeMethod('getInstalledWallets')();
    if (!installedWallets.wallets.includes(walletType)) {
        throw walletError('WALLET_NOT_INSTALLED', `The '${walletType}' wallet app is not installed or cannot be queried on Android.`);
    }
}
async function getRedirectScheme() {
    if (cachedRedirectScheme) {
        return cachedRedirectScheme;
    }
    const result = await requireNativeMethod('getRedirectScheme')();
    if (!result.scheme) {
        throw walletError('INVALID_REDIRECT_SCHEME', 'No Android redirect scheme was found for the current app.');
    }
    cachedRedirectScheme = result.scheme;
    return cachedRedirectScheme;
}
async function buildRedirectUrl(path) {
    const scheme = await getRedirectScheme();
    return `${scheme}://${REDIRECT_HOST}${path}`;
}
async function buildBaseAppUrl() {
    const scheme = await getRedirectScheme();
    return `${scheme}://${REDIRECT_HOST}/app`;
}
function buildExternalWalletUrl(baseUrl, query) {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}
async function openWalletDeeplink(walletType, url) {
    const result = await requireNativeMethod('openWalletDeeplink')({
        walletType,
        url,
    });
    return result.callbackUrl;
}
function parseWalletCallback(callbackUrl, expectedPath) {
    const callback = new URL(callbackUrl);
    if (callback.host !== REDIRECT_HOST || callback.pathname !== expectedPath) {
        throw walletError('MALFORMED_CALLBACK', 'The wallet callback was received on an unexpected redirect URL.');
    }
    return callback.searchParams;
}
function decryptPayload(query, walletEncryptionPublicKey, dappSecretKey) {
    const nonce = query.get('nonce');
    const data = query.get('data');
    if (!nonce || !data) {
        throw walletError('MALFORMED_CALLBACK', 'Wallet callback is missing its encrypted payload.');
    }
    const decrypted = nacl.box.open(decodeBase58(data), decodeBase58(nonce), decodeBase58(walletEncryptionPublicKey), decodeBase58(dappSecretKey));
    if (!decrypted) {
        throw walletError('MALFORMED_CALLBACK', 'Failed to decrypt the external wallet callback payload.');
    }
    return textDecoder.decode(decrypted);
}
function parseJson(value, message) {
    try {
        return JSON.parse(value);
    }
    catch {
        throw walletError('MALFORMED_CALLBACK', message);
    }
}
function canReuseWithoutReconnect(session) {
    if (session.walletType === 'icloud' || session.walletType === 'android') {
        return session.publicKey.length > 0;
    }
    return (session.publicKey.length > 0 &&
        Boolean(session.session) &&
        Boolean(session.dappEncryptionPublicKey) &&
        Boolean(session.dappEncryptionSecretKey) &&
        Boolean(session.walletEncryptionPublicKey));
}
function requireExternalSession(session) {
    if (!isExternalWalletType(session.walletType) ||
        !session.session ||
        !session.dappEncryptionPublicKey ||
        !session.dappEncryptionSecretKey ||
        !session.walletEncryptionPublicKey) {
        throw walletError('MISSING_CONNECTED_WALLET', 'No wallet is currently connected.');
    }
    return session;
}
function isExternalWalletType(value) {
    return value === 'phantom' || value === 'solflare' || value === 'backpack';
}
function walletError(code, message) {
    const error = new Error(message);
    error.name = 'WalletExtensionError';
    error.code = code;
    return error;
}
