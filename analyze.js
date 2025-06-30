const lib = require("./lib");
const loop_rewriter = require("./loop_rewriter");
const equality_rewriter = require("./equality_rewriter");
const escodegen = require("escodegen");
const acorn = require("acorn");
const fs = require("fs");
const iconv = require("iconv-lite");
const path = require("path");
const { VM } = require("vm2");
const child_process = require("child_process");
const argv = require("./argv.js").run;
const jsdom = require("jsdom").JSDOM;
const dom = new jsdom(`<html><head></head><body></body></html>`);
const { DOMParser } = require("xmldom");

const filename = process.argv[2];

// JScriptMemberFunctionStatement plugin registration
// Plugin system is now different in Acorn 8.*, so commenting out.
//require("./patches/prototype-plugin.js")(acorn);

lib.debug("Analysis launched: " + JSON.stringify(process.argv));
lib.verbose("Box-js version: " + require("./package.json").version);

let git_path = path.join(__dirname, ".git");
if (fs.existsSync(git_path) && fs.lstatSync(git_path).isDirectory()) {
  lib.verbose(
    "Commit: " +
      fs
        .readFileSync(path.join(__dirname, ".git/refs/heads/master"), "utf8")
        .replace(/\n/, "")
  );
} else {
  lib.verbose("No git folder found.");
}
lib.verbose(`Analyzing ${filename}`, false);
const sampleBuffer = fs.readFileSync(filename);
let encoding;
if (argv.encoding) {
  lib.debug("Using argv encoding");
  encoding = argv.encoding;
} else {
  lib.debug("Using detected encoding");
  encoding = require("jschardet").detect(sampleBuffer).encoding;
  if (encoding === null) {
    lib.warning(
      "jschardet (v" +
        require("jschardet/package.json").version +
        ") couldn't detect encoding, using UTF-8"
    );
    encoding = "utf8";
  } else {
    lib.warning(
      "jschardet (v" +
        require("jschardet/package.json").version +
        ") detected encoding " +
        encoding
    );
  }
}

let code = iconv.decode(sampleBuffer, encoding);

let rawcode;
if (argv["activex-as-ioc"]) {
  rawcode = iconv.decode(sampleBuffer, encoding);
}

/*
if (code.match("<job") || code.match("<script")) { // The sample may actually be a .wsf, which is <job><script>..</script><script>..</script></job>.
    lib.debug("Sample seems to be WSF");
    code = code.replace(/<\??\/?\w+( [\w=\"\']*)*\??>/g, ""); // XML tags
    code = code.replace(/<!\[CDATA\[/g, "");
    code = code.replace(/\]\]>/g, "");
}
*/

