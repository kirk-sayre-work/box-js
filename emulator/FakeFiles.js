// Load JSON file with faked up file contents. This maps file names to
// file contents.
const fakeFileInfo = require('./FakeFileInfo.json');
const fs = require('node:fs');
const path = require('node:path');

// Real files the emulated script may read: only the sample itself (a script reading its
// own source, e.g. with --real-script-name). The name comes from the sample, so reading
// any path it names would hand it the worker's files.
const realReadable = new Set();
function allowRealRead(fname) {
    realReadable.add(path.resolve(String(fname)));
}

// See if we can read some fake file contents.
function ReadFakeFileContents(fname) {

    // See if we can return some real file contents.
    try {
        if (typeof fname === "string" && realReadable.has(path.resolve(fname))) {
            return fs.readFileSync(fname, 'utf8');
        }
    }
    catch (err) { }

    // No real contents, try fake contents.
    return fakeFileInfo[fname];
}

exports.ReadFakeFileContents = ReadFakeFileContents;
exports.allowRealRead = allowRealRead;
