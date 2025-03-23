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
  assetsInclude: ['**/*.wasm'],
  plugins: [
    {
      name: 'copy-pkg',
      writeBundle() {
        console.log('Copying pkg/ folder to dist/pkg/');
        cpSync('web/pkg', 'dist/pkg', { recursive: true });
      }
    }
  ]
});