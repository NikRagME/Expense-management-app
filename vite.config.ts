import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // App shell only; data always comes live from the API (spec A9).
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        runtimeCaching: [],
      },
      manifest: {
        name: 'Pocket — money, made visible',
        short_name: 'Pocket',
        description: 'All your accounts and spending in one place.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f7f6fb',
        theme_color: '#5b4bd1',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787', '/auth': 'http://localhost:8787' },
  },
});
