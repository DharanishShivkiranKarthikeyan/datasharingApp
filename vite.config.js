import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      crypto: true, // Polyfill the crypto module for Web Crypto API
    }),
  ],
  base: '/datasharingApp/',
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@': '/src', // Makes imports like '@/lib/dht.js' cleaner
    },
  },
});