# wk-enhanced-api deploy templates

Paste-ready artifacts for deploying the server to a single DigitalOcean droplet (or any Ubuntu-flavoured Linux host) running Docker Engine + Compose v2, with DO Spaces for media and Cloudflare in front for TLS / rate-limiting / edge cache.

The deployed thing is called **wk-enhanced-api** everywhere — in DigitalOcean, at `api.wkenhanced.dev`, in this repo's source tree. (The directory used to be called `wk-vocab-api/` until the 2026-05-25 rebrand commit `cbfeabf`; if you're updating a production droplet that predates that, see "Updating a pre-rename droplet" below.)

These are templates — not part of the running service. The runtime under [../src/](../src/) is unchanged; the container image is built from the [`../Dockerfile`](../Dockerfile) using [`../compose.yaml`](../compose.yaml).

Read the broader architecture in [../CLAUDE.md](../CLAUDE.md) before touching these. The deploy decisions — why a single droplet over K8s, why SQLite over Postgres — are captured in [../docs/decisions/ADR-001-no-kubernetes.md](../docs/decisions/ADR-001-no-kubernetes.md) and the CLAUDE.md DEAD-END WARNINGS.

## Files

| File | Lives at on host | What it does |
|---|---|---|
| `../Dockerfile` | Built into the image, not copied to the host | Multi-stage build off `oven/bun:1.3.8`. `deps` stage installs production dependencies with `--frozen-lockfile`; `runtime` stage copies the production node_modules + src/ + data/ + the two backup scripts. Runs as the official `bun` user (uid 1000). |
| `../compose.yaml` | (lives in the cloned repo at `/opt/wk-enhanced-api/wk-enhanced-api/compose.yaml`; not copied to /etc) | Compose stack for the single `api` service. Binds 127.0.0.1:3000, mounts `/var/lib/wk-enhanced-api` for SQLite, loads env from `/etc/wk-enhanced-api/env`, caps log rotation at 30MB. |
| `env.production.template` | `/etc/wk-enhanced-api/env` | Env file Compose loads via `env_file:`. Replace every `<REPLACE_ME_*>` placeholder. `chmod 600`, `chown root:root`. |
| `wk-enhanced-api.service` | `/etc/systemd/system/wk-enhanced-api.service` | Thin systemd wrapper that runs `docker compose up -d` on boot and `docker compose down` on stop. Container-level concerns (user, sandbox, restart policy) live in the Dockerfile + compose.yaml, not here. |
| `wk-enhanced-api-warm.service` | `/etc/systemd/system/wk-enhanced-api-warm.service` | One-shot unit that curls `POST /v1/admin/warm {"scope":"all"}` against 127.0.0.1:3000 (i.e. the container's published port). Reads `ADMIN_TOKEN` from the same env file the API uses. After `dc2629c`, a duplicate trigger while a warm is in flight returns 409. |
| `wk-enhanced-api-warm.timer` | `/etc/systemd/system/wk-enhanced-api-warm.timer` | Schedule for the warm one-shot. Fires `*-*-01 04:00:00` (1st of month, 04:00 local). |
| `wk-enhanced-api-backup.service` | `/etc/systemd/system/wk-enhanced-api-backup.service` | One-shot unit that runs `docker exec wk-enhanced-api bun run /app/deploy/backup.ts` — VACUUM-INTO snapshot of the SQLite DB, upload to `s3://<bucket>/backups/YYYY-MM-DD.sqlite`, and prune older backups per the GFS retention in `deploy/retention.ts`. |
| `wk-enhanced-api-backup.timer` | `/etc/systemd/system/wk-enhanced-api-backup.timer` | Schedule for the backup oneshot. Fires `*-*-* 03:00:00 UTC` (daily, 03:00 UTC — UTC pinned to match the backup-key naming). |
| `backup.ts`, `retention.ts` | Copied into the container image at `/app/deploy/` | The actual backup script + its pure retention helper. Use Bun's built-in `bun:sqlite` (`VACUUM INTO`) and `Bun.S3Client` — no extra image deps. Retention tested in `retention.test.ts`. |

## Order of operations (fresh droplet)

Assumes you've already done the human-side prerequisites from the main README (domain registered, DO account + droplet provisioned in SFO3, Spaces bucket + Full Access keys created, Cloudflare site + DNS + SSL configured, droplet's public IP captured).

