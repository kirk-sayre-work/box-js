// Prefixed with escape-helpers.js by test/sandbox-escape.js.
attempt("global-process", function () { if (typeof process !== "undefined") useProc("global-process", process); });
attempt("global-require", function () { if (typeof require !== "undefined") useReq("global-require", require); });
attempt("orig-require", function () { if (typeof _origRequire !== "undefined") useReq("orig-require", _origRequire); });
attempt("this-require", function () { useReq("this-require", this.require); useReq("globalThis-require", globalThis.require); });
attempt("module-require", function () { if (typeof module !== "undefined" && module) useReq("module-require", module.require); });
attempt("this-ctor", function () { fromCtor("this-ctor", this); fromCtor("globalThis-ctor", globalThis); });
attempt("require-ctor", function () { if (typeof require !== "undefined") fromCtor("require-ctor", require); });
attempt("lib", function () {
  if (typeof lib === "undefined") return;
  fromCtor("lib-ctor", lib);
  fromCtor("lib-fn-ctor", lib.logIOC);
  try { lib.argv.download = true; } catch (e) {}
  try { if (lib.argv && lib.argv.download === true) hit("lib-argv-mutable"); } catch (e) {}
  try { if (typeof lib.throttleFileWrites === "function" || typeof lib.throttleCommands === "function") hit("lib-throttle-toggle"); } catch (e) {}
});
attempt("emulated-objects", function () {
  fromCtor("wscript-ctor", WScript);
  fromCtor("activex-ctor", ActiveXObject);
  fromCtor("activex-inst-ctor", new ActiveXObject("WScript.Shell"));
  fromCtor("activex-method-ctor", new ActiveXObject("WScript.Shell").Run);
  if (typeof location !== "undefined") fromCtor("location-ctor", location);
  if (typeof document !== "undefined") fromCtor("document-ctor", document);
  if (typeof console !== "undefined") fromCtor("console-ctor", console.log);
  if (typeof eval !== "undefined") fromCtor("eval-ctor", eval);
  if (typeof setTimeout !== "undefined") fromCtor("timer-ctor", setTimeout(function () {}, 0));
});
attempt("buffer", function () {
  if (typeof Buffer === "undefined") return;
  fromCtor("buffer-ctor", Buffer);
  fromCtor("buffer-inst-ctor", Buffer.from("x"));
});
attempt("async-ctor", function () { fromCtor("async-ctor", (async function () {})); });
attempt("host-error", function () {
  try { WScript.Sleep({ valueOf: function () { throw new Error("x"); } }); } catch (e) { fromCtor("sandbox-error", e); }
  try { new ActiveXObject("No.Such.Object.Zzz"); } catch (e) { fromCtor("activex-error", e); }
  try { lib.logResource(null, null, null); } catch (e) { fromCtor("lib-error", e); }
  try { require("\u0000nope"); } catch (e) { fromCtor("require-error", e); }
});
attempt("stack-frames", function () {
  var orig = Error.prepareStackTrace;
  Error.prepareStackTrace = function (e, frames) { return frames; };
  function probe(frames) {
    if (!frames || typeof frames.forEach !== "function") return;
    frames.forEach(function (f, i) {
      try { var t = f.getThis(); if (t) fromCtor("frame-this-" + i, t); } catch (e) {}
      try { var fn = f.getFunction(); if (fn) fromCtor("frame-fn-" + i, fn); } catch (e) {}
    });
  }
  try { probe(new Error().stack); } catch (e) {}
  try { lib.logIOC("x", { toString: function () { probe(new Error().stack); return ""; } }, "y"); } catch (e) {}
  try { WScript.Echo({ toString: function () { probe(new Error().stack); return ""; } }); } catch (e) {}
  Error.prepareStackTrace = orig;
});
attempt("caller", function () {
  function grab() { try { var c = grab.caller; if (c) fromCtor("caller", c); } catch (e) {} return ""; }
  try { WScript.Echo({ toString: grab }); } catch (e) {}
  try { [3, 1, 2].sort(function (a, b) { grab(); return a - b; }); } catch (e) {}
});
attempt("inspect-custom", function () {
  var o = {};
  o[Symbol.for("nodejs.util.inspect.custom")] = function (d, opts, inspect) {
    if (inspect) fromCtor("inspect-fn", inspect);
    if (opts && opts.stylize) fromCtor("inspect-stylize", opts.stylize);
    return "o";
  };
  try { console.log(o); } catch (e) {}
});
attempt("host-proxy", function () {
  if (typeof location !== "undefined") { try { fromCtor("location-proto", Object.getPrototypeOf(location)); } catch (e) {} }
  if (typeof event !== "undefined") { try { fromCtor("event-ctor", event); fromCtor("event-fn", event.preventDefault); } catch (e) {} }
});
attempt("dynamic-eval", function () {
  try { useProc("eval-process", eval("typeof process !== 'undefined' ? process : undefined")); } catch (e) {}
  try { useProc("function-process", Function("return typeof process !== 'undefined' ? process : undefined")()); } catch (e) {}
  try { useReq("eval-require", eval("typeof require !== 'undefined' ? require : undefined")); } catch (e) {}
});
attempt("every-global", function () {
  // Every value the host put in the sandbox, and one level below it.
  Object.getOwnPropertyNames(globalThis).forEach(function (k) {
    var v;
    try { v = globalThis[k]; } catch (e) { return; }
    if (v === null || (typeof v !== "object" && typeof v !== "function")) return;
    fromCtor("g-" + k, v);
    var inner = [];
    try { inner = Object.getOwnPropertyNames(v).slice(0, 200); } catch (e) {}
    inner.forEach(function (j) {
      var w;
      try { w = v[j]; } catch (e) { return; }
      if (w !== null && (typeof w === "object" || typeof w === "function")) fromCtor("g-" + k + "." + j, w);
    });
  });
});
attempt("required-facades", function () {
  // Every member of every module the sandbox's require hands out, two levels down.
  ["./lib.js", "./argv.js", "./local_text_decoder.js", "node-html-parser", "buffer", "crypto",
    "events", "path", "querystring", "string_decoder", "url", "util", "vm", "zlib"].forEach(function (id) {
    var m;
    try { m = require(id); } catch (e) { return; }
    if (m === null || (typeof m !== "object" && typeof m !== "function")) return;
    fromCtor("req-" + id, m);
    var names = [];
    try { names = Object.getOwnPropertyNames(m); } catch (e) {}
    names.forEach(function (k) {
      var v;
      try { v = m[k]; } catch (e) { return; }
      if (v === null || (typeof v !== "object" && typeof v !== "function")) return;
      fromCtor("req-" + id + "." + k, v);
      var inner = [];
      try { inner = Object.getOwnPropertyNames(v).slice(0, 100); } catch (e) {}
      inner.forEach(function (j) {
        var w;
        try { w = v[j]; } catch (e) { return; }
        if (w !== null && (typeof w === "object" || typeof w === "function")) fromCtor("req-" + id + "." + k + "." + j, w);
      });
    });
  });
});
attempt("jsdom", function () {
  if (typeof dom === "undefined" || !dom) return;
  try { fromCtor("dom-window", dom.window); } catch (e) {}
  try { useProc("dom-window-Function", dom.window.Function("return typeof process !== 'undefined' ? process : undefined")()); } catch (e) {}
  try { useProc("dom-window-eval", dom.window.eval("typeof process !== 'undefined' ? process : undefined")); } catch (e) {}
  try {
    var el = dom.window.document.createElement("div");
    fromCtor("dom-el", el);
    Object.getOwnPropertySymbols(el).forEach(function (s, i) { try { fromCtor("dom-el-sym-" + i, el[s]); } catch (e) {} });
  } catch (e) {}
  try {
    var del = document.createElement("div");
    Object.getOwnPropertySymbols(del).forEach(function (s, i) { try { fromCtor("doc-el-sym-" + i, del[s]); } catch (e) {} });
  } catch (e) {}
  try { viaRealm("document", document); viaRealm("document-el", document.createElement("div")); } catch (e) {}
  try { if (typeof dom.getInternalVMContext === "function") hit("dom-vmcontext"); } catch (e) {}
});
// The walks above may have registered junk handlers that box-js runs after the sample;
// one that throws sends it into its fallback re-run, so clear them.
try { document.body.onload = undefined; } catch (e) {}
try { listenerCallbacks.length = 0; } catch (e) {}
try { dynamicOnclickHandlers.length = 0; } catch (e) {}
url("http://attempted.example/done");
