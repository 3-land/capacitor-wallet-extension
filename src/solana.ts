import nacl from 'tweetnacl';

import { decodeBase58, encodeBase58 } from './base58';

export function signSerializedTransaction(
  serializedTransaction: string,
  signerPublicKey: string,
  signerSecretKey: Uint8Array,
): string {
  const transactionBytes = [...decodeBase58(serializedTransaction)];
  const signerPublicKeyBytes = [...decodeBase58(signerPublicKey)];
  const signatureLength = 64;

  const { value: signatureCount, nextOffset: signaturesStart } = decodeCompactLength(
    transactionBytes,
    0,
  );
  const messageStart = signaturesStart + signatureCount * signatureLength;

  if (messageStart > transactionBytes.length) {
    throw new Error(
      'Serialized transaction is shorter than its signature header.',
    );
  }

  const messageBytes = transactionBytes.slice(messageStart);
  const signerIndex = findSignerIndex(
    messageBytes,
    signerPublicKeyBytes,
    signatureCount,
  );
  const signature = [...nacl.sign.detached(new Uint8Array(messageBytes), signerSecretKey)];

  if (signature.length !== signatureLength) {
    throw new Error('Detached signature length was not 64 bytes.');
  }

  const signatureOffset = signaturesStart + signerIndex * signatureLength;
  const signatureEnd = signatureOffset + signatureLength;

  if (signatureEnd > transactionBytes.length) {
    throw new Error(
      'Serialized transaction does not have space for the signer signature.',
    );
  }

  transactionBytes.splice(signatureOffset, signatureLength, ...signature);

  return encodeBase58(new Uint8Array(transactionBytes));
}

function decodeCompactLength(bytes: number[], offset: number): {
  value: number;
  nextOffset: number;
} {
  let result = 0;
  let shift = 0;
  let index = offset;

  while (true) {
    if (index >= bytes.length) {
      throw new Error(
        'Unexpected end of transaction while decoding compact length.',
      );
    }

    const byte = bytes[index]!;
    result |= (byte & 0x7f) << shift;
    index += 1;

    if ((byte & 0x80) === 0) {
      return {
        value: result,
        nextOffset: index,
      };
    }

    shift += 7;

    if (shift > 28) {
      throw new Error('Invalid compact length in serialized transaction.');
    }
  }
}

function findSignerIndex(
  messageBytes: number[],
  signerPublicKey: number[],
  signatureCount: number,
): number {
  if (messageBytes.length === 0) {
    throw new Error('Serialized transaction message is empty.');
  }

  const isVersioned = (messageBytes[0]! & 0x80) !== 0;
  const headerOffset = isVersioned ? 1 : 0;

  if (messageBytes.length < headerOffset + 3) {
    throw new Error('Serialized transaction header is incomplete.');
  }

  const numRequiredSignatures = messageBytes[headerOffset]!;
  const accountKeysLengthOffset = headerOffset + 3;
  const { value: accountKeysCount, nextOffset: accountKeysStart } =
    decodeCompactLength(messageBytes, accountKeysLengthOffset);

  if (numRequiredSignatures > accountKeysCount) {
    throw new Error(
      'Serialized transaction signer count exceeds account key count.',
    );
  }

  if (numRequiredSignatures > signatureCount) {
    throw new Error(
      'Serialized transaction signature array is smaller than the required signer count.',
    );
  }

  const requiredBytes = accountKeysStart + accountKeysCount * 32;
  if (requiredBytes > messageBytes.length) {
    throw new Error('Serialized transaction account key list is truncated.');
  }

  for (let signerIndex = 0; signerIndex < numRequiredSignatures; signerIndex += 1) {
    const start = accountKeysStart + signerIndex * 32;
    const end = start + 32;
    const accountKey = messageBytes.slice(start, end);

    if (bytesEqual(accountKey, signerPublicKey)) {
      return signerIndex;
    }
  }

  throw new Error(
    'The connected wallet is not a required signer on one of the provided transactions.',
  );
}

function bytesEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}
