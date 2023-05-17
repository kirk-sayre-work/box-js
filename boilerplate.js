const parse = require("node-html-parser").parse;
const lib = require("./lib.js");

// Handle Blobs. All Blob methods in the real Blob class for dumping
// the data in a Blob are asynch and box-js is all synchronous, so
// rather than rewriting the entire tool to be asynch we are just
// stubbing out a simple Blob class that is synchronous.
class Blob {
    constructor(data, type) {
        this.raw_data = data;
        // Convert to a data string if this is an array of bytes.
        this.data = "";
        var flat = [];
        for (let i = 0; i < data.length; i++) {
            if ((Array.isArray(data[i])) || (data[i].constructor.name == "Uint8Array")) {
                for (let j = 0; j < data[i].length; j++) {
                    flat.push(data[i][j]);
                }
            }
        }
        if (!flat.some(i => (!Number.isInteger(i) || (i < 0) || (i > 255)))) {
            for (let i = 0; i < flat.length; i++) {
                this.data += String.fromCharCode(flat[i]);
            };
        };
    };

    toString() { return this.data };

    charAt(x) { return this.toString().charAt(x); };

    static charAt() { return ""; };
};
Object.prototype.Blob = Blob;

// Simple Enumerator class implementation.
class Enumerator {
    constructor(collection) {
        if (typeof(collection.length) == "undefined") throw "Enumerator collection has no .length attr";
        this.collection = collection;
        this.currIndex = 0;
    };

    atEnd() {
        return (this.currIndex >= this.collection.length);
    };

    moveNext() {
        this.currIndex++;
    };

    item() {
        if (this.atEnd()) throw "Over end of all Enumerator data";
        return this.collection[this.currIndex];
    };
};

// JScript VBArray class.
class VBArray {

    constructor(values) {
        this.values = values;
    };

    getItem(index) {
        return this.values[index];
    };
};

// atob() taken from abab.atob.js .

/**
 * Implementation of atob() according to the HTML and Infra specs, except that
 * instead of throwing INVALID_CHARACTER_ERR we return null.
 */
function atob(data) {
  // Web IDL requires DOMStrings to just be converted using ECMAScript
  // ToString, which in our case amounts to using a template literal.
  data = `${data}`;
  // "Remove all ASCII whitespace from data."
  data = data.replace(/[ \t\n\f\r]/g, "");
  // "If data's length divides by 4 leaving no remainder, then: if data ends
  // with one or two U+003D (=) code points, then remove them from data."
  if (data.length % 4 === 0) {
    data = data.replace(/==?$/, "");
  }
  // "If data's length divides by 4 leaving a remainder of 1, then return
  // failure."
  //
  // "If data contains a code point that is not one of
  //
  // U+002B (+)
  // U+002F (/)
  // ASCII alphanumeric
  //
  // then return failure."
  if (data.length % 4 === 1 || /[^+/0-9A-Za-z]/.test(data)) {
    return null;
  }
  // "Let output be an empty byte sequence."
  let output = "";
  // "Let buffer be an empty buffer that can have bits appended to it."
  //
  // We append bits via left-shift and or.  accumulatedBits is used to track
  // when we've gotten to 24 bits.
  let buffer = 0;
  let accumulatedBits = 0;
  // "Let position be a position variable for data, initially pointing at the
  // start of data."
  //
  // "While position does not point past the end of data:"
  for (let i = 0; i < data.length; i++) {
    // "Find the code point pointed to by position in the second column of
    // Table 1: The Base 64 Alphabet of RFC 4648. Let n be the number given in
    // the first cell of the same row.
    //
    // "Append to buffer the six bits corresponding to n, most significant bit
    // first."
    //
    // atobLookup() implements the table from RFC 4648.
    buffer <<= 6;
    buffer |= atobLookup(data[i]);
    accumulatedBits += 6;
    // "If buffer has accumulated 24 bits, interpret them as three 8-bit
    // big-endian numbers. Append three bytes with values equal to those
    // numbers to output, in the same order, and then empty buffer."
    if (accumulatedBits === 24) {
      output += String.fromCharCode((buffer & 0xff0000) >> 16);
      output += String.fromCharCode((buffer & 0xff00) >> 8);
      output += String.fromCharCode(buffer & 0xff);
      buffer = accumulatedBits = 0;
    }
    // "Advance position by 1."
  }
  // "If buffer is not empty, it contains either 12 or 18 bits. If it contains
  // 12 bits, then discard the last four and interpret the remaining eight as
  // an 8-bit big-endian number. If it contains 18 bits, then discard the last
  // two and interpret the remaining 16 as two 8-bit big-endian numbers. Append
  // the one or two bytes with values equal to those one or two numbers to
  // output, in the same order."
  if (accumulatedBits === 12) {
    buffer >>= 4;
    output += String.fromCharCode(buffer);
  } else if (accumulatedBits === 18) {
    buffer >>= 2;
    output += String.fromCharCode((buffer & 0xff00) >> 8);
    output += String.fromCharCode(buffer & 0xff);
  }
  // "Return output."
  return output;
}
/**
 * A lookup table for atob(), which converts an ASCII character to the
 * corresponding six-bit number.
 */
