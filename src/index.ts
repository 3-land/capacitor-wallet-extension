import { Capacitor, registerPlugin } from '@capacitor/core';
import nacl from 'tweetnacl';

import type {
  ConnectUsingOptions,
  ConnectUsingResult,
  GetAvailableWalletsResult,
  GetWalletMnemonicsResult,
  HasWalletBeenBackedUpResult,
  RecoverWalletFromMnemonicsOptions,
  SignMessageOptions,
  SignMessageResult,
  SignTransactionsOptions,
  SignTransactionsResult,
  WalletExtensionPlugin,
  WalletType,
} from './definitions';
import { decodeBase58, encodeBase58 } from './base58';
import { entropyToMnemonic, mnemonicToEntropy } from './mnemonics';
import { signSerializedTransaction } from './solana';

type ExternalWalletType = Extract<WalletType, 'phantom' | 'solflare' | 'backpack'>;
type NativeWalletType = Extract<WalletType, 'icloud' | 'android'>;

interface ConnectedWalletSession {
  walletType: WalletType;
  publicKey: string;
  session?: string;
  dappEncryptionPublicKey?: string;
  dappEncryptionSecretKey?: string;
  walletEncryptionPublicKey?: string;
}

interface NativeWalletRecord {
  publicKey: string;
  secretKey: string;
}

interface GetWalletRecordResult {
  present?: boolean;
  publicKey?: string;
  secretKey?: string;
}

interface WalletExtensionNativePlugin
  extends Partial<Omit<WalletExtensionPlugin, 'retryBackUp'>> {
  getInstalledWallets?: () => Promise<GetAvailableWalletsResult>;
  getWalletRecord?: () => Promise<GetWalletRecordResult>;
  saveWalletRecord?: (options: NativeWalletRecord) => Promise<void>;
  hasWalletBeenBackedUp?: () => Promise<HasWalletBeenBackedUpResult>;
  retryBackUp?: () => Promise<{ backedUp?: boolean }>;
  getCachedSession?: () => Promise<{ session?: string }>;
  saveCachedSession?: (options: { session: string }) => Promise<void>;
  getRedirectScheme?: () => Promise<{ scheme: string }>;
  openWalletDeeplink?: (options: {
    url: string;
    walletType: ExternalWalletType;
  }) => Promise<{ callbackUrl: string }>;
}

interface ExternalWalletMetadata {
  connectUrl: string;
  signMessageUrl: string;
  signAllTransactionsUrl: string;
}

interface ExternalConnectResponse {
  public_key: string;
  session: string;
}

interface ExternalSignMessageResponse {
  signature: string;
}

interface ExternalSignTransactionsResponse {
  transactions: string[];
}

const WalletExtensionNative = registerPlugin<WalletExtensionNativePlugin>(
  'WalletExtension',
);

