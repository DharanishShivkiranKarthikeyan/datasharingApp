import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'web'),
  publicDir: false, // Disable copying the public/ directory
  plugins: [
    react(),
    nodePolyfills({
      crypto: true,
    }),
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: path.resolve(__dirname, 'web/index.html'), // Entry point
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'web/src'),
    },
  },
});