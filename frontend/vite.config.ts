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
    // Warn if any single chunk grows unexpectedly; the chart library gets its own lazy chunk.
    chunkSizeWarningLimit: 400,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: application changes do not invalidate the cached framework and
        // design-system code, which change only on dependency upgrades.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/,
              priority: 3,
            },
            {
              name: 'mui',
              test: /node_modules[\\/](@mui|@emotion|@popperjs|stylis|react-transition-group)[\\/]/,
              priority: 2,
            },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
