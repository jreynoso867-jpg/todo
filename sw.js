/* Jose's To-Do: opens with no signal. The app's files are kept on the phone, and photos come from the phone's storage. */
const VERSION = 'todo-6a8af69392';
const SHELL = ["./", "./index.html", "./archivo.woff2", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// A photo from the phone's storage. The connection closes right after, so erasing the list is never held up.
function photo(id) {
  return new Promise(ok => {
    let r;
    try { r = indexedDB.open('jose-todo', 1); } catch (e) { ok(null); return; }
    r.onupgradeneeded = () => { const d = r.result; for (const n of ['docs', 'blobs']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); };
    r.onsuccess = () => {
      const d = r.result;
      const end = v => { ok(v); try { d.close(); } catch (e) { /* already closed */ } };
      try {
        const g = d.transaction('blobs').objectStore('blobs').get(id);
        g.onsuccess = () => end(g.result || null);
        g.onerror = () => end(null);
      } catch (e) { end(null); }
    };
    r.onerror = () => ok(null);
    r.onblocked = () => ok(null);
  });
}
// Photos are only ever served as pictures: a known image type, no guessing, and nothing in them can run.
const PICTURE = /^image\/(jpeg|png|webp|gif|heic|avif)$/;
const PHOTO_HEADERS = type => ({
  'Content-Type': type,
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  'Cache-Control': 'no-store',
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  const at = url.pathname.indexOf('/_blob/');
  if (at >= 0) {
    const id = decodeURIComponent(url.pathname.slice(at + 7));
    e.respondWith(photo(id).then(v => (v && PICTURE.test(v.type) ? new Response(v.buf, { headers: PHOTO_HEADERS(v.type) }) : new Response('', { status: 404 }))));
    return;
  }
  // The app opens from the phone right away; a fresh copy is fetched in the background for next time.
  const key = e.request.mode === 'navigate' ? './index.html' : e.request;
  const cache = caches.open(VERSION);
  let kept = null;
  const fresh = fetch(e.request).then(res => {
    if (res && res.ok && res.type === 'basic' && !res.redirected) { const copy = res.clone(); kept = cache.then(c => c.put(key, copy)); }
    return res;
  }).catch(() => null);
  e.waitUntil(fresh.then(() => kept).catch(() => {}));
  e.respondWith(cache.then(c => c.match(key, { ignoreSearch: true })).then(hit => hit || fresh.then(res =>
    res || new Response('Open this once with a connection first.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))));
});
