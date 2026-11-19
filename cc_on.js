// JScript conditional compilation (@if/@elif/@else/@end, @set), evaluated in JS.
//
// This used to be done by piping the sample through m4 and then the C preprocessor on the
// host. Both are programs whose input the sample wrote, and every escaping scheme put in
// front of them was eventually walked around (m4 syscmd/include; cpp #include via digraphs,
// trigraphs, line splices, NUL bytes m4 drops, UCN-spelled __has_include / _Pragma; a "#"
// that made m4 fail and leave an empty program). Here the sample's text is only ever
// scanned as a string, and an @if condition is parsed with acorn and evaluated over a
// whitelist of operators, literals and @variables. No process is started.

const acorn = require("acorn");
const crypto = require("crypto");

// Undefined variables (including _win16, _mac, ...) are NaN, as in JScript.
// The values cscript.exe/wscript.exe report on 32-bit Windows (the C preprocessor
// defines box-js used to pass, plus the version and build JScript 5.8 reports).
const DEFAULT_VARS = Object.freeze({
  _jscript: true,
  _jscript_build: 18702,
  _jscript_version: 5.8,
  _win32: true,
  _win64: true,
  _x86: true,
});

// Directives and @variables only count in code: codeMask() marks string literals, regex
// literals and ordinary comments, where JScript sees text. A comment whose text starts
// with "@" (//@if, and "//@cc_on @if" once analyze.js has removed "@cc_on") is code.
const DIRECTIVE = /@(if|elif|else|end|set)(?![\w$])/gi;
// "@set" must be followed by "@name =" to be one.
const SET_SHAPE = /[ \t]*@[A-Za-z_$][\w$]*\s*=/y;
// JScript's @set values are numbers and booleans. Strings are only allowed as literals
// inside an expression, and bounded, so a sample cannot grow one across @set lines.
const MAX_STRING = 4096;

