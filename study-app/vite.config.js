// Vite + Vitest config for the standalone 日常日本語 study app.
//
// The app is plain ESM (no framework) so no framework plugin is needed. The
// backend lives at a different origin (api.wkenhanced.dev in prod), reached via
// the VITE_API_BASE env var baked at build time — see src/io/api.js. In dev,
// VITE_API_BASE defaults to http://localhost:3000 (the `bun dev` API), which is
// genuinely cross-origin from Vite's :5173, so the credentialed-CORS + cookie
// path is exercised locally exactly as it runs in prod (NOT proxied/hidden).
//
// Tests run under happy-dom: the pure core in src/core/* is DOM-free, but the
// test harness imports the real module graph, so a broken export fails loudly.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built assets work regardless of mount path.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{js,ts}'],
    passWithNoTests: true,
  },
});
