// Use stubbed box-js packages in some cases. Stubbed packages are
// defined in boilerplate.js.
function require(arg) {
    // "node:fs" is "fs": look the stub up without the prefix.
    if (typeof arg === "string" && arg.startsWith("node:")) arg = arg.slice(5);
    
    // Override some Node packages with stubbed box-js versions. Add
    // any new stubbed packages here so they are loaded via require()
    // when sandboxing with box-js.
    const overrides = {
	"child_process" : {
	    execSync: _execSync,
	    spawn: _spawn,
            fork: _fork,
	    exec: _execSync,
	},
	"http" : _http,
	// https used to fall through to the real module; _https (boilerplate.js) emulates
	// it as a network-less worker saw it.
	"https" : __boxjs_https,
	"dns" : __boxjs_dns,
	"dns/promises" : __boxjs_dns.promises,
	"timers" : __boxjs_timers,
	"timers/promises" : __boxjs_timers.promises,
        "net" : {
            createConnection: _createConnection,
            Socket: _Socket,
	    createServer: _createServer,
        },
        "request" : {
        },
        "socket.io-client" : _io_client,
        "axios" : {
            post: _axiosPost,
            get: _axiosGet,
        },
        "better-sqlite3" : {
        },
        "node-machine-id" : {
            machineId : _machineId,
            machineIdSync : _machineIdSync,
        },
	"express" : {
	    Router : _router,
	},
	"fs" : {
	    writeFileSync : _writeFileSync,
	    mkdirSync : _mkdirSync,
	    existsSync : _existsSync,
	    statSync : _statSync,
	},
        "os" : {
            hostname: _NODE_os_hostname,
            userInfo: _NODE_os_userInfo,
            platform: _NODE_os_platform,
            arch: _NODE_os_arch,
            totalmem: _NODE_os_totalmem,
            cpus: _NODE_os_cpus,
            uptime: _NODE_os_uptime,
            userInfo: _NODE_os_userInfo,
            hostname: _NODE_os_hostname,
            networkInterfaces: _NODE_os_networkInterfaces,
        }
    }
    if (typeof overrides[arg] !== "undefined") return overrides[arg];
    try {
	return _origRequire(arg);
    }
    catch (e) {
	lib.error("require(" + arg + ") failed (module unknown). Returning empty module ...");
	return {};
    }
}
