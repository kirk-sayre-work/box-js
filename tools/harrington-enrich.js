#!/usr/bin/env node
/*
 * Post-process a box-js results directory with Harrington
 * (https://github.com/wmetcalf/harrington), the Rust batch/PowerShell
 * deobfuscator.
 *
 * box-js emulates the JavaScript but cannot execute the shell commands the
 * sample spawns, so anything hidden inside a `powershell -enc <base64>` or a
 * caret-obfuscated cmd line stays opaque to it. Harrington statically
 * deobfuscates exactly those command lines. Feeding it every execution IOC
 * box-js recorded recovers the second-stage URLs and traits without box-js
 * having to grow a PowerShell implementation.
 *
 * This runs after emulation has finished, so it never competes with the
 * --timeout budget that the VM and the rewrite stage already share.
 *
 * Usage: node tools/harrington-enrich.js <results-dir> [--bin PATH] [--timeout N]
 * Writes <results-dir>/harrington.json and merges recovered URLs into urls.json.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

/* Every IOC type box-js uses to report that the sample launched something.
 * Keep this in step with the logIOC() call sites in analyze.js, lib.js and
 * emulator/ - a missing entry silently drops command lines from the feed.
 */
const EXEC_IOCS = {
    "run": (v) => v.command,
    "commandexec": (v) => v.value,
    "wmi.getobject.run": (v) => v.value,
    "wmi.getobject.create": (v) => v.value,
    "createshortcut": (v) => v.cmd,
    "task": (v) => v.command || [v.path, v.args].filter(Boolean).join(" "),
    "task path": (v) => v.value,
    "task arguments": (v) => null, // meaningless alone; joined via "task"
    "$.nstask.alloc.init.launchandreturnerror()": (v) => v.value,
    "$.nsworkspace.sharedworkspace.openapplicationaturlconfigurationcompletionhandler()": (v) => v.url,
};

function valueOf(entry) {
    const v = entry.value;
    return (v !== null && typeof v === "object") ? v : { value: v };
}

/* Script-like payloads the sample dropped. The command lines box-js records
 * are usually just `powershell -File <dropped>.ps1` - the interesting content
 * is in the drop itself, and the FileWrite IOC already carries its bytes.
 */
const DROP_EXTS = /\.(ps1|psm1|bat|cmd|vbs|vbe|js|jse|wsf|hta|b64|txt)$/i;
const MAX_DROPS = 64;

function extractDrops(iocs) {
    const out = [];
    const seen = new Set();
    for (const entry of iocs) {
        if (!entry || typeof entry !== "object") continue;
        if (String(entry.type || "").toLowerCase() !== "filewrite") continue;
        const v = valueOf(entry);
        const name = typeof v.file === "string" ? v.file : "";
        if (!DROP_EXTS.test(name)) continue;
        const contents = typeof v.contents === "string" ? v.contents : null;
        if (!contents || !contents.trim()) continue;
        // Repeated appends to one file produce many IOCs; keep the largest.
        const prev = seen.has(name) ? out.find((d) => d.name === name) : null;
        if (prev) {
            if (contents.length > prev.command.length) prev.command = contents;
            continue;
        }
        seen.add(name);
        out.push({ type: "FileWrite", name, command: contents });
        if (out.length >= MAX_DROPS) break;
    }
    return out;
}

function extractCommands(iocPath) {
    let iocs;
    try {
        iocs = JSON.parse(fs.readFileSync(iocPath, "utf8"));
    } catch (e) {
        return [];
    }
    if (!Array.isArray(iocs)) return [];

    const out = [];
    const seen = new Set();
    const haveTask = iocs.some((e) => e && String(e.type).toLowerCase() === "task");

    for (const entry of iocs) {
        if (!entry || typeof entry !== "object") continue;
        const type = String(entry.type || "").toLowerCase();
        const pick = EXEC_IOCS[type];
        if (!pick) continue;
        /* "Task Path" fires on the property setter, before the task is
         * registered. Once a "Task" IOC exists it carries the whole
         * invocation, so the partial setter IOCs are redundant. */
        if (type === "task path" && haveTask) continue;

        let cmd;
        try {
            cmd = pick(valueOf(entry));
        } catch (e) {
            continue;
        }
        if (typeof cmd !== "string") cmd = cmd == null ? "" : String(cmd);
        cmd = cmd.trim();
        if (!cmd || seen.has(cmd)) continue;
        seen.add(cmd);
        out.push({ type: entry.type, command: cmd });
    }
    return out.concat(extractDrops(iocs));
}

function resolveBinary(explicit) {
    const candidates = [
        explicit,
        process.env.HARRINGTON_BIN,
        "batdeob",
        "harrington",
    ].filter(Boolean);
    for (const c of candidates) {
        try {
            cp.execFileSync(c, ["--version"], { stdio: "ignore", timeout: 10000 });
            return c;
        } catch (e) { /* try the next one */ }
    }
    return null;
}

