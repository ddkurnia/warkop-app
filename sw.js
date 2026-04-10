// ============================================
// Service Worker v12 - Warung Kopi POS
// ============================================
// CATATAN PENTING:
// - Service Worker ini TIDAK PERNAH menyentuh IndexedDB atau localStorage
// - Hanya mengelola cache untuk file statis (HTML, CSS, JS, images)
// - Semua data user (transaksi, menu, pengaturan) tersimpan di IndexedDB
//   yang TIDAK AKAN terhapus saat cache diperbarui
// ============================================

const CACHE_NAME = 'warkop-pos-v15';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/logo-wp.png'
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate - hapus cache lama saja (TIDAK menyentuh IndexedDB/localStorage)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => {
        // Hanya hapus cache lama, JANGAN sentuh data user
        const oldCaches = names.filter(n => n !== CACHE_NAME);
        if (oldCaches.length > 0) {
          console.log('[SW] Menghapus cache lama:', oldCaches);
        }
        return Promise.all(oldCaches.map(n => caches.delete(n)));
      })
      .then(() => self.clients.claim())
  );
});

// Fetch - Network first, fallback to cache
// IndexedDB TIDAK terpengaruh oleh operasi cache ini
self.addEventListener('fetch', (event) => {
  // Skip blob and data URLs - biarkan browser handle langsung
  if (event.request.url.startsWith('blob:') || event.request.url.startsWith('data:')) return;

  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          // Cache respons untuk offline access
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Jika offline, gunakan cache
        return caches.match(event.request)
          .then(r => r || caches.match('/'));
      })
  );
});

// Message handler - untuk komunikasi dengan main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
