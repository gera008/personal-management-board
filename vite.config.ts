import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'supabase/functions/_shared'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: { maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'Mios',
        short_name: 'Mios',
        description: 'Calendar, tasks, finance and habits in one place.',
        theme_color: '#0B0B0D',
        background_color: '#0B0B0D',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