```bash
# 1. Install Docker Engine + Compose v2 from Docker's official apt repo.
#    Ubuntu's bundled docker.io is fine for this workload too, but the
#    upstream repo gets you a current Compose v2 binary alongside.
curl -fsSL https://get.docker.com | sh
docker --version            # sanity
docker compose version      # sanity — needs the "compose" subcommand

# 2. Create the SQLite directory and chown it to uid:gid 1000:1000 so the
#    container's `bun` user (uid 1000) can read/write through the bind
#    mount. You do NOT need to useradd `wkenhanced` on the host — the
#    container handles its own user. The bare numeric uid:gid keeps this
#    correct even if the host has no `bun` user of its own.
install -d -o 1000 -g 1000 /var/lib/wk-enhanced-api

# 3. Clone the repo at /opt/wk-enhanced-api. Server source lives at the
#    nested `wk-enhanced-api/` subdirectory (the repo contains both the
#    userscript at the top and the server one level down — both are
#    named wk-enhanced-api after the 2026-05-25 rebrand).
git clone https://github.com/<your-user-or-org>/WaniKani /opt/wk-enhanced-api
cd /opt/wk-enhanced-api/wk-enhanced-api

# 4. Compose the env file. ADMIN_TOKEN: openssl rand -hex 32 (save it
#    somewhere offline first — once it goes into /etc/wk-enhanced-api/env
#    it's chmod 600 root-only).
install -d -m 700 /etc/wk-enhanced-api
install -m 600 -o root -g root \
    deploy/env.production.template \
    /etc/wk-enhanced-api/env
$EDITOR /etc/wk-enhanced-api/env

# 5. Install + start the systemd units. wk-enhanced-api.service brings up
#    the Compose stack; the two timers schedule the bulk warm + the daily
#    backup against that running container.
install -m 644 deploy/wk-enhanced-api.service \
    /etc/systemd/system/wk-enhanced-api.service
install -m 644 deploy/wk-enhanced-api-warm.service \
    /etc/systemd/system/wk-enhanced-api-warm.service
install -m 644 deploy/wk-enhanced-api-warm.timer \
    /etc/systemd/system/wk-enhanced-api-warm.timer
install -m 644 deploy/wk-enhanced-api-backup.service \
    /etc/systemd/system/wk-enhanced-api-backup.service
install -m 644 deploy/wk-enhanced-api-backup.timer \
    /etc/systemd/system/wk-enhanced-api-backup.timer
systemctl daemon-reload
systemctl enable --now wk-enhanced-api
systemctl enable --now wk-enhanced-api-warm.timer
systemctl enable --now wk-enhanced-api-backup.timer

# 6. Verify boot. First start pulls the base image + runs the multi-stage
#    build, which takes a couple of minutes; subsequent restarts are
#    near-instant.
docker compose -f /opt/wk-enhanced-api/wk-enhanced-api/compose.yaml logs -f api
# In another shell:
curl -s http://127.0.0.1:3000/v1/health         # local check; should be {"status":"ok",...}
curl -s https://api.wkenhanced.dev/v1/health    # public check via Cloudflare
```

