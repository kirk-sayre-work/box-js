const child_process = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const request = require("sync-request");
const uuid = require("uuid");
const argv = require("./argv.js").run;
const fakeFiles = require("./emulator/FakeFiles");

const directory = path.normalize(process.argv[3]);

const urls = [];
const activeUrls = [];
const snippets = {};
const resources = {};
const files = {};
const IOC = [];

let latestUrl = "";

function simpleStringify(object, a, b) {
    if (object && typeof object === 'object') {
        const tmpObject = copyWithoutCircularReferences([object], object);
        var newObject = [];
        for (var i = 0; i < Object.keys(tmpObject).length; i++) {
            newObject.push(tmpObject[""+i]);
        }
        object = newObject;
    }
    return JSON.stringify(object, a, b);
    
    function copyWithoutCircularReferences(references, object) {
        var cleanObject = {};
        Object.keys(object).forEach(function(key) {
            var value = object[key];
            if (value && typeof value === 'object') {
                if (references.indexOf(value) < 0) {
                    references.push(value);
                    cleanObject[key] = copyWithoutCircularReferences(references, value);
                    references.pop();
                } else {
                    cleanObject[key] = '###_Circular_###';
                }
            } else if (typeof value !== 'function') {
                cleanObject[key] = value;
            }
        });
        return cleanObject;
    }
}

const logSnippet = function(filename, logContent, content) {
    snippets[filename] = logContent;
    fs.writeFileSync(path.join(directory, filename), "" + content);
    fs.writeFileSync(path.join(directory, "snippets.json"), simpleStringify(snippets, null, "\t"));
};

function kill(message) {
    if (argv["no-kill"])
	throw new Error(message);
    console.trace(message);
    console.log("Exiting (use --no-kill to just simulate a runtime error).");
    process.exit(0);
}

function log(tag, text, toFile = true, toStdout = true) {
    const levels = {
	"debug": 0,
	"verb": 1,
	"info": 2,
	"warn": 3,
	"error": 4,
    };
    if (!(tag in levels)) {
	log("warn", `Application error: unknown logging tag ${tag}`, false);
	return;
    }
    if (!(argv.loglevel in levels)) {
	const oldLevel = argv.loglevel; // prevents infinite recursion
	argv.loglevel = "debug";
	log("warn", `Log level ${oldLevel} is invalid (valid levels: ${Object.keys(levels).join(", ")}), defaulting to "info"`, false);
    }
    const level = levels[tag];
    if (level < levels[argv.loglevel]) return;
    const message = `[${tag}] ${text}`;
    if (toStdout || argv.loglevel === "debug") // Debug level always writes to stdout and file
	console.log(message);
    if (toFile || argv.loglevel === "debug")
	fs.appendFileSync(path.join(directory, "analysis.log"), message + "\n");
}

function hash(algo, string) {
    return crypto.createHash(algo).update(string).digest("hex");
}

const getUUID = uuid.v4;

function logIOC(type, value, description) {
    log("info", "IOC: " + description);
    IOC.push({type, value, description});
    fs.writeFileSync(path.join(directory, "IOC.json"), simpleStringify(IOC, null, "\t"));
}

function logUrl(method, url) {
    log("info", `${method} ${url}`);
    latestUrl = url;
    if (urls.indexOf(url) === -1) urls.push(url);
    fs.writeFileSync(path.join(directory, "urls.json"), simpleStringify(urls, null, "\t"));
}

// Track the # of times we have seen a file written to so we don't spam
// emulation output.
const MAXWRITES = 10;
fileWriteCount = {};

// If needed stop writing bytes to very large files.
const MAXBYTES = 1e+6 * 10; // 10MB
resourceWriteCount = {};
var throttleWrites = false;
tooBigFiles = {};

// Function for enabling/disabling file write throttling.
function throttleFileWrites(val) {
    throttleWrites = val;
};

// If needed stop writing lots of the same sorts of commands.
var _throttleCommands = false;
var numCommandsRun = 0;
const maxCommands = 5000;
const maxPrefixCommands = 500;
var commandPrefixCounts = {};

// Function for enabling/disabling command throttling.
function throttleCommands(val) {
    _throttleCommands = val;
};

