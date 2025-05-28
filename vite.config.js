import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: './src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html')
      }
    }
  },
  base: '/datasharingApp/',
  server: {
    port: 3000,
    https: {
      key: './cert.key',
      cert: './cert.pem'
    }
  },
  optimizeDeps: {
    include: [
      'peerjs',
      'events'
    ],
    esbuildOptions: {
      target: 'esnext'
    }
  }
});