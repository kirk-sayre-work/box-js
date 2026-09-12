// Monitor prototype manipulations that might hide malicious code
const lib = require("../lib");

// Track original Object.defineProperty
function monitorPrototypeManipulation(sandbox) {
    const originalDefineProperty = sandbox.Object.defineProperty;
    
    sandbox.Object.defineProperty = function(obj, prop, descriptor) {
        // Log when someone defines getters/setters on prototypes (common obfuscation technique)
        if (obj && obj.constructor && obj.constructor.name && prop) {
            const targetName = obj.constructor.name + (obj === obj.constructor.prototype ? ".prototype" : "");
            
            if (descriptor && (descriptor.get || descriptor.set)) {
                if (descriptor.get) {
                    const getterSource = descriptor.get.toString();
                    lib.logIOC("prototype_getter_override", {
                        target: targetName,
                        property: prop,
                        code: getterSource
                    }, `Script overriding ${targetName}.${prop} getter`);
                    
                    // If we detect eval or other suspicious patterns in the getter, try to extract it
                    if (getterSource.includes('eval(') || getterSource.includes('atob(')) {
                        try {
                            lib.info(`Suspicious getter detected on ${targetName}.${prop}, attempting to deobfuscate`);
                            attemptDeobfuscation(getterSource, sandbox);
                        } catch (e) {
                            lib.verbose(`Deobfuscation error: ${e.message}`);
                        }
                    }
                }
                
                if (descriptor.set) {
                    lib.logIOC("prototype_setter_override", {
                        target: targetName,
                        property: prop,
                        code: descriptor.set.toString()
                    }, `Script overriding ${targetName}.${prop} setter`);
                }
            }
        }
        
        // Call original function after logging
        return originalDefineProperty.call(this, obj, prop, descriptor);
    };
}

// Try to deobfuscate common patterns
function attemptDeobfuscation(code, sandbox) {
    // Extract strings between eval( and ) - simplified approach
    const evalRegex = /eval\s*\(([^)]+)\)/g;
    let match;
    
    while ((match = evalRegex.exec(code)) !== null) {
        lib.logIOC("eval_content", {extracted: match[1]}, `Extracted eval content: ${match[1]}`);
    }
    
    // Look for concatenated base64 strings
    const base64Pattern = /'[A-Za-z0-9+/=]+'[\s+]*[+][\s+]*'[A-Za-z0-9+/=]+'/g;
    while ((match = base64Pattern.exec(code)) !== null) {
        try {
            // Try to join and decode base64 chunks
            const base64Chunks = match[0].replace(/['+\s]/g, '');
            const decoded = Buffer.from(base64Chunks, 'base64').toString();
            lib.logIOC("base64_decoded", {
                original: match[0],
                decoded: decoded
            }, `Decoded base64: ${decoded}`);
        } catch (e) {
            lib.verbose(`Base64 decode error: ${e.message}`);
        }
    }
    
    // Look for XOR operations with hex strings
    if (code.includes('parseInt') && code.includes('charCodeAt') && code.includes('String.fromCharCode')) {
        lib.info("Potential XOR encryption detected, see full code for analysis");
    }
}

module.exports = monitorPrototypeManipulation;