const REGEX_AFTER = /[(,=:[!&|?{};+\-*%<>~^]/;
const CC_COMMENT = /^@(if|elif|else|end|set|_)/i;
const PAREN_KEYWORDS = new Set(["if", "while", "for", "with"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "new", "delete",
  "void", "throw", "instanceof"]);

// 1 for every character that is not code: inside a "..." / '...' / `...` literal, a regex
// literal, or a comment. A "//@" or "/*@" comment is JScript conditional-compilation code,
// so its contents stay code. Strings and regexes end at a line end (they cannot span one,
// except by a backslash continuation; template literals can);
// a "/" is a regex when the previous token cannot end an expression. One forward pass.
function codeMask(text) {
  const n = text.length;
  const mask = new Uint8Array(n);
  const isWord = (ch) => /[\w$]/.test(ch);
  const isNewline = (ch) => ch === "\n" || ch === "\r";
  let prev = ""; // last non-blank code character
  let word = ""; // the identifier that ends at prev, if prev is a word character
  let gap = false; // blank space since prev
  // Open template literals whose ${...} we are in: brace depth inside each.
  const templates = [];
  let i = 0;
  const atAt = (k) => {
    // Comment text starting with a conditional-compilation directive or variable (after
    // blanks) is code: //@if, //@set, //@_win32 (and "//@cc_on @if" once analyze.js has
    // removed "@cc_on"). JSDoc-style "// @param" stays a comment.
    while (k < n && (text[k] === " " || text[k] === "\t")) k++;
    return CC_COMMENT.test(text.slice(k, k + 8));
  };
  // Parentheses opened right after if/while/for/with: a "/" after their ")" starts a regex.
  const parens = [];
  // Where an unclosed quote or regex scan stopped (its line end), per opener: a later
  // opener of the same kind before that point cannot close either, so it is not rescanned
  // (which made a line full of unclosed quotes or regexes quadratic).
  const noClose = {"\"": -1, "'": -1, "/": -1};
  const markRange = (a, b) => {
    for (let k = a; k < b; k++) mask[k] = 1;
  };
  // Mask a template literal's text from i (just after a backtick or a closing "}") to its
  // end or its next "${"; returns true if it stopped at "${".
  const templateText = () => {
    while (i < n) {
      const d = text[i];
      if (d === "\\") {
        mask[i++] = 1;
        if (i < n) mask[i++] = 1;
        continue;
      }
      if (d === "`") {
        mask[i++] = 1;
        return false;
      }
      if (d === "$" && text[i + 1] === "{") {
        mask[i++] = 1;
        mask[i++] = 1;
        return true;
      }
      mask[i++] = 1;
    }
    return false;
  };
  while (i < n) {
    const c = text[i];
    if (isWord(c)) {
      word = (!gap && isWord(prev) ? word : "") + c;
      prev = c;
      gap = false;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      gap = true;
      i++;
      continue;
    }
    if (templates.length && (c === "{" || c === "}")) {
      if (c === "{") templates[templates.length - 1]++;
      else if (templates[templates.length - 1]-- === 0) {
        templates.pop();
        mask[i++] = 1;
        if (templateText()) templates.push(0);
        prev = "a";
        word = "";
        gap = false;
        continue;
      }
    }
    if (c === "`") {
      mask[i++] = 1;
      if (templateText()) templates.push(0);
      prev = "a";
      word = "";
      gap = false;
      continue;
    }
    if ((c === "\"" || c === "'") && i > noClose[c]) {
      // A string that does not close on its line (backslash continuations aside) is not
      // one: leave the quote as code rather than mask the rest of the line.
      const start = i;
      let k = i + 1;
      let closed = false;
      while (k < n && !isNewline(text[k])) {
        if (text[k] === "\\" && k + 1 < n) {
          k += text[k + 1] === "\r" && text[k + 2] === "\n" ? 3 : 2;
          continue;
        }
        if (text[k] === c) {
          closed = true;
          break;
        }
        k++;
      }
      if (!closed) noClose[c] = k;
      if (closed) {
        markRange(start, k + 1);
        i = k + 1;
        prev = "a";
        word = "";
        gap = false;
        continue;
      }
    }
    if (c === "/" && text[i + 1] === "/") {
      if (atAt(i + 2)) {
        i += 2;
        continue;
      }
      let e = i;
      while (e < n && !isNewline(text[e])) e++;
      markRange(i, e);
      i = e;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      if (atAt(i + 2)) {
        i += 2;
        continue;
      }
      const e = text.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      markRange(i, end);
      i = end;
      continue;
    }
    if (c === "(") {
      parens.push(isWord(prev) && PAREN_KEYWORDS.has(word));
    } else if (c === ")") {
      if (parens.pop()) {
        prev = "(";
        word = "";
        gap = false;
        i++;
        continue;
      }
    } else if ((c === "+" || c === "-") && text[i + 1] === c) {
      // ++ / -- : a "/" after them divides (x++ / 2).
      prev = "a";
      word = "";
      gap = false;
      i += 2;
      continue;
    }
    if (c === "*" && text[i + 1] === "/") {
      // The end of a /*@ ... comment kept as code: not a multiplication and a regex.
      i += 2;
      continue;
    }
    if (c === "/" && (prev === "" || REGEX_AFTER.test(prev) || (isWord(prev) && REGEX_KEYWORDS.has(word)))) {
      // A regex that does not close on its line is a division after all.
      let k = i + 1;
      let inClass = false;
      let closed = false;
      // Inside an earlier unclosed scan's range (this "/" was in a class there), scan only
      // to the first "/" or bracket: a "/" closes it, a bracket means this scan has caught
      // up with the unclosed one and will not close either. Keeps such lines linear.
      const cached = i <= noClose["/"];
      while (k < n && !isNewline(text[k])) {
        if (cached && (text[k] === "[" || text[k] === "]")) break;
        const d = text[k];
        if (d === "\\") {
          k += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) {
          closed = true;
          break;
        }
        k++;
      }
      if (!closed) noClose["/"] = Math.max(noClose["/"], k);
      if (closed) {
        k++;
        while (k < n && /[a-z]/i.test(text[k])) k++;
        markRange(i, k);
        i = k;
        prev = "a";
        word = "";
        gap = false;
        continue;
      }
    }
    prev = c;
    word = "";
    gap = false;
    i++;
  }
  return mask;
}

// The text of a balanced "( ... )" starting at code[i] (after blanks), or a condition up
// to the end of the line when there is no parenthesis (cpp's reading of the old rewrite).
function readCondition(code, i) {
  // Blank space, line breaks included, may come before the "(" (master's rewrite took
  // /@if\s*/); without a "(" the condition runs to the end of its own line.
  let j = i;
  while (j < code.length && /\s/.test(code[j])) j++;
  if (code[j] === "(") i = j;
  else while (i < code.length && /[ \t]/.test(code[i])) i++;
  if (code[i] !== "(") {
    const eol = code.indexOf("\n", i);
    const end = eol < 0 ? code.length : eol;
    return {text: code.slice(i, end), end};
  }
  let depth = 0;
  let quote = null;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (quote) {
      if (c === "\\") j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\"" || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return {text: code.slice(i, j + 1), end: j + 1};
  }
  return {text: code.slice(i), end: code.length};
}

function lookup(vars, name) {
  return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : NaN;
}

// Evaluate a condition/@set expression. Anything outside the whitelist is an error.
function evaluate(text, vars) {
  // @name becomes an identifier with a prefix the sample cannot know (fresh per call), so
  // no identifier the condition spells itself, escaped or not, reads a variable.
  const prefix = "__boxjs_cc_" + crypto.randomBytes(8).toString("hex") + "_";
  const source = text.replace(/@([A-Za-z_$][\w$]*)/g, (m, name) => prefix + name);
  const ast = acorn.parse("(" + source + "\n)", {ecmaVersion: 2020});
  if (ast.body.length !== 1 || ast.body[0].type !== "ExpressionStatement") {
    throw new Error("not a single expression");
  }
  let steps = 0;
  function ev(node) {
    if (++steps > 10000) throw new Error("expression too large");
    switch (node.type) {
    case "Literal":
      if (node.regex || typeof node.value === "bigint") throw new Error("unsupported literal");
      return node.value;
    case "Identifier":
      if (node.name.startsWith(prefix)) return lookup(vars, node.name.slice(prefix.length));
      if (node.name === "undefined") return undefined;
      if (node.name === "NaN") return NaN;
      if (node.name === "Infinity") return Infinity;
      throw new Error("unknown identifier " + node.name);
    case "UnaryExpression": {
      const v = ev(node.argument);
      switch (node.operator) {
      case "!": return !v;
      case "-": return -v;
      case "+": return +v;
      case "~": return ~v;
      default: throw new Error("unsupported operator " + node.operator);
      }
    }
    case "BinaryExpression": {
      const a = ev(node.left);
      const b = ev(node.right);
      if ((typeof a === "string" && a.length > MAX_STRING) || (typeof b === "string" && b.length > MAX_STRING)) {
        throw new Error("string too long");
      }
      switch (node.operator) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return a / b;
      case "%": return a % b;
      case "==": return a == b; // eslint-disable-line eqeqeq
      case "!=": return a != b; // eslint-disable-line eqeqeq
      case "===": return a === b;
      case "!==": return a !== b;
      case "<": return a < b;
      case "<=": return a <= b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "&": return a & b;
      case "|": return a | b;
      case "^": return a ^ b;
      case "<<": return a << b;
      case ">>": return a >> b;
      case ">>>": return a >>> b;
      default: throw new Error("unsupported operator " + node.operator);
      }
    }
    case "LogicalExpression": {
      const a = ev(node.left);
      if (node.operator === "&&") return a && ev(node.right);
      if (node.operator === "||") return a || ev(node.right);
      throw new Error("unsupported operator " + node.operator);
    }
    case "ConditionalExpression":
      return ev(node.test) ? ev(node.consequent) : ev(node.alternate);
    case "SequenceExpression": {
      let v;
      for (const e of node.expressions) v = ev(e);
      return v;
    }
    default:
      throw new Error("unsupported expression " + node.type);
    }
  }
  const v = ev(ast.body[0].expression);
  if (typeof v === "string" && v.length > MAX_STRING) throw new Error("string too long");
  // Only primitives come out (strings, numbers, booleans): nothing reaches the sandbox.
  return v;
}

// Replace @name in active code with the variable's value, as JScript does. An unknown
// name in JScript's predefined namespace (@_win16, @_mac, @_alpha, ...) is NaN there, so
// it becomes NaN here; other unknown names stay as they are. Only in code (see codeMask),
// and not right after an identifier character.
function substitute(text, vars, mask, base) {
  return text.replace(/(^|[^\w$@])@([A-Za-z_$][\w$]*)/g, (m, pre, name, offset) => {
    if (mask[base + offset + pre.length]) return m;
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return name.startsWith("_") ? pre + "NaN" : m;
    const v = vars[name];
    return pre + (typeof v === "number" && Number.isNaN(v) ? "NaN" : String(v));
  });
}

// `code` has had /*@cc_on, @cc_on, /*@ and @*/ removed already. `warn` gets a message
// for each condition that could not be evaluated (taken as false).
function preprocess(code, warn = () => {}) {
  const vars = Object.assign(Object.create(null), DEFAULT_VARS);
  // One frame per open @if: whether this level emits code, and whether a branch was taken.
  const stack = [];
  // Number of open frames that are off: the code is live when there are none. (Checking
  // every frame per directive was quadratic in the nesting depth.)
  let off = 0;
  const active = () => off === 0;
  const setOn = (f, on) => {
    if (f.on !== on) off += on ? -1 : 1;
    f.on = on;
  };
  let out = "";
  let pos = 0;
  function cond(text) {
    try {
      return Boolean(evaluate(text, vars));
    } catch (e) {
      warn(`could not evaluate conditional compilation condition ${JSON.stringify(text.slice(0, 200))}: ${e.message}`);
      return false;
    }
  }
  const mask = codeMask(code);
  DIRECTIVE.lastIndex = 0;
  let m;
  while ((m = DIRECTIVE.exec(code)) !== null) {
    if (mask[m.index]) continue;
    if (active()) out += substitute(code.slice(pos, m.index), vars, mask, pos);
    let next = m.index + m[0].length;
    const kind = m[1].toLowerCase();
    // @elif/@else/@end with no open @if are text (e.g. "at @end" in a string).
    if (stack.length === 0 && (kind === "elif" || kind === "else" || kind === "end")) {
      if (active()) out += m[0];
      pos = next;
      continue;
    }
    if (kind === "if") {
      const c = readCondition(code, next);
      next = c.end;
      const parentOn = active();
      const on = parentOn && cond(c.text);
      stack.push({on, taken: on, parentOn});
      if (!on) off++;
    } else if (kind === "elif") {
      const c = readCondition(code, next);
      next = c.end;
      const f = stack[stack.length - 1];
      if (f) {
        const on = f.parentOn && !f.taken && cond(c.text);
        setOn(f, on);
        f.taken = f.taken || on;
      }
    } else if (kind === "else") {
      const f = stack[stack.length - 1];
      if (f) {
        setOn(f, f.parentOn && !f.taken);
        f.taken = true;
      }
    } else if (kind === "end") {
      const f = stack.pop();
      if (f && !f.on) off--;
    } else if (kind === "set") {
      SET_SHAPE.lastIndex = next;
      if (!SET_SHAPE.test(code)) {
        // Not "@set @name = ..." (checked without scanning the rest of the line, which
        // made many of these on one line quadratic): plain text.
        if (active()) out += m[0];
        pos = next;
        DIRECTIVE.lastIndex = next;
        continue;
      }
      // @set @name = expression (to the end of the line or a ";")
      let i = next;
      while (i < code.length && /[ \t]/.test(code[i])) i++;
      let end = i;
      while (end < code.length && code[end] !== "\n" && (code[end] !== ";" || mask[end])) end++;
      const stmt = code.slice(i, end);
      next = end;
      const sm = /^@([A-Za-z_$][\w$]*)\s*=([\s\S]*)$/.exec(stmt);
      if (!sm) {
        // Not "@set @name = ..." (e.g. "@set" in a string): plain text.
        if (active()) out += m[0];
        pos = m.index + m[0].length;
        DIRECTIVE.lastIndex = pos;
        continue;
      }
      if (active()) {
        try {
          const v = evaluate(sm[2], vars);
          if (typeof v !== "number" && typeof v !== "boolean") throw new Error("@set values are numbers or booleans");
          vars[sm[1]] = v;
        } catch (e) {
          warn(`could not evaluate @set ${JSON.stringify(stmt.slice(0, 200))}: ${e.message}`);
        }
      }
    }
    // Keep line numbers roughly where they were.
    out += "\n";
    pos = next;
    DIRECTIVE.lastIndex = next;
  }
  if (active()) out += substitute(code.slice(pos), vars, mask, pos);
  return out;
}

module.exports = {preprocess, evaluate, DEFAULT_VARS};