function atobLookup(chr) {
  if (/[A-Z]/.test(chr)) {
    return chr.charCodeAt(0) - "A".charCodeAt(0);
  }
  if (/[a-z]/.test(chr)) {
    return chr.charCodeAt(0) - "a".charCodeAt(0) + 26;
  }
  if (/[0-9]/.test(chr)) {
    return chr.charCodeAt(0) - "0".charCodeAt(0) + 52;
  }
  if (chr === "+") {
    return 62;
  }
  if (chr === "/") {
    return 63;
  }
  // Throw exception; should not be hit in tests
  return undefined;
}

function extractJSFromHTA(s) {
    const root = parse("" + s);
    items = root.querySelectorAll('script');
    r = "";
    var chunkNum = 0;
    for (let i1 = 0; i1 < items.length; ++i1) {
        item = items[i1];
        for (let i2 = 0; i2 < item.childNodes.length; ++i2) {
            chunkNum += 1;
            child = item.childNodes[i2]
            attrs = ("" + child.parentNode.rawAttrs).toLowerCase();
            if (!attrs.includes("vbscript")) {
                r += "// Chunk #" + chunkNum + "\n" + child._rawText + "\n\n";
            }
        }
    }
    return r;
}

var location = {
    
    /*
      Location.ancestorOrigins
      Is a static DOMStringList containing, in reverse order, the origins
      of all ancestor browsing contexts of the document associated with
      the given Location object.
    */
    ancestorOrigins: '',
    
    /* 
       Location.href
       Is a stringifier that returns a USVString containing the entire
       URL. If changed, the associated document navigates to the new
       page. It can be set from a different origin than the associated
       document.
    */
    href: 'http://mylegitdomain.com:2112/and/i/have/a/path.php',

    /* 
       Location.protocol
       Is a USVString containing the protocol scheme of the URL, including
       the final ':'.
    */
    protocol: 'http:',

    /* 
       Location.host
       Is a USVString containing the host, that is the hostname, a ':', and
       the port of the URL.
    */
    host: 'mylegitdomain.com:2112',

    /* 
       Location.hostname
       Is a USVString containing the domain of the URL.
    */
    hostname: 'mylegitdomain.com',

    /* 
       Location.port
       Is a USVString containing the port number of the URL.
    */
    port: '2112',

    /* 
       Location.pathname
       Is a USVString containing an initial '/' followed by the path of the URL.
    */
    pathname: '/and/i/have/a/path.php',

    /* 
       Location.search
       Is a USVString containing a '?' followed by the parameters or
       "querystring" of the URL. Modern browsers provide URLSearchParams
       and URL.searchParams to make it easy to parse out the parameters
       from the querystring.
    */
    search: '',

    /* 
       Location.hash
       Is a USVString containing a '#' followed by the fragment identifier
       of the URL.
    */
    hash: '',

    /* 
       Location.origin Read only
       Returns a USVString containing the canonical form of the origin of
       the specific location.
    */
    origin: 'http://mylegitdomain.com:2112',

    replace: function (url) {
        logIOC('Window Location', {url}, "The script changed the window location URL.");
	logUrl('Window Location', url);
    },

    // The location.reload() method reloads the current URL, like the Refresh button.
    reload: function() {},

    // box-js specific. Used to tell when window.location is used as a string.
    toString: function() {
        // Should return the URL (href) but looks like some JS malware
        // expects this to be the file URL for the sample.        
        //return this.href;
        return "file:///C:\Users\User\AppData\Roaming\CURRENT_SCRIPT_IN_FAKED_DIR.js"
    },
};