function lacksBinary(name) {
  const path = child_process.spawnSync("command", ["-v", name], {
    shell: true,
  }).stdout;
  return path.length === 0;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

function stripSingleLineComments(s) {
  const lines = s.split("\n");
  var r = "";
  for (const line of lines) {
    var lineStrip = line.trim() + "\r";
    for (const subLine of lineStrip.split("\r")) {
      // Full line comment?
      var subLineStrip = subLine.trim();
      if (subLineStrip.startsWith("//")) continue;
      r += subLineStrip + "\n";
    }
  }
  return r;
}

function isCodeLine(line) {
  // Check if a line contains actual JavaScript code (not just comments/whitespace)
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Skip lines that are only comments
  if (trimmed.startsWith("//")) return false;
  if (trimmed.startsWith("/*") && trimmed.endsWith("*/")) return false;

  // Look for JavaScript keywords, operators, or structure
  const jsPatterns = [
    /\b(function|var|let|const|if|else|for|while|try|catch|return|new|this)\b/,
    /[{}();=+\-*/<>!&|]/,
    /\.\w+\s*\(/, // method calls
    /\w+\s*[=:]/, // assignments
    /\w+\(/, // function calls
  ];

  return jsPatterns.some((pattern) => pattern.test(trimmed));
}

function isAlphaNumeric(str) {
  var code, i;

  if (str.length == 0) return false;
  code = str.charCodeAt(0);
  if (
    !(code > 47 && code < 58) && // numeric (0-9)
    !(code > 64 && code < 91) && // upper alpha (A-Z)
    !(code > 96 && code < 123)
  ) {
    // lower alpha (a-z)
    return false;
  }
  return true;
}

function smartStripComments(s) {
  // This function is designed to handle heavily commented samples better
  // than the original hideStrs() comment removal

  // First, handle line-by-line processing for mixed code/comment lines
  const lines = s.split("\n");
  const processedLines = [];

  for (let line of lines) {
    // Skip empty lines and lines that are just whitespace
    if (!line.trim()) {
      processedLines.push("");
      continue;
    }

    // Check if this line contains actual code
    if (isCodeLine(line)) {
      // For lines with code, try to preserve the code part while removing comments
      // Handle inline /* */ comments
      let processed = line;

      // Remove inline /* */ comments but be careful about strings
      let inString = false;
      let stringChar = "";
      let result = "";
      let i = 0;

      while (i < processed.length) {
        const char = processed[i];
        const nextChar = processed[i + 1];

        // Track string boundaries
        if (!inString && (char === '"' || char === "'" || char === "`")) {
          inString = true;
          stringChar = char;
          result += char;
          i++;
          continue;
        } else if (
          inString &&
          char === stringChar &&
          processed[i - 1] !== "\\"
        ) {
          inString = false;
          stringChar = "";
          result += char;
          i++;
          continue;
        }

        // If we're in a string, just copy the character
        if (inString) {
          result += char;
          i++;
          continue;
        }

        // Look for /* comment start
        if (char === "/" && nextChar === "*") {
          // Find the end of the comment
          let commentEnd = processed.indexOf("*/", i + 2);
          if (commentEnd !== -1) {
            // Skip the entire comment
            i = commentEnd + 2;
            continue;
          } else {
            // Comment doesn't end on this line, keep the rest
            break;
          }
        }

        // Look for // comment start
        if (char === "/" && nextChar === "/") {
          // Rest of line is a comment
          break;
        }

        result += char;
        i++;
      }

      // Check if this looks like an undeclared variable assignment
      const trimmedResult = result.trim();
      const equalIndex = trimmedResult.indexOf("=");
      const beforeEqual =
        equalIndex > 0 ? trimmedResult.substring(0, equalIndex) : trimmedResult;

      if (
        trimmedResult &&
        /^\w+\s*=\s*/.test(trimmedResult) &&
        !trimmedResult.startsWith("var ") &&
        !trimmedResult.startsWith("let ") &&
        !trimmedResult.startsWith("const ") &&
        !beforeEqual.includes(".") && // Not a property assignment
        !beforeEqual.includes("[")
      ) {
        // Not an array element assignment
        // Add var declaration
        result = result.replace(/^(\s*)(\w+)/, "$1var $2");
      }

      processedLines.push(result.trim() ? result : "");
    } else {
      // This line is comment-only or whitespace, skip it
      processedLines.push("");
    }
  }

  return processedLines.join("\n");
}

function hideStrs(s) {
  var inStrSingle = false;
  var inStrDouble = false;
  var inStrBackTick = false;
  var inComment = false;
  var inCommentSingle = false;
  var inRegex = false;
  var oldInRegex = false;
  var currStr = undefined;
  var prevChar = "";
  var prevPrevChar = "";
  var allStrs = {};
  var escapedSlash = false;
  var prevEscapedSlash = false;
  var counter = 1000000;
  var r = "";
  var skip = false;
  var justExitedComment = false;
  var slashSubstr = "";
  var resetSlashes = false;
  var justStartedRegex = false;
  var inSquareBrackets = false;
  var skippedSpace = false;

  // Use smarter comment stripping for heavily commented samples
  s = smartStripComments(s);

  // For debugging.
  var window = "               ";
  // Special case. Regex uses like '/.../["test"]' are really hard
  // to deal with. Hide all '["test"]' instances.
  var tmpName = "HIDE_" + counter++;
  s = s.replace(/\["test"\]/g, tmpName);
  allStrs[tmpName] = '["test"]';
  tmpName = "HIDE_" + counter++;
  s = s.replace(/\['test'\]/g, tmpName);
  allStrs[tmpName] = "['test']";
  // Similar to the above, obfuscator.io constructs like
  // '/.../[0x_fff(' are also really hard to deal with. Replace
  // those also.
  tmpName = "HIDE_" + counter++;
  // Ony match exprs that start with the '/' and keep the '/' in the
  // code to close out the regex. We are doing this because
  // Replacement name must start with HIDE_.
  s = s.replace(/\/\[_0x/g, "/" + tmpName);
  allStrs[tmpName] = "[_0x";
  //console.log("prevprev,prev,curr,dbl,single,commsingl,comm,regex,oldinregex,slash,justexitcom");
  for (let i = 0; i < s.length; i++) {
    // Track consecutive backslashes. We use this to tell if the
    // current back slash has been escaped (even # of backslashes)
    // or is escaping the next character (odd # of slashes).
    if (prevChar == "\\" && slashSubstr.length == 0) {
      slashSubstr = "\\";
    } else if (prevChar == "\\" && slashSubstr.length > 0) {
      slashSubstr += "\\";
    } else if (prevChar != "\\") {
      slashSubstr = "";
    }
    // Backslash escaping gets 'reset' when hitting a space.
    var currChar = s[i];
    if (currChar == " " && slashSubstr) {
      slashSubstr = "";
      resetSlashes = true;
    }
    // Debugging.
    //window = window.slice(1,) + currChar;
    //console.log(window);

    // Since we've already handled comments in smartStripComments(),
    // we can simplify the comment detection here
    var oldInComment = inComment;

    // We still need basic comment detection for remaining edge cases
    // but it should be much simpler now
    inComment =
      inComment ||
      (prevChar == "/" &&
        currChar == "*" &&
        !inStrDouble &&
        !inStrSingle &&
        !inCommentSingle &&
        !inStrBackTick &&
        (!inRegex || !oldInRegex));

    // In /* */ comment? (Should be rare now after preprocessing)
    if (inComment) {
      // Skip comment content
      if (oldInComment != inComment) {
        inRegex = false;
        r = r.slice(0, -1);
      }

      // Out of comment?
      if (prevChar == "*" && currChar == "/" && !skippedSpace) {
        inComment = false;
        justExitedComment = true;
      }

      // Keep going until we leave the comment
      if (currChar != " ") {
        prevPrevChar = prevChar;
        prevChar = currChar;
      } else {
        skippedSpace = true;
      }
      continue;
    }

    // Single line comments should also be mostly handled, but keep basic detection
    inCommentSingle =
      inCommentSingle ||
      (prevChar == "/" &&
        currChar == "/" &&
        !inStrDouble &&
        !inStrSingle &&
        !inComment &&
        !justExitedComment &&
        !inStrBackTick);

    if (prevChar == "/" && currChar == "/" && !inComment && justExitedComment) {
      inComment = true;
      justExitedComment = false;
      continue;
    }
    justExitedComment = false;

    // In // comment?
    if (inCommentSingle) {
      inRegex = false;
      r += currChar;

      // Out of comment?
      if (currChar == "\n" || currChar == "\r") {
        inCommentSingle = false;
      }

      if (currChar != " ") {
        prevPrevChar = prevChar;
        prevChar = currChar;
      }
      continue;
    }

    // Start /.../ regex expression?
    oldInRegex = inRegex;
    // Assume that regex expressions can't be preceded by ')' or
    // an alphanumeric character. This is to try to tell divisiion
    // from the start of a regex.
    inRegex =
      inRegex ||
      (prevChar != "/" &&
        prevChar != ")" &&
        !isAlphaNumeric(prevChar) &&
        currChar == "/" &&
        !inStrDouble &&
        !inStrSingle &&
        !inComment &&
        !inCommentSingle &&
        !inStrBackTick);

    // In /.../ regex expression?
    if (inRegex) {
      // Save regex unmodified.
      r += currChar;

      // In character set (square brackets)?
      if (currChar == "[") inSquareBrackets = true;
      if (currChar == "]") inSquareBrackets = false;

      // Out of regex?
      //
      // Unescaped '/' can appear in a regex (nice). Try to
      // guess whether the '/' actually ends the regex based on
      // the char after the '/'. Add chars that CANNOT appear
      // after a regex def as needed.
      //
      // ex. var f=/[!"#$%&'()*+,/\\:;<=>?@[\]^`{|}~]/g;
      if (
        !justStartedRegex &&
        !inSquareBrackets &&
        prevChar == "/" &&
        slashSubstr.length % 2 == 0 &&
        "\\:[]?".indexOf(currChar) == -1
      ) {
        inRegex = false;
      }

      // Track seeing the '/' starting the regex.
      justStartedRegex = !oldInRegex;

      // Keep going until we leave the regex.
      if (currChar != " ") {
        prevPrevChar = prevChar;
        prevChar = currChar;
      }
      if (resetSlashes) prevChar = " ";
      resetSlashes = false;
      continue;
    }

    // Looking at an escaped back slash (1 char back)?
    escapedSlash = prevChar == "\\" && prevPrevChar == "\\";

    // Start/end single quoted string?
    if (
      currChar == "'" &&
      (prevChar != "\\" ||
        (prevChar == "\\" && slashSubstr.length % 2 == 0 && inStrSingle)) &&
      !inStrDouble &&
      !inStrBackTick
    ) {
      // Switch being in/out of string.
      inStrSingle = !inStrSingle;

      // Finished up a string we were tracking?
      if (!inStrSingle) {
        currStr += "'";
        const strName = "HIDE_" + counter++;
        allStrs[strName] = currStr;
        r += strName;
        skip = true;
      } else {
        currStr = "";
      }
    }

    // Start/end double quoted string?
    if (
      currChar == '"' &&
      (prevChar != "\\" ||
        (prevChar == "\\" && slashSubstr.length % 2 == 0 && inStrDouble)) &&
      !inStrSingle &&
      !inStrBackTick &&
      !inCommentSingle &&
      !inComment &&
      !inRegex
    ) {
      // Switch being in/out of string.
      inStrDouble = !inStrDouble;

      // Finished up a string we were tracking?
      if (!inStrDouble) {
        currStr += '"';
        const strName = "HIDE_" + counter++;
        allStrs[strName] = currStr;
        r += strName;
        skip = true;
      } else {
        currStr = "";
      }
    }

    // Start/end backtick quoted string?
    if (
      currChar == "`" &&
      (prevChar != "\\" ||
        (prevChar == "\\" &&
          escapedSlash &&
          !prevEscapedSlash &&
          inStrBackTick)) &&
      !inStrSingle &&
      !inStrDouble &&
      !inCommentSingle &&
      !inComment &&
      !inRegex
    ) {
      // Switch being in/out of string.
      inStrBackTick = !inStrBackTick;

      // Finished up a string we were tracking?
      if (!inStrBackTick) {
        currStr += "`";
        const strName = "HIDE_" + counter++;
        allStrs[strName] = currStr;
        r += strName;
        skip = true;
      } else {
        currStr = "";
      }
    }

    // Save the current character if we are tracking a string.
    if (inStrDouble || inStrSingle || inStrBackTick) {
      currStr += currChar;
    }

    // Not in a string. Just save the original character in the
    // result string.
    else if (!skip) {
      r += currChar;
    }
    skip = false;

    // Track what is now the previous character so we can handle
    // escaped quotes in strings.
    prevPrevChar = prevChar;
    if (currChar != " ") prevChar = currChar;
    if (resetSlashes) prevChar = " ";
    resetSlashes = false;
    prevEscapedSlash = escapedSlash;
  }
  //console.log(JSON.stringify([prevPrevChar, prevChar, currChar, inStrDouble, inStrSingle, inCommentSingle, inComment, inRegex, slashSubstr, justExitedComment]))
  return [r, allStrs];
}

function unhideStrs(s, map) {
  // Replace each HIDE_NNNN with the hidden string.
  var oldPos = 0;
  var currPos = s.indexOf("HIDE_");
  var r = "";
  var done = currPos < 0;
  while (!done) {
    // Add in the previous non-hidden string contents.
    r += s.slice(oldPos, currPos);

    // Pull out the name of the hidden string.
    var tmpPos = currPos + "HIDE_".length + 7;

    // Get the original string.
    var hiddenName = s.slice(currPos, tmpPos);
    var origVal = map[hiddenName];

    // Add in the unhidden string.
    r += origVal;

    // Move to the next string to unhide.
    oldPos = tmpPos;
    currPos = s.slice(tmpPos).indexOf("HIDE_");
    done = currPos < 0;
    currPos = tmpPos + currPos;
  }

  // Add in remaining original string that had nothing hidden.
  r += s.slice(tmpPos);

  // Done.
  return r;
}

// JScript lets you stick the actual code to run in a conditional
// comment like '/*@if(@_jscript_version >= 4)....*/'. If there,
// extract that code out.
function extractCode(code) {
  // See if we can pull code out from conditional comments.
  // /*@if(@_jscript_version >= 4) ... @else @*/
  // /*@if(1) ... @end@*/
  //
  // /*@cc_on
  // @if(1) ... @end@*/
  //
  // /*@cc_on @*//*@if (1)
  // ... @end @*/
  const commentPat =
    /\/\*(?:@cc_on\s+)?@if\s*\([^\)]+\)(.+?)@(else|end)\s*@\s*\*\//s;
  var codeMatch = code.match(commentPat);
  if (!codeMatch) {
    const commentPat1 =
      /\/\*\s*@cc_on\s*@\*\/\s*\/\*\s*@if\s*\([^\)]+\)(.+?)@(else|end)\s*@\s*\*\//s;
    codeMatch = code.match(commentPat1);
    if (!codeMatch) {
      // /*@cc_on\n...@*/
      const commentPat2 = /\/\*\s*@cc_on *\r?\n(.+?)\r?\n@\*\//;
      codeMatch = code.match(commentPat2);
      if (!codeMatch) {
        // //@cc_on ... @*/
        const commentPat3 = /\/\/\s*@cc_on(.+?)@\*\//;
        codeMatch = code.match(commentPat3);
        if (!codeMatch) {
          return code;
        }
      }
    }
  }
  var r = codeMatch[1];
  lib.info("Extracted code to analyze from conditional JScript comment.");
  return r;
}

function rewrite(code, useException = false) {
  //console.log("!!!! CODE: 0 !!!!");
  //console.log(code);
  //console.log("!!!! CODE: 0 !!!!");

  // box-js is assuming that the JS will be run on Windows with cscript or wscript.
  // Neither of these engines supports strict JS mode, so remove those calls from
  // the code.
  code = code
    .toString()
    .replace(/"use strict"/g, '"STRICT MODE NOT SUPPORTED"');
  code = code
    .toString()
    .replace(/'use strict'/g, "'STRICT MODE NOT SUPPORTED'");

  // The following 2 code rewrites should not be applied to patterns
  // in string literals. Hide the string literals first.
  //
  // This also strips all comments.
  if (!argv["no-rewrite"]) {
    var counter = 1000000;
    const [newCode, strMap] = hideStrs(code);
    code = newCode;

    // Some samples for some reason have spurious spaces in '==' type
    // expressions. Fix those while the strings are hidden.
    code = code.toString().replace(/= +=/g, "==");
    code = code.toString().replace(/\^ +=/g, "^=");
    code = code.toString().replace(/= +>/g, "=>");
    code = code.toString().replace(/% +%/g, "%");

    // WinHTTP ActiveX objects let you set options like 'foo.Option(n)
    // = 12'. Acorn parsing fails on these with a assigning to rvalue
    // syntax error, so rewrite things like this so we can parse
    // (replace these expressions with comments). We have to do this
    // with regexes rather than modifying the parse tree since these
    // expressions cannot be parsed by acorn.
    var rvaluePat = /[\n;][^\n^;]*?\([^\n^;]+?\)\s*=[^=^>][^\n^;]+?\r?(?=[;])/g;
    code = code.toString().replace(rvaluePat, ";/* ASSIGNING TO RVALUE */");
    rvaluePat = /[\n;][^\n^;]*?\([^\n^;]+?\)\s*=[^=^>][^\n^;]+?\r?(?=[\n])/g;
    code = code.toString().replace(rvaluePat, ";// ASSIGNING TO RVALUE");

    // Now unhide the string literals.
    code = unhideStrs(code, strMap);
  }
  //console.log("!!!! CODE: 3 !!!!");
  //console.log(code);
  //console.log("!!!! CODE: 3 !!!!");

  // Some samples (for example that use JQuery libraries as a basis to which to
  // add malicious code) won't emulate properly for some reason if there is not
  // an assignment line at the start of the code. Add one here (this should not
  // change the behavior of the code).
  code = "__bogus_var_name__ = 12;\n\n" + code;

  if (code.match("@cc_on")) {
    lib.debug("Code uses conditional compilation");
    if (!argv["no-cc_on-rewrite"]) {
      code = code
        .replace(/\/\*@cc_on/gi, "")
        .replace(/@cc_on/gi, "")
        .replace(/\/\*@/g, "\n")
        .replace(/@\*\//g, "\n");
      // "@if" processing requires m4 and cc, but don't require them otherwise
      if (/@if/.test(code)) {
        /*
                	"@if (cond) source" becomes "\n _boxjs_if(cond)" with JS
                	"\n _boxjs_if(cond)" becomes "\n #if (cond) \n source" with m4
                	"\n #if (cond) \n source" becomes "source" with the C preprocessor
                */
        code = code
          .replace(/@if\s*/gi, "\n_boxjs_if")
          .replace(/@elif\s*/gi, "\n_boxjs_elif")
          .replace(/@else/gi, "\n#else\n")
          .replace(/@end/gi, "\n#endif\n")
          .replace(/@/g, "_boxjs_at");
        // Require m4, cc
        if (lacksBinary("cc"))
          lib.kill(
            "You must install a C compiler (executable 'cc' not found)."
          );
        if (lacksBinary("m4")) lib.kill("You must install m4.");
        code =
          `
define(\`_boxjs_if', #if ($1)\n)
define(\`_boxjs_elif', #elif ($1)\n)
` + code;
        lib.info(
          "    Replacing @cc_on statements (use --no-cc_on-rewrite to skip)...",
          false
        );
        const outputM4 = child_process.spawnSync("m4", [], {
          input: code,
        });
        const outputCc = child_process.spawnSync(
          "cc",
          [
            "-E",
            "-P", // preprocess, don't compile
            "-xc", // read from stdin, lang: c
            "-D_boxjs_at_x86=1",
            "-D_boxjs_at_win16=0",
            "-D_boxjs_at_win32=1",
            "-D_boxjs_at_win64=1", // emulate Windows 32 bit
            "-D_boxjs_at_jscript=1",
            "-o-", // print to stdout
            "-", // read from stdin
          ],
          {
            input: outputM4.stdout.toString("utf8"),
          }
        );
        code = outputCc.stdout.toString("utf8");
      }
      code = code.replace(/_boxjs_at/g, "@");
    } else {
      lib.warn(
        `The code appears to contain conditional compilation statements.
If you run into unexpected results, try uncommenting lines that look like

    /*@cc_on
    <JavaScript code>
    @*/

`
      );
    }
  }

  if (!argv["no-rewrite"]) {
    try {
      lib.verbose("Rewriting code...", false);
      if (argv["dumb-concat-simplify"]) {
        lib.verbose(
          '    Simplifying "dumb" concatenations (remove --dumb-concat-simplify to skip)...',
          false
        );
        code = code.replace(/'[ \r\n]*\+[ \r\n]*'/gm, "");
        code = code.replace(/"[ \r\n]*\+[ \r\n]*"/gm, "");
      }

      let tree;
      try {
        //console.log("!!!! CODE FINAL !!!!");
        //console.log(code);
        //console.log("!!!! CODE FINAL !!!!");
        tree = acorn.parse(code, {
          ecmaVersion: "latest",
          allowReturnOutsideFunction: true, // used when rewriting function bodies
          plugins: {
            // enables acorn plugin needed by prototype rewrite
            JScriptMemberFunctionStatement: !argv["no-rewrite-prototype"],
          },
        });
      } catch (e) {
        if (useException) return 'throw("Parse Error")';
        lib.error("Couldn't parse with Acorn:");
        lib.error(e);
        lib.error("");
        if (filename.match(/jse$/)) {
          lib.error(
            `This appears to be a JSE (JScript.Encode) file.
Please compile the decoder and decode it first:

cc decoder.c -o decoder
./decoder ${filename} ${filename.replace(/jse$/, "js")}

`
          );
        } else {
          lib.error(
            // @@@ Emacs JS mode does not properly parse this block.
            //`This doesn't seem to be a JavaScript/WScript file.
            //If this is a JSE file (JScript.Encode), compile
            //decoder.c and run it on the file, like this:
            //
            //cc decoder.c -o decoder
            //./decoder ${filename} ${filename}.js
            //
            //`
            "Decode JSE. 'cc decoder.c -o decoder'. './decoder ${filename} ${filename}.js'"
          );
        }
        process.exit(4);
        return;
      }

      // Loop rewriting is looking for loops in the original unmodified code so
      // do this before any other modifications.
      if (argv["rewrite-loops"]) {
        lib.verbose("    Rewriting loops...", false);
        traverse(tree, loop_rewriter.rewriteSimpleWaitLoop);
        traverse(tree, loop_rewriter.rewriteSimpleControlLoop);
        traverse(tree, loop_rewriter.rewriteLongWhileLoop);
      }

      // Rewrite == checks so that comparisons of the current script name to
      // a hard coded script name always return true.
      if (argv["loose-script-name"] && code.includes("==")) {
        lib.verbose("    Rewriting == checks...", false);
        traverse(tree, equality_rewriter.rewriteScriptCheck);
      }

      if (argv.preprocess) {
        lib.verbose(
          `    Preprocessing with uglify-es v${
            require("uglify-es/package.json").version
          } (remove --preprocess to skip)...`,
          false
        );
        const unsafe = !!argv["unsafe-preprocess"];
        lib.debug("Unsafe preprocess: " + unsafe);
        const result = require("uglify-es").minify(code, {
          parse: {
            bare_returns: true, // used when rewriting function bodies
          },
          compress: {
            passes: 3,

            booleans: true,
            collapse_vars: true,
            comparisons: true,
            conditionals: true,
            dead_code: true,
            drop_console: false,
            evaluate: true,
            if_return: true,
            inline: true,
            join_vars: false, // readability
            keep_fargs: unsafe, // code may rely on Function.length
            keep_fnames: unsafe, // code may rely on Function.prototype.name
            keep_infinity: true, // readability
            loops: true,
            negate_iife: false, // readability
            properties: true,
            pure_getters: false, // many variables are proxies, which don't have pure getters
            /* If unsafe preprocessing is enabled, tell uglify-es that Math.* functions
             * have no side effects, and therefore can be removed if the result is
             * unused. Related issue: mishoo/UglifyJS2#2227
             */
            pure_funcs: unsafe
              ? // https://stackoverflow.com/a/10756976
                Object.getOwnPropertyNames(Math).map((key) => `Math.${key}`)
              : null,
            reduce_vars: true,
            /* Using sequences (a; b; c; -> a, b, c) provides some performance benefits
             * (https://github.com/CapacitorSet/box-js/commit/5031ba7114b60f1046e53b542c0e4810aad68a76#commitcomment-23243778),
             * but it makes code harder to read. Therefore, this behaviour is disabled.
             */
            sequences: false,
            toplevel: true,
            typeofs: false, // typeof foo == "undefined" -> foo === void 0: the former is more readable
            unsafe,
            unused: true,
          },
          output: {
            beautify: true,
            comments: true,
          },
        });
        if (result.error) {
          lib.error(
            "Couldn't preprocess with uglify-es: " +
              JSON.stringify(result.error)
          );
        } else {
          code = result.code;
        }
      }

      if (!argv["no-rewrite-prototype"]) {
        lib.verbose(
          "    Replacing `function A.prototype.B()` (use --no-rewrite-prototype to skip)...",
          false
        );
        traverse(tree, function (key, val) {
          if (!val) return;
          if (
            val.type !== "FunctionDeclaration" &&
            val.type !== "FunctionExpression"
          )
            return;
          if (!val.id) return;
          if (val.id.type !== "MemberExpression") return;
          r = require("./patches/prototype.js")(val);
          return r;
        });
      }

      if (!argv["no-hoist-prototype"]) {
        lib.verbose(
          "    Hoisting `function A.prototype.B()` (use --no-hoist-prototype to skip)...",
          false
        );
        hoist(tree);
      }

      if (argv["function-rewrite"]) {
        lib.verbose(
          "    Rewriting functions (remove --function-rewrite to skip)...",
          false
        );
        traverse(tree, function (key, val) {
          if (key !== "callee") return;
          if (val.autogenerated) return;
          switch (val.type) {
            case "MemberExpression":
              return require("./patches/this.js")(val.object, val);
            default:
              return require("./patches/nothis.js")(val);
          }
        });
      }

      if (!argv["no-typeof-rewrite"]) {
        lib.verbose(
          "    Rewriting typeof calls (use --no-typeof-rewrite to skip)...",
          false
        );
        traverse(tree, function (key, val) {
          if (!val) return;
          if (val.type !== "UnaryExpression") return;
          if (val.operator !== "typeof") return;
          if (val.autogenerated) return;
          return require("./patches/typeof.js")(val.argument);
        });
      }

      if (!argv["no-eval-rewrite"]) {
        lib.verbose(
          "    Rewriting eval calls (use --no-eval-rewrite to skip)...",
          false
        );
        traverse(tree, function (key, val) {
          if (!val) return;
          if (val.type !== "CallExpression") return;
          if (val.callee.type !== "Identifier") return;
          if (val.callee.name !== "eval") return;
          return require("./patches/eval.js")(val.arguments);
        });
      }

      if (!argv["no-catch-rewrite"]) {
        // JScript quirk
        lib.verbose(
          "    Rewriting try/catch statements (use --no-catch-rewrite to skip)...",
          false
        );
        traverse(tree, function (key, val) {
          if (!val) return;
          if (val.type !== "TryStatement") return;
          if (!val.handler) return;
          if (val.autogenerated) return;
          return require("./patches/catch.js")(val);
        });
      }
      code = escodegen.generate(tree);
      //console.log("!!!! CODE !!!!");
      //console.log(code);

      // The modifications may have resulted in more concatenations, eg. "a" + ("foo", "b") + "c" -> "a" + "b" + "c"
      if (argv["dumb-concat-simplify"]) {
        lib.verbose(
          '    Simplifying "dumb" concatenations (remove --dumb-concat-simplify to skip)...',
          false
        );
        code = code.replace(/'[ \r\n]*\+[ \r\n]*'/gm, "");
        code = code.replace(/"[ \r\n]*\+[ \r\n]*"/gm, "");
      }

      lib.verbose("Rewritten successfully.", false);
    } catch (e) {
      if (argv["ignore-rewrite-errors"]) {
        lib.warning("Code rewriting failed. Analyzing original sample.");
      } else {
        console.log("An error occurred during rewriting:");
        console.log(e);
        process.exit(3);
      }
    }
  }

  return code;
}

// Extract the actual code to analyze from conditional JScript
// comments if needed.
if (false && argv["extract-conditional-code"]) {
  code = extractCode(code);
}

// Track if we are throttling large/frequent file writes.
if (argv["throttle-writes"]) {
  lib.throttleFileWrites(true);
}

// Track if we are throttling frequent command executions.
if (argv["throttle-commands"]) {
  lib.throttleCommands(true);
}

// Rewrite the code if needed.
code = rewrite(code);

// prepend extra JS containing mock objects in the given file(s) onto the code
if (argv["prepended-code"]) {
  var prependedCode = "";
  var files = [];

  // get all the files in the directory and sort them alphebetically
  var isDir = false;
  try {
    isDir = fs.lstatSync(argv["prepended-code"]).isDirectory();
  } catch (e) {}
  if (isDir) {
    dir_files = fs.readdirSync(argv["prepended-code"]);
    for (var i = 0; i < dir_files.length; i++) {
      files.push(path.join(argv["prepended-code"], dir_files[i]));
    }

    // make sure we're adding mock code in the right order
    files.sort();
  } else {
    // Use default boilerplate code?
    if (argv["prepended-code"] == "default") {
      const defaultBP = __dirname + "/boilerplate.js";
      files.push(defaultBP);
    } else {
      files.push(argv["prepended-code"]);
    }
  }

  for (var i = 0; i < files.length; i++) {
    prependedCode += fs.readFileSync(files[i], "utf-8") + "\n\n";
  }

  // Add in require() override code so that stubbed versions of some
  // packages can be loaded via require().
  const requireOverride = fs.readFileSync(
    path.join(__dirname, "require_override.js"),
    "utf8"
  );
  code =
    "const _origRequire = require;\n{" +
    requireOverride +
    "\n\n" +
    code +
    "\n}";

  // Add in prepended code.
  code = prependedCode + "\n\n" + code;
}

// prepend patch code, unless it is already there.
if (!code.includes("let __PATCH_CODE_ADDED__ = true;")) {
  code = fs.readFileSync(path.join(__dirname, "patch.js"), "utf8") + code;
} else {
  console.log("Patch code already added.");
}

// append more code
code += "\n\n" + fs.readFileSync(path.join(__dirname, "appended-code.js"));

lib.logJS(code);

Array.prototype.Count = function () {
  return this.length;
};

// Set the fake scripting engine to report.
var fakeEngineShort = "wscript.exe";
if (argv["fake-script-engine"]) {
  fakeEngineShort = argv["fake-script-engine"];
}
var fakeEngineFull = "C:\\WINDOWS\\system32\\" + fakeEngineShort;

// Fake command line options can be set with the --fake-cl-args
// option. "''" is an empty string argument.
var commandLineArgs = [];
if (argv["fake-cl-args"]) {
  const tmpArgs = argv["fake-cl-args"].split(",");
  for (var arg of tmpArgs) {
    if (arg == "''") arg = "";
    commandLineArgs.push(arg);
  }
}

// Fake sample file name can be set with the --fake-sample-name option.
var sampleName = "CURRENT_SCRIPT_IN_FAKED_DIR.js";
var sampleFullName =
  "C:Users\\Sysop12\\AppData\\Roaming\\Microsoft\\Templates\\" + sampleName;
if (argv["fake-sample-name"]) {
  // Sample name with full path?
  var dirChar = undefined;
  if (argv["fake-sample-name"].indexOf("\\") >= 0) {
    dirChar = "\\";
  }
  if (argv["fake-sample-name"].indexOf("/") >= 0) {
    dirChar = "/";
  }
  if (dirChar) {
    // Break out the immediate sample name and full name.
    sampleName = argv["fake-sample-name"].slice(
      argv["fake-sample-name"].lastIndexOf(dirChar) + 1
    );
    sampleFullName = argv["fake-sample-name"];
  } else {
    sampleName = argv["fake-sample-name"];
    sampleFullName =
      "C:Users\\Sysop12\\AppData\\Roaming\\Microsoft\\Templates\\" + sampleName;
  }
  lib.logIOC(
    "Sample Name",
    { "sample-name": sampleName, "sample-name-full": sampleFullName },
    "Using fake sample file name " + sampleFullName + " when analyzing."
  );
} else if (argv["real-script-name"]) {
  sampleName = path.basename(filename);
  sampleFullName = filename;
  lib.logIOC(
    "Sample Name",
    { "sample-name": sampleName, "sample-name-full": sampleFullName },
    "Using real sample file name " + sampleFullName + " when analyzing."
  );
} else {
  lib.logIOC(
    "Sample Name",
    { "sample-name": sampleName, "sample-name-full": sampleFullName },
    "Using standard fake sample file name " +
      sampleFullName +
      " when analyzing."
  );
}

// Fake up the WScript object for Windows JScript.
var wscript_proxy = new Proxy(
  {
    arguments: new Proxy((n) => commandLineArgs[n], {
      get: function (target, name) {
        name = name.toString().toLowerCase();
        switch (name) {
          case "unnamed":
            return commandLineArgs;
          case "length":
            return commandLineArgs.length;
          case "showUsage":
            return {
              typeof: "unknown",
            };
          case "named":
            return commandLineArgs;
          default:
            return new Proxy(target[name], {
              get: (target, name) =>
                name.toLowerCase() === "typeof" ? "unknown" : target[name],
            });
        }
      },
    }),
    buildversion: "1234",
    interactive: true,
    fullname: fakeEngineFull,
    name: fakeEngineShort,
    path: "C:\\TestFolder\\",
    scriptfullname: sampleFullName,
    scriptname: sampleName,
    timeout: 0,
    quit: function () {
      lib.logIOC(
        "WScript",
        "Quit()",
        "The sample explicitly called WScript.Quit()."
      );
      //console.trace()
      if (!argv["ignore-wscript-quit"] || lib.doWscriptQuit()) {
        process.exit(0);
      }
    },
    get stderr() {
      lib.error("WScript.StdErr not implemented");
    },
    get stdin() {
      lib.error("WScript.StdIn not implemented");
    },
    get stdout() {
      lib.error("WScript.StdOut not implemented");
    },
    version: "5.8",
    get connectobject() {
      lib.error("WScript.ConnectObject not implemented");
    },
    createobject: ActiveXObject,
    get disconnectobject() {
      lib.error("WScript.DisconnectObject not implemented");
    },
    echo() {},
    get getobject() {
      lib.error("WScript.GetObject not implemented");
    },
    // Note that Sleep() is implemented in patch.js because it requires
    // access to the variable _globalTimeOffset, which belongs to the script
    // and not to the emulator.
    [Symbol.toPrimitive]: () => "Windows Script Host",
    tostring: "Windows Script Host",
  },
  {
    get(target, prop) {
      // For whatever reasons, WScript.* properties are case insensitive.
      if (typeof prop === "string") prop = prop.toLowerCase();
      return target[prop];
    },
  }
);

const sandbox = {
  saveAs: function (data, fname) {
    // TODO: If Blob need to extract the data.
    lib.writeFile(fname, data);
  },
  setInterval: function (func, time) {
    // For malware analysis, we want to execute the callback
    // but need to handle cases where the callback references the interval ID
    lib.verbose("setInterval called, scheduling callback execution");
    const intervalId = Math.floor(Math.random() * 1000);

    // Use setTimeout to allow the interval ID to be assigned first
    setTimeout(() => {
      if (typeof func === "function") {
        try {
          func();
        } catch (e) {
          lib.verbose("setInterval callback error: " + e.message);
        }
      } else if (typeof func === "string") {
        try {
          eval(func);
        } catch (e) {
          lib.verbose("setInterval string callback error: " + e.message);
        }
      }
    }, 0);

    return intervalId;
  },
  clearInterval: function (id) {
    // No-op since we execute callbacks immediately
    lib.verbose("clearInterval called with id: " + id);
  },
  setTimeout: function (func, time) {
    // The interval should be an int, so do a basic check for int.
    if (typeof time !== "number" || time == null) {
      throw "time is not a number.";
    }

    // Just call the function immediately, no waiting.
    if (typeof func === "function") {
      func();
    } else {
      throw "Callback must be a function";
    }
  },
  logJS: lib.logJS,
  logIOC: lib.logIOC,
  logUrl: lib.logUrl,
  ActiveXObject,
  dom,
  window: {
    addEventListener: function (event, callback, useCapture) {
      lib.verbose(`window.addEventListener('${event}') called`);
      lib.logIOC(
        "window.addEventListener",
        { event, useCapture },
        `Script added event listener for '${event}' event`
      );
      // Mock implementation - just log the call
    },
    URL: {
      createObjectURL: function (blob) {
        const url =
          "blob:fake-url-" + Math.random().toString(36).substring(2, 15);
        lib.logIOC(
          "window.URL.createObjectURL",
          { url },
          `Script created object URL ${url}`
        );
        return url;
      },
      revokeObjectURL: function (url) {
        lib.verbose(`window.URL.revokeObjectURL called for ${url}`);
      },
    },
    atob: function (str) {
      // Use the global atob function
      return sandbox.atob(str);
    },
    moveTo: function (x, y) {
      lib.verbose(`window.moveTo(${x}, ${y}) called`);
      lib.logIOC(
        "window.moveTo",
        { x, y },
        `Script attempted to move window to position (${x}, ${y})`
      );
    },
    resizeTo: function (width, height) {
      lib.verbose(`window.resizeTo(${width}, ${height}) called`);
      lib.logIOC(
        "window.resizeTo",
        { width, height },
        `Script attempted to resize window to ${width}x${height}`
      );
    },
    get location() {
      // Return the global location object so window.location.href works
      return sandbox.location;
    },
    set location(value) {
      // Allow setting window.location to a URL (like window.location = "http://...")
      lib.info(`Script is setting window.location to ${value}`);
      lib.logIOC(
        "window.location.set",
        { value },
        `Script is setting window.location to ${value}`
      );
      lib.logUrl("window.location", value);
      if (sandbox.location) {
        sandbox.location.href = value;
      }
    },
  },
  alert: (x) => {
    lib.info("Displayed alert(" + x + ")");
  },
  InstallProduct: (x) => {
    lib.logUrl("InstallProduct", x);
  },
  console: {
    //log: (x) => console.log(x),
    //log: (x) => lib.info("Script output: " + JSON.stringify(x)),
    log: function (x) {
      lib.info("Script output: " + x);
      // Check for our monitoring messages
      if (typeof x === "string" && x.includes("DEOBFUSCATED URL DETECTED:")) {
        const url = x.replace("DEOBFUSCATED URL DETECTED: ", "");
        lib.logUrl("DeobfuscatedURL", url);
        lib.logIOC(
          "DeobfuscatedURL",
          { url: url },
          "Script deobfuscated and attempted to navigate to URL: " + url
        );
      } else if (
        typeof x === "string" &&
        x.includes("String.fromCharCode deobfuscation detected:")
      ) {
        const decodedContent = x.replace(
          "String.fromCharCode deobfuscation detected: ",
          ""
        );
        lib.logIOC(
          "String.fromCharCode",
          { decoded: decodedContent },
          "Script used String.fromCharCode for deobfuscation"
        );
      }
      // Log evals of JS downloaded from a C2 if needed.
      if (x === "EXECUTED DOWNLOADED PAYLOAD") {
        lib.logIOC(
          "PayloadExec",
          x,
          "The script executed JS returned from a C2 server."
        );
      }
    },
    error: function (x) {
      lib.info("Script error output: " + x);
      // Add error output to IOCs for analysis
      lib.logIOC(
        "console.error",
        { message: x },
        "Script logged an error message"
      );
    },
    warn: function (x) {
      lib.info("Script warning output: " + x);
      // Add warning output to IOCs for analysis
      lib.logIOC(
        "console.warn",
        { message: x },
        "Script logged a warning message"
      );
    },
    clear: function () {},
  },
  Enumerator: require("./emulator/Enumerator"),
  GetObject: require("./emulator/WMI").GetObject,
  JSON,
  String: String,
  Object: Object,
  Function: Function,
  Array: Array,
  Date: Date,
  location: new Proxy(
    {
      href: "about:blank",
      hostname: "localhost",
      pathname: "/",
      protocol: "http:",
      toString: () => this.href,
    },
    {
      get(target, name) {
        const locationGetValue = target[name];
        if (name === "href" || name === "toString") {
          lib.verbose(
            `location.${name} accessed, returning: ${locationGetValue}`
          );
        }
        return target[name];
      },
      set(target, name, value) {
        lib.info(`Script is setting location.${name} to ${value}`);
        lib.logIOC(
          "Location.set",
          { property: name, value },
          `Script is setting window.location.${name} to ${value}`
        );
        lib.logUrl("Location", value);
        target[name] = value;
        if (name === "href") {
          lib.info(`Script is navigating to ${value}`);
        }
        return true;
      },
    }
  ),
  parse: (x) => {},
  rewrite: (code, log = false) => {
    const ret = rewrite(code, (useException = true));
    if (log) lib.logJS(ret);
    return ret;
  },
  ScriptEngine: () => {
    const type = "JScript"; // or "JavaScript", or "VBScript"
    // lib.warn(`Emulating a ${type} engine (in ScriptEngine)`);
    return type;
  },
  _typeof: (x) => (x.typeof ? x.typeof : typeof x),
  WScript: wscript_proxy,
  WSH: wscript_proxy,
  decodeURIComponent: (x) => {
    out = decodeURIComponent(x);
    if (argv["decode-uri-component-as-ioc"]) {
      if (out !== null && out !== x && out !== "" && out !== "") {
        lib.logIOC("decodeURIComponent", { out }, `decodeURIComponent Output`);
      }
    }
    return out;
  },
  unescape: (x) => {
    out = unescape(x);
    if (argv["decode-unescape-as-ioc"]) {
      if (out !== null && out !== x && out !== "" && out !== "") {
        lib.logIOC("unescape", { out }, `unescape Output`);
      }
    }
    return out;
  },
  decodeURI: (x) => {
    out = decodeURI(x);
    if (argv["decode-uri-as-ioc"]) {
      if (out !== null && out !== x && out !== "" && out !== "") {
        lib.logIOC("decodeURI", { out }, `decodeURI Output`);
      }
    }
    return out;
  },
  self: {},
  require,
  atob: function (str) {
    try {
      // Make sure we have a valid string and handle all edge cases
      if (str === undefined || str === null) {
        lib.error("atob called with invalid input: " + typeof str);
        return "";
      }

      // Ensure we're working with a string
      str = String(str);

      try {
        // Create buffer directly from base64 string
        const buffer = Buffer.from(str, "base64");

        // Check if content is printable
        const isPrintable = /^[\x20-\x7E\t\r\n]*$/.test(
          buffer.toString("binary")
        );

        // Create the output filename using a hash of the content
        const fs = require("fs");
        const path = require("path");
        const crypto = require("crypto");

        // Create a SHA256 hash of the content for the filename
        const hash = crypto.createHash("sha256").update(buffer).digest("hex");
        const filename = `${hash}.bin`;

        // Get the results directory directly from process.argv[3]
        // This is the actual .results directory that box-js creates
        const resultsDir = process.argv[3] || "./";

        // Ensure results directory exists
        if (!fs.existsSync(resultsDir)) {
          fs.mkdirSync(resultsDir, { recursive: true });
        }

        // Create absolute file path
        const filepath = path.resolve(path.join(resultsDir, filename));

        // Always save the raw buffer to a file
        fs.writeFileSync(filepath, buffer);

        // Store the absolute filepath in the sandbox itself as a property
        // This makes it accessible to the click handler
        sandbox.lastDecodedFile = filepath;
        global.lastDecodedFile = filepath; // Also store in global for redundancy

        // For display in logs
        const decoded = buffer.toString("binary");

        if (isPrintable) {
          // For printable content, truncate it to avoid dumping large content in logs
          const displayContent =
            decoded.length > 100 ? decoded.substring(0, 100) + "..." : decoded;
          lib.logIOC(
            "atob",
            {
              input_length: str.length,
              output_length: buffer.length,
              output_sample: displayContent,
              file: filepath,
            },
            `atob Decoded Text Content (saved to ${filename})`
          );
        } else {
          // For binary content, don't include the content in the log
          lib.logIOC(
            "atob",
            {
              input_length: str.length,
              output_length: buffer.length,
              content_type: "binary",
              file: filepath,
            },
            `atob Decoded Binary Content (saved to ${filename})`
          );
        }

        lib.info(`Saved atob decoded content to ${filepath}`);

        // Return the result as a binary string
        return decoded;
      } catch (bufferError) {
        lib.error(`Buffer error in atob: ${bufferError.message}`);
        return ""; // Return empty string on error
      }
    } catch (e) {
      lib.error(`Fatal error in atob: ${e.message}`);
      return "";
    }
  },
  document: {
    write: function (content) {
      // Log the full content to IOC but use a truncated version for the info message
      lib.logIOC("document.write", { content }, "Script wrote to document");
      const truncatedContent =
        content && content.length > 50
          ? content.substring(0, 50) + "... [content truncated]"
          : content;
      lib.info(
        `document.write() called (length: ${
          content ? content.length : 0
        } bytes)`
      );

      // Parse content for script tags and add JavaScript code to execution queue
      if (content && typeof content === "string") {
        const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptRegex.exec(content)) !== null) {
          const scriptContent = match[1];
          if (scriptContent && scriptContent.trim()) {
            lib.info(
              `Found JavaScript in document.write content (${scriptContent.length} bytes)`
            );
            // Add to dynamically written scripts array for later execution
            if (typeof sandbox.dynamicScripts === "undefined") {
              sandbox.dynamicScripts = [];
            }
            sandbox.dynamicScripts.push(scriptContent);
          }
        }
      }
    },
    writeln: function (content) {
      // Log the full content to IOC but use a truncated version for the info message
      lib.logIOC("document.writeln", { content }, "Script wrote to document");
      const truncatedContent =
        content && content.length > 50
          ? content.substring(0, 50) + "... [content truncated]"
          : content;
      lib.info(
        `document.writeln() called (length: ${
          content ? content.length : 0
        } bytes)`
      );

      // Parse content for script tags and add JavaScript code to execution queue
      if (content && typeof content === "string") {
        const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptRegex.exec(content)) !== null) {
          const scriptContent = match[1];
          if (scriptContent && scriptContent.trim()) {
            lib.info(
              `Found JavaScript in document.writeln content (${scriptContent.length} bytes)`
            );
            // Add to dynamically written scripts array for later execution
            if (typeof sandbox.dynamicScripts === "undefined") {
              sandbox.dynamicScripts = [];
            }
            sandbox.dynamicScripts.push(scriptContent);
          }
        }
      }
    },
    createElement: function (tag) {
      lib.verbose(`document.createElement(${tag}) called`);
      return {
        tagName: tag.toUpperCase(),
        src: "",
        href: "",
        text: "",
        style: {},
        download: "",
        async: false,
        appendChild: function () {},
        parentNode: null,
        setAttribute: function (name, value) {
          lib.verbose(
            `setAttribute(${name}, ${value}) called on ${tag} element`
          );
          this[name] = value;
          // Handle script src - only log as IOC, not in URLs
          if (tag.toLowerCase() === "script" && name === "src") {
            lib.logIOC(
              "ScriptSrc",
              { url: value, tag: tag },
              `Script element loads external JavaScript from: ${value}`
            );
          }
          // Handle other URLs - log both as URL and IOC
          else if (
            (tag.toLowerCase() === "link" && name === "href") ||
            (tag.toLowerCase() === "a" && name === "href")
          ) {
            lib.logUrl(`${tag}.${name}`, value);
            if (tag.toLowerCase() === "link" && name === "href") {
              lib.logIOC(
                "LinkHref",
                { url: value, tag: tag },
                `Link element references external resource: ${value}`
              );
            } else if (tag.toLowerCase() === "a" && name === "href") {
              lib.logIOC(
                "AnchorHref",
                { url: value, tag: tag },
                `Anchor element links to: ${value}`
              );
            }
          }
          if (tag.toLowerCase() === "a" && name === "download") {
            lib.logIOC(
              "FileDownload",
              { filename: value },
              `Script attempted to download file: ${value}`
            );
          }
        },
        click: function () {
          if (
            tag.toLowerCase() === "a" &&
            this.download &&
            argv["fake-download"]
          ) {
            lib.verbose(
              `<a> tag clicked with download attribute: ${this.download}`
            );

            // Get the content to save - try to find the most recent atob decoded content
            let contentToSave = "";
            let fileData = null;

            // Get the results directory directly from process.argv[3]
            // This is the actual .results directory that box-js creates
            const outputDir = process.argv[3] || "./";

            // Try to use the last decoded content from atob if available
            if (
              sandbox.lastDecodedFile &&
              typeof sandbox.lastDecodedFile === "string"
            ) {
              try {
                lib.verbose(
                  `Using lastDecodedFile: ${sandbox.lastDecodedFile}`
                );
                fileData = fs.readFileSync(sandbox.lastDecodedFile);
                contentToSave = fileData;
              } catch (e) {
                lib.error(`Error reading lastDecodedFile: ${e.message}`);
              }
            } else if (
              global.lastDecodedFile &&
              typeof global.lastDecodedFile === "string"
            ) {
              try {
                lib.verbose(
                  `Using global.lastDecodedFile: ${global.lastDecodedFile}`
                );
                fileData = fs.readFileSync(global.lastDecodedFile);
                contentToSave = fileData;
              } catch (e) {
                lib.error(`Error reading global.lastDecodedFile: ${e.message}`);
              }
            }

            // If we have content to save
            if (contentToSave) {
              const fs = require("fs");
              const path = require("path");
              const crypto = require("crypto");

              // Create a hash of the content for the filename
              const hash = crypto
                .createHash("sha256")
                .update(contentToSave)
                .digest("hex");

              // Use the specified download filename but add extension if missing
              let downloadFilename = this.download || "download.bin";

              // Save the file to the output directory with the download name
              const filepath = path.resolve(
                path.join(outputDir, `${hash}_${downloadFilename}`)
              );

              // Ensure file gets written
              try {
                fs.writeFileSync(filepath, contentToSave);
                lib.info(`Saved downloaded file to ${filepath}`);

                // Log the download as an IOC
                lib.logIOC(
                  "download",
                  {
                    filename: downloadFilename,
                    file: filepath,
                    hash: hash,
                    size: contentToSave.length,
                  },
                  `File downloaded: ${downloadFilename} (${hash})`
                );
              } catch (e) {
                lib.error(`Error saving downloaded file: ${e.message}`);
              }
            } else {
              lib.error(
                `No content available to save for download: ${this.download}`
              );
            }
          }
        },
        getAttribute: function (name) {
          lib.verbose(`getAttribute(${name}) called on ${tag} element`);
          return this[name];
        },
      };
    },
    createElementNS: function (namespace, tag) {
      lib.verbose(`document.createElementNS(${namespace}, ${tag}) called`);
      // Return the same type of object as createElement
      return this.createElement(tag);
    },
    getElementById: function (id) {
      lib.verbose(`document.getElementById(${id}) called`);
      return {
        innerHTML: "",
        value: "",
        href: "",
        style: {
          display: "",
        },
        appendChild: function () {},
      };
    },
    getElementsByTagName: function (tagName) {
      lib.verbose(`document.getElementsByTagName(${tagName}) called`);
      // Return a mock element array with parentNode for script injection patterns
      const mockElement = {
        tagName: tagName.toUpperCase(),
        parentNode: {
          insertBefore: function (newNode, referenceNode) {
            lib.verbose(
              `parentNode.insertBefore() called - inserting ${
                newNode.tagName || "element"
              } before ${referenceNode.tagName || "element"}`
            );
            if (newNode.src) {
              // For script elements, only log as IOC, not URL
              if (
                newNode.tagName &&
                newNode.tagName.toLowerCase() === "script"
              ) {
                lib.logIOC(
                  "ScriptSrc",
                  { url: newNode.src, tag: newNode.tagName },
                  `Script element loads external JavaScript from: ${newNode.src}`
                );
              } else {
                lib.logUrl(`${newNode.tagName || "element"}.src`, newNode.src);
              }
            }
            return newNode;
          },
          appendChild: function (newNode) {
            lib.verbose(
              `parentNode.appendChild() called - appending ${
                newNode.tagName || "element"
              }`
            );
            if (newNode.src) {
              // For script elements, only log as IOC, not URL
              if (
                newNode.tagName &&
                newNode.tagName.toLowerCase() === "script"
              ) {
                lib.logIOC(
                  "ScriptSrc",
                  { url: newNode.src, tag: newNode.tagName },
                  `Script element loads external JavaScript from: ${newNode.src}`
                );
              } else {
                lib.logUrl(`${newNode.tagName || "element"}.src`, newNode.src);
              }
            }
            return newNode;
          },
        },
      };
      return [mockElement];
    },
    addEventListener: function (event, callback, useCapture) {
      lib.verbose(`document.addEventListener('${event}') called`);
      lib.logIOC(
        "document.addEventListener",
        { event },
        `Script added '${event}' event listener to document`
      );

      // Store callback for later execution
      if (typeof sandbox.listenerCallbacks === "undefined") {
        sandbox.listenerCallbacks = [];
      }
      sandbox.listenerCallbacks.push(callback);

      // If it's a DOMContentLoaded or load event, execute immediately
      if (event === "DOMContentLoaded" || event === "load") {
        try {
          callback({ type: event });
          lib.verbose(`Executed '${event}' event handler immediately`);
        } catch (e) {
          lib.error(`Error executing '${event}' handler: ${e.message}`);
        }
      }
    },
    removeEventListener: function (event, callback, useCapture) {
      lib.verbose(`document.removeEventListener('${event}') called`);
    },
    documentElement: {
      appendChild: function (element) {
        lib.verbose("document.documentElement.appendChild() called");
      },
    },
    body: {
      innerHTML: "",
      appendChild: function () {},
      onload: function () {
        lib.verbose("document.body.onload() called");
        return true;
      },
      addEventListener: function (event, callback, useCapture) {
        lib.verbose(`document.body.addEventListener('${event}') called`);
        lib.logIOC(
          "document.body.addEventListener",
          { event },
          `Script added '${event}' event listener to document.body`
        );

        // Store callback for later execution
        if (typeof sandbox.listenerCallbacks === "undefined") {
          sandbox.listenerCallbacks = [];
        }
        sandbox.listenerCallbacks.push(callback);

        // If it's a load event, execute immediately
        if (event === "load") {
          try {
            callback({ type: event });
            lib.verbose(`Executed body '${event}' event handler immediately`);
          } catch (e) {
            lib.error(`Error executing body '${event}' handler: ${e.message}`);
          }
        }
      },
      removeEventListener: function (event, callback, useCapture) {
        lib.verbose(`document.body.removeEventListener('${event}') called`);
      },
    },
    location: new Proxy(
      {
        href: "about:blank",
        hostname: "localhost",
        pathname: "/",
        protocol: "http:",
        toString: () => this.href,
      },
      {
        get(target, name) {
          const docLocationGetValue = target[name];
          lib.logUrl("document.location.get", docLocationGetValue);
          return target[name];
        },
        set(target, name, value) {
          lib.logIOC(
            "document.location.set",
            { property: name, value },
            `Script is setting document.location.${name} to ${value}`
          );
          lib.logUrl("document.location", value);
          target[name] = value;
          if (name === "href") {
            lib.info(`Script is navigating to ${value}`);
          }
          return true;
        },
      }
    ),
    cookie: "",
    open: function () {
      lib.verbose(`document.open() called`);
      lib.logIOC("document.open", {}, "Script called document.open()");
    },
    close: function () {
      lib.verbose(`document.close() called`);
      lib.logIOC("document.close", {}, "Script called document.close()");
    },
  },
  ArrayBuffer: function (length) {
    this.byteLength = length;
    lib.verbose(`ArrayBuffer created with length ${length}`);
  },
  Uint8Array: function (buffer) {
    if (typeof buffer === "number") {
      this.length = buffer;
      this.buffer = new ArrayBuffer(buffer);
    } else {
      this.buffer = buffer;
      this.length = buffer.byteLength;
    }

    for (let i = 0; i < this.length; i++) {
      this[i] = 0;
    }

    this.set = function (array, offset) {
      offset = offset || 0;
      for (let i = 0; i < array.length; i++) {
        this[offset + i] = array[i];
      }
    };

    lib.verbose(`Uint8Array created with length ${this.length}`);
  },
  Blob: function (parts, options) {
    this.parts = parts || [];
    this.options = options || {};
    lib.logIOC(
      "Blob",
      { parts: JSON.stringify(parts), options },
      `Script created a new Blob`
    );
  },
  URL: {
    createObjectURL: function (blob) {
      const url =
        "blob:fake-url-" + Math.random().toString(36).substring(2, 15);
      lib.logIOC(
        "URL.createObjectURL",
        { url },
        `Script created object URL ${url}`
      );
      return url;
    },
    revokeObjectURL: function (url) {
      lib.verbose(`URL.revokeObjectURL called for ${url}`);
    },
  },
  AudioContext: function () {
    // Mock AudioContext for browser-based malware
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.destination = {};
    this.listener = {};
    this.state = "running";

    // Mock methods
    this.suspend = function () {
      lib.verbose("AudioContext.suspend() called");
      this.state = "suspended";
      return Promise.resolve();
    };

    this.resume = function () {
      lib.verbose("AudioContext.resume() called");
      this.state = "running";
      return Promise.resolve();
    };

    this.close = function () {
      lib.verbose("AudioContext.close() called");
      this.state = "closed";
      return Promise.resolve();
    };

    this.createOscillator = function () {
      lib.verbose("AudioContext.createOscillator() called");
      return {
        frequency: { value: 440 },
        type: "sine",
        start: function () {},
        stop: function () {},
        connect: function () {},
      };
    };

    this.createGain = function () {
      lib.verbose("AudioContext.createGain() called");
      return {
        gain: { value: 1 },
        connect: function () {},
      };
    };

    this.createBuffer = function (channels, length, sampleRate) {
      lib.verbose(
        `AudioContext.createBuffer(${channels}, ${length}, ${sampleRate}) called`
      );
      return {
        numberOfChannels: channels,
        length: length,
        sampleRate: sampleRate,
        getChannelData: function (channel) {
          return new Float32Array(length);
        },
      };
    };

    this.decodeAudioData = function (audioData) {
      lib.verbose("AudioContext.decodeAudioData() called");
      return Promise.resolve(this.createBuffer(2, 44100, 44100));
    };

    lib.logIOC(
      "AudioContext",
      { sampleRate: this.sampleRate },
      "Script created AudioContext"
    );
    lib.verbose(`AudioContext created with sampleRate: ${this.sampleRate}`);
  },
  webkitAudioContext: function () {
    // Some scripts might use webkitAudioContext prefix
    lib.verbose("webkitAudioContext created (redirecting to AudioContext)");
    return new sandbox.AudioContext();
  },
  structuredClone: function (value) {
    // Polyfill for structuredClone in vm2 sandbox
    // This provides basic deep cloning functionality and triggers getters
    lib.verbose("structuredClone called with value type: " + typeof value);

    if (value === null || typeof value !== "object") {
      return value;
    }
    if (value instanceof Date) {
      return new Date(value.getTime());
    }
    if (value instanceof Array) {
      return value.map((item) => sandbox.structuredClone(item));
    }
    if (typeof value === "object") {
      const cloned = {};
      // Get all property names including non-enumerable ones
      const allProps = Object.getOwnPropertyNames(value);
      lib.verbose(
        "structuredClone: Processing object with properties: " +
          allProps.join(", ")
      );

      for (const key of allProps) {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          lib.verbose(
            `structuredClone: Processing property ${key}, has getter: ${!!(
              descriptor && descriptor.get
            )}`
          );

          if (descriptor && descriptor.get) {
            // For getter properties, access them to trigger execution
            lib.verbose(`structuredClone: Accessing getter property ${key}`);
            const propValue = value[key];
            lib.verbose(
              `structuredClone: Getter ${key} returned: ${typeof propValue}`
            );
            cloned[key] = sandbox.structuredClone(propValue);
          } else if (descriptor && descriptor.value !== undefined) {
            // For regular properties
            cloned[key] = sandbox.structuredClone(descriptor.value);
          }
        } catch (e) {
          lib.verbose(
            `structuredClone: Failed to access property ${key}: ${e.message}`
          );
        }
      }

      // Also iterate over enumerable properties to catch anything we missed
      for (const key in value) {
        if (value.hasOwnProperty(key) && !(key in cloned)) {
          try {
            lib.verbose(
              `structuredClone: Processing enumerable property ${key}`
            );
            cloned[key] = sandbox.structuredClone(value[key]);
          } catch (e) {
            lib.verbose(
              `structuredClone: Failed to clone property ${key}: ${e.message}`
            );
          }
        }
      }

      lib.verbose("structuredClone: Finished cloning object");
      return cloned;
    }
    return value;
  },
  close: function () {
    lib.verbose("close() called - redirecting to document.close()");
    lib.logIOC("close", {}, "Script called close() function");
    // This is likely meant to be document.close()
    if (sandbox.document && sandbox.document.close) {
      return sandbox.document.close();
    }
  },
  moveTo: function (x, y) {
    lib.verbose(`moveTo(${x}, ${y}) called`);
    lib.logIOC(
      "moveTo",
      { x, y },
      `Script attempted to move window to position (${x}, ${y})`
    );
  },
  resizeTo: function (width, height) {
    lib.verbose(`resizeTo(${width}, ${height}) called`);
    lib.logIOC(
      "resizeTo",
      { width, height },
      `Script attempted to resize window to ${width}x${height}`
    );
  },
  String: {
    fromCharCode: function (...args) {
      const result = String.fromCharCode(...args);
      // Log if we're converting multiple characters (likely deobfuscation)
      if (args.length > 3 || result.length > 3) {
        lib.verbose(
          `String.fromCharCode called with ${args.length} arguments, result: ${result}`
        );
        lib.logIOC(
          "String.fromCharCode",
          { args: args.slice(0, 10), result: result.substring(0, 100) }, // Truncate for readability
          `Script used String.fromCharCode for potential deobfuscation`
        );
      }
      return result;
    },
  },
};

