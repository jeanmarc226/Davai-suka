// Service worker : mise en cache pour fonctionner hors ligne.
// Pensez à changer CACHE_VERSION à chaque mise à jour des fichiers.
const CACHE_VERSION = 'davai-suka-v21';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './fonts/RussoOne-Regular.woff2',
  './images/fond-urss.jpg',
  './images/fond-semaine.jpg',
  './images/fond-calories.jpg',
  './images/fond-programme.jpg',
  './images/etoile-kremlin.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './audio/playlist.ogg',
  './audio/playlist.mp3'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(ASSETS.map(async (asset) => {
      const fresh = new URL(asset, self.location.href);
      fresh.searchParams.set('__sw', String(Date.now()));
      const res = await fetch(new Request(fresh.toString(), { cache: 'reload' }));
      if (!res.ok) throw new Error(asset);
      await cache.put(asset, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Icônes, police, affiches et musique : le cache suffit (elles changent avec CACHE_VERSION).
function isCacheFirst(url) {
  return url.pathname.includes('/icons/') || url.pathname.includes('/fonts/') || url.pathname.includes('/images/') || url.pathname.includes('/audio/');
}
function isAudio(url) {
  return url.pathname.includes('/audio/');
}

// Navigation, HTML, script, feuille de style et manifeste : réseau d'abord,
// pour prendre la mise à jour dès la prochaine ouverture. Hors ligne, le cache.
function isNetworkFirst(request, url) {
  if (request.mode === 'navigate') return true;
  const path = url.pathname;
  return path.endsWith('/')
    || path.endsWith('.html')
    || path.endsWith('/app.js')
    || path.endsWith('/styles.css')
    || path.endsWith('.webmanifest');
}

// Nouvelle URL à chaque fois : sinon Chrome peut rendre la copie HTTP
// déjà en mémoire, et l'ancienne version reste affichée.
function networkFetch(request) {
  const url = new URL(request.url);
  url.searchParams.set('__sw', String(Date.now()));
  const mode = request.mode === 'navigate' || request.mode === 'no-cors' ? 'same-origin' : request.mode;
  return fetch(new Request(url.toString(), {
    method: 'GET',
    cache: 'reload',
    credentials: 'same-origin',
    redirect: 'follow',
    mode,
  }));
}

function remember(request, response) {
  if (!response || !response.ok || response.status === 206 || response.type !== 'basic') return Promise.resolve();
  const copy = response.clone();
  const key = new Request(request.url, { method: 'GET' });
  return caches.open(CACHE_VERSION).then((cache) => cache.put(key, copy)).catch(() => {});
}

// Le lecteur envoie souvent un en-tête Range. On sert le fichier entier mis en cache,
// découpé si besoin, pour que la lecture reste hors ligne.
async function maybeRange(request, response) {
  const range = request.headers.get('range');
  if (!range || response.status === 206) return response;
  const m = /^bytes=(\d+)-(\d*)$/i.exec(range.trim());
  if (!m) return response;
  const buf = await response.clone().arrayBuffer();
  const size = buf.byteLength;
  if (!size) return response;
  const start = Math.min(Number(m[1]), size);
  let end = m[2] ? Number(m[2]) : size - 1;
  if (end >= size) end = size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  const slice = buf.slice(start, end + 1);
  const headers = new Headers();
  const type = response.headers.get('Content-Type');
  if (type) headers.set('Content-Type', type);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
  headers.set('Content-Length', String(slice.byteLength));
  return new Response(slice, { status: 206, statusText: 'Partial Content', headers });
}

function fromCache(request) {
  return caches.match(request, { ignoreSearch: true }).then((cached) => {
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('./index.html');
    return new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  });
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  const url = new URL(e.request.url);

  if (isCacheFirst(url)) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request, { ignoreSearch: true });
      if (cached) return isAudio(url) ? maybeRange(e.request, cached) : cached;
      if (isAudio(url)) {
        const full = await fetch(new Request(url.toString(), { method: 'GET', cache: 'reload' }));
        if (full.ok) {
          await remember(new Request(url.toString()), full);
          const stored = await caches.match(url.toString(), { ignoreSearch: true });
          return maybeRange(e.request, stored || full);
        }
        return full;
      }
      const res = await fetch(e.request);
      await remember(e.request, res);
      return res;
    })().catch(() => fromCache(e.request)));
    return;
  }

  if (!isNetworkFirst(e.request, url)) return;

  e.respondWith(
    networkFetch(e.request)
      .then((res) => remember(e.request, res).then(() => res))
      .catch(() => fromCache(e.request))
  );
});