function __getElementsByTagName(tag) {
    var func = function(content) {
        logIOC('DOM Write', {content}, "The script added a HTML node to the DOM");
        const urls = pullActionUrls(content);
        if (typeof(urls) !== "undefined") {
            for (const url of urls) {
                logUrl('Action Attribute', url);
            };
        }
        return "";
    };
    
    // Return a dict that maps every tag name to the same fake element.
    fake_dict = {};
    fake_dict = new Proxy(fake_dict, {
        get(target, phrase) { // intercept reading a property from dictionary
            return {
                "appendChild" : func,
                "insertBefore" : func,
                "parentNode" : {
                    "appendChild" : func,
                    "insertBefore" : func,
                },
                "getElementsByTagName" : __getElementsByTagName,
                "title" : "My Fake Title",
                style: {},
                getAttribute: function() { return {}; },
            };
        }
    });
    return fake_dict;
};

function __createElement(tag) {
    var fake_elem = {
        set src(url) {
            // Looks like you can leave off the http from the url.
            if (url.startsWith("//")) url = "https:" + url;
            logIOC('Remote Script', {url}, "The script set a remote script source.");
            logUrl('Remote Script', url);
        },
        log: [],
	style: [],
	appendChild: function() {
            return __createElement("__append__");
        },
        append: function() {
            return __createElement("__append__");
        },
        attributes: {},
        setAttribute: function(name, val) {
            this.attributes[name] = val;
        },
        setAttributeNode: function(name, val) {
            if (typeof(val) !== "undefined") {
                this.attributes[name] = val;
            };
            if ((typeof(name.nodeValue !== "undefined")) &&
                (typeof(name.nodeValue.valueOf == "function"))) {
                name.nodeValue.valueOf();
            };
        },
        removeAttributeNode: function(node) {
            // Stubbed out until needed.
        },                
        getAttribute: function(name) {
            return this.attributes[name];
        },
        clearAttributes: function() {
            this.attributes = {};
        },        
        firstChild: {
            nodeType: 3,
        },
        lastChild: {
            nodeType: 3,
        },
        getElementsByTagName: __getElementsByTagName,
        // Probably wrong, fix this if it causes problems.
        querySelector: function(tag) {
            return __createElement(tag);
        },
        cloneNode: function() {
            // Actually clone the element (deep copy).
            return JSON.parse(JSON.stringify(this));
        },
        toLowerCase: function() {
            return "// NOPE";
        },
        click: function() {
            lib.info("click() method called on a document element.");
        },
        insertAdjacentHTML: function(position, content) {
            logIOC('DOM Write', {content}, "The script added a HTML node to the DOM");
            const urls = pullActionUrls(content);
            if (typeof(urls) !== "undefined") {
                for (const url of urls) {
                    logUrl('Action Attribute', url);
                };
            }
        },
	removeChild: function() {},
    };
    return fake_elem;
};

// Stubbed global navigator object.
var navigator = {
    userAgent: 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.2; WOW64; Trident/6.0; .NET4.0E; .NET4.0C; .NET CLR 3.5.30729; .NET CLR 2.0.50727; .NET CLR 3.0.30729; Tablet PC 2.0; InfoPath.3)',
};

var _generic_append_func = function(content) {
    logIOC('DOM Write', {content}, "The script added a HTML node to the DOM");
    const urls = pullActionUrls(content);
    if (typeof(urls) !== "undefined") {
        for (const url of urls) {
            logUrl('Action Attribute', url);
        };
    }
    return "";
};