// See https://github.com/nodejs/node/issues/8071#issuecomment-240259088
// It will prevent console.log from calling the "inspect" property,
// which can be kinda messy with Proxies
require("util").inspect.defaultOptions.customInspect = false;

if (argv["dangerous-vm"]) {
  lib.verbose("Analyzing with native vm module (dangerous!)");
  const vm = require("vm");
  //console.log(code);
  vm.runInNewContext(code, sandbox, {
    displayErrors: true,
    // lineOffset: -fs.readFileSync(path.join(__dirname, "patch.js"), "utf8").split("\n").length,
    filename: "sample.js",
  });
} else {
  lib.debug("Analyzing with vm2 v" + require("vm2/package.json").version);

  const vm = new VM({
    timeout: (argv.timeout || 10) * 1000,
    sandbox,
  });

  // Fake cscript.exe style ReferenceError messages.
  code =
    'ReferenceError.prototype.toString = function() { return "[object Error]";};\n\n' +
    code;
  // Fake up Object.toString not being defined in cscript.exe.
  //code = "Object.prototype.toString = undefined;\n\n" + code;

  // Run the document.body.onload() function if defined to simulate
  // document loading.
  code +=
    "\nif ((typeof(document) != 'undefined') && (typeof(document.body) != 'undefined') && (typeof(document.body.onload) != 'undefined')) document.body.onload();\n";

  // Run all of the collected onclick handler code snippets pulled
  // from dynamically added HTML.
  code +=
    "\nif (typeof dynamicOnclickHandlers === 'undefined') { var dynamicOnclickHandlers = []; }\nfor (const handler of dynamicOnclickHandlers) {\ntry {\neval(handler);\n}\ncatch (e) {\nconsole.log(e.message);\nconsole.log(handler);\n}\n}\n";

  // Run all of the collected event listener callback functions 1
  // more time after the original code has executed in case the DOM
  // has changed and a callback changes its behavior based on the
  // DOM contents.
  code +=
    "\nif (typeof listenerCallbacks === 'undefined') { var listenerCallbacks = []; }\nif (typeof dummyEvent === 'undefined') { var dummyEvent = {}; }\nfor (const func of listenerCallbacks) {\nfunc(dummyEvent);\n}\n";
  //console.log(code);

  try {
    vm.run(code);

    // After the main script execution, check for and execute dynamic scripts
    if (sandbox.dynamicScripts && sandbox.dynamicScripts.length > 0) {
      lib.info(
        `Executing ${sandbox.dynamicScripts.length} dynamic script(s) from document.write/writeln`
      );
      for (const script of sandbox.dynamicScripts) {
        try {
          lib.info(
            `Executing dynamic script: ${script.substring(0, 50)}${
              script.length > 50 ? "..." : ""
            }`
          );
          vm.run(script);
        } catch (e) {
          lib.error(`Error executing dynamic script: ${e.message}`);
          lib.verbose(`Failed script content: ${script}`);
        }
      }
    }
  } catch (e) {
    lib.error("Sandbox execution failed:");
    console.log(e.stack);
    lib.error(e.message);
    process.exit(1);
  }
}

