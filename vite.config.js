import { defineConfig } from 'vite';
import { cpSync } from 'fs'; // Node.js fs module for copying files

export default defineConfig({
  root: './web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  base: '/dcrypt/', // Replace with your GitHub repository name
  server: {
    open: '/index.html',
    port: 3000,
    https: {
      key: './cert.key',
      cert: './cert.pem'
    }
  },
  assetsInclude: ['**/*.wasm'], // Ensure Vite recognizes .wasm files as assets
  plugins: [
    {
      // Custom plugin to copy the pkg/ folder to dist/ after build
      name: 'copy-pkg',
      writeBundle() {
        console.log('Copying pkg/ folder to dist/pkg/');
        cpSync('web/pkg', 'dist/pkg', { recursive: true });
      }
    }
  ]
});