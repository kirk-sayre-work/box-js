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