function noCasePropObj(obj)
{
    var handler =
	{
	    get: function(target, key)
	    {
		//console.log("key: " + key.toString());
		if (typeof key == "string")
		{
		    var uKey = key.toUpperCase();

		    if ((key != uKey) && (key in target))
			return target[key];
		    return target[uKey];
		}
		return target[key];
	    },
	    set: function(target, key, value)
	    {
		if (typeof key == "string")
		{
		    var uKey = key.toUpperCase();

		    if ((key != uKey) && (key in target))
			target[key] = value;
		    target[uKey] = value;
		}
		else
		    target[key] = value;
	    },
	    deleteProperty: function(target, key)
	    {
		if (typeof key == "string")
		{
		    var uKey = key.toUpperCase();

		    if ((key != uKey) && (key in target))
			delete target[key];
		    if (uKey in target)
			delete target[uKey];
		}
		else
		    delete target[key];
	    },
	};
    function checkAtomic(value)
    {
	if (typeof value == "object")
	    return new noCasePropObj(value); // recursive call only for Objects
	return value;
    }

    var newObj;

    if (typeof obj == "object")
    {
	newObj = new Proxy({}, handler);
        // traverse the Original object converting string keys to upper case
	for (var key in obj)
	{
	    if (typeof key == "string")
	    {
		var objKey = key.toUpperCase();

		if (!(key in newObj))
		    newObj[objKey] = checkAtomic(obj[key]);
	    }
	}
    }
    else if (Array.isArray(obj))
    {
        // in an array of objects convert to upper case string keys within each row
	newObj = new Array();
	for (var i = 0; i < obj.length; i++)
	    newObj[i] = checkAtomic(obj[i]);
    }
    return newObj; // object with upper cased keys
};

_doWscriptQuit = false;
function doWscriptQuit(flag) {
    if (typeof(flag) != "undefined") _doWscriptQuit = flag;
    return _doWscriptQuit;
}

