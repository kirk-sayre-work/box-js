// Something in vm2 munges the type of data sent to
// TextDecoder::decode(), so implement it here so we can modify types.

function getNativeClass(obj) {
    if (typeof obj === "undefined") return "undefined";
    if (obj === null) return "null";
    return Object.prototype.toString.call(obj).match(/^\[object\s(.*)\]$/)[1];
}

function decode(input) {
    let bytes;

    if (input === undefined) {
        return "";
    }

    if (getNativeClass(input) === "Uint8Array") {
        bytes = input;
    }
    else if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
        bytes = new Uint8Array(
            input.buffer,
            input.byteOffset,
            input.byteLength
        );
    } else {
        throw new TypeError(
            "Input must be an ArrayBuffer or ArrayBufferView (not " + input.constructor.name + ")"
        );
    }

    let result = "";
    let i = 0;

    // TextDecoder("utf-8") ignores a leading UTF-8 BOM by default.
    if (
        bytes.length >= 3 &&
            bytes[0] === 0xef &&
            bytes[1] === 0xbb &&
            bytes[2] === 0xbf
    ) {
        i = 3;
    }

    while (i < bytes.length) {
        const b1 = bytes[i];

        /*
         * ASCII
         */
        if (b1 <= 0x7f) {
            result += String.fromCharCode(b1);
            i++;
            continue;
        }

        /*
         * 2-byte UTF-8:
         *
         * 110xxxxx 10xxxxxx
         *
         * Valid leading bytes are C2..DF.
         * C0 and C1 would create overlong encodings.
         */
        if (b1 >= 0xc2 && b1 <= 0xdf) {
            if (i + 1 >= bytes.length) {
                result += "\ufffd";
                i++;
                continue;
            }

            const b2 = bytes[i + 1];

            if ((b2 & 0xc0) !== 0x80) {
                result += "\ufffd";
                i++;
                continue;
            }

            const codePoint =
                  ((b1 & 0x1f) << 6) |
                  (b2 & 0x3f);

            result += String.fromCharCode(codePoint);
            i += 2;
            continue;
        }

        /*
         * 3-byte UTF-8:
         *
         * 1110xxxx 10xxxxxx 10xxxxxx
         */
        if (b1 >= 0xe0 && b1 <= 0xef) {
            if (i + 1 >= bytes.length) {
                result += "\ufffd";
                i++;
                continue;
            }

            const b2 = bytes[i + 1];

            /*
             * Validate the second byte specially:
             *
             * E0 A0..BF avoids overlong encoding.
             * ED 80..9F avoids UTF-16 surrogate code points.
             */
            let validB2;

            if (b1 === 0xe0) {
                validB2 = b2 >= 0xa0 && b2 <= 0xbf;
            } else if (b1 === 0xed) {
                validB2 = b2 >= 0x80 && b2 <= 0x9f;
            } else {
                validB2 = (b2 & 0xc0) === 0x80;
            }

            if (!validB2) {
                result += "\ufffd";
                i++;
                continue;
            }

            if (i + 2 >= bytes.length) {
                result += "\ufffd";
                i += 2;
                continue;
            }

            const b3 = bytes[i + 2];

            if ((b3 & 0xc0) !== 0x80) {
                result += "\ufffd";
                i += 2;
                continue;
            }

            const codePoint =
                  ((b1 & 0x0f) << 12) |
                  ((b2 & 0x3f) << 6) |
                  (b3 & 0x3f);

            result += String.fromCharCode(codePoint);
            i += 3;
            continue;
        }

        /*
         * 4-byte UTF-8:
         *
         * 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
         *
         * Valid Unicode range ends at U+10FFFF, so the first
         * byte can only be F0..F4.
         */
        if (b1 >= 0xf0 && b1 <= 0xf4) {
            if (i + 1 >= bytes.length) {
                result += "\ufffd";
                i++;
                continue;
            }

            const b2 = bytes[i + 1];

            let validB2;

            /*
             * F0 90..BF avoids overlong encodings.
             * F4 80..8F limits the result to U+10FFFF.
             */
            if (b1 === 0xf0) {
                validB2 = b2 >= 0x90 && b2 <= 0xbf;
            } else if (b1 === 0xf4) {
                validB2 = b2 >= 0x80 && b2 <= 0x8f;
            } else {
                validB2 = (b2 & 0xc0) === 0x80;
            }

            if (!validB2) {
                result += "\ufffd";
                i++;
                continue;
            }

            if (i + 2 >= bytes.length) {
                result += "\ufffd";
                i += 2;
                continue;
            }

            const b3 = bytes[i + 2];

            if ((b3 & 0xc0) !== 0x80) {
                result += "\ufffd";
                i += 2;
                continue;
            }

            if (i + 3 >= bytes.length) {
                result += "\ufffd";
                i += 3;
                continue;
            }

            const b4 = bytes[i + 3];

            if ((b4 & 0xc0) !== 0x80) {
                result += "\ufffd";
                i += 3;
                continue;
            }

            let codePoint =
                ((b1 & 0x07) << 18) |
                ((b2 & 0x3f) << 12) |
                ((b3 & 0x3f) << 6) |
                (b4 & 0x3f);

            /*
             * Convert Unicode code point above U+FFFF to a UTF-16
             * surrogate pair.
             */
            codePoint -= 0x10000;

            const high =
                  0xd800 + (codePoint >> 10);

            const low =
                  0xdc00 + (codePoint & 0x3ff);

            result += String.fromCharCode(high, low);
            i += 4;
            continue;
        }

        /*
         * Invalid UTF-8 leading byte:
         *
         * 80..BF  stray continuation byte
         * C0..C1  overlong lead bytes
         * F5..FF  outside valid Unicode range
         */
        result += "\ufffd";
        i++;
    }

    return result;
};

module.exports = {
    decode,
}
