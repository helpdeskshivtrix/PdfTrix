// Copies the shared web app (../www) into ./www for Capacitor (no service worker needed in the native shell).
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', '..', 'www'), dst = path.join(__dirname, '..', 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
fs.rmSync(path.join(dst, 'sw.js'), { force: true });
console.log('web assets copied to', dst);
