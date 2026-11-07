import { registerSW } from 'virtual:pwa-register';

/**
 * Keeps the installed app current. iPhones rarely close a home-screen app, so
 * the browser seldom checks for a new version on its own. We check when the
 * app opens and every time it comes back to the front; when a new version is
 * found it takes over and the page reloads into it (with registerType
 * "autoUpdate"). Checking only on resume means a reload never interrupts
 * someone mid-form.
 */
export function keepAppUpdated() {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => undefined);
      });
    },
  });
}
