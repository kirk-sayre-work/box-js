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
	lib.kill("UTF8Encoding received unsupported value.");
}

function UTF8Encoding() {
	this.getbytes = function(str) {
		const buffer = Buffer.from(str, "utf8");
		return Array.from(buffer);
	};

	this.getbytes_2 = this.getbytes;
	this.getbytes_3 = this.getbytes;
	this.getbytes_4 = this.getbytes;

	this.getstring = function(value) {
		const buffer = toBuffer(value);
		return buffer.toString("utf8");
	};

	this.getstring_2 = this.getstring;
}

module.exports = () => lib.proxify(UTF8Encoding, "System.Text.UTF8Encoding");
