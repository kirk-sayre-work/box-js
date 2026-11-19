/* eslint-env mocha */

// require_override.js (loaded with --prepended-code=default) stubs node modules; ids it
// does not stub now fail inside the sandbox instead of reaching the host's real modules.

const assert = require("assert");
const {execFileSync} = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const boxDir = path.join(__dirname, "..");

describe("require_override stubs", function() {
	this.timeout(90000);
	let urls, iocs, work;
	before(function() {
		work = fs.mkdtempSync(path.join(os.tmpdir(), "boxjs-override-"));
		const sample = path.join(work, "sample.js");
		fs.writeFileSync(sample, [
			"try { require(\"https\").request({hostname: \"tls.example\", port: 443, path: \"/a\"}); } catch (e) {}",
			"try { require(\"node:https\").request({hostname: \"tls2.example\", port: 8443, path: \"/b\"}); } catch (e) {}",
			"try { require(\"https\").request(new (require(\"url\").URL)(\"https://c2.example/payload?a=1\")); } catch (e) {}",
			"try { require(\"https\").request({hostname: \"tls3.example\", port: \"\", pathname: \"/c\", search: \"?q\"}); } catch (e) {}",
			"try { require(\"node:child_process\").execSync(\"whoami /all\"); } catch (e) {}",
			// No try/catch: a beacon must not end the analysis.
			"var req = require(\"https\").request({hostname: \"beacon.example\", path: \"/c\", method: \"POST\"}, function () {});",
			"req.on(\"error\", function () {}); req.write(\"x\"); req.end();",
			"require(\"child_process\").execSync(\"after beacon\");",
			// A promise-wrapped request settles through the emulated "error".
			"new Promise(function (res, rej) { var r = require(\"https\").request({host: \"hostopt.example:8443\", path: \"/p\"}); r.on(\"error\", rej); r.end(); })",
			"  .catch(function () { require(\"child_process\").execSync(\"after rejection\"); });",
			"(async function () { var r = require(\"https\").request(\"https://[::1]:8443/late\"); r.end(); await null; await null;",
			"  await new Promise(function (res, rej) { r.on(\"error\", rej); }).catch(function () { require(\"child_process\").execSync(\"late listener\"); }); })();",
			"const lib = {tag: 1};", // a sample's own top-level name must not break the emulation
			"new Promise(function (res) { var r = require(\"https\").request(\"https://close.example/\"); r.on(\"error\", function () {}); r.on(\"close\", res); r.end(\"x\"); })",
			"  .then(function () { require(\"child_process\").execSync(\"after close\"); });",
			"require(\"https\").request(\"https://cb.example/\").write(\"d\", function (err) { if (err) require(\"child_process\").execSync(\"write callback\"); });",
			"var parsed = require(\"url\").parse(\"https://template.example/api\"); parsed.hostname = \"dga.example\"; parsed.host = \"dga.example\";",
			"require(\"https\").get(parsed).on(\"error\", function () {});",
			"require(\"dns\").resolveTxt(\"cmd.c2.example\", function (err) { if (err) require(\"child_process\").execSync(\"dns fallback\"); });",
			"require(\"node:timers/promises\").setTimeout(10).then(function () { require(\"child_process\").execSync(\"after sleep\"); });",
			"require(\"dns\").lookup(\"45.133.1.20\", function (err, a) { if (!err) require(\"child_process\").execSync(\"resolved \" + a); });",
			"var w = require(\"timers\").setTimeout(function () {}, 15000); w.unref(); require(\"child_process\").execSync(\"after unref\");",
			"(async function () { var n = 0; for await (const _ of require(\"timers/promises\").setInterval(1000)) { if (++n >= 2) break; } require(\"child_process\").execSync(\"interval done\"); })();",
			"var ticks = 0; var iv = require(\"timers\").setInterval(function () { if (++ticks > 3) require(\"child_process\").execSync(\"ran after clear\"); if (ticks === 3) { clearInterval(this); require(\"child_process\").execSync(\"third tick\"); } }, 1000);",
			"require(\"timers\").setTimeout(function () { require(\"child_process\").execSync(\"deadline after \" + ticks); }, 10000);",
			// A timer due before a pending sleep runs first.
			"var key = null; require(\"timers\").setTimeout(function () { key = \"k1\"; }, 1000);",
			"(async function () { await require(\"timers/promises\").setTimeout(5000); require(\"child_process\").execSync(\"key \" + key); })();",
			// A never-cleared interval stops at its tick cap; virtual time reaches a 10-minute timer.
			"var beats = 0, t0 = Date.now(); require(\"timers\").setInterval(function () { beats++; }, 1000);",
			"require(\"timers\").setTimeout(function () { require(\"child_process\").execSync(\"beats \" + beats + \" waited \" + (Date.now() - t0 >= 600000)); }, 600000);",
			"var agent = new (require(\"https\").Agent)({rejectUnauthorized: false});",
			"var g = require(\"https\").get(new URL(\"https://get.example/g?x=1\"), function () {}); g.on(\"error\", function () {}); g.setTimeout(5000, function () { g.destroy(); });",
			"require(\"https\").request(\"https://decoy.example/\", {hostname: \"real.example\", path: \"/c2\", agent: agent}, function () {}).end();",
			"",
		].join("\n"));
		try {
			execFileSync(process.execPath, [path.join(boxDir, "run.js"), sample, `--output-dir=${work}`,
				"--no-kill", "--timeout=20", "--prepended-code=default", "--no-shell-error"],
			{cwd: work, stdio: "ignore", timeout: 60000});
		} catch (e) {}
		const results = path.join(work, "sample.js.results");
		urls = JSON.parse(fs.readFileSync(path.join(results, "urls.json"), "utf8"));
		iocs = JSON.parse(fs.readFileSync(path.join(results, "IOC.json"), "utf8"));
	});
	after(function() {
		fs.rmSync(work, {recursive: true, force: true});
	});
	it("logs https requests with the URL node would contact", function() {
		assert.deepStrictEqual(urls, ["https://tls.example/a", "https://tls2.example:8443/b",
			"https://c2.example/payload?a=1", "https://tls3.example/c?q", "https://beacon.example/c",
			"https://hostopt.example:8443/p", "https://[::1]:8443/late", "https://close.example/",
			"https://cb.example/", "https://dga.example/api", "https://get.example/g?x=1", "https://real.example/c2"]);
	});
	it("keeps analysing after an https request", function() {
		assert(iocs.some((i) => i.value && i.value.command === "after beacon"), JSON.stringify(iocs.map((i) => i.type)));
	});
	it("rejects a promise-wrapped request through its error listener", function() {
		assert(iocs.some((i) => i.value && i.value.command === "after rejection"), JSON.stringify(iocs.map((i) => i.type)));
	});
	it("delivers the error to a listener attached later", function() {
		assert(iocs.some((i) => i.value && i.value.command === "late listener"), JSON.stringify(iocs.map((i) => i.type)));
	});
	it("emits close and calls write callbacks after the failure", function() {
		for (const c of ["after close", "write callback"]) {
			assert(iocs.some((i) => i.value && i.value.command === c), c);
		}
	});
	it("emulates dns failing and timers/promises sleeping", function() {
		for (const c of ["dns fallback", "after sleep", "resolved 45.133.1.20", "after unref", "interval done", "third tick", "deadline after 3", "key k1", "beats 20 waited true"]) {
			assert(iocs.some((i) => i.value && i.value.command === c), c);
		}
	});
	it("stops an interval cleared through this", function() {
		assert(!iocs.some((i) => i.value && i.value.command === "ran after clear"));
	});
	it("gives node:-prefixed ids the same stub", function() {
		assert(iocs.some((i) => i.value && i.value.command === "whoami /all"), JSON.stringify(iocs.map((i) => i.type)));
	});
});
