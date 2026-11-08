/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { alphaTab } from '@coderline/alphatab-vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // copies alphaTab's fonts/soundfont and wires up its web workers
    alphaTab(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'samples/*.musicxml'],
      manifest: {
        name: 'Fretline',
        short_name: 'Fretline',
        description: 'Practice along with your own tabs and recordings',
        theme_color: '#12808a',
        background_color: '#f6f5f1',
        display: 'standalone',
        orientation: 'any',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        // alphaTab's soundfont is ~1.6 MB; cache it so the synth works offline
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,otf,eot,ttf,sf2,sf3,musicxml}'],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
