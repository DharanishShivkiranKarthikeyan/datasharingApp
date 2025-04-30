import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path'; // Add this import to resolve paths

export default defineConfig({
  root: path.resolve(__dirname, 'web'), // Set the root to the web/ directory
  publicDir: 'public', // Specify the public directory relative to the root (web/public/)
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
      '@': path.resolve(__dirname, 'web/src'), // Update the alias to point to web/src/
    },
  },
});