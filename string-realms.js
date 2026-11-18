// String.prototype.valueOf of each sandbox realm, registered by analyze.js before the sample
// runs, read as "".valueOf (the realm intrinsic, not a String global the sample could plant
// on the shared sandbox before a fallback VM is made). Kept out of lib.js, whose exports the
// sandbox can reach. The sandbox is also given the host require (a known residual), so the
// registrar is a one-time capability: analyze.js claims it at load, before any sample code,
// and a later claim throws.
const valueOfs = [];
let claimed = false;

module.exports = {
	list() {
		return valueOfs.slice();
	},
	claimRegistrar() {
		if (claimed) throw new Error("string-realms registrar already claimed");
		claimed = true;
		return function register(fn) {
			if (typeof fn === "function" && !valueOfs.includes(fn)) valueOfs.push(fn);
		};
	},
};
