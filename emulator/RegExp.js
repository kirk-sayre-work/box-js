const lib = require("../lib");

function RegExp() {
    this.Pattern = undefined;
    this.Global = false;
    this.IgnoreCase = false;

    this.Test = function(s) {
	throw "Not Implemented!";
    };

    this.Execute = function(s) {
	throw "Not Implemented!";
    };

    this.Replace = function(s, repl) {
	throw "Not Implemented!";
    };
}

module.exports = lib.proxify(Dictionary, "VBScript.RegExp");
