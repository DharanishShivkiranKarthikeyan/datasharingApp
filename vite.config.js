import { defineConfig } from 'vite';
import { cpSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  root: './web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input:{
        main: resolve("./web/","index.html"),
        signup: resolve("./web/","signup.html"),
        nodeinstructions: resolve("./web/","node-instructions.html")
      },
      output: {
        // Bundle all JavaScript into a single file
        manualChunks: undefined, // Disable chunk splitting
        entryFileNames: 'assets/app.js', // Name the single bundle file "app.js"
        chunkFileNames: 'assets/[name].js', // Fallback for any chunks (shouldn't be used)
        assetFileNames: 'assets/[name].[ext]', // For other assets like CSS
      },
    },
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
  optimizeDeps: {
    include: [
      'libp2p',
      '@libp2p/kad-dht',
      '@libp2p/peer-id-factory',
      '@libp2p/identify',
      '@libp2p/ping',
      '@multiformats/multiaddr',
      '@multiformats/cid',
      'peerjs',
      'events'
    ],
    esbuildOptions: {
      target: 'esnext'
    }
  },
  resolve: {
    alias: {
      crypto: 'crypto-browserify',
      events: 'events' // Alias Node.js events to events package
    }
  }
});