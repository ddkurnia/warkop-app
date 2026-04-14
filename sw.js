// ============================================
// Service Worker v20 - Warung Kopi POS
// ============================================
// CATATAN PENTING:
// - Service Worker ini TIDAK PERNAH menyentuh IndexedDB atau localStorage
// - Hanya mengelola cache untuk file statis (HTML, CSS, JS, images)
// - Semua data user (transaksi, menu, pengaturan) tersimpan di IndexedDB
//   yang TIDAK AKAN terhapus saat cache diperbarui
//
// v20 CHANGES:
// - Proteksi EKSTRA untuk blob:, data:, dan download requests
// - Skip SEMUA request yang BUKAN dari domain asli (same-origin)
// - Skip semua request dengan mode selain 'navigate' dan 'cors'
//   (except 'basic') untuk mencegah intercept download/blob di TWA/APK
// - Skip request yang memiliki header 'sec-fetch-dest' = document
//   saat URL mengandung 'blob:' (download trigger di APK)
// - Tambah skip untuk Google API calls, CDN resources
// ============================================

const CACHE_NAME = 'warkop-pos-v20';
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
// ============================================
// v20: Proteksi SUPER KETAT untuk blob/download requests
// Ini penting agar export CSV tetap berfungsi di APK (TWA)
// ============================================
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // === SKIP 1: Semua pattern yang tidak boleh di-cache ===
  for (let i = 0; i < SKIP_PATTERNS.length; i++) {
    if (url.includes(SKIP_PATTERNS[i])) return;
  }

  // === SKIP 2: Non-GET requests (POST, PUT, DELETE, dll) ===
  if (event.request.method !== 'GET') return;

  // === SKIP 3: Request dengan URL blob:, data:, intent:, dll ===
  // Meskipun sudah ada di SKIP_PATTERNS, ini double-check untuk keamanan
  if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('intent:')) return;

  // === SKIP 4: Request yang bukan same-origin DAN bukan CORS ===
  // Hanya cache file dari domain sendiri + file statis yang diketahui
  try {
    var reqUrl = new URL(url);
    var selfUrl = new URL(self.location.origin);
    // Jika host berbeda dan bukan subdomain yang diketahui, skip
    if (reqUrl.host !== selfUrl.host) return;
  } catch(e) {
    // Jika URL tidak valid, skip
    return;
  }

  // === SKIP 5: Download-related requests di APK/TWA ===
  // Di TWA, ketika user klik <a download>, browser mengirim request
  // dengan mode 'navigate'. Kita harus memastikan ini tidak di-intercept.
  // Cek header sec-fetch-dest jika tersedia
  var dest = event.request.destination;
  if (dest === 'document' || dest === 'embed' || dest === 'object') {
    // Navigasi ke document bisa jadi download trigger
    // Hanya intercept jika ini adalah request ke halaman utama
    if (url !== self.location.origin + '/' && url !== self.location.origin + '/index.html') {
      return;
    }
  }

  // === SKIP 6: Opaque requests (cross-origin tanpa CORS) ===
  if (event.request.mode === 'no-cors') return;

  // === LANJUT: Hanya cache request same-origin yang aman ===
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
