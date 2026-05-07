const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_INDEX = new Map([...ALPHABET].map((character, index) => [character, index]));
export function encodeBase58(data) {
    if (data.length === 0) {
        return '';
    }
    const digits = new Array(data.length * 2).fill(0);
    let digitLength = 1;
    for (const byte of data) {
        let carry = byte;
        for (let index = 0; index < digitLength; index += 1) {
            carry += digits[index] << 8;
            digits[index] = carry % 58;
            carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
            digits[digitLength] = carry % 58;
            digitLength += 1;
            carry = Math.floor(carry / 58);
        }
    }
    let encoded = '1'.repeat(countLeadingZeros(data));
    for (let index = digitLength - 1; index >= 0; index -= 1) {
        encoded += ALPHABET[digits[index]];
    }
    return encoded;
}
export function decodeBase58(value) {
    if (value.length === 0) {
        return new Uint8Array();
    }
    const bytes = new Uint8Array(value.length);
    let byteLength = 1;
    for (const character of value) {
        const alphabetValue = ALPHABET_INDEX.get(character);
        if (alphabetValue === undefined) {
            throw new Error('Invalid base58 string.');
        }
        let carry = alphabetValue;
        for (let index = 0; index < byteLength; index += 1) {
            carry += bytes[index] * 58;
            bytes[index] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes[byteLength] = carry & 0xff;
            byteLength += 1;
            carry >>= 8;
        }
    }
    const leadingZeroCount = [...value].findIndex((character) => character !== '1');
    const zeroPrefixLength = leadingZeroCount === -1 ? value.length : leadingZeroCount;
    const decoded = new Uint8Array(zeroPrefixLength + byteLength);
    for (let index = byteLength - 1; index >= 0; index -= 1) {
        decoded[zeroPrefixLength + (byteLength - 1 - index)] = bytes[index];
    }
    if (encodeBase58(decoded) !== value) {
        throw new Error('Invalid base58 string.');
    }
    return decoded;
}
function countLeadingZeros(data) {
    let count = 0;
    for (const byte of data) {
        if (byte !== 0) {
            break;
        }
        count += 1;
    }
    return count;
}