// Stubbed global document object.
var document = {
    documentMode: 8, // Fake running in IE8
    nodeType: 9,
    referrer: 'https://bing.com/',
    body: __createElement("__document_body__"),
    location: location,
    head: {
        innerHTML: "",
        append: _generic_append_func,
        appendChild: _generic_append_func,
    },
    defaultView: {},
    cookie: "",
    ready: function(func) {
        func();
    },
    elementCache : {},
    getElementById : function(id) {

        // Already looked this up?
        if (typeof(this.elementCache[id]) !== "undefined") return this.elementCache[id];
        
        var char_codes_to_string = function (str) {
            var codes = ""
            for (var i = 0; i < str.length; i++) {
                codes += String.fromCharCode(str[i])
            }
            return codes
        }

        /* IDS_AND_DATA */
        
        if (typeof(ids) != "undefined") {
            for (var i = 0; i < ids.length; i++) {
                if (char_codes_to_string(ids[i]) == id) {
                    var r = {
                        innerHTML: char_codes_to_string(data[i]),
                        innerText: char_codes_to_string(data[i]),
                        onclick: undefined,
                        click: function() {
                            if (typeof(this.onclick) !== "undefined") this.onclick();
                        },
                        getAttribute: function(attrId) {
                            return this.attrs[attrId];
                        },
                        insertAdjacentHTML: function(position, content) {
                            logIOC('DOM Write', {content}, "The script added a HTML node to the DOM");
                            const urls = pullActionUrls(content);
                            if (typeof(urls) !== "undefined") {
                                for (const url of urls) {
                                    logUrl('Action Attribute', url);
                                };
                            }
                        },
                    };
                    r.attrs = attrs[i];
                    this.elementCache[id] = r;
                    return r;                    
                }
            }
        }

        // got nothing to return. Make up some fake element and hope for the best.
        return __createElement(id);
    },
    documentElement: {
        style: {},
        className: "",
    },
    write: function (content) {
        logIOC('DOM Write', {content}, 'The script wrote to the DOM')
        const urls = pullActionUrls(content);
        if (typeof(urls) !== "undefined") {
            for (const url of urls) {
                logUrl('Action Attribute', url);
            };
        }
        eval.apply(null, [extractJSFromHTA(content)]);
    },
    appendChild: function(content) {
        logIOC('DOM Write', {content}, "The script appended an HTML node to the DOM")
        const urls = pullActionUrls(content);
        if (typeof(urls) !== "undefined") {
            for (const url of urls) {
                logUrl('Action Attribute', url);
            };
        }
        eval(extractJSFromHTA(content));
    },
    insertBefore: function(node) {
	logIOC('DOM Insert', {node}, "The script inserted an HTML node on the DOM")
        eval(extractJSFromHTA(node));
    },
    getElementsByTagName: __getElementsByTagName,
    createDocumentFragment: function() {
        return __createElement("__doc_fragment__");
    },
    createElement: __createElement,
    createTextNode: function(text) {},
    addEventListener: function(tag, func) {
        // Simulate the event happing by running the function.
        logIOC("document.addEventListener()", {event: tag}, "The script added an event listener for the '" + tag + "' event.");
        func();
    },
    createAttribute: function(name) {
        logIOC('Document.createAttribute()', {name}, "The script added attribute '" + name + "' to the document.");
        return __createElement(name);
    },
};

// Stubbed out URL class.
class URL {

    constructor(url, base="") {
	this.url = url + base;
	lib.logIOC("URL()", {method: "URL()", url: this.url}, "The script created a URL object.");
        lib.logUrl("URL()", this.url);
    };

    static _blobCount = 0;
    
    static createObjectURL(urlObject) {

	// If we have a Blob this is probably creating a file download
	// link. Save the "file".
	if (urlObject.constructor.name == "Blob") {
	    const fname = "URL_Blob_file_" + URL._blobCount++;
	    const uuid = lib.getUUID();
	    lib.writeFile(fname, urlObject.data);
	    lib.logResource(uuid, fname, urlObject.data);
	}
    };

    static revokeObjectURL() {};
};

