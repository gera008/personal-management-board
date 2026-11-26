import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native iOS shell (Capacitor). The app is the same web build (`dist`), bundled
 * inside the iPhone app. `npm run ios` builds it and copies it into Xcode.
 */
const config: CapacitorConfig = {
  // Must be unique on the App Store; change it before registering the app with Apple.
  appId: 'com.geraflores.mios',
  appName: 'Mios',
  webDir: 'dist',
  ios: {
    // The page handles the notch and home bar itself with env(safe-area-inset-*).
    contentInset: 'never',
    backgroundColor: '#0B0B0D',
  },
};

export default config;
