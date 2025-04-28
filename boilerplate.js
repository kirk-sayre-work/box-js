const parse = require("node-html-parser").parse;
const lib = require("./lib.js");

// Save event listener functions. Event listener callbacks may change
// the state of the DOM and exhibit different functionality when
// called again, so save the callback functions so we can call them
// multiple times.
const listenerCallbacks = [];

// Dummy event to use for faked event handler calls.
const dummyEvent = {

    // A boolean value indicating whether or not the event bubbles up through the DOM.
    bubbles: true,

    // A boolean value indicating whether the event is cancelable.
    cancelable: true,

    //A boolean indicating whether or not the event can bubble across
    //the boundary between the shadow DOM and the regular DOM.
    composed: true,

    // A reference to the currently registered target for the
    // event. This is the object to which the event is currently
    // slated to be sent. It's possible this has been changed along
    // the way through retargeting.
    currentTarget: "??",

    // Indicates whether or not the call to event.preventDefault() canceled the event.
    defaultPrevented: false,

    // Indicates which phase of the event flow is being processed. It
    // is one of the following numbers: NONE, CAPTURING_PHASE,
    // AT_TARGET, BUBBLING_PHASE.
    eventPhase: 1, // CAPTURING_PHASE

    // Indicates whether or not the event was initiated by the browser
    // (after a user click, for instance) or by a script (using an
    // event creation method, for example).
    isTrusted: true,

    // A reference to the object to which the event was originally
    // dispatched.
    target: {
        closest: function() { return false; },
    },

    // The time at which the event was created (in milliseconds). By
    // specification, this value is time since epoch—but in reality,
    // browsers' definitions vary. In addition, work is underway to
    // change this to be a DOMHighResTimeStamp instead.
    timeStamp: 1702919791198,

    // The name identifying the type of the event.
    type: "FILL IN BASED ON FAKED HANDLER",
    
    // For Key events.
    key: 97, // "a"

    stopPropagation: function() {},
    preventDefault: function() {},
    composedPath: function() {
        return {
            includes: function() { return false; },
        };
    },
};
event = dummyEvent;

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

function btoa(data) {
    if (typeof(data) == "undefined") return "";
    return Buffer.from(data, 'binary').toString('base64')
}

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