// Stubbed global window object.
var window = {
    eval: function(cmd) { eval(cmd); },
    resizeTo: function(a,b){},
    moveTo: function(a,b){},
    open: function(url) {
        if ((typeof(url) == "string") && (url.length > 0)){
            logIOC('window.open()', {url}, "The script loaded a resource.");
        }
    },
    close: function(){},
    matchMedia: function(){ return {}; },
    atob: function(s){
        return atob(s);
    },
    setTimeout: function(f, i) {},
    addEventListener: function(tag, func) {
        // Simulate the event happing by running the function.
        logIOC("window.addEventListener()", {event: tag}, "The script added an event listener for the '" + tag + "' event.");
        func();
    },
    attachEvent: function(){},
    getComputedStyle: function(){
	return ["??",
		"-moz-"];
    },
    createDocumentFragment: function() {},
    createElement: __createElement,    
    location: location,
    localStorage: {
        // Users and session to distinguish and generate statistics about website traffic. 
        "___utma" : undefined,
        // Users and session to distinguish and generate statistics about website traffic. 
        "__utma" : undefined,
        // Determine new sessions and visits and generate statistics about website traffic. 
        "__utmb" : undefined,
        // Determine new sessions and visits and generate statistics about website traffic. 
        "__utmc" : undefined,
        // Process user requests and generate statistics about the website traffic. 
        "__utmt" : undefined,
        // Store customized variable data at visitor level and generate statistics about the website traffic. 
        "__utmv" : undefined,
        // To record the traffic source or campaign how users ended up on the website. 
        "__utmz" : undefined,
    },
    document: document,
    navigator: navigator,
    _NavbarView: class _NavbarView {
        constructor() {};    
    },
    URL: URL,
};
window.self = window;
window.top = window;
self = window;

// Initial stubbed object. Add items a needed.
var screen = {
};

// Initial stubbed object. Add items a needed.
var ShareLink = {
};

// Initial stubbed function. Add items a needed.
function define(path, func) {
    // Run the function.
    func({}, {}, {}, {}, {});
};
define.amd = true;

// These could be due to a bug in a sample, but added this to
// get analysis to work. Also could be missing globals from other scripts.
wp = {};
wprentals_map_general_start_map = function() {};
googlecode_property_vars = {};
wprentals_map_general_cluster = function() {};
wprentals_map_general_spiderfy = function() {};
wpestate_initialize_poi = function() {};
Codevz_Plus = {};

// Initial stubbed function. Add items a needed.
function adjustIframes() {};

// Initial jQuery stubbing. Add items a needed.

// Function form of jQuery().
var funcDict = {
    on: function(){ return funcDict },
    val: function() {},
    scroll: function() {},
    ready: function() {},
    document: function() {},
    load: function() {},
    extend: function() { return {}; },
    attr: function(field) { return ".attr(" + field + ")"; },
    codevzPlus: function() {},
    hasClass: function() { return false; },
    attr: function() {},
    attrHooks: {
        value: {
            get: function() {},
            set: function() {},
        },
    },
    support: {
        boxModel: false,
    },
    boxModel: false,
    ajaxSetup: function() {},
    event: {
        add: function() {},
        remove: function() {},
        trigger: function() {},
        special: {},
    },
    each: function() {},
    one: function() {},
    mouseup: function() {},
    isFunction: function() {},
    data: function() { return "12"; },
    outerHeight: function() {},
    css: function() {},
    // Probably not jQuery
    avia_sc_messagebox: function() {},
    trigger: function() {},
    width: function() {},
    resize: function() {},
    blur: function() {},
};
var jQuery = function(field){
    if (typeof(field) != "undefined") {
        return field;
    };
    return funcDict;
};

