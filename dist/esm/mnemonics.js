import { englishWordlist } from './bip39English';
const wordIndex = new Map(englishWordlist.map((word, index) => [word, index]));
const supportedEntropyLengths = new Set([16, 20, 24, 28, 32]);
const supportedWordCounts = new Set([12, 15, 18, 21, 24]);
export async function entropyToMnemonic(entropy) {
    if (!supportedEntropyLengths.has(entropy.length)) {
        throw new Error('Unsupported entropy length for mnemonic export.');
    }
    const entropyBits = bytesToBinary(entropy);
    const checksumLength = entropy.length / 4;
    const checksumBits = (await checksumBinary(entropy)).slice(0, checksumLength);
    const bits = `${entropyBits}${checksumBits}`;
    const words = [];
    for (let offset = 0; offset < bits.length; offset += 11) {
        const chunk = bits.slice(offset, offset + 11);
        const index = Number.parseInt(chunk, 2);
        const word = englishWordlist[index];
        if (!word) {
            throw new Error('Failed to encode the mnemonic word index.');
        }
        words.push(word);
    }
    return words;
}
export async function mnemonicToEntropy(mnemonic) {
    const words = normalizeMnemonic(mnemonic);
    if (!supportedWordCounts.has(words.length)) {
        throw new Error('Unsupported mnemonic word count.');
    }
    const bits = words
        .map((word) => {
        const index = wordIndex.get(word);
        if (index === undefined) {
            throw new Error('Mnemonic contains an unknown word.');
        }
        return index.toString(2).padStart(11, '0');
    })
        .join('');
    const entropyBitLength = Math.floor((bits.length * 32) / 33);
    const checksumBitLength = bits.length - entropyBitLength;
    const entropy = binaryToBytes(bits.slice(0, entropyBitLength));
    const expectedChecksum = (await checksumBinary(entropy)).slice(0, checksumBitLength);
    const actualChecksum = bits.slice(entropyBitLength);
    if (actualChecksum !== expectedChecksum) {
        throw new Error('Mnemonic checksum did not match.');
    }
    return entropy;
}
function normalizeMnemonic(mnemonic) {
    return mnemonic
        .normalize('NFKD')
        .trim()
        .toLowerCase()
        .split(/\s+/u)
        .filter(Boolean);
}
async function checksumBinary(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Web Crypto is unavailable for mnemonic checksums.');
    }
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const digest = await subtle.digest('SHA-256', buffer);
    return bytesToBinary(new Uint8Array(digest));
}
function bytesToBinary(bytes) {
    return Array.from(bytes, (byte) => byte.toString(2).padStart(8, '0')).join('');
}
function binaryToBytes(bits) {
    if (bits.length % 8 !== 0) {
        throw new Error('Binary data must be aligned to full bytes.');
    }
    const bytes = new Uint8Array(bits.length / 8);
    for (let index = 0; index < bytes.length; index += 1) {
        const start = index * 8;
        bytes[index] = Number.parseInt(bits.slice(start, start + 8), 2);
    }
    return bytes;
}