After this, run the initial bulk warm once manually (the timer's next fire is the 1st of next month, which may be weeks away):

```bash
systemctl start wk-enhanced-api-warm
# Then watch:
docker compose -f /opt/wk-enhanced-api/wk-enhanced-api/compose.yaml logs -f api | grep -E 'warm\.(word|all)'
```

Optional but recommended: run one immediate backup to verify the S3 path before the daily timer fires:

```bash
systemctl start wk-enhanced-api-backup
journalctl -u wk-enhanced-api-backup -n 50
```

## Serving the study app at wkenhanced.dev (two-container cut-over)

The study app is now its **own container** — `web:` in [compose.yaml](../compose.yaml), built
from the sibling [study-app/](../../study-app) (Vite build → nginx on `127.0.0.1:8080`) —
**separate** from the API (`api:` on `:3000`). The apex `wkenhanced.dev` serves the tool;
`api.wkenhanced.dev` serves the API. They're same-site but **cross-origin**, so the session
cookie spans them via `Domain=.wkenhanced.dev` + an origin-scoped credentialed-CORS branch
(all in code). The steps below are the operator's **one-time cut-over**, ordered for zero
apex downtime.

> **Status: this cut-over shipped (2026-05-26).** The API serves no static study-app assets
> anymore (`web/` and its routes are gone) and the apex is served by the `web:` container. The
> steps below are kept as the historical runbook + the rollback recipe — you don't re-run them
> on the current droplet.

**1. Droplet env** (`/etc/wk-enhanced-api/env`) — three lines:
```
COOKIE_SECURE=true                        # already in the prod template
COOKIE_DOMAIN=.wkenhanced.dev             # the cookie now spans apex + api.
STUDY_APP_ORIGINS=https://wkenhanced.dev  # the credentialed-CORS allowlist
```

**2. Bring up both containers.** The `web` image bakes `VITE_API_BASE=https://api.wkenhanced.dev`
at build time (override via `STUDY_API_BASE`). **Run compose with the same `ENV_FILE` +
`DATA_DIR` the systemd unit injects** — a bare `docker compose up` defaults `env_file` to a
non-existent `./.env` and aborts, and (worse) an unset `DATA_DIR` bind-mounts an empty
`./.compose-data` instead of the real SQLite under `/var/lib/wk-enhanced-api`, so the API
boots against an empty DB (accounts/progress *look* gone). Or run `docker compose build` then
`systemctl restart wk-enhanced-api` to let the unit supply both:
```bash
cd /opt/wk-enhanced-api/wk-enhanced-api
export ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api  # what the systemd unit sets
docker compose up -d --build               # builds study-app (vite→nginx) + api
docker compose ps                           # wk-enhanced-api + wk-study-app both Up
curl -sI http://127.0.0.1:8080/             # 200 text/html (the tool)
curl -s  http://127.0.0.1:3000/v1/health    # API still healthy
```
At this point in the cut-over the API still had its `web/` fallback routes (until step 5's
decommission commit), so the apex kept working regardless of ingress state.

**3. Repoint the Cloudflare apex ingress** from the API (`:3000`) to the tool (`:8080`).
`api.wkenhanced.dev` stays on `:3000`.

- **Dashboard / token-managed tunnel** (Zero Trust → Networks → Tunnels → your tunnel →
  Public Hostnames): edit the `wkenhanced.dev` hostname's Service from `HTTP localhost:3000`
  → `HTTP localhost:8080` (add the hostname pointing at `:8080` if it didn't exist).
  **At the zone apex this is not sufficient by itself** — adding a Public Hostname does *not*
  auto-create the apex DNS record the way it does for sub-domains. Add it by hand under
  **DNS → Records**: type `CNAME`, name `@`, target `<tunnel-uuid>.cfargotunnel.com`,
  **Proxied** (orange). Skip it and `dig wkenhanced.dev` is empty / browsers show
  `DNS_PROBE_FINISHED_NXDOMAIN` while `1.1.1.1` and the droplet resolve fine. The
  `<tunnel-uuid>` is the `t` field of the `--token` (decode the base64) or the tunnel URL.
- **Locally-managed** (`/etc/cloudflared/config.yml`):
  ```yaml
  ingress:
    - hostname: api.wkenhanced.dev
      service: http://localhost:3000
    - hostname: wkenhanced.dev
      service: http://localhost:8080       # <-- was :3000
    - service: http_status:404
  ```
  `systemctl restart cloudflared`.

**4. Verify the live cross-origin app:**
```bash
curl -sI https://wkenhanced.dev/                   # 200 text/html (the tool container)
curl -s  https://api.wkenhanced.dev/ | head -c 90  # service-info JSON, app: https://wkenhanced.dev
# the preflight must echo the apex origin + credentials:
curl -sI -X OPTIONS https://api.wkenhanced.dev/v1/auth/login \
  -H 'Origin: https://wkenhanced.dev' -H 'Access-Control-Request-Method: POST' \
  | grep -i 'access-control-allow-\(origin\|credentials\)'
```
Then open `https://wkenhanced.dev/`, sign in, and confirm the chip shows your email and
progress survives a reload + a second browser. Native みんなの日本語 audio should play (its
`<audio>` sends the cookie via `crossOrigin='use-credentials'`).

**5. Decommission the API fallback** — once step 4 is confirmed, deploy the decommission
commit (removes the API's static `web/` routes + `COPY web`) and `docker compose up -d
--build`. `api.wkenhanced.dev/app.js` then 404s and `/` returns service-info JSON — the tool
container is the only thing serving the app.

**Rollback.** Repoint the apex ingress back to `:3000` and restore the pre-cut-over API image
(the old image still serves `web/` at `/`). Heads-up: `docker compose up --build` on a
**containerd** image store prunes the old *untagged* image, so there's no instant `docker tag`
retag unless you pre-tagged it. Two paths: (a) pre-built tagged snapshot — `docker build -t
wk-enhanced-api:rollback-<sha> .` from a `git worktree` at the old sha (tagged images survive
the prune), then `docker tag wk-enhanced-api:rollback-<sha> wk-enhanced-api:local && docker
compose up -d --no-build api && docker compose stop web`; (b) rebuild from source — `git
checkout <old-sha> && ENV_FILE=… DATA_DIR=… docker compose up -d --build --remove-orphans`.

> Apex DNS note: Cloudflare CNAME-flattens the apex, so a **manually-added** proxied `CNAME @ → <tunnel-uuid>.cfargotunnel.com` resolves with no A record needed — but for a token/dashboard-managed tunnel you must add that record yourself (the Public Hostname UI won't create it at the apex). See step 3.

## Local bring-up of the Compose stack

`bun dev` from the repo is still the fastest iteration loop, but `docker compose up` from a fresh checkout also works end-to-end with no host-side prep:

```bash
cd wk-enhanced-api
cp .env.example .env       # if you haven't already
docker compose up --build
# In another shell:
curl http://127.0.0.1:3000/v1/health
```

Two `compose.yaml` env-var inputs make this portable between dev and prod:

| Input | Local default | Prod (set by systemd) |
|---|---|---|
| `ENV_FILE` | `./.env` (the file you just `cp`-ed) | `/etc/wk-enhanced-api/env` (chmod-600, root-only) |
| `DATA_DIR` | `./.compose-data` (gitignored, Docker Desktop auto-creates) | `/var/lib/wk-enhanced-api` (persistent host directory) |

Inside the container, `compose.yaml` hard-codes `DATABASE_FILE=/var/lib/wk-enhanced-api/wk-enhanced-api.sqlite` and `LOCAL_MEDIA_DIR=/var/lib/wk-enhanced-api/media` regardless of what's in the env file — those paths live inside the bind mount so both writable state survives container restarts. (The dev `.env`'s `./dev-data/...` paths still apply to `bun dev`, which doesn't read `compose.yaml`.)

Local data lands at `wk-enhanced-api/.compose-data/` — inspect with Finder or `sqlite3`. Wipe with `docker compose down && rm -rf .compose-data`.

**Linux dev note:** on Linux, the bind-mount source needs to be writable by uid 1000 (the container's `bun` user). If your shell uid isn't 1000, pre-create with `sudo install -d -o 1000 -g 1000 .compose-data` once. Docker Desktop on macOS handles uid mapping transparently so no setup needed there.

**S3 vars stay blank in dev** — `STORAGE_DRIVER=local` is the default in `.env.example`, so media writes go under `.compose-data/media`. For local Docker testing where you only care about boot + HTTP, leaving the S3 vars blank is fine.

## Updating after a `git pull`

```bash
cd /opt/wk-enhanced-api && git pull
cd wk-enhanced-api
# Rebuild the image with the new source. --pull keeps the bun base layer current.
docker compose build --pull
# Recreate the container with the new image. Compose stops the old one
# and starts the new one in a few seconds.
systemctl restart wk-enhanced-api
```

If any of the files in this directory changed (`*.service`, `*.timer`), re-copy them (`install -m 644 ... /etc/systemd/system/...`) and `systemctl daemon-reload` before restart.

**Schema changes apply automatically on restart** — `openDb()` runs the whole `schema.sql` with
`CREATE … IF NOT EXISTS` at boot, so new tables/indexes/views appear the moment the new container
starts. No migration step.

**One-time DATA seeds must be run explicitly, though.** A deploy that ships a new seedable dataset
needs its seed script run once against the prod DB after the restart. As of the **unified sentence
store (Phase 1 + Phase 2)** `seed-sentences.ts` seeds BOTH the built-in 独り言 Self-Talk phrases AND
the built-in vocab example sentences (Phase 2 — public rows linked to cards) in one run — without it
the live 独り言 tab AND the flashcard/Browse example sentences fetch an empty store and render nothing:

```bash
# Run on the droplet, in the compose dir, AFTER `systemctl restart wk-enhanced-api`.
cd /opt/wk-enhanced-api/wk-enhanced-api
# Reuses the `api` service's env_file + DB bind-mount (so DATABASE_FILE already points at the
# prod sqlite), but runs the script from the HOST repo checkout mounted at /repo — the runtime
# image deliberately ships only src/+data/, NOT scripts/ or study-app/, which the seed needs.
# BOTH ENV_FILE and DATA_DIR MUST be set the same way the systemd unit's Environment= directives
# set them (the compose ENV_FILE/DATA_DIR gotcha) — a manual `docker compose` invocation doesn't
# inherit them, so env_file falls back to ./.env (which doesn't exist on prod → "env file … not
# found") and the bind mount falls back to ./.compose-data (you'd seed the wrong file).
ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api \
  docker compose run --rm --no-deps \
  -v /opt/wk-enhanced-api:/repo -w /repo/wk-enhanced-api \
  api bun scripts/seed-sentences.ts
# → "seeded 44 Self-Talk built-in phrases…" + "seeded 500 example sentences (500 links across 100
#   cards)…". Idempotent: safe to re-run (reuse-by-hash + link-replace → no growth).
```

The seed's import chain is pure (relative + Bun/Node builtins only — no third-party deps), so it
runs in the bare `oven/bun` image with the repo mounted; no `bun install` needed. It writes through
WAL alongside the live server safely. Verify after:
`curl https://api.wkenhanced.dev/v1/sentences?ownerType=selftalk` returns the Self-Talk built-ins and
`…?ownerType=card` returns the example sentences (one entry per card/tier) — and the apex study-app's
独り言 tab + the flashcard/Browse example sentences should populate, with the credentialed CORS header
echoing the apex origin.

**歌/Songs starter library (`seed-songs.ts`).** Seeds the curated starter songs (`data/songs/*.json`)
as PUBLIC, anon-readable rows — the `song` table + one `sentence` row per line (`owner_type='song'`).
Without it `GET /v1/songs` returns nothing and the apex study-app's 歌/Songs library renders empty.
**Run it AFTER `seed-sentences.ts`** and BEFORE `seed-annotations.ts` below. Same mounted-repo
invocation + the same `ENV_FILE`/`DATA_DIR` gotcha — **plus one extra flag the other seeds don't need:**

> **CRITICAL — `seed-songs.ts` requires `-e NODE_PATH=/app/node_modules`.** Unlike the pure-import
> `seed-sentences.ts` / `seed-annotations.ts`, this script imports `@anthropic-ai/sdk` *transitively*
> (via `offsetTokens` from `src/services/songAnalyze.ts` — reused so the seed's UTF-16 token offsets
> match the runtime analyzer's). The mounted host repo at `/repo` ships no `node_modules`, so the bare
> seed-sentences-style invocation fails with `error: Cannot find module '@anthropic-ai/sdk' from
> '/repo/wk-enhanced-api/src/services/songAnalyze.ts'`. The `-e NODE_PATH=/app/node_modules` points
> Bun at the image's installed production deps (the Dockerfile's `WORKDIR /app` + `COPY --from=deps
> /app/node_modules`) so the transitive dep resolves.

```bash
cd /opt/wk-enhanced-api/wk-enhanced-api
ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api \
  docker compose run --rm --no-deps \
  -e NODE_PATH=/app/node_modules \
  -v /opt/wk-enhanced-api:/repo -w /repo/wk-enhanced-api \
  api bun scripts/seed-songs.ts
# → "seeded N starter song(s) (… lines, … timed) into the song store". Idempotent (upsert by song
#   ext_id, reuse-by-hash per line). Verify: `curl https://api.wkenhanced.dev/v1/songs` lists the
#   starter songs and the apex study-app's 歌/Songs library populates.
```

**Phase 4 — NLP annotations + grammar tags (`seed-annotations.ts`).** Loads the committed
`data/annotations.json` (parsed OFFLINE — no Python on the droplet) into `sentence_annotation` and writes
the detected grammar ids to `sentence_tag(kind='grammar')`. Without it the study-app's tap-a-word lookup
silently falls back to plain ruby (the client code is live but `?annotate=1` returns no tokens). **Run it
AFTER `seed-sentences.ts`** (it resolves rows by content hash, so the sentence rows must exist first), same
mounted-repo invocation + the same `ENV_FILE`/`DATA_DIR` gotcha:

```bash
cd /opt/wk-enhanced-api/wk-enhanced-api
ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api \
  docker compose run --rm --no-deps \
  -v /opt/wk-enhanced-api:/repo -w /repo/wk-enhanced-api \
  api bun scripts/seed-annotations.ts
```

The upsert re-asserts the UTF-16 offset contract, so a stale/mismatched artifact ABORTS the seed rather
than landing bad offsets. Idempotent. Verify:
`curl -s 'https://api.wkenhanced.dev/v1/sentences?ownerType=card&annotate=1' | grep -o '"annotation"' | head -1`
returns `"annotation"`, and the apex study-app's Browse example sentences become tappable + the Grammar
filter row appears. (The grammar-filter LABELS ride in the study-app's own `web` image build — `grammar.json`
is committed + Vite-bundled — so no separate seed for those.)

**Seeding / re-voicing the Siri TTS voices (`siri:male` / `siri:female`).** Unlike the seed above, the
tagged voice clips can't be (re)generated on the droplet — rendering a Siri voice needs a Mac with the
right **System Voice** (see `scripts/generate-tts.ts`). Once you've rendered them locally there's no
reason to render a second time for prod; ship the same bytes with `scripts/push-tts-variants.ts`, run
**from the Mac** (it has the `.m4a`s; S3 is reachable from anywhere) against the prod bucket:

```bash
# From wk-enhanced-api/ on the Mac. Dry-run first to see the count, then --force to OVERWRITE
# (required to RE-VOICE clips that were originally seeded with the wrong System Voice).
cd wk-enhanced-api
STORAGE_DRIVER=s3 \
  S3_ENDPOINT=… S3_REGION=… S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… S3_FORCE_PATH_STYLE=true \
  bun scripts/push-tts-variants.ts --dry-run            # then re-run with --force
```

That push moves BYTES only. The Settings voice picker is driven by the `audio_variants` MANIFEST, which
`GET /v1/audio/variants` reads from the sqlite — NOT from storage — so until those rows exist in the prod
DB the picker shows the voice as "not generated" even though the clips are in the bucket. The manifest rows
can't be written from the Mac (it can't reach the droplet's sqlite), so seed them **on the droplet** with
`seed-audio-variants.ts`, via the same mounted-repo `docker compose run` as the sentence seed above:

```bash
cd /opt/wk-enhanced-api/wk-enhanced-api
# Reuses the api service's env_file (→ prod DATABASE_FILE + S3_* for the bucket existence checks) and
# the repo mount at /repo. Re-derives the text set + records a manifest row only for clips actually in
# the bucket — self-correcting + idempotent. Same ENV_FILE/DATA_DIR gotcha as the sentence seed.
ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api \
  docker compose run --rm --no-deps \
  -v /opt/wk-enhanced-api:/repo -w /repo/wk-enhanced-api \
  api bun scripts/seed-audio-variants.ts
# → "siri:male → recorded 960 present" + "siri:female → recorded 960 present".
```

After the push + seed, the new `/v1/audio/tts` cache headers (ETag + `public, no-cache`) make any client
holding the old wrong-voice clip revalidate and pick up the corrected bytes on next play — no cache-bust
needed. Verify: `curl -s "https://api.wkenhanced.dev/v1/audio/variants?text=%E9%A3%9F%E3%81%B9%E3%82%8B"`
now lists `siri:male`/`siri:female` (not just `google`), the study app's Settings picker offers them, and
`curl -s "https://api.wkenhanced.dev/v1/audio/tts?text=…&voice=siri:male" -o /tmp/m.m4a` plays the male voice.

## Verify the whole deploy in one shot (`verify-prod.ts`)

After the seeds + pushes above, run the **read-only** verifier to confirm prod actually serves
everything authored locally. It makes anonymous GETs only (no `.env`, no S3/DB creds, no cookie) and
exits non-zero on any drift, so it doubles as a deploy-script gate or a cron heartbeat:

```bash
# From wk-enhanced-api/ on any machine with the repo (reads local data/ + the study-app bundles, hits
# the public API). Run it RIGHT AFTER a deploy to catch a half-applied one.
bun scripts/verify-prod.ts                                # check api.wkenhanced.dev
bun scripts/verify-prod.ts --full                         # exhaustive voice probe (every TTS text, slower)
bun scripts/verify-prod.ts --base http://localhost:3000   # check a local/dev server instead
```

It checks `/v1/health`; songs (`/v1/songs` vs `data/songs/*.json` by ext id + timing sidecars);
selftalk + example sentences + annotations (`/v1/sentences`); templates (`/v1/templates`); and a
SAMPLE of voice clips (`/v1/audio/variants` — are `siri:male`/`siri:female` live?). **Voices are
sampled over HTTP, not exhaustive** — when it flags missing voices, the authoritative byte+manifest
reconcile is `seed-audio-variants.ts` on the droplet (reports present/absent per clip). Default-voice
(`tts/<hash>`) clips + Minna native MP3s have no public catalog endpoint, so they're noted, not
asserted. A clean run prints `✓ prod is in sync with local content`.

> The split that bites: a voice can have its **bytes** in the bucket yet be absent from
> `/v1/audio/variants` because the `audio_variants` **manifest row** (DB) was never seeded — the
> picker reads the manifest, not storage. So the two-step voice deploy is always *push bytes from the
> Mac* (`push-tts-variants.ts`) **then** *seed the manifest on the droplet* (`seed-audio-variants.ts`).

## Migrating from a pre-Docker droplet

Pre-Docker droplets ran Bun directly via `wk-enhanced-api.service` as the unprivileged `wkenhanced` host user. Conversion is one-shot:

```bash
# 1. Stop the old bare-metal service + timers. Don't disable yet — the
#    new unit files take the same names.
systemctl stop wk-enhanced-api wk-enhanced-api-warm.timer wk-enhanced-api-backup.timer

# 2. Install Docker if it's not already on the host.
curl -fsSL https://get.docker.com | sh
docker compose version      # sanity

# 3. Pull the new repo state (brings in Dockerfile, compose.yaml, and the
#    rewritten systemd units in deploy/).
cd /opt/wk-enhanced-api && git pull
cd wk-enhanced-api

# 4. Re-chown the SQLite directory to uid 1000 (the container's bun user).
#    Pre-Docker it was owned by the host `wkenhanced` user; that uid may
#    or may not be 1000 depending on the install order. Forcing 1000:1000
#    is what compose.yaml's bind mount needs to work.
chown -R 1000:1000 /var/lib/wk-enhanced-api

# 5. Replace the systemd unit files (same paths, new contents).
install -m 644 deploy/wk-enhanced-api.service          /etc/systemd/system/
install -m 644 deploy/wk-enhanced-api-warm.service     /etc/systemd/system/
install -m 644 deploy/wk-enhanced-api-warm.timer       /etc/systemd/system/
install -m 644 deploy/wk-enhanced-api-backup.service   /etc/systemd/system/
install -m 644 deploy/wk-enhanced-api-backup.timer     /etc/systemd/system/
systemctl daemon-reload

# 6. First start triggers the build. Subsequent restarts are fast.
systemctl start wk-enhanced-api
systemctl start wk-enhanced-api-warm.timer wk-enhanced-api-backup.timer
docker compose -f /opt/wk-enhanced-api/wk-enhanced-api/compose.yaml logs -f api

# 7. Optional cleanup once you've verified everything works:
#    - The host `wkenhanced` user is no longer used. Leave it (userdel
#      risks accidentally removing files we still want); the container
#      runs as uid 1000 regardless of whether a host user maps to it.
#    - /usr/local/bin/bun can stay; nothing references it anymore but
#      it's also harmless. `apt purge bun` if you installed via apt, or
#      `rm /usr/local/bin/bun` if you used the official installer.
```

The `DATABASE_FILE` path at `/var/lib/wk-enhanced-api/wk-enhanced-api.sqlite` stays unchanged — the compose bind-mount uses the same path inside and outside the container, so the existing env file works as-is.

## Updating a pre-rename droplet

For droplets provisioned before the 2026-05-25 source rebrand (`wk-vocab-api/` → `wk-enhanced-api/`), do this once before the first post-rename `git pull`:

```bash
# Stop the service so it doesn't fail with "WorkingDirectory not found".
systemctl stop wk-enhanced-api wk-enhanced-api-warm.timer

# Rename the source directory inside the cloned repo so the new
# WorkingDirectory in wk-enhanced-api.service matches reality.
mv /opt/wk-enhanced-api/wk-vocab-api /opt/wk-enhanced-api/wk-enhanced-api

# Pull the renamed source. (git tracks the rename cleanly via -M.)
cd /opt/wk-enhanced-api && git pull
```

Then follow the "Migrating from a pre-Docker droplet" section above — both transitions can land in the same `systemctl restart`.

## Spaces key permissions — use Full Access

The S3 driver sets `acl: 'public-read'` on every upload so the resulting CDN URL is anonymously readable. **DO Spaces "Limited Access" keys do NOT grant `s3:PutObjectAcl`**, even with Read/Write/Delete scope — every upload fails with `AccessDenied`. Two workarounds were investigated and rejected:

- **Bucket policy** (`PutBucketPolicy`): not exposed by DO Spaces' S3 API. Returns 403 even with a Full Access key. Don't waste time on `s3cmd setpolicy`.
- **Two-step PUT then `s3cmd setacl`**: works but requires a post-upload hook in code, adds latency and another failure mode.

The clean path is to give the Spaces key **Full Access** in the DO control panel. On a single-tenant production droplet (one bucket, one app, key never leaves `/etc/wk-enhanced-api/env`) the practical risk delta vs Limited Access is marginal. If you need Limited Access for a multi-tenant setup, you'll need to implement the two-step approach.

## Things to remember

- **Container runs as uid:gid 1000:1000** (the `bun` user the official image provides). The host directory `/var/lib/wk-enhanced-api` MUST be owned by 1000:1000 or SQLite reads fail with EACCES. The `install -d -o 1000 -g 1000` step above handles this on fresh installs; pre-Docker droplets need the one-time `chown -R 1000:1000` in the migration section.
- **DATABASE_FILE** path stays `/var/lib/wk-enhanced-api/wk-enhanced-api.sqlite`. The bind mount uses the same path inside and outside the container precisely so the env file doesn't need to change between the old and new setups.
- **The warm timer's `OnCalendar`** uses server-local time. If you didn't `timedatectl set-timezone`, that's UTC, which is fine — just know it. The backup timer pins UTC explicitly.
- **Backups**: automated via `wk-enhanced-api-backup.timer` (daily at 03:00 UTC). The script (`deploy/backup.ts`) runs INSIDE the container via `docker exec` — it uses `bun:sqlite` for `VACUUM INTO` and `Bun.S3Client` for the upload, both of which live in the image. Snapshot lands at `s3://<bucket>/backups/YYYY-MM-DD.sqlite` (UTC date, private object). Retention is GFS-style — by default keep 7 daily + 4 weekly + 12 monthly snapshots; override with `BACKUP_RETAIN_{DAILY,WEEKLY,MONTHLY}` in `/etc/wk-enhanced-api/env`. Override the prefix with `BACKUP_PREFIX` if you want backups for multiple environments in the same bucket. Manually run a backup with `systemctl start wk-enhanced-api-backup`; tail it with `journalctl -fu wk-enhanced-api-backup`.
- **Logs**: `docker compose logs -f api` is the structured-JSON stream (one event per line). `journalctl -fu wk-enhanced-api` shows the unit-level start/stop events only. Use `docker compose logs` for the real story.
- **CI publishing the image is not set up yet.** Today's deploy builds the image locally from the cloned repo (`docker compose build`). Once a GHCR publish pipeline lands, the compose.yaml's `image:` tag becomes pullable and `docker compose pull && docker compose up -d` replaces the rebuild step. See [../../ROADMAP.html](../../ROADMAP.html) (infra: "CI publish the server image to GHCR") for the follow-up.