function mapCLSID(clsid) {
  clsid = clsid.toUpperCase();
  switch (clsid) {
    case "F935DC22-1CF0-11D0-ADB9-00C04FD58A0B":
      return "wscript.shell";
    case "000C1090-0000-0000-C000-000000000046":
      return "windowsinstaller.installer";
    case "00000566-0000-0010-8000-00AA006D2EA4":
      return "adodb.stream";
    case "00000535-0000-0010-8000-00AA006D2EA4":
      return "adodb.recordset";
    case "00000514-0000-0010-8000-00AA006D2EA4":
      return "adodb.connection";
    case "0E59F1D5-1FBE-11D0-8FF2-00A0D10038BC":
      return "scriptcontrol";
    case "EE09B103-97E0-11CF-978F-00A02463E06F":
      return "scripting.dictionary";
    case "13709620-C279-11CE-A49E-444553540000":
      return "shell.application";
    case "0002DF01-0000-0000-C000-000000000046":
      return "internetexplorer.application";
    case "F935DC26-1CF0-11D0-ADB9-00C04FD58A0B":
      return "wscript.network";
    case "76A64158-CB41-11D1-8B02-00600806D9B6":
      return "wbemscripting.swbemlocator";
    case "0E59F1D5-1FBE-11D0-8FF2-00A0D10038BC":
      return "msscriptcontrol.scriptcontrol";
    case "0F87369F-A4E5-4CFC-BD3E-73E6154572DD":
      return "schedule.service";
    default:
      return null;
  }
}

