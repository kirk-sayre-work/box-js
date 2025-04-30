// Use stubbed box-js packages in some cases. Stubbed packages are
// defined in boilerplate.js.
function require(arg) {
    
    // Override some Node packages with stubbed box-js versions. Add
    // any new stubbed packages here so they are loaded via require()
    // when sandboxing with box-js.
    const overrides = {
	"child_process" : {
	    execSync: _execSync,
	    spawn: _spawn,
	    exec: _execSync,
	},
	"http" : _http,
    }
    if (typeof overrides[arg] !== "undefined") return overrides[arg];
    return _origRequire(arg);
}
