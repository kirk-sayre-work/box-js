/* eslint-env mocha */

// --proxy used to be SILENTLY DISCARDED: then-request's options have no `proxy` field
// (see then-request/lib/Options.d.ts), so setting one did nothing while the README
// advertised it as working. On a malware analysis tool that is a deanonymisation risk
// of the worst kind — an analyst who believes their fetches are proxied gets them
// straight from their own address, and nothing in the output says otherwise.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const boxDir = path.join(__dirname, "..");

function loadHelper() {
	// Extract proxyAgentFor from lib.js and evaluate it in isolation, so these assert
	// the SELECTION LOGIC without a network or a live proxy.
	const src = fs.readFileSync(path.join(boxDir, "lib.js"), "utf8");
	const start = src.indexOf("function proxyAgentFor");
	assert.notStrictEqual(start, -1, "lib.js must define proxyAgentFor");
	const body = src.slice(start, src.indexOf("\n}", start) + 2);
	const { HttpProxyAgent } = require("http-proxy-agent");
	const { HttpsProxyAgent } = require("https-proxy-agent");
	return new Function(
		"HttpProxyAgent", "HttpsProxyAgent", `${body}\nreturn proxyAgentFor;`
	)(HttpProxyAgent, HttpsProxyAgent);
}

describe("--proxy", function() {
	const proxyAgentFor = loadHelper();

	it("is actually plumbed into the request", function() {
		// The regression this whole file exists for: the option must reach `agent`,
		// which then-request understands, and not `proxy`, which it silently drops.
		const lib = fs.readFileSync(path.join(boxDir, "lib.js"), "utf8");
		assert.ok(/options\.agent = proxyAgentFor\(/.test(lib),
			"--proxy must be routed through an agent");
		assert.ok(!/options\.proxy = /.test(lib),
			"then-request has no `proxy` option; setting it is a silent no-op");
	});

	it("tunnels an https target even through a plain http proxy", function() {
		// An https:// target is reached with CONNECT regardless of what the proxy
		// speaks, so the agent is chosen by the TARGET's scheme, not the proxy's.
		assert.strictEqual(
			proxyAgentFor("https://example.com/x", "http://p:3128").constructor.name,
			"HttpsProxyAgent");
	});

	it("uses a plain http agent for an http target", function() {
		assert.strictEqual(
			proxyAgentFor("http://example.com/x", "http://p:3128").constructor.name,
			"HttpProxyAgent");
	});

	it("throws on a malformed proxy rather than downloading direct", function() {
		// Throwing is the point: a proxy the analyst asked for and did not get must
		// fail the run, never quietly fetch from their own IP.
		assert.throws(() => proxyAgentFor("http://x", "not a url"), /not a valid URL/);
	});

	it("refuses a SOCKS proxy instead of ignoring the scheme", function() {
		assert.throws(() => proxyAgentFor("http://x", "socks5://p:1080"),
			/only supports http\(s\)/);
	});

	it("declares its agent packages as direct dependencies", function() {
		// They happened to be present transitively via jsdom. Relying on that would
		// make downloads silently unproxied again the day that changes.
		const pkg = JSON.parse(fs.readFileSync(path.join(boxDir, "package.json"), "utf8"));
		assert.ok(pkg.dependencies["http-proxy-agent"]);
		assert.ok(pkg.dependencies["https-proxy-agent"]);
	});
});

// ---------------------------------------------------------------- eval scope (vm2)

describe("eval() scope", function() {
	// This is documented as a TEST rather than a comment because the cause was
	// misdiagnosed once already: the `sandbox.eval` override was blamed, and removing
	// it changes nothing. The cause is vm2 itself.
	it("is a vm2 limitation, not a box-js one", function() {
		const { VM } = require("vm2");
		const src = 'function f(){var s="S3CR3T"; return eval("s");} f();';

		// node's own vm scopes a direct eval correctly...
		assert.strictEqual(require("vm").runInNewContext(src), "S3CR3T");

		// ...vm2 does not, in any configuration.
		for (const opts of [{}, { eval: true }, { wasm: false, eval: true }]) {
			assert.throws(() => new VM(opts).run(src), /is not defined/,
				`vm2 ${JSON.stringify(opts)} unexpectedly scoped eval correctly — if this
				 now passes, the warning in analyze.js should be removed`);
		}
	});

	it("warns the analyst without pointing at a disabled flag", function() {
		// --dangerous-vm would fix it and is disabled in this fork, so recommending it
		// would send the analyst to a flag that silently does nothing.
		const analyze = fs.readFileSync(path.join(boxDir, "analyze.js"), "utf8");
		const start = analyze.indexOf("vm2's limitation");
		assert.notStrictEqual(start, -1, "the ReferenceError warning must exist");
		const warning = analyze.slice(start, start + 600);
		assert.ok(!/Re-run with --dangerous-vm/.test(warning),
			"must not recommend --dangerous-vm; this build disables it");
		assert.ok(/--dangerous-vm is disabled in this build/.test(warning),
			"the warning must say why there is no workaround");
	});
});
