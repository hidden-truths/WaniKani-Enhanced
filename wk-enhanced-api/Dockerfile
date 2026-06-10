# syntax=docker/dockerfile:1.7
#
# wk-enhanced-api container image. Multi-stage build:
#
#   - `deps`     installs production dependencies against the frozen lockfile
#                so the final image doesn't carry dev deps (typescript,
#                @types/bun). Cached across builds whenever bun.lock and
#                package.json haven't changed — usually meaning a code-only
#                change rebuilds in seconds.
#
#   - `runtime`  assembles the minimal runtime image. Just the bun binary
#                (from the base), production node_modules, src/, data/, the
#                two scripts the backup systemd unit calls, and package.json
#                (config.ts reads version from it). Runs as the official
#                `bun` user (uid 1000) — see deploy/README.md for the host-
#                side chown step.
#
# Pinned to the exact Bun version we develop against so dev and prod can't
# silently diverge on a 1.3.x point release. Bump this in lock-step with
# local upgrades.

FROM oven/bun:1.3.8 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.8 AS runtime
WORKDIR /app

# Production node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# App source. package.json must come along — config.ts imports it for the
# version string surfaced on / and in OpenAPI docs.
COPY package.json ./
COPY src ./src
COPY data ./data

# The study web app served at `/`. A single self-contained HTML file; src/
# resolves it via `new URL('../web/index.html', import.meta.url)`, so it must
# sit as a sibling of src/ inside the image (i.e. /app/web).
COPY web ./web

# Deploy scripts that run inside the container via `docker exec` from
# host-side systemd units (currently just backup.ts + retention.ts). We
# intentionally copy only the .ts files, NOT the systemd unit templates
# or env.production.template — those are deploy-time host artifacts and
# have no business in the runtime image.
COPY deploy/backup.ts deploy/retention.ts ./deploy/

# Drop to the unprivileged `bun` user the base image provides (uid 1000).
# The host bind-mount at /var/lib/wk-enhanced-api must be owned by uid 1000
# for SQLite reads/writes to succeed; the deploy README documents this.
USER bun

# Documentation-only — Compose handles the actual port publish via the
# `ports:` directive. The PORT env var (read by config.ts) governs what
# the server binds inside the container; default 3000 matches Compose.
EXPOSE 3000

# Container-level liveness probe. /v1/health is the canonical check; it
# returns 200 + {status:'ok',...} with Cache-Control: no-store. Use Bun's
# built-in fetch as the probe command so the image has no curl dependency.
# Tightish defaults so a hung worker (cold-warm holding for >5s without
# writing bytes is normal — we don't probe during warm storms) gets
# retried; the start-period gives the server time to boot the SQLite
# schema before the first probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD bun --eval 'fetch("http://localhost:" + (process.env.PORT || 3000) + "/v1/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'

CMD ["bun", "run", "start"]
