import type { CapacitorConfig } from '@capacitor/cli';

/** The published web app. The iPhone app opens it, so every deploy reaches the app with no reinstall. */
const LIVE_URL = 'https://personal-management-board-vercel.vercel.app';

/**
 * Native iOS shell (Capacitor).
 *
 * The app loads the live site (LIVE_URL) instead of a copy bundled inside it:
 * a push to main that Vercel deploys shows up the next time the app opens.
 * Only native changes (plugins, icon, permissions, Info.plist) need a rebuild
 * and reinstall: `npm run ios`.
 *
 * Without a connection it shows offline.html (bundled, from public/).
 * Set MIOS_BUNDLED=1 when building to ship the bundled copy instead, as the
 * App Store prefers (`MIOS_BUNDLED=1 npm run ios`).
 */
const bundled = process.env.MIOS_BUNDLED === '1';

const config: CapacitorConfig = {
  // Must be unique on the App Store; change it before registering the app with Apple.
  appId: 'com.geraflores.mios',
  appName: 'Mios',
  webDir: 'dist',
  server: bundled ? undefined : { url: LIVE_URL, errorPath: 'offline.html' },
  ios: {
    // The page handles the notch and home bar itself with env(safe-area-inset-*).
    contentInset: 'never',
    backgroundColor: '#0B0B0D',
  },
};

export default config;
