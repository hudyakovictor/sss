import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The playable vertical slice talks to the API through the same origin: the dev
// server proxies `/api` to the local API server, and the build aliases the
// shared contracts to their source so client and server validate the same wire
// shapes. No hidden/future truth and no client-side scoring cross this boundary.
const apiProxyTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@signal-arena/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url)
      )
    }
  },
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
