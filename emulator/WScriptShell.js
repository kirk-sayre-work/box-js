const lib = require("../lib.js");
const TextStream = require("./TextStream.js");
const argv = require("../argv.js").run;

function WScriptShell() {

    this.clazz = "WScriptShell";
    
    const vars = {
	/* %APPDATA% equals C:\Documents and Settings\{username}\Application Data on Windows XP,
	 * but C:\Users\{username}\AppData\Roaming on Win Vista and above.
	 */
	appdata: argv["windows-xp"]
	    ? "C:\\Documents and Settings\\User\\Application Data"
	    : "C:\\Users\\User\\AppData\\Roaming",
	localappdata: "C:\\Users\\Sysop12\\AppData\\Local",
	computername: "DOMAIN-CONTROLLER-1",
	comspec: "%SystemRoot%\\system32\\cmd.exe",
	homedrive: "C:",
	homepath: "\\Users\\Sysop12",
	logonserver: "\\\\DOMAIN-CONTROLLER-1",
	number_of_processors: "4",
	os: "Windows_NT",
	path: "C:\\WINDOWS\\system32;C:\\WINDOWS;C:\\WINDOWS\\System32\\Wbem;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0",
	pathext: ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
	processor_revision: "0209",
	processor_architecture: "x86",
	processor_architew6432: "AMD64",
	allusersprofile: "C:\\ProgramData",
	programdata: "C:\\ProgramData",
	programfiles: "C:\\Program Files",
	"programfiles(x86)": "C:\\Program Files (x86)",
	commonprogramfiles: "C:\\Program Files\\Common Files",
	public: "C:\\Users\\Public",
	session_name: "Console",
	systemdrive: "C:",
	systemroot: "C:\\WINDOWS",
	//tmp: "C:\\DOCUME~1\\User\\LOCALS~1\\Temp",
	tmp: "C:\\Users\\SYSOP1~1\\AppData\\Local\\Temp",
	//temp: "C:\\DOCUME~1\\User\\LOCALS~1\\Temp",
	temp: "C:\\Users\\SYSOP1~1\\AppData\\Local\\Temp",
	username: "Sysop12",
	userdomain: "DOMAIN-CONTROLLER-1",
	userprofile: "C:\\Users\\Sysop12\\",
	windir: "C:\\WINDOWS"
    };

    // Environment variables assigned by the sample at runtime.
    var assignedVars = {};

    this._envVarLookup = function (argument) {
	argument = argument.toLowerCase();
	if (argument in vars) return vars[argument];
	if (argument in assignedVars) return assignedVars[argument];
	// Return a fake value so all environment variable reads succeed?
        if (argv["fake-reg-read"]) return ("Unknown environment variable " + argument);
	lib.kill(`Unknown parameter ${argument} for WScriptShell.Environment.*`);
    };
    
    this.environment = (x) => {
	if ((x.toLowerCase() === "system") || (x.toLowerCase() === "process") || (x.toLowerCase() === "user")) {
	    var r = this._envVarLookup;
	    r.Item = function(x) {
		if (x.toLowerCase() === "programdata")
		    return "C:\\ProgramData";
		return "Unknown environment variable " + x;
	    };
	    r.rvalAssign = function(varName, varVal) {
		assignedVars[varName] = varVal;
		lib.logEnvVar(varName, varVal);
	    };
	    // Keep Item() callable for reads while still supporting the
	    // rewritten `Environment("Process")("X") = "Y"` assignment form.
	    r.Item.rvalAssign = r.rvalAssign;
	    return r;
	}
	return `(Environment variable ${x})`;
    };

    this.environment1 = undefined;
    this.specialfolders = (x) => `${x}`;
    this.createshortcut = function(shortcut) {

        // Thrown error for things that don't look like MS shortcuts.
        const shortcutS = shortcut.trim();
        if (!shortcutS.endsWith(".lnk") &&
            !shortcutS.endsWith(".URL") &&
            !shortcutS.endsWith(".url")) throw "Shortcut '" + shortcutS + "' is invalid.";

        // Valid shortcut file name. Return a fake shortcut object.
        return {
            name: shortcut,
            Save: function() {
                var name = "???";
                if (typeof(this.name) !== "undefined") {
                    name = this.name;
                };
                var cmd = "???";
                if ((typeof(this.targetPath) !== "undefined") && (typeof(this.arguments) !== "undefined")) {
                    cmd = "" + this.targetPath + " " + this.arguments;
                }
                lib.logIOC("CreateShortcut", {name: name, cmd: cmd}, "The script saved a shortcut.");
            }
        };
    };
    this.expandenvironmentstrings = (path) => {
	Object.keys(vars).forEach(key => {

	    const regex = RegExp("%" + key + "%", "gi");

	    if (!regex.test(path)) return;

	    lib.logIOC("Environ", key, "The script read an environment variable");
	    path = path.replace(regex, vars[key]);
	});

	if (/%\w+%/i.test(path)) {
	    lib.warning("Possibly failed to expand environment strings in " + path);
	}

	return path;
    };
    
    this.run = cmd => {
	lib.runShellCommand(cmd);
	return 0;
    };
    
    this.exec = function(cmd) {
	lib.runShellCommand(cmd);
        var r = {
	    ExitCode: 1,
	    ProcessID: Math.floor(Math.random() * 1000),
	    Status: 1, // Finished			
	    StdErr: null,
	    StdIn: {
                writeline: function(txt) {
                    lib.logIOC("Run", txt, "The script piped text to a process: '" + txt + "'.");
                },
            },
	    StdOut: new TextStream(`<output of ${cmd}>`),
	};
        return lib.noCasePropObj(r);
    };

    if (!this._reg_entries) {
	this._reg_entries = require("system-registry");
        
	// lacks the HKEY_CURRENT_USER reg key by default (y tho?)
	this._reg_entries["HKEY_CURRENT_USER"] = {}
	this._reg_entries["HKEY_CURRENT_USER"]["Control Panel"] = {"International" : {"Locale" : "0x407"}}

	/* Samples routinely resolve an interpreter/LOLBin path through
	 * App Paths before launching it. The bundled system-registry data
	 * is XP-era and has none of these, and an unresolved read aborts
	 * the whole analysis, so seed the ones malware actually asks for.
	 * system-registry nests on ".", so "powershell.exe" is stored as
	 * {powershell: {exe: {"@": <path>}}}.
	 */
	const _sys32 = "C:\\WINDOWS\\system32\\";
	const _appPaths = {
	    "powershell.exe": _sys32 + "WindowsPowerShell\\v1.0\\powershell.exe",
	    "pwsh.exe": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
	    "cmd.exe": _sys32 + "cmd.exe",
	    "wscript.exe": _sys32 + "wscript.exe",
	    "cscript.exe": _sys32 + "cscript.exe",
	    "mshta.exe": _sys32 + "mshta.exe",
	    "certutil.exe": _sys32 + "certutil.exe",
	    "bitsadmin.exe": _sys32 + "bitsadmin.exe",
	    "curl.exe": _sys32 + "curl.exe",
	    "rundll32.exe": _sys32 + "rundll32.exe",
	    "regsvr32.exe": _sys32 + "regsvr32.exe",
	    "schtasks.exe": _sys32 + "schtasks.exe",
	    "reg.exe": _sys32 + "reg.exe",
	    "taskkill.exe": _sys32 + "taskkill.exe",
	    "notepad.exe": _sys32 + "notepad.exe",
	    "explorer.exe": "C:\\WINDOWS\\explorer.exe",
	    "msbuild.exe": "C:\\WINDOWS\\Microsoft.NET\\Framework\\v4.0.30319\\MSBuild.exe",
	    "chrome.exe": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	    "msedge.exe": "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	    "firefox.exe": "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
	    "winword.exe": "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
	    "excel.exe": "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE",
	};
	const _cv = this._reg_entries["HKEY_LOCAL_MACHINE"]["SOFTWARE"]["Microsoft"]["Windows"]["CurrentVersion"];
	if (typeof _cv["App Paths"] === "undefined") _cv["App Paths"] = {};
	for (const _name in _appPaths) {
	    const _parts = _name.split(".");
	    let _node = _cv["App Paths"];
	    for (let _i = 0; _i < _parts.length; _i++) {
		if (typeof _node[_parts[_i]] === "undefined") _node[_parts[_i]] = {};
		_node = _node[_parts[_i]];
	    }
	    _node["@"] = _appPaths[_name];
	    _node["Path"] = _appPaths[_name].substring(0, _appPaths[_name].lastIndexOf("\\"));
	}
    }

    // expand registry acronyms and make lowercase
    function normalizeRegKey(key) {
	key = key
	    .replace("HKLM", "HKEY_LOCAL_MACHINE")
	    .replace("HKCR", "HKEY_CLASSES_ROOT")
	    .replace("HKU", "HKEY_USERS")
	    .replace("HKCU", "HKEY_CURRENT_USER")
	    .replace("HKCC", "HKEY_CURRENT_CONFIG");
	return key.toLowerCase();
    };
    
    // traverse registry object searching for the key
    this._resolveRegKey = (inKey) => {

	var inKeyParts = inKey.split("\\")

	/* A key ending in "\\" names the default value of that subkey,
	 * which system-registry stores under "@".
	 */
	if (inKeyParts.length > 1 && inKeyParts[inKeyParts.length - 1] === "") {
	    inKeyParts[inKeyParts.length - 1] = "@";
	}

	var currRegEntry = this._reg_entries

	// compare the given key to the "this" value (see usage below)
	var keysEqual = function(key) {
	    return normalizeRegKey(key) === normalizeRegKey(this)
	}

	// Descend one path component, which system-registry may have
	// split further on "." (e.g. "powershell.exe" is stored nested as
	// {powershell: {exe: ...}}).
	var descend = function(node, part) {
	    var found = Object.keys(node).filter(keysEqual, part)
	    if (found.length > 0) return node[found[0]]
	    if (part.indexOf(".") === -1) return undefined
	    var sub = node
	    for (const dotPart of part.split(".")) {
		if (typeof sub !== "object" || sub === null) return undefined
		var f = Object.keys(sub).filter(keysEqual, dotPart)
		if (f.length === 0) return undefined
		sub = sub[f[0]]
	    }
	    return sub
	}

	for (inKeyPart of inKeyParts) {
	    var next = descend(currRegEntry, inKeyPart)
	    if (typeof next === "undefined") {
                // Return a fake value so all registry reads succeed?
                if (argv["fake-reg-read"]) return "FAKE_REG_VALUE";
		return undefined
	    }
	    currRegEntry = next
	}

	/* Reading a subkey that carries a default value yields that value,
	 * not the subkey object.
	 */
	if (currRegEntry && typeof currRegEntry === "object" && typeof currRegEntry["@"] === "string") {
	    return currRegEntry["@"]
	}

	return currRegEntry
    }

    this.regread = (key) => {

	// log the IOC whether or not we handle the read correctly
	lib.logIOC("RegRead", {key}, "The script read a registry key");
	value = this._resolveRegKey(key)

	if (value) {
	    lib.verbose(`Read registry key ${key}`);
	    return value
	}
	else {
	    lib.warning(`Unknown registry key ${key}`);
	    //return "";
            throw("Registry key not found.");
	}
    };
    
    this.regwrite = (key, value, type = "(unspecified)") => {

	// log the IOC whether or not we correctly handle it
	lib.logIOC("RegWrite", {key, value, type}, "The script wrote to a registry key");

	var badKey = false
	var existingKey = key
	var existingRegEntry = undefined
	var keysToCreate = []

	// find the deepest part of the given key that exists in our registry object
	do {
	    existingRegEntry = this._resolveRegKey(existingKey)

	    // if we've checked the very top level key and didn't find it
	    if (existingKey.split("\\").length == 1 && !existingRegEntry) {
		lib.info("script tried to write to an invalid key root " + existingKey)
		badKey = true
	    }

	    // chop off the last element of the key path and try again
	    // save the last part of the key that didn't exist as the key we need to create
	    if (!existingRegEntry && !badKey) {
		keyParts = existingKey.split("\\")
		keysToCreate.unshift(keyParts.pop())
		existingKey = keyParts.join("\\")
	    }
	} while (!existingRegEntry && !badKey);

	if (!badKey) {
	    // the key already existed, just need to overwrite the last element
	    if (keysToCreate.length == 0) {
		keysToCreate.unshift(key.split("\\").pop())
	    }

	    lib.info(`Setting registry key ${key} to ${value} of type ${type}`);

	    // iterate through keys that need new nested objects
	    while (keysToCreate.length > 1) {
		newKey = keysToCreate.shift()
		existingRegEntry[newKey] = {}
		existingRegEntry = existingRegEntry[newKey]
	    }

	    // set the value in our (possibly) newly created registry entry
	    existingRegEntry[keysToCreate.shift()] = value
	}
    };
    
    this.regdelete = (key) => {

	lib.logIOC("RegDelete", {key}, "The script deleted a registry key.");

	keyParts = key.split("\\")
	keyToDelete = keyParts.pop()
	pathtoKey = keyParts.join("\\")

	toDelete = this._resolveRegKey(pathtoKey)

	if (toDelete) {
	    lib.info(`deleting registry key ${key}`);
	    delete toDelete[keyToDelete]
	}
	else {
	    lib.warning(`registry key not present ${key}`)
	}
    }

    this.appactivate = function(app) {
        lib.info(`Activate application '${app}'`);
        return true;
    };

    this.sendkeys = function(keys) {
        lib.info(`Send keystrokes '${keys}'`);
        return true;
    };
    
    this.popup = function(text, a, title = "[Untitled]", b) {
	if (!argv["no-echo"]) {
	    lib.verbose(`Script opened a popup window: title "${title}", text "${text}"`);
	    lib.verbose("Add flag --no-echo to disable this.");
	}
	//return true; // Emulates a click
        return 1;
    };
}

module.exports = lib.proxify(WScriptShell, "WScriptShell");