module.exports = {
    argv,
    kill,
    getUUID,
    throttleFileWrites,
    throttleCommands,
    noCasePropObj,
    doWscriptQuit,
    
    debug: log.bind(null, "debug"),
    verbose: log.bind(null, "verb"),
    info: log.bind(null, "info"),
    warning: log.bind(null, "warn"),
    error: log.bind(null, "error"),

    proxify: (actualObject, objectName = "<unnamed>") => {
	/* Creating a Proxy is a common operation, because they normalize property names
	 * and help catch unimplemented features. This function implements this behaviour.
	 */
	return new Proxy(new actualObject, {
	    get: function(target, prop) {
		const lProp = prop.toLowerCase();
		if (lProp in target) return target[lProp];
		kill(`${objectName}.${prop} not implemented!`);
	    },
	    set: function(a, b, c) {
		b = b.toLowerCase();
		a[b] = c;
		return true;
	    },
	});
    },
    fetchUrl: function(method, url, headers = {}, body) {
	// Ignore HTTPS errors
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
	logUrl(method, url);
	logIOC("UrlFetch", {method, url, headers, body}, "The script fetched an URL.");

        // Fake that the request worked?
        if (argv["fake-download"]) {
            log("info", "Returning HTTP 200 (Success) with fake response payload 'console.log(\"EXECUTED DOWNLOADED PAYLOAD\");'");
	    return {
		body: new Buffer("console.log(\"EXECUTED DOWNLOADED PAYLOAD\");"),
		headers: {},
	    };
        }        

        // Do no download, say that it failed.
	if (!argv.download) {
	    log("info", "Returning HTTP 404 (Not found); use --download to actually try to download the payload or --fake-download to fake the download");
	    return {
		body: new Buffer(""),
		headers: {},
	    };
	}
	try {
	    log("info", "Downloading...");

	    headers["User-Agent"] = "Mozilla/4.0 (Windows; MSIE 6.0; Windows NT 6.0)";
	    const options = {
		headers,
		maxRedirects: 20,
		timeout: 4000,
	    };
	    if (body)
		options.body = body;
	    if (argv.proxy)
		options.proxy = argv.proxy;

	    const file = request(method, url, options);
	    Buffer.prototype.charCodeAt = function(index) {
		return this[index];
	    };
	    log("info", `Downloaded ${file.body.length} bytes.`);
	    return file;
	} catch (e) {
	    // Log and rethrow
	    log("error", `An error occurred while emulating a ${method} request to ${url}.`);
	    log("error", e);
	    throw e;
	}
    },
    writeFile: function(filename, contents) {
        // Don't spam lots of file write info to same file.
        if (typeof(fileWriteCount[filename]) == "undefined") fileWriteCount[filename] = 0;
        fileWriteCount[filename]++;
        var doLog = (!throttleWrites) || (fileWriteCount[filename] <= MAXWRITES);
	if (doLog) logIOC("FileWrite", {file: filename, contents}, "The script wrote file '" + filename + "'.");        
	files[filename] = contents;
    },
    readFile: function(filename) {
	logIOC("FileRead", {file: filename}, "The script read a file.");
        // Do we have some fake contents for this file?
        const r = fakeFiles.ReadFakeFileContents(filename);
        if (typeof(r) !== "undefined") {
            return r;
        }
	return files[filename];
    },
    logUrl,
    logResource: function(resourceName, emulatedPath, content) {

	// Writing a Blob?
	if (content.constructor.name == "Blob") {

	    // Grab the actual contents as a byte string.
	    content = content.data;
	};
	
        // Throttle lots of small writes to a resource when the resource is large.
        const filePath = path.join(directory, resourceName);
        if (typeof(resourceWriteCount[resourceName]) == "undefined") resourceWriteCount[resourceName] = 0;
        resourceWriteCount[resourceName]++;
        var throttle = (resourceWriteCount[resourceName] > MAXWRITES * 50) &&
            (content.length > MAXBYTES/5) && throttleWrites
        if (throttle) {
            if (typeof(tooBigFiles[filePath]) == "undefined") {
                log("warn", "File '" + filePath + "' is too big with too many small writes. Not writing.");
                tooBigFiles[filePath] = true;
            }
            return;
        }
        
        // Has this file aready gotten too large?
        if (throttleWrites && (content.length > MAXBYTES)) {
            if (typeof(tooBigFiles[filePath]) == "undefined") {
                log("warn", "File '" + filePath + "' is too big. Not writing.");
                tooBigFiles[filePath] = true;
            }
            return;
        };

        // Save the new file contents. Save as binary data to make
        // sure we dump the exact bytes to disk.
	fs.writeFileSync(filePath, content, "binary");

        // Don't spam lots of file write info to same file.
        if (typeof(fileWriteCount[filePath]) == "undefined") fileWriteCount[filePath] = 0;
        fileWriteCount[filePath]++;
        var doLog = (!throttleWrites) || (fileWriteCount[filePath] <= MAXWRITES);
        let filetype = "";
	if (doLog) {
            log("info", `Saved ${filePath} (${content.length} bytes)`);
	    filetype = child_process.execSync("file " + simpleStringify(filePath)).toString("utf8");
	    filetype = filetype.replace(`${filePath}: `, "").replace("\n", "");
            log("info", `${filePath} has been detected as ${filetype}.`);
        }
        if (fileWriteCount[filePath] == (MAXWRITES + 1)) {
            log("warn", "Throttling file write reporting for " + filePath);
        }

	if (doLog && (/executable/.test(filetype))) {
	    // Log active url
	    log("info", `Active URL detected: ${latestUrl}`);
	    if (activeUrls.indexOf(latestUrl) === -1)
		activeUrls.push(latestUrl);
	    fs.writeFileSync(path.join(directory, "active_urls.json"), simpleStringify(activeUrls, null, "\t"));
	}

	if (doLog) {
	    const md5 = hash("md5", content);
	    log("verb", "md5:    " + md5);
	    const sha1 = hash("sha1", content);
	    log("verb", "sha1:   " + sha1);
	    const sha256 = hash("sha256", content);
            log("verb", "sha256: " + sha256);

	    const resource = {
	        path: emulatedPath,
	        type: filetype,
	        latestUrl,
	        md5,
	        sha1,
	        sha256
	    };
            logIOC("NewResource", resource, "The script created a resource.");
	    fs.writeFileSync(path.join(directory, "resources.json"), simpleStringify(resources, null, "\t"));
            resources[resourceName] = resource;
        }
    },
    logSnippet,
    logJS: function(code) {
	const filename = uuid.v4() + ".js";
	log("verb", `Code saved to ${filename}`);
	logSnippet(filename, {as: "eval'd JS"}, code);
	return code; // Helps with tail call optimization
    },
    logIOC,
    runShellCommand: (command) => {
        // Have too many commands been run?
        if (_throttleCommands) {

            // Too many commands total?
            numCommandsRun++;
            if (numCommandsRun > maxCommands) {
                log("warn", "Too many commands were run. Terminating.");
                console.log("");
                // We want this to take precedence over the --no-kill
                // flag, so directly exit.
                process.exit(0);
            }

            // Too many very similar commands?
            if (command.lastIndexOf(" ") > 10) {

                // Assuming that a command may just vary by an
                // argument, strip off the last argument.
                const end = command.lastIndexOf(" ");
                const prefix = command.slice(0, end);
                if (!(prefix in commandPrefixCounts)) {
                    commandPrefixCounts[prefix] = 0;
                }
                commandPrefixCounts[prefix]++;
                if (commandPrefixCounts[prefix] > maxPrefixCommands) {
                    log("warn", "Too many similar commands were run. Terminating.");
                    console.log("");
                    // We want this to take precedence over the --no-kill
                    // flag, so directly exit.
                    process.exit(0);
                }
            }
        }
        
	const filename = getUUID();
        command = "" + command;
	logIOC("Run", {command}, "The script ran the command '" + command + "'.");
	logSnippet(filename, {as: "WScript code"}, command);
	process.send("expect-shell-error");
	if (!argv["no-shell-error"])
	    throw new Error("If you can read this, re-run box.js with the --no-shell-error flag.");
	process.send("no-expect-shell-error");
    }
};
