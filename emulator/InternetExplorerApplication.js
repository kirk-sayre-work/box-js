const lib = require("../lib");

function InternetExplorerApplication() {
    this.navigate = function(url) {
        lib.logUrl('IE URL Navigation', url);
        lib.logIOC("InternetExplorer.Application", {url: url}, "The script navigated IE to " + url);
    }
    this.busy = false;
    this.readystate = 4;
    this.document = {
        "documentElement" : {
            "outerText" : "_Loaded_IE_Doc_outerText_"
        }
    };
}

module.exports = lib.proxify(InternetExplorerApplication, "InternetExplorerApplication");