function _makeDomDocument() {
  const r = {
    createElement: function (tag) {
      const r = {
        dataType: "??",
        text: "",
        get nodeTypedValue() {
          if (this.dataType != "bin.base64") return this.text;
          return atob(this.text);
        },
      };
      return r;
    },
  };
  return r;
}

function ActiveXObject(name) {
  // Check for use of encoded ActiveX object names.
  lib.verbose(`New ActiveXObject: ${name}`);
  if (argv["activex-as-ioc"]) {
    // Handle ActiveX objects referred to by CLSID.
    m = name.match(
      /new\s*:\s*\{?([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})\}?/i
    );
    if (m !== null) {
      clsid = m[1].toUpperCase();
      mappedname = mapCLSID(clsid);
      if (mappedname !== null) {
        lib.logIOC(
          "CLSID ActiveX Object Created",
          { name, mappedname },
          `The script created a new ActiveX object ${mappedname} using CLSID ${name}`
        );
        name = mappedname;
      }
    }

    // Is the name obfuscated in the source? Note that if the name
    // is given as a CLSID this will probably be true.
    //console.log((new Error()).stack);
    name_re = new RegExp(name, "i");
    pos = rawcode.search(name_re);
    if (pos === -1) {
      lib.logIOC(
        "Obfuscated ActiveX Object",
        { name },
        `The script created a new ActiveX object ${name}, but the string was not found in the source.`
      );
    } else {
      lib.logIOC(
        "ActiveX Object Created",
        { name },
        `The script created a new ActiveX object ${name}`
      );
    }
  }

  // Actually emulate the ActiveX object creation.
  name = name.toLowerCase();
  if (name.match("xmlhttp") || name.match("winhttprequest")) {
    return require("./emulator/XMLHTTP");
  }
  if (name.match("domdocument")) {
    return _makeDomDocument();
  }
  if (name.match("dom")) {
    const r = {
      document: sandbox.document,
      createElement: function (tag) {
        var r = this.document.createElement(tag);
        r.text = "";
        return r;
      },
      load: (filename) => {
        console.log(`Loading ${filename} in a virtual DOM environment...`);
      },
      loadXML: function (s) {
        try {
          this.document = new DOMParser().parseFromString(s);
          this.documentElement = this.document.documentElement;
          this.documentElement.document = this.document;
          this.documentElement.createElement = function (tag) {
            var r = this.document.createElement(tag);
            r.text = "";
            return r;
          };
          return true;
        } catch (e) {
          return false;
        }
      },
    };
    return r;
  }

  switch (name) {
    case "windowsinstaller.installer":
      return require("./emulator/WindowsInstaller");
    case "word.application":
      return require("./emulator/WordApplication");
    case "adodb.stream":
      return require("./emulator/ADODBStream")();
    case "adodb.recordset":
      return require("./emulator/ADODBRecordSet")();
    case "adodb.connection":
      return require("./emulator/ADODBConnection")();
    case "scriptcontrol":
      return require("./emulator/ScriptControl");
    case "scripting.filesystemobject":
      return require("./emulator/FileSystemObject");
    case "scripting.dictionary":
      return require("./emulator/Dictionary");
    case "shell.application":
      return require("./emulator/ShellApplication");
    case "internetexplorer.application":
      return require("./emulator/InternetExplorerApplication");
    case "wscript.network":
      return require("./emulator/WScriptNetwork");
    case "wscript.shell":
      return require("./emulator/WScriptShell");
    case "wbemscripting.swbemlocator":
      return require("./emulator/WBEMScriptingSWBEMLocator");
    case "wbemscripting.swbemdatetime":
      return require("./emulator/WBEMScriptingSWbemDateTime");
    case "wbemscripting.swbemnamedvalueset":
      return require("./emulator/WBEMScriptingSWbemNamedValueSet");
    case "msscriptcontrol.scriptcontrol":
      return require("./emulator/MSScriptControlScriptControl");
    case "schedule.service":
      return require("./emulator/ScheduleService");
    case "system.text.asciiencoding":
      return require("./emulator/AsciiEncoding");
    case "system.security.cryptography.frombase64transform":
      return require("./emulator/Base64Transform");
    case "system.io.memorystream":
      return require("./emulator/MemoryStream");
    case "system.runtime.serialization.formatters.binary.binaryformatter":
      return require("./emulator/BinaryFormatter");
    case "system.collections.arraylist":
      return require("./emulator/ArrayList");
    default:
      lib.kill(`Unknown ActiveXObject ${name}`);
      break;
  }
}

