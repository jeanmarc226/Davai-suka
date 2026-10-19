// Service worker : mise en cache pour fonctionner hors ligne.
// Pensez à changer CACHE_VERSION à chaque mise à jour des fichiers.
const CACHE_VERSION = 'davai-suka-v12';
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
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
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

// Icônes, police et affiche : le cache suffit (elles changent avec CACHE_VERSION).
function isCacheFirst(url) {
  return url.pathname.includes('/icons/') || url.pathname.includes('/fonts/') || url.pathname.includes('/images/');
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
  if (!response || !response.ok || response.type !== 'basic') return Promise.resolve();
  const copy = response.clone();
  const key = new Request(request.url, { method: 'GET' });
  return caches.open(CACHE_VERSION).then((cache) => cache.put(key, copy)).catch(() => {});
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
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(e.request)
          .then((res) => remember(e.request, res).then(() => res))
          .catch(() => fromCache(e.request));
      })
    );
    return;
  }

  if (!isNetworkFirst(e.request, url)) return;

  e.respondWith(
    networkFetch(e.request)
      .then((res) => remember(e.request, res).then(() => res))
      .catch(() => fromCache(e.request))
  );
});
