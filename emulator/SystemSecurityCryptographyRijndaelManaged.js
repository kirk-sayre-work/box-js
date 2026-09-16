const crypto = require("crypto");
const lib = require("../lib");

function toBuffer(value, fieldName) {
	if (Buffer.isBuffer(value)) return Buffer.from(value);
	if (typeof value === "string") return Buffer.from(value, "binary");
	if (Array.isArray(value)) return Buffer.from(value);
	if (value && typeof value === "object") {
		if (ArrayBuffer.isView(value)) {
			return Buffer.from(value);
		}
		if (typeof value.length === "number") {
			return Buffer.from(Array.from(value));
		}
	}
	if (value === undefined || value === null) return Buffer.alloc(0);
	lib.kill(`RijndaelManaged received unsupported ${fieldName || "value"}.`);
}

function stripZeroPadding(buffer) {
	let end = buffer.length;
	while (end > 0 && buffer[end - 1] === 0x00) {
		end--;
	}
	return buffer.slice(0, end);
}

function resolveAlgorithm(keySize, blockSize, mode) {
	if (blockSize !== 128) {
		lib.kill(`RijndaelManaged with unsupported BlockSize ${blockSize}.`);
	}
	if (mode !== 1) {
		lib.kill(`RijndaelManaged with unsupported CipherMode ${mode}.`);
	}
	switch (keySize) {
	case 128:
	case 192:
	case 256:
		return `aes-${keySize}-cbc`;
	default:
		lib.kill(`RijndaelManaged with unsupported KeySize ${keySize}.`);
	}
}

function buildTransform(algorithm, key, iv, isEncrypt, paddingMode) {
	return new Proxy({
		transformfinalblock(data, start = 0, count) {
			const input = toBuffer(data, "TransformFinalBlock input");
			const sliceEnd = typeof count === "number" ? start + count : undefined;
			const chunk = input.slice(start, sliceEnd);
			const cipher = isEncrypt ? crypto.createCipheriv(algorithm, key, iv) : crypto.createDecipheriv(algorithm, key, iv);
			if (paddingMode === 3) cipher.setAutoPadding(false);
			const transformed = Buffer.concat([cipher.update(chunk), cipher.final()]);
			let result = transformed;
			if (!isEncrypt && paddingMode === 3) {
				result = stripZeroPadding(transformed);
			}
			const message = isEncrypt ? "The script encrypted data." : "The script decrypted data.";
			lib.logIOC("System.Security.Cryptography.RijndaelManaged", {
				op: isEncrypt ? "encrypt" : "decrypt",
				length: result.length,
			}, message);
			return Array.from(result);
		},
	}, {
		get(target, prop) {
			const name = prop.toLowerCase();
			if (name in target) return target[name];
			lib.kill(`RijndaelManaged transform ${prop} not implemented.`);
		},
		set(target, prop, value) {
			target[prop.toLowerCase()] = value;
			return true;
		},
	});
}

function RijndaelManaged() {
	this.mode = 1;
	this.padding = 1;
	this.blocksize = 128;
	this.keysize = 256;

	let keyBuffer = Buffer.alloc(0);
	let ivBuffer = Buffer.alloc(0);

	Object.defineProperty(this, "key", {
		enumerable: true,
		get: () => keyBuffer,
		set: (value) => {
			const expectedLength = Math.floor((this.keysize || 256) / 8);
			const raw = toBuffer(value, "Key");
			if (raw.length === expectedLength) {
				keyBuffer = raw;
				return;
			}
			keyBuffer = Buffer.alloc(expectedLength);
			raw.copy(keyBuffer, 0, 0, Math.min(raw.length, expectedLength));
		},
	});

	Object.defineProperty(this, "iv", {
		enumerable: true,
		get: () => ivBuffer,
		set: (value) => {
			const expectedLength = Math.floor((this.blocksize || 128) / 8);
			const raw = toBuffer(value, "IV");
			if (raw.length === expectedLength) {
				ivBuffer = raw;
				return;
			}
			ivBuffer = Buffer.alloc(expectedLength);
			raw.copy(ivBuffer, 0, 0, Math.min(raw.length, expectedLength));
		},
	});

	this.createdecryptor = () => {
		const algorithm = resolveAlgorithm(this.keysize, this.blocksize, this.mode);
		if (keyBuffer.length === 0) lib.kill("RijndaelManaged decryptor requires a key.");
		if (ivBuffer.length === 0) lib.kill("RijndaelManaged decryptor requires an IV.");
		return buildTransform(algorithm, keyBuffer, ivBuffer, false, this.padding);
	};

	this.createencryptor = () => {
		const algorithm = resolveAlgorithm(this.keysize, this.blocksize, this.mode);
		if (keyBuffer.length === 0) lib.kill("RijndaelManaged encryptor requires a key.");
		if (ivBuffer.length === 0) lib.kill("RijndaelManaged encryptor requires an IV.");
		return buildTransform(algorithm, keyBuffer, ivBuffer, true, this.padding);
	};
}

module.exports = () => lib.proxify(RijndaelManaged, "System.Security.Cryptography.RijndaelManaged");