var __location = {
    
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
    get href() {
        if (typeof(this._href) === "undefined") this._href = 'http://mylegitdomain.com:2112/and/i/have/a/path.php#tag?var1=12&var2=checkout&ref=otherlegitdomain.moe';
        return this._href;
    },
    set href(url) {
	if (url) {
	    url = "" + url;
	    url = url.replace(/\r?\n/g, "");
	    if (url.startsWith("file:")) return;
            this._href = url;
            logIOC('HREF Location', {url}, "The script changed location.href.");
	    logUrl('HREF Location', url);
	}
    },

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
    get hash() {
        // Return a fake fragment ID if location is not set.
        if (typeof(this._href) === "undefined") {
            var r = '#foo@bar.baz';
            return r;
        };
        // Return the actual fragment ID if we have one.
        const i = this._href.indexOf("#");
        var r = "";
        if (i >= 0) r = this._href.slice(i);
        return r;
    },

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

// Track setting the current HREF by direct assignments to location.
Object.defineProperty(Object.prototype, "__define", {
    value: function(name, descriptor){
        Object.defineProperty(this, name, descriptor);
    }
});

__define("location",
       {
	   get: function() { return __location; },
	   set: function(url) {
	       if (url) {
		   __location.href = url;
	       }
	   },
       });

tagNameMap = {
    /* !! ADD TAG TO VALUE MAPPINGS HERE !! */
};

function __makeFakeElem(data) {

    var func = function(content) {
        logIOC('DOM Write', {content}, "The script added a HTML node to the DOM");
        const urls = pullActionUrls(content);
        if (typeof(urls) !== "undefined") {
            for (const url of urls) {
                logUrl('Action Attribute', url);
            };
        }
        return __createElement("FAKEELEM");
    };
    
    var fakeDict = {
        "appendChild" : func,
        "insertBefore" : func,
        "parentNode" : {
            "appendChild" : func,
            "insertBefore" : func,
            removeChild: function () {},
        },
        "getElementsByTagName" : __getElementsByTagName,
        "title" : "My Fake Title",
        style: {},
        navigator: navigator,
        getAttribute: function() { return {}; },
        addEventListener: function(tag, func) {
            if (typeof(func) === "undefined") return;
            // Simulate the event happing by running the function.
            logIOC("Element.addEventListener()", {event: tag}, "The script added an event listener for the '" + tag + "' event.");
            func(dummyEvent);
            listenerCallbacks.push(func);
        },
        removeEventListener: function(tag) {
            logIOC("Element.removeEventListener()", {event: tag}, "The script removed an event listener for the '" + tag + "' event.");
        },                
        "classList" : {
            add: function() {},
            remove: function() {},
            trigger: function() {},
            special: {},
        },
        innerHTML: data,
	_textContent: data,
        get textContent() {
            if (typeof(this._textContent) === "undefined") this._textContent = '';
            return this._textContent;
        },
        set textContent(d) {
            this._textContent = d;
            logIOC('Element Text', {textContent}, "The script changed textContent of an element.");
        },
        item: function() {},
        removeChild: function() {},
	remove: function() {},
        append: function() {
            return __createElement("__append__");
        },
	prepend: function() {
            return __createElement("__prepend__");
        },	
        cloneNode: func,
    };
    return fakeDict;
}

function __getElementsByTagName(tag) {
    
    // Do we have data for this tag?
    const tagData = tagNameMap[tag];
    if (tagData) {
        var r = [];
        for (var i = 0; i < tagData.length; i++) {
            r.push(__makeFakeElem(tagData[i]));
        }
        return r;
    }
    else {
        return [__makeFakeElem(""), __makeFakeElem(""), __makeFakeElem("")];
    }
};

var __currSelectedVal = undefined;
var __fakeParentElem = undefined;
var dynamicOnclickHandlers = [];
function __createElement(tag) {
    var fake_elem = {
	myType: "Element",
        set src(url) {

            // Looks like you can leave off the http from the url.
            if (url.startsWith("//")) url = "https:" + url;

            // Is the script source base64 encoded?
            if (url.startsWith("data:text/html;base64,")) {

                // Strip off the HTML info.
                url = url.slice("data:text/html;base64,".length)

                // Decode the base64.
                url = atob(url);
            }

            // Save the IOC.
            logIOC('Remote Script', {url}, "The script set a remote script source.");
            logUrl('Remote Script', url);
        },
        set onerror(func) {
            // Call the onerror handler.
            func();
        },
        set value(txt) {
            this.val = txt;
        },
        get value() {
            return this.val;
        },
        get href() {
            if (typeof(this._href) === "undefined") this._href = 'http://mylegitdomain.com:2112/and/i/have/a/path.php#tag?var1=12&var2=checkout&ref=otherlegitdomain.moe';
            return this._href;
        },
        set href(url) {
	    if (url) {
		url = url.replace(/\r?\n/g, "");
		this._href = url;
		logIOC('HREF Location', {url}, "The script changed location.href.");
		logUrl('HREF Location', url);
	    }
        },
        // Not ideal or close to correct, but sometimes needs a parentNode field.
        parentNode: __fakeParentElem,
        log: [],
	style: {
	    setProperty: function() {},
            display: "",
	},
	appendChild: function() {
            return __createElement("__append__");
        },
        append: function() {
            return __createElement("__append__");
        },
	prepend: function() {
            return __createElement("__prepend__");
        },
        attributes: {},
        setAttribute: function(name, val) {
            this.attributes[name] = val;

            // Setting the source of an element to (maybe) a URL?
            if (name === "src") {
                if (val.startsWith("//")) val = "https:" + val;
                logIOC('Element Source', {val}, "The script set the src field of an element.");
	        logUrl('Element Source', val);
            }
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
        getElementsByClassName: __getElementsByTagName,
        // Probably wrong, fix this if it causes problems.
        querySelector: function(tag) {
            return __createElement(tag);
        },
        select: function() {
            __currSelectedVal = this.val;
        },
        cloneNode: function() {
            //// Actually clone the element (deep copy).
            //return JSON.parse(JSON.stringify(this));
            return __createElement("FAKEELEM");
        },
        toLowerCase: function() {
            return "// NOPE";
        },
        _onclick: undefined,
        set onclick(func) {
            this._onclick = func;
            // Call the click handler.
            func();
        },
        get onclick() {
            return this._onclick;
        },
        click: function() {
            lib.info("click() method called on a document element.");
            if (typeof(this.onclick) !== "undefined") this.onclick();
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
        set innerHTML(content) {
            this._innerHTML = content;
            logIOC("Set innerHTML", {content}, "The script set the innerHTML of an element.");

            // Pull action attribute URLs.
            const urls = pullActionUrls(content);
            if (typeof(urls) !== "undefined") {
                for (const url of urls) {
                    logUrl('Action Attribute', url);
                };
            }

            // Pull out onclick JS and run it (eventually).
            const clickHandlers = pullClickHandlers(content);
            if (clickHandlers.length > 0) {
                lib.info("onclick handler code provided in dynamically added HTML.");
                for (const handler of clickHandlers) {

                    // Save the onclick handler code snippets so we can
                    // run them again at the end in case the DOM has
                    // changed.
                    dynamicOnclickHandlers.push(handler);
                }
            }
        },
        get innerHTML() {
            if (typeof(this._innerHTML) === "undefined") this._innerHTML = "";
            return this._innerHTML;
        },
        addEventListener: function(tag, func) {
            if (typeof(func) === "undefined") return;
            // Simulate the event happing by running the function.
            logIOC("Element.addEventListener()", {event: tag}, "The script added an event listener for the '" + tag + "' event.");
            func(dummyEvent);
            listenerCallbacks.push(func);
        },
        removeEventListener: function(tag) {
            logIOC("Element.removeEventListener()", {event: tag}, "The script removed an event listener for the '" + tag + "' event.");
        },        
	removeChild: function() {},
	remove: function() {},
        "classList" : {
            add: function() {},
            remove: function() {},
            trigger: function() {},
            // Trivial stubbing. Just say nothing is in the class
            // list. May need a flag to control this.
            contains: function(x) { return false; },
            special: {},
        },
        sheet: {
            insertRule: function() {},
        },
        isVisible: function() { return true; },
        _textContent: '',
        get textContent() {
            if (typeof(this._textContent) === "undefined") this._textContent = '';
            return this._textContent;
        },
        set textContent(d) {
            this._textContent = d;
            logIOC('Element Text', {d}, "The script changed textContent of an element.");
        },
        focus: function() {},
    };
    fake_elem["contentWindow"] = {
        document: document,
    };
    return fake_elem;
};
__fakeParentElem = __createElement("FakeParentElem");

// Fake up the then() method. This dict can be returned by methods
// that use the a.b().then() pattern. All this does is call the
// function passed to the then().
const __stubbed_then = {
    then: function(f) {
	f();
    },
}

// Track the current text in the clipboard.
var __currClipboardData = "";

// Stubbed global navigator object.
const navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    clipboard: {
        writeText : function(txt) {
            logIOC('Clipboard', txt, "The script pasted text into the clipboard.");
	    __currClipboardData = txt;
	    return __stubbed_then;
        },
    },
    connection: {
    },
    cookieEnabled: {
    },
    credentials: {
    },
    deviceMemory: {
    },
    geolocation: {
    },
    gpu: {
    },
    hid: {
    },
    hardwareConcurrency: {
    },
    ink: {
    },
    keyboard: {
    },
    language: "english",
    languages: {
    },
    locks: {
    },
    maxTouchPoints: {
    },
    mediaCapabilities: {
    },
    mediaDevices: {
    },
    mediaSession: {
    },
    onLine: {
    },
    pdfViewerEnabled: {
    },
    permissions: {
    },
    platform: "Win32",
    presentation: {
    },
    serial: {
    },
    serviceWorker: {
    },
    scheduling: {
    },
    storage: {
    },
    userActivation: {
    },
    userAgentData: {
    },
    virtualKeyboard: {
    },
    webdriver: false,
    windowControlsOverlay: {
    },
    xr: {
    },    
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

// Stubbed NodeIterator object that does nothing.
function _getNodeIterator (root) {
    const r = {
	root: root,
	nextNode: function() { return null; },
    };
    return r;
}

// Stubbed global document object.
generatedElements = {};
var document = {
    documentMode: 8, // Fake running in IE8
    nodeType: 9,
    scripts: [],
    title: "A Web Page",
    referrer: 'https://www.bing.com/',
    body: __createElement("__document_body__"),
    location: location,
    readyState: "complete",
    head: {
        innerHTML: "",
        append: _generic_append_func,
        appendChild: _generic_append_func,
        prepend: _generic_append_func,
    },
    defaultView: {},
    set cookie(val) {
        this._cookie = val;
        logIOC('document.cookie', val, "The script set a cookie.");
    },
    get cookie() {
        if (typeof(this._cookie) === "undefined") this._cookie = "";
        return this._cookie;
    },
    ready: function(func) {
        func();
    },
    elementCache : {},
    execCommand : function(cmd) {
        if ((cmd == "copy") && (typeof(__currSelectedVal) !== "undefined")) {
            logIOC('Clipboard', __currSelectedVal, "The script pasted text into the clipboard.");
	    __currClipboardData = __currSelectedVal;
        }
    },
    getElementById : function(id) {

	// Normalize ID.
	if (id.startsWith(".")) id = id.slice(1);
	
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

	    // Look for it in ID map.
            for (var i = 0; i < ids.length; i++) {
                if (char_codes_to_string(ids[i]) == id) {
                    var r = __createElement(id);
                    r.innerHTML = char_codes_to_string(data[i]);
                    r.innerText = char_codes_to_string(data[i]);
                    r.getAttribute = function(attrId) {
                        return this.attrs[attrId];
                    };
                    r.attrs = attrs[i];
                    this.elementCache[id] = r;
                    r.val = jqueryVals[id];
                    if ((typeof(r.val) == "undefined") || (r.val == "")) r.val = "legituser@mylegitdomain.com";
                    return r;                    
                }
            }

            // Maybe just tracked as attr?
	    for (var i = 0; i < attrs.length; i++) {
		if ((attrs[i].class === id) || ((attrs[i].id === id))) {
                    var r = __createElement(id);
                    r.value = attrs[i].value;
                    if ((typeof(r.value) == "undefined") || (r.value == "")) r.value = "legituser@mylegitdomain.com";
		    return r;
		}
	    }
            
        }

        // Have we already made a fake element for this ID?
        if (typeof(generatedElements[id]) !== "undefined") return generatedElements[id];
        
        // got nothing to return. Make up some fake element and hope for the best.
        var r = __createElement(id);
        r.val = jqueryVals[id];
        if (typeof(r.val) == "undefined") r.val = "legituser@mylegitdomain.com";
	r.prepend = function() {};
        generatedElements[id] = r;
        return r;
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
    writeln: function (content) {
        this.write(content);
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
    getElementsByName: __getElementsByTagName,
    getElementsByClassName: __getElementsByTagName,
    createDocumentFragment: function() {
        return __createElement("__doc_fragment__");
    },
    createElement: __createElement,
    createTextNode: function(text) {},
    addEventListener: function(tag, func) {
        if (typeof(func) === "undefined") return;
        // Simulate the event happing by running the function.
        logIOC("Document.addEventListener()", {event: tag}, "The script added an event listener for the '" + tag + "' event.");
        func(dummyEvent);
        listenerCallbacks.push(func);
    },
    removeEventListener: function(tag) {
        logIOC("Document.removeEventListener()", {event: tag}, "The script removed an event listener for the '" + tag + "' event.");
    },
    createAttribute: function(name) {
        logIOC('Document.createAttribute()', {name}, "The script added attribute '" + name + "' to the document.");
        return __createElement(name);
    },
    querySelector: function(selectors) {
        logIOC('Document.querySelector()', {selectors}, "The script queried the DOM for selectors '" + selectors + "' .");
	return document.getElementById(selectors);
    },
    querySelectorAll: function(selectors) {
        logIOC('Document.querySelector()', {selectors}, "The script queried the DOM for selectors '" + selectors + "' .");
	return [document.getElementById(selectors)];
    },    
    keypress: function() {},
    createNodeIterator: function(root) {
	return _getNodeIterator(root);
    },
    currentScript: __makeFakeElem(""),
    open: function() {
        return this;
    },
    close: function() {},
};
document.documentElement = document;

// Stubbed out URL class.
class URL {

    constructor(url, base="") {
        if (typeof(url) == "undefined") url = "???";
	this.url = url + base;
        this.hostname = "???";
        const startHost = this.url.indexOf("://");
        if (startHost >= 0) {
            this.hostname = this.url.slice(startHost + 3);
            const endHost = this.hostname.indexOf("/");
            if (endHost >= 0) {
                this.hostname = this.hostname.slice(0, endHost);
            }
        }
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

function requestAnimationFrame(func) {
    lib.logIOC("requestAnimationFrame()", {}, "The script ran a function with requestAnimationFrame().");
    func();
}

// Initial stubbed object. Add items a needed.
var screen = {
    availHeight: 2000,
    availWidth: 4000,
    colorDepth: 12,
    height: 1000,
    isExtended: false,
    mozBrightness: .3,
    mozEnabled: false,
    orientation: {
        type: "landscape-primary",
    },
    pixelDepth: 9,
    width: 2000,
};

class XMLHttpRequest {
    constructor(){
        this.method = null;
        this.url = null;
        this.readyState = 4;
        this.status = 200;
        this.responseText = "";
    };

    _onreadystatechange = undefined;
    get onreadystatechange() {
        return this._onreadystatechange;
    };
    set onreadystatechange(func) {
        lib.info("onreadystatechange() method set for XMLHTTP object.");
        this._onreadystatechange = func;
        if (typeof(func) !== "undefined") {
            try {
                func("fake");
            }
            catch (e) {
                lib.info("Callback function execution failed. Continuing analysis anyway.");
            }
        }
    };
    
    addEventListener(tag, func) {
        if (typeof(func) === "undefined") return;
        // Simulate the event happing by running the function.
        logIOC("XMLHttpRequest.addEventListener()", {event: tag}, "The script added an event listener for the '" + tag + "' event.");
        func(dummyEvent);
        listenerCallbacks.push(func);
    };

    removeEventListener(tag) {
        logIOC("XMLHttpRequest.removeEventListener()", {event: tag}, "The script removed an event listener for the '" + tag + "' event.");
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

dataLayer = [];

// Stubbed global window object.
function makeWindowObject() {
    var window = {
        get park() {
            if (typeof(this._park) === "undefined") this._park = '???';
            return this._park;
        },
        set park(val) {
            logIOC('Window Parking', val, "The script changed window.park.");
        },        
        eval: function(cmd) { return eval(cmd); },
	btoa: btoa,
        resizeTo: function(a,b){},
        moveTo: function(a,b){},
        open: function(url) {
            if ((typeof(url) == "string") && (url.length > 0)){
                logIOC('window.open()', {url}, "The script loaded a resource.");
            }
        },
        close: function(){},
        requestAnimationFrame: requestAnimationFrame,
        matchMedia: function(){ return {}; },
        setInterval:function(){ return {}; },
        atob: function(s){
            return atob(s);
        },
        setTimeout: function(f, i) {
	},
        Date: Date,
        addEventListener: function(tag, func) {
            if (typeof(func) === "undefined") return;
            // Simulate the event happing by running the function.
            logIOC("Window.addEventListener()", {event: tag}, "The script added an event listener for the '" + tag + "' event.");
            func(dummyEvent);
            listenerCallbacks.push(func);
        },
        removeEventListener: function(tag) {
            logIOC("Window.removeEventListener()", {event: tag}, "The script removed an event listener for the '" + tag + "' event.");
        },
        attachEvent: function(){},
        getComputedStyle: function(){
	    return ["??",
		    "-moz-"];
        },
        createDocumentFragment: function() {},
        createElement: __createElement,    
        screen: screen,
        _location: location,
        get location() {
            return this._location;
        },
        set location(url) {
            this._location.href = url;
        },
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
        dataLayer: [],
        navigator: navigator,
        _NavbarView: class _NavbarView {
            constructor() {};    
        },
        URL: URL,
        decodeURIComponent: decodeURIComponent,
        set onload(func) {
	    lib.info("Script set window.onload function.");
	    func();
        },
        get MAIL_URL() {
            if (typeof(this._MAIL_URL) === "undefined") this._href = 'http://mylegitdomain.com:2112/and/i/have/a/path.php#tag?var1=12&var2=checkout&ref=otherlegitdomain.moe';
            return this._MAIL_URL;
        },
        set MAIL_URL(url) {
	    // Could be base64.
	    if (atob(url)) url = atob(url);
	    this._MAIL_URL = url;
	    logIOC('MAIL_URL Location', {url}, "The script changed window.MAIL_URL.");
	    logUrl('MAIL_URL Location', url);
        },
        XMLHttpRequest: XMLHttpRequest,
	clipboardData: {
	    getData: function() {
		return __currClipboardData;
	    },
            setData: function (typ, txt) {
                logIOC('Clipboard', txt, "The script pasted text into the clipboard.");
	        __currClipboardData = txt;
	        return __stubbed_then;
            },
	},
        frames: [],
    };

    return window;
}
window = makeWindowObject();
window.self = window;
window.top = window;
self = window;
window.parent = makeWindowObject();
download = window;
const _localStorage = {
    getItem: function(x) {
        // Can access localStorage with a URL (does not seem local but whatever).
        if (x.startsWith("http://") || x.startsWith("https://")) {
            logIOC('localStorage', {x}, "The script accessed a URL with localStorage.getItem().");
	    logUrl('localStorage', x);
        }
        return null
    },
    setItem: function(x,y) {},
};
window.localStorage = _localStorage;
window.String = String;
window.RegExp = RegExp;
window.JSON = JSON;
window.Array = Array;
localStorage = _localStorage;
top = window;

// Initial stubbed object. Add items a needed.
var ShareLink = {
};

// Initial stubbed function. Add items a needed.
function define(path, func) {
    // Run the function.
    if (!(typeof(func) === "function")) return;
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
    val: function() { return "some@emailaddr.moe" },
    click: function(f) {
	f(dummyEvent);
    },
    scroll: function() {},
    modal: function() {},
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
    submit: function(func) {
        func(dummyEvent);
    },
    hide: function() {},
    keypress: function() {},
    animate: function() {},
    show: function() {},
    html: function() {},
    focus: function() {},
    text: function() {},
};
var jQuery = function(field){
    // Handle things like $(document) by just returning document.
    if ((typeof(field) != "undefined") && (typeof(field) != "string")) {
        return field;
    };
    // If we have $('string') it looks like we should get some JQuery
    // object back.
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
jQuery.ajax = function(params) {
    const url = params["url"];
    if (typeof(url) == "undefined") return;
    logIOC('AJAX', {url}, "The script used $.ajax() to hit a URL.");
    logUrl('AJAX', url);    
};
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
jQuery.getJSON = function(url) {
    logIOC('JQuery.getJSON()', {url}, "The script called JQuery.getJSON()");
    logUrl('JQuery.getJSON()', url);
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
    prototype() { return {}; };
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
if (WScript.name != "node") {
    Array.prototype.reduce = function(a, b) {
        throw "CScript JScript has no Array.reduce() method."
    };
};

timeoutFuncs = {}
function setTimeout(func, time) {
    if (!(typeof(func) === "function")) return;
    // No recursive loops.
    const funcStr = ("" + func);
    if (typeof(timeoutFuncs[funcStr]) == "undefined") timeoutFuncs[funcStr] = 0;
    if (timeoutFuncs[funcStr] > 2) {
        console.log("Recursive setTimeout() loop detected. Breaking loop.")
        return func;
    }
    timeoutFuncs[funcStr]++;
    func();
    return func;
};
function clearTimeout() {};
function setInterval(func, val) {
    if (typeof(func) === "function") {
        func();
    };
};
function clearInterval() {};

// Some JS checks to see if these are defined. Do very basic stubbing
// until better stubbing is needed.
var exports = {};
//var module = {};

// fetch API emulation.
function fetch(url, data) {
    lib.logIOC("fetch", {url: url, data: data}, "The script fetch()ed a URL.");
    lib.logUrl("fetch", url);
    const r = {
	ok : true,
	json : function() { return "1"; },
    };
    const p = new Promise((resolve, reject) => {
        resolve(r);
    });
    return p;
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
    if ((typeof(html) == "undefined") || (typeof(html.match) == "undefined")) return undefined;
    
    // Do we have action attributes?
    const actPat = /(?:action|src)\s*=\s*"([^"]*)"/g;
    const r = [];
    for (const match of html.matchAll(actPat)) {
        var currAct = match[1];
        if (currAct == "//null") continue;
        if (!currAct.startsWith("http") && !currAct.startsWith("//")) continue;
        if (currAct.startsWith("//")) currAct = "https:" + currAct;
        r.push(currAct);
    }

    // Do we have URLs in the action attribute values?
    if (r.length == 0) return undefined;
    return r;
}

// Pull JS from onclick="" HTML element attributes.
function pullClickHandlers(html) {

    // Sanity check.
    if ((typeof(html) == "undefined") || (typeof(html.match) == "undefined")) return [];
    
    // Do we have action attributes?
    const actPat = /onclick\s*=\s*"([^"]+)"/g;
    const r = [];
    for (const match of html.matchAll(actPat)) {
        var currAct = match[1];
        if (currAct == "//null") continue;
        r.push(currAct);
    }

    // Done.
    return r;
}


// Stubbing for chrome object. Currently does very little.
const chrome = {

    extension: {
        onMessage: {
            addListener: function () {}
        },            
    },

    runtime : {
        sendMessage : function(info) {
            if (info["url"]) {
                var url = info["url"];
                var method = "??";
                if (info["message"]) method = info["message"];
                lib.logIOC("chrome.runtime.sendMessage", {method: method, url: url}, "The script opened a HTTP request.");
                lib.logUrl("chrome.runtime.sendMessage", url);
            };
        },
    },    
};

Modernizr = {};

mediaContainer = {
    Click : function () {},
};

function addEventListener(event, func) {
    func(dummyEvent);
    listenerCallbacks.push(func);
}

if (typeof(arguments) === "undefined") {
    var arguments = [];
}

// TODO: Add flag to specify whether to use high or low values.
var randVal = 0.01;
Math.random = function() {
    logIOC('Math.random', {}, "Script called Math.random().");
    const r = randVal;
    randVal += 0.1;
    if (randVal > 1.0) randval = 0.01;
    return r;
}

// Fake history object.
var history = {

    replaceState: function(state, unused, url) {
        logIOC('history', url, "The script changed browsing history with history.replaceState().");
        // Let's assume that the current location is being set to this URL.
        location._href = url;
    },
    pushState: function() {},
};

// Fake sessionStorage object.
var sessionStorage = {
    getItem: function() {},
    setItem: function() {},
};

// Stubbed URLSearchParams class.
class URLSearchParams {
    constructor() {};
    get() {};
    append() {};
}

// Very stubbed NodeFilter "class".
var NodeFilter = {
    FILTER_ACCEPT: 1,
    SHOW_COMMENT: 2,
}

function moveTo() {};
function resizeTo() {};

// Stubbed JWPlayer (video player) support.
// https://jwplayer.com/
function jwplayer(arg) {

    // Constructor?
    if (typeof(arg) !== "undefined") {
        
        // Return a fake JWPlayer object.
        return {
            setup: function() {},
            on: function(event, func) {
                func();
            },
            remove: function() {},
        };
    }

    // Maybe static methods?
    return {
        getPosition: function () {
            return 100.0;
        },
        getDuration: function () {
            return 100.0;
        },
        getState: function () {
            return "idle";
        },
        play: function () {},
    }
}

// Stubbed performance object.
performance = {
    now: function() { return 51151.43; },
}

// (Very) stubbed DOMParser class.
class DOMParser {

    parseFromString(content) {
        logIOC("DOMParser", {content}, "DOMParser.parseFromString() called.");

        // Pull action attribute URLs.
        const urls = pullActionUrls(content);
        if (typeof(urls) !== "undefined") {
            for (const url of urls) {
                logUrl('Action Attribute', url);
            };
        }
        
        // Pull out onclick JS and run it (eventually).
        const clickHandlers = pullClickHandlers(content);
        if (clickHandlers.length > 0) {
            lib.info("onclick handler code provided in parsed HTML.");
            for (const handler of clickHandlers) {
                
                // Save the onclick handler code snippets so we can
                // run them again at the end in case the DOM has
                // changed.
                dynamicOnclickHandlers.push(handler);
            }
        }

        // Return a fake "parsed" element.
        return document;
    };
};

// Call all of the dynamically created on click handlers and listener
// callbacks.
function callDynamicHandlers() {

    // On click handlers.
    for (const handler of dynamicOnclickHandlers) {
        try {
            eval(handler);
        }
        catch (e) {
            console.log(e.message);
            console.log(handler);
        }
    }

    // Listener callbacks.
    for (const func of listenerCallbacks) {
        try {
            func(dummyEvent);
        }
        catch (e) {
            console.log(e.message);
            console.log(handler);
        }
    }
}
