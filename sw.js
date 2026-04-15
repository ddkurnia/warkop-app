// ============================================
// Service Worker v29 - Warung Kopi POS
// ============================================
// CATATAN PENTING:
// - Service Worker ini TIDAK PERNAH menyentuh IndexedDB atau localStorage
// - Hanya mengelola cache untuk file statis (HTML, CSS, JS, images)
// - Semua data user (transaksi, menu, pengaturan) tersimpan di IndexedDB
//   yang TIDAK AKAN terhapus saat cache diperbarui
//
// v21 CHANGES:
// - Skip total untuk blob:, data:, intent: URLs
// - Skip cross-origin requests (hanya cache same-origin)
// - Skip non-GET requests (POST, PUT, DELETE, dll)
// - Skip no-cors dan opaque requests
// - Skip document/embed/object destinations (kecuali root URL)
// - Skip Google API, Firebase, CDN resources
// - Skip share-target URLs
// - Network-first strategy untuk reliability
// ============================================

const CACHE_NAME = 'warkop-pos-v29';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/logo-wp.png'
];

// Patterns yang TIDAK BOLEH diintercept oleh Service Worker
const SKIP_PATTERNS = [
  'blob:',
  'data:',
  'intent:',
  'about:blank',
  'javascript:',
  'tel:',
  'mailto:',
  'whatsapp:',
  'wa.me/',
  '/api/',
  '/share-target',
  // Google APIs & Firebase
  'googleapis.com',
  'googleusercontent.com',
  'google.com/',
  'gstatic.com',
  'accounts.google.com',
  'firebaseio.com',
  'firebaseapp.com',
  'firebase.google.com',
  '.googleapis.com',
  'firebase.app',
  // CDN resources (selalu fresh dari server)
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  // Android intents
  'android-app://',
  'play.google.com'
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Cache setiap asset satu per satu, skip yang gagal
        const promises = STATIC_ASSETS.map(url =>
          cache.add(url).catch(() => {
            console.log('[SW v21] Skip cache:', url);
          })
        );
        return Promise.all(promises);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate - hapus cache lama saja (TIDAK menyentuh IndexedDB/localStorage)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => {
        const oldCaches = names.filter(n => n !== CACHE_NAME);
        if (oldCaches.length > 0) {
          console.log('[SW v21] Menghapus cache lama:', oldCaches);
        }
        return Promise.all(oldCaches.map(n => caches.delete(n)));
      })
      .then(() => self.clients.claim())
  );
});

// Fetch - Network first, fallback to cache
// ============================================
// v21: Proteksi SUPER KETAT untuk blob/download/share requests
// Penting agar export CSV dan share tetap berfungsi di APK (TWA)
// ============================================
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // === SKIP 1: Semua pattern yang tidak boleh di-cache ===
  for (let i = 0; i < SKIP_PATTERNS.length; i++) {
    if (url.includes(SKIP_PATTERNS[i])) return;
  }

  // === SKIP 2: Non-GET requests ===
  if (event.request.method !== 'GET') return;

  // === SKIP 3: Blob, data, intent URLs (double-check) ===
  if (url.startsWith('blob:') || url.startsWith('data:') || 
      url.startsWith('intent:') || url.startsWith('about:')) return;

  // === SKIP 4: Hanya handle same-origin requests ===
  try {
    var reqUrl = new URL(url);
    var selfUrl = new URL(self.location.origin);
    if (reqUrl.host !== selfUrl.host) return;
  } catch(e) {
    return;
  }

  // === SKIP 5: Download-related requests di APK/TWA ===
  var dest = event.request.destination;
  if (dest === 'document' || dest === 'embed' || dest === 'object') {
    if (url !== self.location.origin + '/' && url !== self.location.origin + '/index.html') {
      return;
    }
  }

  // === SKIP 6: Opaque / no-cors requests ===
  if (event.request.mode === 'no-cors' || event.request.mode === 'opaque') return;

  // === LANJUT: Network-first untuk same-origin ===
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline: fallback ke cache
        return caches.match(event.request)
          .then(r => r || caches.match('/'));
      })
  );
});

// Message handler
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
