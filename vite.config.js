import { defineConfig } from 'vite';
import { cpSync } from 'fs';

export default defineConfig({
  root: './web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  base: '/datasharingApp/', // Updated to match your repository name
  server: {
    open: '/index.html',
    port: 3000,
    https: {
      key: './cert.key',
      cert: './cert.pem'
    }
  },
});