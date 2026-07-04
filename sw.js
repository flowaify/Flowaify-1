// Flowaify service worker — installability only.
// Deliberately does NOT cache anything so every deploy is instantly live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network passthrough */ });
