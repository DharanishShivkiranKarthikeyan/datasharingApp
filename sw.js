self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open('dcrypt-v1').then((cache) => {
            return cache.addAll([
                '/',
                '/index.html',
                '/assets/index.js',
                '/wasm/dcrypt_wasm.js',
                '/wasm/dcrypt_wasm_bg.wasm'
            ]);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request).catch(() => {
                return caches.match('/index.html'); // Fallback for offline
            });
        })
    );
});

// New: Handle messages from the main script to cache chunks
self.addEventListener('message', async (event) => {
    if (event.data.type === 'cache_chunk') {
        const { chunkHash, data } = event.data;
        const cache = await caches.open('dcrypt-chunks');
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const response = new Response(blob, {
            headers: { 'Content-Type': 'application/octet-stream' }
        });
        await cache.put(`/chunks/${chunkHash}`, response);
        console.log(`Service Worker: Cached chunk ${chunkHash}`);
    }
});

// New: Intercept chunk requests for offline access
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/chunks/')) {
        event.respondWith(
            caches.open('dcrypt-chunks').then((cache) => {
                return cache.match(event.request).then((response) => {
                    if (response) {
                        console.log(`Service Worker: Serving chunk ${url.pathname} from cache`);
                        return response;
                    }
                    return fetch(event.request).catch(() => {
                        return new Response('Chunk not available offline', { status: 503 });
                    });
                });
            })
        );
    } else {
        event.respondWith(
            caches.match(event.request).then((response) => {
                return response || fetch(event.request).catch(() => {
                    return caches.match('/index.html');
                });
            })
        );
    }
});