function runHarrington(bin, commands, timeoutSecs) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "boxjs-harrington-"));
    const files = [];
    try {
        commands.forEach((c, i) => {
            const f = path.join(tmp, `cmd${i}.txt`);
            fs.writeFileSync(f, c.command);
            files.push(f);
        });
        /* One invocation for the whole batch - harrington's `analyze` takes
         * many files and emits one JSONL stream, keyed by `input`. */
        const proc = cp.spawnSync(
            bin,
            ["analyze", ...files, "--jsonl", "--timeout", String(timeoutSecs)],
            { encoding: "utf8", timeout: (timeoutSecs + 5) * 1000 * commands.length,
              maxBuffer: 64 * 1024 * 1024 }
        );
        if (proc.error) return { error: String(proc.error) };

        const byFile = new Map(files.map((f, i) => [f, i]));
        const results = commands.map((c) => ({ ...c, traits: [], deobfuscated: null }));
        let current = null;
        for (const line of (proc.stdout || "").split("\n")) {
            if (!line.trim()) continue;
            let rec;
            try { rec = JSON.parse(line); } catch (e) { continue; }
            if (rec.kind === "meta" && byFile.has(rec.input)) {
                current = results[byFile.get(rec.input)];
            } else if (!current) {
                continue;
            } else if (rec.kind === "trait" && rec.trait) {
                current.traits.push(rec.trait);
            } else if (rec.kind === "deob" && typeof rec.content === "string") {
                current.deobfuscated = rec.content.trim();
            }
        }
        return { results, stderr: (proc.stderr || "").slice(-2000) };
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
}

function mergeUrls(dir, results) {
    const urlPath = path.join(dir, "urls.json");
    let urls = [];
    try { urls = JSON.parse(fs.readFileSync(urlPath, "utf8")); } catch (e) {}
    if (!Array.isArray(urls)) urls = [];

    const before = new Set(urls);
    const added = [];
    /* Traits carry recovered locations under several field names depending on
     * kind - Download uses src/dst, UrlArgument uses url, and others embed the
     * location in the reconstructed cmd. Scan every string field rather than
     * guessing, and also sweep cmd text for URLs harrington rebuilt from UNC
     * or WebDAV forms.
     */
    const take = (v) => {
        if (typeof v !== "string") return;
        for (const m of v.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()\\]+/gi) || []) {
            if (before.has(m)) continue;
            before.add(m);
            urls.push(m);
            added.push(m);
        }
    };
    for (const r of results) {
        for (const t of r.traits) {
            for (const k of Object.keys(t)) take(t[k]);
        }
        take(r.deobfuscated);
    }
    if (added.length) fs.writeFileSync(urlPath, JSON.stringify(urls, null, "\t"));
    return added;
}

function enrich(dir, opts = {}) {
    const iocPath = path.join(dir, "IOC.json");
    if (!fs.existsSync(iocPath)) return { skipped: "no IOC.json" };

    const commands = extractCommands(iocPath);
    if (!commands.length) return { skipped: "no execution IOCs" };

    const bin = resolveBinary(opts.bin);
    if (!bin) {
        return { skipped: "harrington/batdeob binary not found (set --harrington-bin or $HARRINGTON_BIN)" };
    }

    const run = runHarrington(bin, commands, opts.timeout || 10);
    if (run.error) return { skipped: run.error };

    const addedUrls = mergeUrls(dir, run.results);
    const report = {
        binary: bin,
        commands_analyzed: commands.length,
        urls_recovered: addedUrls,
        results: run.results.filter((r) => r.traits.length || r.deobfuscated),
    };
    fs.writeFileSync(path.join(dir, "harrington.json"), JSON.stringify(report, null, "\t"));
    return report;
}

module.exports = { enrich, extractCommands, EXEC_IOCS };

if (require.main === module) {
    const args = process.argv.slice(2);
    const dir = args.find((a) => !a.startsWith("--"));
    if (!dir) {
        console.error("Usage: harrington-enrich.js <results-dir> [--bin PATH] [--timeout N]");
        process.exit(2);
    }
    const binIdx = args.indexOf("--bin");
    const toIdx = args.indexOf("--timeout");
    const r = enrich(dir, {
        bin: binIdx >= 0 ? args[binIdx + 1] : undefined,
        timeout: toIdx >= 0 ? parseInt(args[toIdx + 1], 10) : undefined,
    });
    if (r.skipped) {
        console.log(`harrington: skipped (${r.skipped})`);
    } else {
        console.log(`harrington: analyzed ${r.commands_analyzed} command(s), recovered ${r.urls_recovered.length} new URL(s)`);
        for (const u of r.urls_recovered) console.log(`  + ${u}`);
    }
}
