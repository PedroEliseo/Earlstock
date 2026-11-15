import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Development: the Vite dev server proxies the API, so the browser sees a single origin (the
 * backend sends no CORS headers, and the Dataset-Snapshot header stays readable). The backend
 * address can be overridden with EARLSTOCK_API_URL. Production hosting is deliberately not decided
 * yet (see README).
 */
const apiTarget = process.env['EARLSTOCK_API_URL'] ?? 'http://localhost:3000';
/**
 * Browser telemetry (opt-in, VITE_EARLSTOCK_TELEMETRY=1) is posted to the same origin under /otlp
 * and forwarded to the local OTLP relay (backend `npm run otlp-relay`), which adds the credentials.
 */
const otlpRelayTarget = process.env['EARLSTOCK_OTLP_RELAY_URL'] ?? 'http://127.0.0.1:4319';

/**
 * With VITE_EARLSTOCK_TELEMETRY=1, adds src/telemetry/boot.ts to index.html as a module script
 * placed before the application's, so telemetry starts first (see boot.ts). Without it, nothing is
 * added and the SDK is not bundled.
 */
function browserTelemetry(enabled: boolean): Plugin[] {
  if (!enabled) return [];
  return [
    {
      name: 'earlstock-browser-telemetry',
      // 'pre': added before Vite processes index.html, so the build bundles it like the app's entry.
      transformIndexHtml: {
        order: 'pre',
        handler: () => [
          {
            tag: 'script',
            attrs: { type: 'module', src: '/src/telemetry/boot.ts' },
            injectTo: 'head',
          },
        ],
      },
    },
  ];
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...browserTelemetry(loadEnv(mode, process.cwd(), 'VITE_')['VITE_EARLSTOCK_TELEMETRY'] === '1'),
  ],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/health': { target: apiTarget, changeOrigin: false },
      '/otlp': {
        target: otlpRelayTarget,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/otlp/, ''),
      },
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
              // MUI's runtime (styling engine, system, utilities). @mui/material components are
              // NOT grouped: each lands with the routes that use it, so lazy routes' components
              // stay out of the initial bundle.
              name: 'mui',
              test: /node_modules[\\/](@mui[\\/](system|utils|styled-engine|private-theming|core-downloads-tracker)|@emotion|stylis|react-transition-group|@popperjs)[\\/]/,
              priority: 2,
            },
            {
              // The chart library stays out of the eager vendor chunk: it is loaded only with charts.
              name: 'vendor',
              test: /node_modules[\\/](?!lightweight-charts|fancy-canvas|@mui[\\/]material|@mui[\\/]icons-material)/,
              priority: 1,
            },
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
}));
