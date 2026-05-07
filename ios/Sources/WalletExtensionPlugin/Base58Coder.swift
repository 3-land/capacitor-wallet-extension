import Foundation

enum Base58Coder {
    private static let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
    private static let alphabetIndex: [Character: Int] = {
        var result: [Character: Int] = [:]

        for (index, character) in alphabet.enumerated() {
            result[character] = index
        }

        return result
    }()

    static func encode(_ data: Data) throws -> String {
        let bytes = [UInt8](data)

        guard !bytes.isEmpty else {
            return ""
        }

        var digits = [Int](repeating: 0, count: bytes.count * 2)
        var digitLength = 1

        for byte in bytes {
            var carry = Int(byte)

            for index in 0..<digitLength {
                carry += digits[index] << 8
                digits[index] = carry % 58
                carry /= 58
            }

            while carry > 0 {
                digits[digitLength] = carry % 58
                digitLength += 1
                carry /= 58
            }
        }

        var encoded = String(repeating: "1", count: bytes.prefix { $0 == 0 }.count)

        for index in stride(from: digitLength - 1, through: 0, by: -1) {
            encoded.append(alphabet[digits[index]])
        }

        return encoded
    }

    static func decode(_ value: String) throws -> Data {
        guard !value.isEmpty else {
            return Data()
        }

        var bytes = [UInt8](repeating: 0, count: value.count)
        var byteLength = 1

        for character in value {
            guard let alphabetValue = alphabetIndex[character] else {
                throw WalletExtensionError.invalidBase58("Invalid base58 string.")
            }

            var carry = alphabetValue

            for index in 0..<byteLength {
                carry += Int(bytes[index]) * 58
                bytes[index] = UInt8(carry & 0xff)
                carry >>= 8
            }

            while carry > 0 {
                bytes[byteLength] = UInt8(carry & 0xff)
                byteLength += 1
                carry >>= 8
            }
        }

        let leadingZeroCount = value.prefix { $0 == "1" }.count
        var decoded = [UInt8](repeating: 0, count: leadingZeroCount)

        for index in stride(from: byteLength - 1, through: 0, by: -1) {
            decoded.append(bytes[index])
        }

        let data = Data(decoded)

        if try encode(data) != value {
            throw WalletExtensionError.invalidBase58("Invalid base58 string.")
        }

        return data
    }
}
