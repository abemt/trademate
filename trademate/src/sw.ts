/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0];
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }),
);

self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

interface PushNote {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let note: PushNote = {};
      try {
        note = (event.data?.json() as PushNote) ?? {};
      } catch {
        // empty payload — expected
      }
      if (!note.title) {
        try {
          const res = await fetch("/api/push/latest");
          if (res.ok) note = (await res.json()) as PushNote;
        } catch {
          // offline
        }
      }
      await self.registration.showNotification(note.title ?? "TradeMate", {
        body: note.body ?? "Open the app for the latest.",
        icon: "/icon.svg",
        badge: "/icon.svg",
        data: { url: note.url ?? "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          await w.focus();
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
