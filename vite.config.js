import { defineConfig } from 'vite';
import { cpSync } from 'fs';

export default defineConfig({
  root: './web',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        signup: resolve(__dirname, 'web/signup.html'),
        nodeInstructions: resolve(__dirname, 'web/node-instructions.html'),
      }
    },
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