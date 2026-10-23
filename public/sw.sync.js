// Retire the legacy operation-queue worker when an existing registration updates.
// The Vinext integration owns its own account-scoped replica lifecycle.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister())
})
