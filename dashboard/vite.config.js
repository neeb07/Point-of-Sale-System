import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Unlike the till's frontend, this is a real web build: absolute base, and the
 * API is same-origin because the cloud serves these files itself in production.
 * That is deliberate — same origin means no CORS, and a session cookie that
 * simply works instead of needing SameSite=None.
 */
export default defineConfig({
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5174,
    // In development the two run apart, so proxy the API across.
    proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true } },
  },
});
