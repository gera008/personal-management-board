/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
const manifest = self.__WB_MANIFEST;
precacheAndRoute(manifest);
// SPA: serve the app shell for in-app navigations (works offline once cached).
// The dev build precaches nothing, so only do this when index.html is in the manifest.
if (manifest.some((e) => (typeof e === 'string' ? e : e.url).endsWith('index.html'))) {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
}

interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let data: PushPayload = { title: 'Personal Hub' };
  try {
    data = event.data?.json() ?? data;
  } catch {
    data = { title: 'Personal Hub', body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        existing.navigate(url);
        return existing.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
