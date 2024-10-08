const lib = require("../lib");
const argv = require("../argv.js").run;

var _fileCheckCount = 0;
var _lastUrl = "";
function XMLHTTP() {
    this.headers = {};
    this.onreadystatechange = () => {};
    this.readystate = 0;
    this.statustext = "UNSENT";
    this.status = undefined;
    this.url = "URL NOT SET";
    this.method = "METHOD NOT SET";
    
    this.open = function(method, url) {
	// Maybe you can skip the http part of the URL and XMLHTTP
	// still handles it?
	if (url.startsWith("//")) {
	    url = "http:" + url;
	}
	this.url = url;
	this.method = method;
	this.readystate = 1;
	this.statustext = "OPENED";
        lib.logUrl('XMLHTTP', url);
        lib.logIOC("XMLHTTP", {url: url}, "The script opened URL " + url + " with XMLHTTP");

        // Try to break infinite network loops by exiting if we do
        // many open()s.
        _fileCheckCount++;
        if (argv["limit-file-checks"]) {
            if ((_fileCheckCount > 100) && (url == _lastUrl)) {
                lib.info("Possible infinite network loop detected. Exiting.");
                process.exit(0);
            }
        }
        _lastUrl = url;
    };
    this.responsetext = "console.log('The script executed JS returned from a C2 server.')";
    this.setrequestheader = function(key, val) {
	key = key.replace(/:$/, ""); // Replace a trailing ":" if present
	this.headers[key] = val;
	lib.info(`Header set for ${this.url}:`, key, val);
    };
    this.settimeouts = function() {
        // Stubbed out.
    };
    this.setproxy = function() {
        // Stubbed out.
    };    
    this.send = function(data) {
	if (data)
	    lib.info(`Data sent to ${this.url}:`, data);
	this.readystate = 4;
	let response;

        // Track the initial request.
	response = lib.fetchUrl(this.method, this.url, this.headers, data);
        
        // Fake that the request worked?
        if (argv["fake-download"]) {
	    this.status = 200;
	    this.statustext = "OK";
        }

        // Not faking request.
        else {
	    try {
                                
                // Actually try the request?
	        if (argv.download) {
		    this.status = 200;
		    this.statustext = "OK";
	        } else {
		    this.status = 404;
		    this.statustext = "Not found";
	        };
	    } catch (e) {
	        // If there was an error fetching the URL, pretend that the distribution site is down
	        this.status = 404;
	        this.statustext = "Not found";
	        response = {
		    body: new Buffer(""),
		    headers: {},
	        };
	    };
        };
	this.responsebody = response.body;
	this.responsetext = this.responsebody.toString("utf8");
	this.responseheaders = response.headers;
	this.onreadystatechange();
    };
    this.setoption = () => {};
    // Fake up setting options.
    this.option = {};
    this.getresponseheader = (key) => this.responseheaders[key];
    this.waitforresponse = function() {};
}

module.exports = lib.proxify(XMLHTTP, "XMLHTTP");
