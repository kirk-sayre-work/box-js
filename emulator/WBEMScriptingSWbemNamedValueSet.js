const lib = require("../lib");

function SWbemNamedValueSet() {
    this.add = function(name, val) {
    };
}

module.exports = lib.proxify(SWbemNamedValueSet, "WbemScripting.SWbemNamedValueSet");
