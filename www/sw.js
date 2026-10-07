/* PdfTrix service worker: precache everything for full offline use */
const VERSION = 'v5';
const CACHE = 'shivtrix-pdfpro-' + VERSION;
const CORE = [
  './', './index.html', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-192.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png', './icons/app.ico',
  './libs/jszip.min.js', './libs/pdf-lib-enc.min.js', './libs/pdf-lib.min.js',
  './libs/pdfjs/pdf.min.js', './libs/pdfjs/pdf.worker.min.js',
  './libs/tesseract/tesseract.min.js', './libs/tesseract/worker.min.js', './libs/mammoth.browser.min.js'
];
/* OCR engine + English data: cached after first use (large) */
const LAZY = /\/libs\/tesseract\/(tesseract-core.*|lang\/.*)$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shivtrix-pdfpro-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; /* other-language OCR data etc. go straight to network */
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && (LAZY.test(url.pathname) || CORE.some(p => new URL(p, location).pathname === url.pathname))) cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});
