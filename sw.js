// ============================================
// Service Worker v19 - Warung Kopi POS
// ============================================
// CATATAN PENTING:
// - Service Worker ini TIDAK PERNAH menyentuh IndexedDB atau localStorage
// - Hanya mengelola cache untuk file statis (HTML, CSS, JS, images)
// - Semua data user (transaksi, menu, pengaturan) tersimpan di IndexedDB
//   yang TIDAK AKAN terhapus saat cache diperbarui
//
// v19 CHANGES:
// - Tambah skip untuk Google API calls (Firebase, Google Drive, OAuth)
// - Tambah skip untuk CDN resources (Tailwind, Font Awesome, Google Fonts, GIS)
// - Pastikan blob:, data:, dan download-related requests TIDAK diintercept
// - Skip semua external API calls agar tidak di-cache
// ============================================

const CACHE_NAME = 'warkop-pos-v19';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/logo-wp.png'
];

// Patterns yang TIDAK BOLEH diintercept oleh Service Worker
const SKIP_PATTERNS = [
  'blob:',
  'data:',
  '/api/',
  // Google APIs
  'googleapis.com',
  'googleusercontent.com',
  'google.com/',
  'gstatic.com',
  'accounts.google.com',
  'firebaseio.com',
  'firebaseapp.com',
  'firebase.google.com',
  '.googleapis.com',
  // CDN resources (selalu fresh dari server)
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
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
  const url = event.request.url;

  // Skip semua pattern yang tidak boleh di-cache
  for (let i = 0; i < SKIP_PATTERNS.length; i++) {
    if (url.includes(SKIP_PATTERNS[i])) return;
  }

  // Skip non-GET requests (POST, PUT, DELETE, dll)
  if (event.request.method !== 'GET') return;

  // Skip navigasi ke blob URL atau download triggers
  if (event.request.mode === 'navigate' && url.startsWith('blob:')) return;

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