// Global object form of jQuery.
$ = jQuery; // Ugh, shorthand name.
jQuery.jquery = "2.6.1";
jQuery.fn = {
    jquery: "2.6.1",
    extend: function() { return {}; },
    toggle: function() {},
    live: function() {},
    die: function() {},
    load: function() {},
    revolution: {
        is_mobile: function() {},
        is_android: function() {},
    },
    smoothScroll: {},
};
jQuery.extend = function() { return {}; };
jQuery.attr = function() {};
jQuery.attrHooks = {
    value: {
        get: function() {},
        set: function() {},
    },
};
jQuery.support = {
    boxModel: false,
};
jQuery.boxModel = false;
jQuery.ajaxSetup = function() {};
jQuery.event = {
    add: function() {},
    remove: function() {},
    trigger: function() {},
    special: {},
};
jQuery.each = function() {};
jQuery.isFunction = function() {};
jQuery.expr = {
    pseudos: {},
};

// Looks like that can be a window field.
window.jQuery = jQuery

// Initial WebPack stubbing.
globalThis.location = location;
globalThis.importScripts = true;

// Mejs module stubbing.
var mejs = {
    plugins: {},
    Utils: {},
};

// MediaElementPlayer module stubbing.
var MediaElementPlayer = {
    prototype: {},
};

// Vue module stubbing.
class Vue {
    constructor() {};    
};
Vue.directive = function() {};
Vue.component = function() {};

// What is this?
var N2R = N2D = function() {};

// No Element class in node-js.
class Element {
    constructor() {};
};

class _WidgetInfo {
    constructor(a1, a2, a3, a4, a5) {};
};

var _WidgetManager = {
    _Init: function(a1, a2, a3) {},
    _SetDataContext: function(a1) {},
    _RegisterWidget: function(a1, a2) {},
};

// We are acting like cscript when emulating. JS in cscript does not
// implement Array.reduce().
Array.prototype.reduce = function(a, b) {
    throw "CScript JScript has no Array.reduce() method."
};

function setTimeout(func, time) {
    func();
};
function clearTimeout() {};
function setInterval() {};
function clearInterval() {};

class XMLHttpRequest {
    constructor(){
        this.method = null;
        this.url = null;
    };

    addEventListener(tag, func) {
        // Simulate the event happing by running the function.
        logIOC("XMLHttpRequest.addEventListener()", {event: tag}, "The script added an event listener for the '" + tag + "' event.");
        func();
    };

    open(method, url) {
        this.method = method;
	// Maybe you can skip the http part of the URL and XMLHTTP
	// still handles it?
	if (url.startsWith("//")) {
	    url = "http:" + url;
	}
        this.url = url;
        lib.logIOC("XMLHttpRequest", {method: method, url: url}, "The script opened a HTTP request.");
        lib.logUrl("XMLHttpRequest", url);
    };

    setRequestHeader(field, val) {
        lib.logIOC("XMLHttpRequest", {field: field, value: val}, "The script set a HTTP header value.");
    };
    
    send() {};
};

// Some JS checks to see if these are defined. Do very basic stubbing
// until better stubbing is needed.
var exports = {};
//var module = {};

// fetch API emulation.
function fetch(url) {
    lib.logIOC("fetch", {url: url}, "The script fetch()ed a URL.");
    lib.logUrl("fetch", url);
};

// Image class stub.
class Image {

    set src(url) {

        // Looks like you can leave off the http from the url.
        if (url.startsWith("//")) url = "https:" + url;
        this.url = url;
        lib.logIOC("Image.src", url, "The script set the source of an Image.");
        lib.logUrl("Image.src", url);
    };
}

// Pull URLs from action attributes of HTML.
function pullActionUrls(html) {

    // Sanity check.
    if (typeof(html.match) == "undefined") return undefined;
    
    // Do we have action attributes?
    const actPat = /action\s*=\s*"([^"]*)"/g;
    const r = [];
    for (const match of html.matchAll(actPat)) {
        var currAct = match[1];
        if (!currAct.startsWith("http") && !currAct.startsWith("//")) continue;
        if (currAct.startsWith("//")) currAct = "https:" + currAct;
        r.push(currAct);
    }

    // Do we have URLs in the action attribute values?
    console.log(r);
    if (r.length == 0) return undefined;
    return r;
}

// Stubbing for chrome object. Currently does nothing.
const chrome = {

    extension: {
        onMessage: {
            addListener: function () {}
        },            
    },
    
};
