/* eslint-env mocha */

// The sample must never reach the worker's own process: not `process`, not the host
// `require`, not a module that can (fs, child_process, vm, ...), not a host eval, not the
// conditional-compilation (@cc_on/@if) rewrite, which used to pipe the sample through m4
// and cpp. These run box-js end to end on probes
// under test/fixtures/ (escape-helpers.js prefixed to each) that try known vm2 /
// host-reference escapes and, on success, log http://escaped.example/<name> and drop a
// marker file next to the results dir through the host's real fs.

const assert = require("assert");
const {execFileSync} = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const boxDir = path.join(__dirname, "..");
const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const helpers = fixture("escape-helpers.js");


function runProbe(probe, extraArgs) {
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "boxjs-escape-"));
	const mark = path.join(work, "MARK");
	const sample = path.join(work, "sample.js");
	fs.writeFileSync(sample, (helpers + "\n" + fixture(probe)).split("__MARK__").join(mark));
	// A real host file the sample must never read back (via a preprocessor include, lib,
	// the emulated FSO/ADODB or the <a download> handler). Run, it reports itself.
	fs.writeFileSync(`${mark}.leak.js`, "\nhit(\"host-file-" + "read\");\n");
	try {
		execFileSync(process.execPath, [path.join(boxDir, "run.js"), sample, `--output-dir=${work}`,
			// Generous: the reflection walks are slow on a loaded machine, and a probe cut off
			// by the timeout fails "runs every escape attempt to the end" instead of passing.
			"--no-kill", "--timeout=90", ...extraArgs], {cwd: work, stdio: "ignore", timeout: 180000});
	} catch (e) {
		// box-js exits non-zero for some samples; the outputs are what is checked.
	}
	const results = path.join(work, "sample.js.results");
	let urls = [];
	try {
		urls = JSON.parse(fs.readFileSync(path.join(results, "urls.json"), "utf8"));
	} catch (e) {}
	const marks = fs.readdirSync(work).filter((n) => n.startsWith("MARK") && n !== "MARK.leak.js");
	let leaked = [];
	try {
		leaked = fs.readdirSync(results).filter((n) =>
			fs.readFileSync(path.join(results, n), "latin1").includes("host-file-" + "read"));
	} catch (e) {}
	let overwritten = [];
	try {
		// A file under one of box-js's own content-addressed names that the sample wrote, or
		// a results-index entry the sample made under such a name.
		const hostNamed = (n) => /^[0-9a-f]{64}(\.bin|_)/i.test(n);
		overwritten = fs.readdirSync(results).filter((n) => hostNamed(n) &&
			/overwritten-by-sample|claimed-by-sample/.test(fs.readFileSync(path.join(results, n), "latin1")));
		for (const index of ["resources.json", "snippets.json"]) {
			const p = path.join(results, index);
			if (!fs.existsSync(p)) continue;
			const entries = JSON.parse(fs.readFileSync(p, "utf8"));
			for (const k of Object.keys(entries)) {
				if (hostNamed(k) && /claimed|overwritten/.test(JSON.stringify(entries[k]))) overwritten.push(index + ":" + k);
			}
		}
	} catch (e) {}
	return {work, urls, marks, leaked, overwritten};
}

const MODES = [
	["bare sandbox", [], ["setInterval-global", "setInterval", "setTimeout-global", "listener"]],
	// boilerplate.js shadows the bare setInterval and document; the global ones still reach
	// analyze.js's handlers.
	["default boilerplate (the engine's mode)", ["--prepended-code=default", "--rewrite-loops",
		"--activex-as-ioc", "--no-shell-error", "--ignore-wscript-quit"], ["setInterval-global", "setTimeout-global"]],
	// The <a download> handler only saves with --fake-download, and is analyze.js's own
	// document (boilerplate.js replaces document), so this mode is bare.
	["bare sandbox, --fake-download", ["--fake-download"],
		["setInterval-global", "setInterval", "setTimeout-global", "listener"]],
];
const CC_ON = ["m4-syscmd", "m4-prefixed-syscmd", "m4-esyscmd", "m4-include", "cpp-include",
	"cpp-include-indented", "cpp-include-digraph", "cpp-include-splice", "cpp-include-splice-crlf",
	"cpp-include-splice-space", "cpp-include-trigraph", "cpp-include-nul-digraph",
	"cpp-include-nul-trigraph", "cpp-include-nul-splice", "m4-nul-syscmd", "cpp-has-include",
	"cpp-has-include-ucn", "cpp-pragma-ucn"];

for (const [label, args, handlers] of MODES) {
	for (const probe of ["escape-payloads.js", "escape-strings.js", "escape-capabilities.js"]) {
		describe(`sandbox isolation: ${probe}, ${label}`, function() {
			this.timeout(240000);
			let run;
			before(function() {
				run = runProbe(probe, args);
			});
			after(function() {
				if (run) fs.rmSync(run.work, {recursive: true, force: true});
			});
			it("runs every escape attempt to the end", function() {
				const want = ["done"];
				if (probe === "escape-strings.js") {
					want.push(...handlers.map((h) => "ran-" + h));
					want.push(...CC_ON.map((c) => "cc-" + c), "cc-hash-condition", "cc-float-condition",
						"cc-set");
				}
				if (probe === "escape-capabilities.js") {
					want.push("events-work", "events-statics", "zlib-works", "zlib-callback-works", "after-splice", "after-json",
						"events-once-clean", "events-iterator");
				}
				for (const w of want) {
					assert(run.urls.includes("http://attempted.example/" + w),
						`probe step ${w} did not run; urls: ` + JSON.stringify(run.urls));
				}
			});
			it("reaches no host process, require or capability module", function() {
				const escaped = run.urls.filter((u) => String(u).startsWith("http://escaped.example/"));
				assert.deepStrictEqual(escaped, []);
			});
			it("writes nothing through the host's real fs or child_process", function() {
				assert.deepStrictEqual(run.marks, []);
			});
			it("reads no host file into the results", function() {
				assert.deepStrictEqual(run.leaked, []);
			});
			it("cannot write under one of box-js's own result names", function() {
				assert.deepStrictEqual(run.overwritten, []);
			});
		});
	}
}
