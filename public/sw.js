const CACHE = 'fd-sst-shell-field-tools-v2'
const shell = new URL('./', self.registration.scope).href
self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE)
  const response = await fetch(shell, { cache:'reload' })
  if (!response.ok) throw new Error('Não foi possível preparar o aplicativo offline.')
  const html = await response.clone().text()
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g)].map((match) => new URL(match[1], shell).href)
  await cache.put(shell, response)
  await cache.addAll(assets)
  await self.skipWaiting()
})()))
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('fd-sst-') && key !== CACHE).map((key) => caches.delete(key))))])))
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // Never cache API responses, private photos, authentication or external data.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => { if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(shell, copy))) } return response }).catch(() => caches.match(shell)))
  } else if (/\/assets\//.test(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy))) } return response })))
  }
})
