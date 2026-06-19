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
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, normalize } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// DEV-ONLY: serve the repo-root ROADMAP.html (the consolidated maintainer backlog hub) + the mock
// galleries it links, so the dev-account-gated "Roadmap" navbar link resolves on the :5173 dev
// server. `configureServer` runs ONLY under `vite dev`, never in `vite build` — so the internal
// backlog is never served from the production bundle (the navbar gate hides the link, not the file).
// Paired with the dev-roadmap link injected in src/features/cloud.js (also import.meta.env.DEV-gated).
function roadmapDevServer() {
  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
  const ROADMAP = resolve(REPO_ROOT, 'ROADMAP.html');
  const MOCKS = resolve(REPO_ROOT, 'study-app/mockups') + '/';
  return {
    name: 'roadmap-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url !== '/ROADMAP.html' && !url.startsWith('/study-app/mockups/')) return next();
        const file = normalize(resolve(REPO_ROOT, decodeURIComponent(url.replace(/^\/+/, ''))));
        if (file !== ROADMAP && !file.startsWith(MOCKS)) return next();   // scope/traversal guard
        try {
          const body = await readFile(file);
          res.setHeader('Content-Type', MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream');
          res.end(body);
        } catch { next(); }
      });
    },
  };
}

export default defineConfig({
  // Relative base so the built assets work regardless of mount path.
  base: './',
  plugins: [roadmapDevServer()],
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