function traverse(obj, func) {
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const replacement = func.apply(this, [key, obj[key]]);
    if (replacement) obj[key] = replacement;
    if (obj.autogenerated) continue;
    if (obj[key] !== null && typeof obj[key] === "object")
      traverse(obj[key], func);
  }
}

// Emulation of member function statements hoisting of by doing some reordering within AST
function hoist(obj, scope) {
  scope = scope || obj;
  // All declarations should be moved to the top of current function scope
  let newScope = scope;
  if (obj.type === "FunctionExpression" && obj.body.type === "BlockStatement")
    newScope = obj.body;

  for (const key of Object.keys(obj)) {
    if (obj[key] !== null && typeof obj[key] === "object") {
      const hoisted = [];
      if (Array.isArray(obj[key])) {
        obj[key] = obj[key].reduce((arr, el) => {
          if (el && el.hoist) {
            // Mark as hoisted yet
            el.hoist = false;
            // Should be hoisted? Add to array and filter out from current.
            hoisted.push(el);
            // If it was an expression: leave identifier
            if (el.hoistExpression) arr.push(el.expression.left);
          } else arr.push(el);
          return arr;
        }, []);
      } else if (obj[key].hoist) {
        const el = obj[key];

        el.hoist = false;
        hoisted.push(el);
        obj[key] = el.expression.left;
      }
      scope.body.unshift(...hoisted);
      // Hoist all elements
      hoist(obj[key], newScope);
    }
  }
}
