// Prefixed with escape-helpers.js by test/sandbox-escape.js. Kept apart from
// escape-payloads.js, whose walks call every global with odd arguments and can leave
// handlers behind that derail the string timers below.
attempt("string-timers", function () {
  // A string handler must run in the sandbox, not through the host's own eval.
  // (boilerplate.js defines its own fake `process`; useProc/useReq test for the real ones.)
  var probe = "url('http://attempted.example/ran-STR');" +
    "useProc('STR', typeof process !== 'undefined' ? process : undefined);" +
    "useReq('STR-require', typeof require !== 'undefined' ? require : undefined);";
  try { globalThis.setInterval(probe.split("STR").join("setInterval-global"), 0); } catch (e) {}
  try { setInterval(probe.split("STR").join("setInterval"), 0); } catch (e) {}
  try { globalThis.setTimeout(probe.split("STR").join("setTimeout-global"), 0); } catch (e) {}
  try { document.getElementById("x").addEventListener("click", probe.split("STR").join("listener")); } catch (e) {}
});
attempt("cc_on-preprocessors", function () {
  // Conditional-compilation (cc_on / if) source goes through m4 and cpp on the host; built at runtime so this file
  // itself is not preprocessed. __MARK__.leak.js (written by the test) calls hit().
  var A = String.fromCharCode(64), H = String.fromCharCode(35);
  var leak = MARK + ".leak.js";
  var bodies = {
    "m4-syscmd": "syscmd(: > '" + MARK + ".m4-syscmd')",
    "m4-prefixed-syscmd": "m4_syscmd(: > '" + MARK + ".m4-prefixed-syscmd')",
    "m4-esyscmd": "esyscmd(: > '" + MARK + ".m4-esyscmd')",
    "m4-include": "include(" + leak + ")",
    "cpp-include": "\n" + H + "include \"" + leak + "\"\n",
    "cpp-include-indented": "\n \t" + H + "include \"" + leak + "\"\n",
    "cpp-include-digraph": "\n%:include \"" + leak + "\"\n",
    // cpp splices backslash-newline before it looks for directives.
    "cpp-include-splice": "\n%\\\n:include \"" + leak + "\"\n",
    "cpp-include-splice-crlf": "\n%\\\r\n:include \"" + leak + "\"\n",
    "cpp-include-splice-space": "\n%\\  \n:include \"" + leak + "\"\n",
    "cpp-include-trigraph": "\n??=include \"" + leak + "\"\n",
    // m4 drops NUL bytes, so a NUL can hide a directive from escaping done before m4.
    "cpp-include-nul-digraph": "\n%\u0000:include \"" + leak + "\"\n",
    "cpp-include-nul-trigraph": "\n?\u0000?=include \"" + leak + "\"\n",
    "cpp-include-nul-splice": "\n%\\\u0000\n:include \"" + leak + "\"\n",
    "m4-nul-syscmd": "m4\u0000_syscmd(: > '" + MARK + ".m4-nul-syscmd')",
  };
  Object.keys(bodies).forEach(function (k) {
    // An escaped "#include" is not JS, so the eval may throw; that is the blocked outcome.
    url("http://attempted.example/cc-" + k);
    var src = "var cc = 1; // " + A + "cc_on " + A + "if (1) " + bodies[k] + "\n";
    try { eval(src); } catch (e) {}
  });
});
attempt("cc_on-conditions", function () {
  // __has_include in an @if condition (also UCN-spelled, which GCC read as the real thing)
  // is a host file-existence oracle; _Pragma("GCC dependency ...") opens a host file.
  var A = String.fromCharCode(64), leak = MARK + ".leak.js";
  var conds = {
    "cpp-has-include": "__has_include(\"" + leak + "\")",
    "cpp-has-include-ucn": "__has\\u005finclude(\"" + leak + "\")",
    "cpp-pragma-ucn": "1)\n_\\u0050ragma(\"GCC dependency \\\"" + leak + "\\\"\")\n" + A + "end\n" + A + "if (1",
  };
  Object.keys(conds).forEach(function (k) {
    url("http://attempted.example/cc-" + k);
    try { eval("var c5 = 1; // " + A + "cc_on " + A + "if (" + conds[k] + ") hit('" + k + "'); " + A + "end\n"); } catch (err) {}
  });
});
attempt("cc_on-semantics", function () {
  // Real JScript conditions keep working: a float version test and @set.
  var A = String.fromCharCode(64);
  eval("var cc3 = 1; // " + A + "cc_on " + A + "if (" + A + "_jscript_version >= 5.5)\nurl('http://attempted.example/cc-float-condition');\n" + A + "end\n");
  eval("var cc4 = 1; // " + A + "cc_on " + A + "set " + A + "probe = 7\n" + A + "if (" + A + "probe == 7) url('http://attempted.example/cc-set'); " + A + "end\n");
});
attempt("cc_on-evasion", function () {
  // A "#" in an @if condition used to open an m4 comment that swallowed the closing
  // parenthesis; m4 failed and box-js analysed an empty program.
  var A = String.fromCharCode(64), H = String.fromCharCode(35);
  eval("var cc2 = 1; // " + A + "cc_on " + A + "if (1 /* " + H + " */)\nurl('http://attempted.example/cc-hash-condition');\n" + A + "end\n");
});
url("http://attempted.example/done");
