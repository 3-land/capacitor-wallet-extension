export type WalletType = 'icloud' | 'android' | 'phantom' | 'solflare' | 'backpack';
export interface GetAvailableWalletsResult {
    wallets: WalletType[];
}
export interface ConnectUsingOptions {
    walletType: WalletType;
}
export interface ConnectUsingResult {
    publicKey: string;
    walletType: WalletType;
    cached: boolean;
}
export interface ConfigureExternalWalletUrlsOptions {
    appUrl: string;
    redirectBaseUrl: string;
}
export interface SignMessageOptions {
    message: string;
}
export interface SignMessageResult {
    signature: string;
    walletType: WalletType;
}
export interface SignTransactionsOptions {
    transactions: string[];
}
export interface SignTransactionsResult {
    transactions: string[];
    walletType: WalletType;
}
export interface GetWalletMnemonicsResult {
    mnemonics: string[];
}
export interface RecoverWalletFromMnemonicsOptions {
    mnemonics: string | string[];
}
export interface HasWalletBeenBackedUpResult {
    backedUp: boolean;
}
export interface WalletExtensionPlugin {
    configureExternalWalletUrls(options: ConfigureExternalWalletUrlsOptions): Promise<void>;
    getAvailableWallets(): Promise<GetAvailableWalletsResult>;
    connectUsing(options: ConnectUsingOptions): Promise<ConnectUsingResult>;
    signMessage(options: SignMessageOptions): Promise<SignMessageResult>;
    signTransactions(options: SignTransactionsOptions): Promise<SignTransactionsResult>;
    getWalletMnemonics(): Promise<GetWalletMnemonicsResult>;
    recoverWalletFromMnemonics(options: RecoverWalletFromMnemonicsOptions): Promise<boolean>;
    hasWalletBeenBackedUp(): Promise<HasWalletBeenBackedUpResult>;
    retryBackUp(): Promise<boolean>;
    logout(): Promise<void>;
}
//# sourceMappingURL=definitions.d.ts.map