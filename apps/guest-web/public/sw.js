// Fetivi guest service worker: web push only, no offline caching.
// A push shows one notification and tells open windows to check the inbox; a tap opens the app.

/** Same-origin paths only; anything else opens the Chat. */
const safePath = (url) => (typeof url === 'string' && /^\/(?![/\\])/.test(url) ? url : '/chat');

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const url = safePath(message.url);
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(message.title || 'Fetivi', {
        body: message.body || '',
        icon: '/icon.svg',
        data: { url },
      });
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: 'fetivi-inbox' });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safePath(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => 'focus' in client);
      if (open) {
        await open.focus();
        if ('navigate' in open) await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
