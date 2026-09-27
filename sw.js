// Basit Service Worker (PWA Kurulumu İçin Gerekli)
self.addEventListener('install', (event) => {
    console.log('Service Worker kuruldu.');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker aktif edildi.');
});

self.addEventListener('fetch', (event) => {
    // Şimdilik sadece ağdan çekiyoruz, ileride çevrimdışı (offline) mod için önbellekleme (cache) yapılabilir
});