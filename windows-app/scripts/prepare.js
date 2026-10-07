// Copies the shared web app (../www) into ./app-www so electron-builder can package it.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', '..', 'www'), dst = path.join(__dirname, '..', 'app-www');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
fs.rmSync(path.join(dst, 'sw.js'), { force: true }); // everything is already on disk
console.log('web assets copied to', dst);
