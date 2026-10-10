import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      includeAssets: [
        'icons/focusmate.svg',
        'icons/focusmate-180.png',
        'icons/focusmate-192.png',
        'icons/focusmate-512.png',
        'icons/focusmate-maskable-512.png',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        globIgnores: [
          '**/models/**',
          '**/about.html',
          '**/contact.html',
          '**/privacy.html',
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api(?:\/|$)/,
          /^\/(?:about|contact|privacy)\/?$/,
          /^\/(?!$|(?:about|contact|privacy)\/?$)/,
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        index: resolve(dashboardRoot, 'index.html'),
        about: resolve(dashboardRoot, 'about.html'),
        contact: resolve(dashboardRoot, 'contact.html'),
        privacy: resolve(dashboardRoot, 'privacy.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.FOCUSMATE_WEB_PORT || 5173),
    strictPort: true,
  },
});