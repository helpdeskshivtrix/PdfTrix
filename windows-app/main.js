const { app, BrowserWindow, Menu, shell, protocol, net, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const WEB = path.join(__dirname, 'app-www');
const MIME = {
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac'
};
const EXTS = Object.keys(MIME);

let win = null;
let rendererReady = false;
const queue = []; // file paths waiting for the window

function filesFromArgv(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter(a => {
    if (!a || a.startsWith('-')) return false;
    const ext = path.extname(a).slice(1).toLowerCase();
    try { return EXTS.includes(ext) && fs.statSync(a).isFile(); } catch (e) { return false; }
  });
}

function sendFile(p) {
  try {
    const name = path.basename(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const data = fs.readFileSync(p);
    win.webContents.send('open-file', { name, type: MIME[ext] || '', data });
  } catch (e) { /* unreadable file: ignore */ }
}
function flush() { if (win && rendererReady) while (queue.length) sendFile(queue.shift()); }

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 420, minHeight: 600,
    backgroundColor: '#000000',
    title: 'PdfTrix',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  win.loadURL('app://local/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; rendererReady = false; });
}

ipcMain.on('renderer-ready', () => { rendererReady = true; flush(); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  queue.push(...filesFromArgv(process.argv));
  app.on('second-instance', (_e, argv) => {
    queue.push(...filesFromArgv(argv));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); flush(); }
  });
  app.whenReady().then(() => {
    protocol.handle('app', req => {
      const u = new URL(req.url);
      let p = decodeURIComponent(u.pathname); if (p === '/' || !p) p = '/index.html';
      const f = path.normalize(path.join(WEB, p));
      if (!f.startsWith(WEB)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(f).toString());
    });
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
