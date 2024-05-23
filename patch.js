/* !!!! Patches from box-js !!!! */
let __PATCH_CODE_ADDED__ = true;
window = this;

_globalTimeOffset = 0;
WScript.sleep = function(delay) {
    _globalTimeOffset += delay;
}

let fullYearGetter = Date.prototype.getFullYear;
Date.prototype.getFullYear = function() {
    console.log("Warning: the script tried to read the current date.");
    console.log("If it doesn't work correctly (eg. fails to decrypt a string,");
    console.log("try editing patch.js with a different year.");

    // return 2017;
    return fullYearGetter.call(this);
};
Date.prototype.getYear = function() {
    return this.getFullYear();
};
Date.prototype.toString = function() {
    // Example format: Thu Aug 24 18:17:18 UTC+0200 2017
    const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][this.getDay()];
    const monName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][this.getMonth()];
    return [
	dayName, monName, this.getUTCDay(),
	this.getUTCHours() + ":" + this.getUTCMinutes() + ":" + this.getUTCSeconds(),
	"UTC-0500", // New York timezone
	this.getFullYear()
    ].join(" ");
}
let toLocaleStringGetter = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function(lang, opts) {

    try {
        // Try doing the real toLocaleDateString() with the given args.
        return toLocaleStringGetter.call(this, lang, opts);
    } catch (e) {
        // Invalid args. cscript defaults to some sensible options in
        // this case, so return that result.
        const sensibleOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
        return toLocaleStringGetter.call(this, undefined, sensibleOpts).replace(" at ", " ");
    }
};
Date.prototype.gethours = Date.prototype.getHours;
Date.prototype.getminutes = Date.prototype.getMinutes;

const legacyDate = Date;
Date = function() {
    return new Proxy({
	_actualTime: new legacyDate(...arguments),
    }, {
	get: (target, prop) => {
            // Fast forward through time to foil anti-sandboxing busy
            // loops. The _myOffset field caches the faked time offset
            // used when the Date object was 1st looked at and
            // advances if so future date objects jump forward in
            // time.
            if (typeof(target._myOffset) == "undefined") {
                target._myOffset = _globalTimeOffset;
                _globalTimeOffset += 100;
            }
	    const modifiedDate = new legacyDate(target._actualTime.getTime() + target._myOffset);
	    if (prop === Symbol.toPrimitive) return hint => {
		switch (hint) {
		case "string":
		case "default": {
		    return modifiedDate.toString();
                }
		case "number": {
		    return modifiedDate.getTime();
                }
		default:
		    throw new Error("Unknown hint!");
		}
	    }
	    if (typeof prop !== "symbol") {
		if (!(prop in modifiedDate) && (prop in legacyDate)) return legacyDate[prop];
		if (!(prop in legacyDate.prototype)) return undefined;                
	    }
            if (typeof(modifiedDate[prop]) === "undefined") return undefined;
	    const boundFn = modifiedDate[prop].bind(modifiedDate);
	    return function() {
		const ret = boundFn.apply(null, arguments);
		target._actualTime = new legacyDate(modifiedDate.getTime() - _globalTimeOffset);
		return ret;
	    }
	}
    });
}
Date.now = () => legacyDate.now() + _globalTimeOffset;
Date.length = 7;
Date.parse = legacyDate.parse;
Date.UTC = legacyDate.UTC;
Date.toString = () => legacyDate.toString()
Date.valueOf  = () => legacyDate.valueOf()

Array.prototype.Count = function() {
    return this.length;
};

let _OriginalFnToString = Function.prototype.toString;
Function.prototype.toString = function() {
    /**
     * WSH's toString() looks a bit different for built-in functions
     * than result generated by Node.js (tabbed and wrapped with newlines)
     * which is sometimes checked by malicious scripts.
     */
    let source = _OriginalFnToString.call(this);
    let r = source.replace(
	/^function (\S+) { \[native code\] }$/,
	((m, fnName) => `\nfunction ${fnName} {\n    [native code]\n}\n`)
    )
    // Some obfuscators flag funcs with newlines.
    r = r.replace(/\n/g, "").replace(/{ +/g, "{").replace(/ +}/g, "}");
    return r;
}

// Handle dynamic code executed via c("...") where c = SomeFunc.constructor.
let _OriginalFnConstructor = Function.prototype.constructor;
function _CreateFunc(...args) {
    let originalSource = args.pop();
    let source;
    if (typeof originalSource === "function") {
	originalSource = originalSource.toString();
	source = rewrite("(" + originalSource + ")");
    } else if (typeof originalSource === "string") {
	source = `/* Function arguments: ${JSON.stringify(args)} */\n` + rewrite(originalSource);
    } else {
	// What the fuck JS
	// For some reason, IIFEs result in a call to Function.
	//return new _OriginalFunction(...args, source);
        return new _OriginalFnConstructor(...args, source);
    }
    logJS(source);
    //return new _OriginalFunction(...args, source);
    return new _OriginalFnConstructor(...args, source);
}

Function.prototype.constructor = _CreateFunc;

// Handle dynamic code executed via Function("...").
let _OriginalFunction = Function;
Function = _CreateFunc;
Function.toString = () => _OriginalFunction.toString()
Function.valueOf  = () => _OriginalFunction.valueOf()

String.prototype.xstrx = function() {
    const hex = this.valueOf();
    var str = '';
    for (let i = 0; i < hex.length; i += 2) {
        const hexValue = hex.substr(i, 2);
        const decimalValue = parseInt(hexValue, 16);
        str += String.fromCharCode(decimalValue);
    }
    return str;
}

// Track the values of elements set by JQuery $("#q").val(...) uses.
var jqueryVals = {};

// Fake up JQuery $("#q").val(...) uses.
String.prototype.val = function(value) {
    if (!this.startsWith("#")) return;
    logIOC("JQuery", value, "The script used JQuery $(\"#q\").val(...) to set an element.")
    var name = this.slice(1);
    jqueryVals[name] = value;
}

Object.prototype.replace = function() {
    return "";
}

constructor.prototype.bind = function(context, func) {
    const r = function() {
        if (typeof(func) !== "undefined") {
            return func.apply(context, arguments);
        }
    };
    return r;
};
/* End patches */