const REDIRECT_HOST = 'wallet-extension';
const CLUSTER = 'mainnet-beta';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const externalWallets: Record<ExternalWalletType, ExternalWalletMetadata> = {
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

let cachedSession: ConnectedWalletSession | null | undefined;
let cachedAndroidWallet: NativeWalletRecord | null | undefined;
let cachedRedirectScheme: string | undefined;

const WalletExtension: WalletExtensionPlugin = {
  async getAvailableWallets() {
    if (Capacitor.getPlatform() !== 'android') {
      return requireNativeMethod('getAvailableWallets')();
    }

    const installedWallets = await requireNativeMethod('getInstalledWallets')();
    return {
      wallets: ['android', ...installedWallets.wallets.filter(isExternalWalletType)],
    };
  },

  async connectUsing(options: ConnectUsingOptions): Promise<ConnectUsingResult> {
    if (Capacitor.getPlatform() !== 'android') {
      return requireNativeMethod('connectUsing')(options);
    }

    const walletType = options.walletType;
    if (!walletType) {
      throw walletError(
        'MISSING_PARAMETER',
        "Missing required parameter 'walletType'.",
      );
    }

    if (walletType === 'icloud') {
      throw walletError(
        'INVALID_WALLET_TYPE',
        "Unsupported wallet type 'icloud' on Android.",
      );
    }

    const currentSession = await getCurrentAndroidSession();
    if (
      currentSession &&
      currentSession.walletType === walletType &&
      canReuseWithoutReconnect(currentSession)
    ) {
      return {
        publicKey: currentSession.publicKey,
        walletType: currentSession.walletType,
        cached: true,
      };
    }

    if (walletType === 'android') {
      const wallet = await ensureAndroidWallet();
      const nextSession: ConnectedWalletSession = {
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
    const callback = await openWalletDeeplink(
      walletType,
      buildExternalWalletUrl(externalWallets[walletType].connectUrl, {
        app_url: await buildBaseAppUrl(),
        dapp_encryption_public_key: dappPublicKey,
        redirect_link: await buildRedirectUrl('/connect'),
        cluster: CLUSTER,
      }),
    );
    const query = parseWalletCallback(callback, '/connect');
    const errorMessage = query.get('errorMessage');
    if (errorMessage) {
      throw walletError('CALLBACK_ERROR', errorMessage);
    }

    const walletEncryptionPublicKey =
      query.get('phantom_encryption_public_key') ??
      query.get('solflare_encryption_public_key') ??
      query.get('wallet_encryption_public_key');

    if (!walletEncryptionPublicKey) {
      throw walletError(
        'MALFORMED_CALLBACK',
        'Wallet encryption public key was missing from the connect callback.',
      );
    }

    const decryptedPayload = decryptPayload(
      query,
      walletEncryptionPublicKey,
      dappSecretKey,
    );
    const response = parseJson<ExternalConnectResponse>(
      decryptedPayload,
      'MALFORMED_CALLBACK',
      'Failed to process the external wallet connect callback.',
    );
    const nextSession: ConnectedWalletSession = {
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

  async signMessage(options: SignMessageOptions): Promise<SignMessageResult> {
    if (Capacitor.getPlatform() !== 'android') {
      return requireNativeMethod('signMessage')(options);
    }

    const message = options.message;
    if (!message) {
      throw walletError(
        'MISSING_PARAMETER',
        "Missing required parameter 'message'.",
      );
    }

    const session = await requireCurrentAndroidSession();
    if (session.walletType === 'android') {
      const wallet = await requireAndroidWallet();
      const signature = nacl.sign.detached(
        decodeBase58(message),
        decodeBase58(wallet.secretKey),
      );

      return {
        signature: encodeBase58(signature),
        walletType: 'android',
      };
    }

    const externalSession = requireExternalSession(session);
    const nonce = nacl.randomBytes(24);
    const payload = textEncoder.encode(
      JSON.stringify({
        message,
        session: externalSession.session,
      }),
    );
    const encryptedPayload = nacl.box(
      payload,
      nonce,
      decodeBase58(externalSession.walletEncryptionPublicKey),
      decodeBase58(externalSession.dappEncryptionSecretKey),
    );
    const callback = await openWalletDeeplink(
      externalSession.walletType,
      buildExternalWalletUrl(
        externalWallets[externalSession.walletType].signMessageUrl,
        {
          dapp_encryption_public_key: externalSession.dappEncryptionPublicKey,
          nonce: encodeBase58(nonce),
          redirect_link: await buildRedirectUrl('/sign-message'),
          payload: encodeBase58(encryptedPayload),
        },
      ),
    );
    const query = parseWalletCallback(callback, '/sign-message');
    const errorMessage = query.get('errorMessage');
    if (errorMessage) {
      throw walletError('CALLBACK_ERROR', errorMessage);
    }

    const decryptedPayload = decryptPayload(
      query,
      externalSession.walletEncryptionPublicKey,
      externalSession.dappEncryptionSecretKey,
    );
    const response = parseJson<ExternalSignMessageResponse>(
      decryptedPayload,
      'MALFORMED_CALLBACK',
      'Failed to process the external wallet signMessage callback.',
    );
    const verified = nacl.sign.detached.verify(
      decodeBase58(message),
      decodeBase58(response.signature),
      decodeBase58(session.publicKey),
    );

    if (!verified) {
      throw walletError(
        'CALLBACK_ERROR',
        'The external wallet returned a signature that could not be verified.',
      );
    }

    return {
      signature: response.signature,
      walletType: externalSession.walletType,
    };
  },

  async signTransactions(
    options: SignTransactionsOptions,
  ): Promise<SignTransactionsResult> {
    if (Capacitor.getPlatform() !== 'android') {
      return requireNativeMethod('signTransactions')(options);
    }

    const transactions = options.transactions;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw walletError(
        'MISSING_PARAMETER',
        "Missing required parameter 'transactions'.",
      );
    }

    const session = await requireCurrentAndroidSession();
    if (session.walletType === 'android') {
      const wallet = await requireAndroidWallet();
      const signerSecretKey = decodeBase58(wallet.secretKey);

      return {
        transactions: transactions.map((transaction) =>
          signSerializedTransaction(
            transaction,
            wallet.publicKey,
            signerSecretKey,
          ),
        ),
        walletType: 'android',
      };
    }

    const externalSession = requireExternalSession(session);
    const nonce = nacl.randomBytes(24);
    const payload = textEncoder.encode(
      JSON.stringify({
        transactions,
        session: externalSession.session,
      }),
    );
    const encryptedPayload = nacl.box(
      payload,
      nonce,
      decodeBase58(externalSession.walletEncryptionPublicKey),
      decodeBase58(externalSession.dappEncryptionSecretKey),
    );
    const callback = await openWalletDeeplink(
      externalSession.walletType,
      buildExternalWalletUrl(
        externalWallets[externalSession.walletType].signAllTransactionsUrl,
        {
          dapp_encryption_public_key: externalSession.dappEncryptionPublicKey,
          nonce: encodeBase58(nonce),
          redirect_link: await buildRedirectUrl('/sign-transactions'),
          payload: encodeBase58(encryptedPayload),
        },
      ),
    );
    const query = parseWalletCallback(callback, '/sign-transactions');
    const errorMessage = query.get('errorMessage');
    if (errorMessage) {
      throw walletError('CALLBACK_ERROR', errorMessage);
    }

    const decryptedPayload = decryptPayload(
      query,
      externalSession.walletEncryptionPublicKey,
      externalSession.dappEncryptionSecretKey,
    );
    const response = parseJson<ExternalSignTransactionsResponse>(
      decryptedPayload,
      'MALFORMED_CALLBACK',
      'Failed to process the external wallet signAllTransactions callback.',
    );

    if (response.transactions.length !== transactions.length) {
      throw walletError(
        'CALLBACK_ERROR',
        'The external wallet returned an unexpected number of signed transactions.',
      );
    }

    return {
      transactions: response.transactions,
      walletType: externalSession.walletType,
    };
  },

  async getWalletMnemonics(): Promise<GetWalletMnemonicsResult> {
    assertNativeWalletPlatform();

    const wallet = await ensureNativeWallet();
    const seed = extractSeedFromWallet(wallet);

    return {
      mnemonics: await entropyToMnemonic(seed),
    };
  },

  async recoverWalletFromMnemonics(
    options: RecoverWalletFromMnemonicsOptions,
  ): Promise<boolean> {
    assertNativeWalletPlatform();

    try {
      const normalizedMnemonic = normalizeMnemonicInput(options.mnemonics);
      const seed = await mnemonicToEntropy(normalizedMnemonic);
      if (seed.length !== nacl.sign.seedLength) {
        return false;
      }

      const wallet = createWalletRecordFromSeed(seed);
      await saveNativeWallet(wallet);

      if (Capacitor.getPlatform() === 'android') {
        const backupStatus =
          await requireNativeMethod('hasWalletBeenBackedUp')();
        if (backupStatus.backedUp !== true) {
          const retriedBackup = await requireNativeMethod('retryBackUp')();
          if (retriedBackup.backedUp !== true) {
            return false;
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  },

  async hasWalletBeenBackedUp(): Promise<HasWalletBeenBackedUpResult> {
    if (Capacitor.getPlatform() !== 'android') {
      throw walletError(
        'UNAVAILABLE',
        'WalletExtension.hasWalletBeenBackedUp is only available on Android.',
      );
    }

    return requireNativeMethod('hasWalletBeenBackedUp')();
  },

  async retryBackUp(): Promise<boolean> {
    if (Capacitor.getPlatform() !== 'android') {
      throw walletError(
        'UNAVAILABLE',
        'WalletExtension.retryBackUp is only available on Android.',
      );
    }

    const result = await requireNativeMethod('retryBackUp')();
    return result.backedUp === true;
  },

  async logout(): Promise<void> {
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

function requireNativeMethod<
  T extends keyof WalletExtensionNativePlugin,
>(method: T): NonNullable<WalletExtensionNativePlugin[T]> {
  const nativeMethod = WalletExtensionNative[method];
  if (!nativeMethod) {
    throw walletError(
      'UNAVAILABLE',
      `WalletExtension.${String(method)} is not available on this platform.`,
    );
  }

  return nativeMethod.bind(WalletExtensionNative) as NonNullable<
    WalletExtensionNativePlugin[T]
  >;
}

async function getCurrentAndroidSession(): Promise<ConnectedWalletSession | null> {
  if (cachedSession !== undefined) {
    return cachedSession;
  }

  const result = await requireNativeMethod('getCachedSession')();
  if (!result.session) {
    cachedSession = null;
    return null;
  }

  cachedSession = parseJson<ConnectedWalletSession>(
    result.session,
    'CRYPTOGRAPHY_FAILURE',
    'Failed to read the cached wallet session.',
  );
  return cachedSession;
}

async function saveCurrentAndroidSession(
  session: ConnectedWalletSession,
): Promise<void> {
  await requireNativeMethod('saveCachedSession')({
    session: JSON.stringify(session),
  });
  cachedSession = session;
}

async function requireCurrentAndroidSession(): Promise<ConnectedWalletSession> {
  const session = await getCurrentAndroidSession();
  if (!session) {
    throw walletError(
      'MISSING_CONNECTED_WALLET',
      'No wallet is currently connected.',
    );
  }

  return session;
}

async function getCurrentNativeSession(): Promise<ConnectedWalletSession | null> {
  if (Capacitor.getPlatform() === 'android') {
    return getCurrentAndroidSession();
  }

  const result = await requireNativeMethod('getCachedSession')();
  if (!result.session) {
    return null;
  }

  return parseJson<ConnectedWalletSession>(
    result.session,
    'CRYPTOGRAPHY_FAILURE',
    'Failed to read the cached wallet session.',
  );
}

async function saveCurrentNativeSession(
  session: ConnectedWalletSession,
): Promise<void> {
  if (Capacitor.getPlatform() === 'android') {
    await saveCurrentAndroidSession(session);
    return;
  }

  await requireNativeMethod('saveCachedSession')({
    session: JSON.stringify(session),
  });
}

async function getStoredNativeWallet(): Promise<NativeWalletRecord | null> {
  if (cachedAndroidWallet !== undefined) {
    return cachedAndroidWallet;
  }

  const result = await requireNativeMethod('getWalletRecord')();
  if (!result.present) {
    if (Capacitor.getPlatform() === 'android') {
      cachedAndroidWallet = null;
    }
    return null;
  }

  if (!result.publicKey || !result.secretKey) {
    throw walletError(
      'CRYPTOGRAPHY_FAILURE',
      'The native wallet record is incomplete.',
    );
  }

  const wallet = {
    publicKey: result.publicKey,
    secretKey: result.secretKey,
  };

  if (Capacitor.getPlatform() === 'android') {
    cachedAndroidWallet = wallet;
  }

  return wallet;
}

async function ensureNativeWallet(): Promise<NativeWalletRecord> {
  if (Capacitor.getPlatform() === 'android') {
    return ensureAndroidWallet();
  }

  const existingWallet = await getStoredNativeWallet();
  if (existingWallet) {
    return existingWallet;
  }

  const nextWallet = createWalletRecordFromSeed(
    nacl.randomBytes(nacl.sign.seedLength),
  );

  await saveNativeWallet(nextWallet);
  return nextWallet;
}

async function saveNativeWallet(wallet: NativeWalletRecord): Promise<void> {
  await requireNativeMethod('saveWalletRecord')(wallet);

  if (Capacitor.getPlatform() === 'android') {
    cachedAndroidWallet = wallet;
  }

  await syncNativeSessionPublicKey(wallet.publicKey);
}

async function ensureAndroidWallet(): Promise<NativeWalletRecord> {
  const existingWallet = await getStoredNativeWallet();
  if (existingWallet) {
    return existingWallet;
  }

  const nextWallet = createWalletRecordFromSeed(
    nacl.randomBytes(nacl.sign.seedLength),
  );

  await saveNativeWallet(nextWallet);
  return nextWallet;
}

async function requireAndroidWallet(): Promise<NativeWalletRecord> {
  const wallet = await ensureAndroidWallet();
  if (!wallet.publicKey || !wallet.secretKey) {
    throw walletError(
      'CRYPTOGRAPHY_FAILURE',
      'Failed to load the Android wallet record.',
    );
  }

  return wallet;
}

async function syncNativeSessionPublicKey(publicKey: string): Promise<void> {
  const session = await getCurrentNativeSession();
  const nativeWalletType = getPlatformNativeWalletType();

  if (!session || session.walletType !== nativeWalletType) {
    return;
  }

  if (session.publicKey === publicKey) {
    return;
  }

  await saveCurrentNativeSession({
    ...session,
    publicKey,
  });
}

function extractSeedFromWallet(wallet: NativeWalletRecord): Uint8Array {
  const secretKey = decodeBase58(wallet.secretKey);
  if (secretKey.length !== nacl.sign.secretKeyLength) {
    throw walletError(
      'CRYPTOGRAPHY_FAILURE',
      'The native wallet secret key was malformed.',
    );
  }

  const seed = secretKey.slice(0, nacl.sign.seedLength);
  const rebuiltWallet = createWalletRecordFromSeed(seed);
  if (
    rebuiltWallet.publicKey !== wallet.publicKey ||
    rebuiltWallet.secretKey !== wallet.secretKey
  ) {
    throw walletError(
      'CRYPTOGRAPHY_FAILURE',
      'The stored wallet could not be represented as recovery mnemonics.',
    );
  }

  return seed;
}

function createWalletRecordFromSeed(seed: Uint8Array): NativeWalletRecord {
  const keyPair = nacl.sign.keyPair.fromSeed(seed);

  return {
    publicKey: encodeBase58(keyPair.publicKey),
    secretKey: encodeBase58(keyPair.secretKey),
  };
}

function normalizeMnemonicInput(mnemonics: string | string[]): string {
  if (Array.isArray(mnemonics)) {
    return mnemonics.join(' ');
  }

  return mnemonics;
}

function assertNativeWalletPlatform(): void {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios' || platform === 'android') {
    return;
  }

  throw walletError(
    'UNAVAILABLE',
    'WalletExtension native wallet recovery is only available on iOS and Android.',
  );
}

function getPlatformNativeWalletType(): NativeWalletType {
  return Capacitor.getPlatform() === 'android' ? 'android' : 'icloud';
}

async function assertExternalWalletInstalled(
  walletType: ExternalWalletType,
): Promise<void> {
  const installedWallets = await requireNativeMethod('getInstalledWallets')();
  if (!installedWallets.wallets.includes(walletType)) {
    throw walletError(
      'WALLET_NOT_INSTALLED',
      `The '${walletType}' wallet app is not installed or cannot be queried on Android.`,
    );
  }
}

async function getRedirectScheme(): Promise<string> {
  if (cachedRedirectScheme) {
    return cachedRedirectScheme;
  }

  const result = await requireNativeMethod('getRedirectScheme')();
  if (!result.scheme) {
    throw walletError(
      'INVALID_REDIRECT_SCHEME',
      'No Android redirect scheme was found for the current app.',
    );
  }

  cachedRedirectScheme = result.scheme;
  return cachedRedirectScheme;
}

async function buildRedirectUrl(path: string): Promise<string> {
  const scheme = await getRedirectScheme();
  return `${scheme}://${REDIRECT_HOST}${path}`;
}

async function buildBaseAppUrl(): Promise<string> {
  const scheme = await getRedirectScheme();
  return `${scheme}://${REDIRECT_HOST}/app`;
}

function buildExternalWalletUrl(
  baseUrl: string,
  query: Record<string, string>,
): string {
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

async function openWalletDeeplink(
  walletType: ExternalWalletType,
  url: string,
): Promise<string> {
  const result = await requireNativeMethod('openWalletDeeplink')({
    walletType,
    url,
  });
  return result.callbackUrl;
}

function parseWalletCallback(callbackUrl: string, expectedPath: string): URLSearchParams {
  const callback = new URL(callbackUrl);
  if (callback.host !== REDIRECT_HOST || callback.pathname !== expectedPath) {
    throw walletError(
      'MALFORMED_CALLBACK',
      'The wallet callback was received on an unexpected redirect URL.',
    );
  }

  return callback.searchParams;
}

function decryptPayload(
  query: URLSearchParams,
  walletEncryptionPublicKey: string,
  dappSecretKey: string,
): string {
  const nonce = query.get('nonce');
  const data = query.get('data');
  if (!nonce || !data) {
    throw walletError(
      'MALFORMED_CALLBACK',
      'Wallet callback is missing its encrypted payload.',
    );
  }

  const decrypted = nacl.box.open(
    decodeBase58(data),
    decodeBase58(nonce),
    decodeBase58(walletEncryptionPublicKey),
    decodeBase58(dappSecretKey),
  );
  if (!decrypted) {
    throw walletError(
      'MALFORMED_CALLBACK',
      'Failed to decrypt the external wallet callback payload.',
    );
  }

  return textDecoder.decode(decrypted);
}

function parseJson<T>(value: string, code: string, message: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw walletError(code, message);
  }
}

function canReuseWithoutReconnect(session: ConnectedWalletSession): boolean {
  if (session.walletType === 'icloud' || session.walletType === 'android') {
    return session.publicKey.length > 0;
  }

  return (
    session.publicKey.length > 0 &&
    Boolean(session.session) &&
    Boolean(session.dappEncryptionPublicKey) &&
    Boolean(session.dappEncryptionSecretKey) &&
    Boolean(session.walletEncryptionPublicKey)
  );
}

function requireExternalSession(
  session: ConnectedWalletSession,
): ConnectedWalletSession & {
  walletType: ExternalWalletType;
  session: string;
  dappEncryptionPublicKey: string;
  dappEncryptionSecretKey: string;
  walletEncryptionPublicKey: string;
} {
  if (
    !isExternalWalletType(session.walletType) ||
    !session.session ||
    !session.dappEncryptionPublicKey ||
    !session.dappEncryptionSecretKey ||
    !session.walletEncryptionPublicKey
  ) {
    throw walletError(
      'MISSING_CONNECTED_WALLET',
      'No wallet is currently connected.',
    );
  }

  return session as ConnectedWalletSession & {
    walletType: ExternalWalletType;
    session: string;
    dappEncryptionPublicKey: string;
    dappEncryptionSecretKey: string;
    walletEncryptionPublicKey: string;
  };
}

function isExternalWalletType(value: string): value is ExternalWalletType {
  return value === 'phantom' || value === 'solflare' || value === 'backpack';
}

function walletError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.name = 'WalletExtensionError';
  error.code = code;
  return error;
}
