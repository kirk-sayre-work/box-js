const crypto = require("crypto");
const lib = require("../lib");

function toBuffer(value) {
	if (Buffer.isBuffer(value)) return Buffer.from(value);
	if (typeof value === "string") return Buffer.from(value, "binary");
	if (Array.isArray(value)) return Buffer.from(value);
	if (value && typeof value === "object") {
		if (ArrayBuffer.isView(value)) return Buffer.from(value);
		if (typeof value.length === "number") return Buffer.from(Array.from(value));
	}
	if (value === undefined || value === null) return Buffer.alloc(0);
	lib.kill("SHA256Managed received unsupported value.");
}

function SHA256Managed() {
	this.computehash = function(value) {
		const buffer = toBuffer(value);
		const digest = crypto.createHash("sha256").update(buffer).digest();
		const bytes = Array.from(digest);
		lib.logIOC("System.Security.Cryptography.SHA256Managed", {
			length: bytes.length,
		}, "The script hashed data with SHA256Managed.");
		return bytes;
	};

	this.computehash_2 = this.computehash;
}

module.exports = () => lib.proxify(SHA256Managed, "System.Security.Cryptography.SHA256Managed");
