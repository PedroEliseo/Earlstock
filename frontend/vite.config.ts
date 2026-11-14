import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Development: the Vite dev server proxies the API, so the browser sees a single origin (the
 * backend sends no CORS headers, and the Dataset-Snapshot header stays readable). The backend
 * address can be overridden with EARLSTOCK_API_URL. Production hosting is deliberately not decided
 * yet (see README).
 */
const apiTarget = process.env['EARLSTOCK_API_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/health': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    sourcemap: true,
    // Baseline (React, router, TanStack Query, zod/mini) is about 345 kB minified / 108 kB gzipped.
    // Warn if any chunk grows beyond that noticeably; the chart library gets its own lazy chunk.
    chunkSizeWarningLimit: 400,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
