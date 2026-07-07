# Troubleshoot: production incidents

Prod is a single DigitalOcean droplet (SFO3) running **two Docker containers** behind a
**Cloudflare Tunnel**, with DO Spaces as the media CDN. Deploy/rollback itself is the
`deploy-prod` skill; this file is for *diagnosing* a live incident. **Every command below is
lifted from `wk-enhanced-api/deploy/README.md` — re-verify against it before running, and never
invent a prod command.**

## Topology (know before you touch)

- **Droplet:** `ssh root@209.38.71.210`. Repo cloned at `/opt/wk-enhanced-api`; server source is
  the nested `wk-enhanced-api/` subdir, so **compose lives at
  `/opt/wk-enhanced-api/wk-enhanced-api/compose.yaml`**.
- **Two compose services:** `api` (container `wk-enhanced-api`, `127.0.0.1:3000`) + `web` (nginx,
  container `wk-study-app`, `127.0.0.1:8080`). systemd unit `wk-enhanced-api.service` wraps
  `docker compose up -d`.
- **Cloudflare token tunnel** maps `api.wkenhanced.dev` → `:3000` and the apex `wkenhanced.dev` →
  `:8080`. **The apex DNS `CNAME @ → <tunnel-uuid>.cfargotunnel.com` was added MANUALLY** in
  Cloudflare DNS — a token/dashboard tunnel does NOT auto-create the apex record. If `api.` works
  but the apex is `DNS_PROBE_FINISHED_NXDOMAIN` / empty `dig`, that manual CNAME is the first
  suspect, not the containers.
- **Logs:** `docker compose logs -f api` is the real structured-JSON story (see
  `references/api.md`). `journalctl -fu wk-enhanced-api` shows only unit start/stop.

## SAFETY: diagnose before you restart

Restarting a container or the tunnel is **user-visible** on a live service. Confirm the fault with
a read-only probe first, and — unless it's already clearly down — confirm the restart with the
user. **Never** run destructive ops as a diagnostic: no `docker compose down -v`, no volume/DB
`rm`. A daily backup timer exists (`wk-enhanced-api-backup.timer`, 03:00 UTC → Spaces); check its
recency (`journalctl -u wk-enhanced-api-backup -n 50`) before any risky operation.

## Triage ladder (run top-down, stop when you find the break)

```bash
# 1. Is the API reachable through the edge? (from anywhere — public, safe)
curl -s https://api.wkenhanced.dev/v1/health
#    200 {"status":"ok",...}      → edge + tunnel + API all up; fault is higher (content/app)
#    CORS/connection refused/hang → tunnel or origin down → step 2
#    apex NXDOMAIN but api. is OK → the MANUAL apex CNAME (see topology) — a DNS fix, not the box

# 2. On the droplet:
ssh root@209.38.71.210
systemctl status wk-enhanced-api            # is the compose unit up?
docker compose -f /opt/wk-enhanced-api/wk-enhanced-api/compose.yaml ps
#    → wk-enhanced-api + wk-study-app should both be Up

# 3. Read the origin logs (the real story):
cd /opt/wk-enhanced-api/wk-enhanced-api
docker compose logs api --tail 100          # boot errors, warm failures, request lines

# 4. Local-origin probes (bypass Cloudflare to isolate edge vs origin):
curl -s http://127.0.0.1:3000/v1/health     # API container healthy?
curl -sI http://127.0.0.1:8080/             # 200 text/html = the study-app container serves

# 5. Tunnel (if origin is healthy at :3000/:8080 but the public URL isn't):
systemctl status cloudflared
```

Interpreting the ladder: **origin healthy at :3000 but public URL dead** → tunnel problem
(`cloudflared`). **`/v1/health` hangs** → API up but cloudflared lost the upstream; a
`systemctl restart wk-enhanced-api` (or `cloudflared`) recovers it — confirm with the user first.
Only restart the specific broken layer.

## Prod media 404 (works locally)

A word's text renders but its audio/image 404s on prod only → the warm pipeline half-failed
mid-upload to Spaces (local uses the `local` storage driver, so the divergence is expected — see
the parity table in `wk-enhanced-api/CLAUDE.md`). Re-warm that word with `force:true` to re-upload
(the admin-warm curl is in `references/userscript.md`). If MANY words 404, suspect the Spaces
key/ACL: DO Spaces **Full Access** keys are required (Limited Access can't set `public-read` ACLs →
every upload `AccessDenied`), and `S3_FORCE_PATH_STYLE=true` is mandatory. Both are documented
dead-ends; check `/etc/wk-enhanced-api/env`.

## A prod tab / library is empty (local is fine)

Almost always a **seed step that never ran** after the deploy. Schema changes apply automatically
on container restart (`CREATE ... IF NOT EXISTS`), but **one-time DATA seeds must be run
explicitly**. Diagnose by hitting the public endpoint directly:

```bash
curl https://api.wkenhanced.dev/v1/sentences?ownerType=selftalk   # 独り言 built-ins present?
curl https://api.wkenhanced.dev/v1/sentences?ownerType=card       # example sentences present?
curl https://api.wkenhanced.dev/v1/songs                          # 歌 starter library present?
```

Empty there → the corresponding seed hasn't run. The one-shot check for ALL authored content is
`cd wk-enhanced-api && bun scripts/verify-prod.ts` (read-only, anon; exits non-zero on drift,
prints `✓ prod is in sync with local content` when clean). **Running the seed is a `deploy-prod`
task** — it uses the `docker compose run -v /opt/wk-enhanced-api:/repo` pattern with the
**ENV_FILE/DATA_DIR gotcha** (a bare `docker compose` doesn't inherit the systemd `Environment=`
directives, so `env_file` falls back to a nonexistent `./.env` and the bind mount to an empty
`./.compose-data` → you'd seed the WRONG DB or abort). Do not improvise that invocation from here;
hand off to `deploy-prod`, which lifts the exact command lines from `deploy/README.md`.

## Voice shows "not generated" on prod despite bytes in the bucket

A known split: a voice can have its **bytes** in Spaces yet be absent from `/v1/audio/variants`
because the `audio_variants` **manifest row** (in SQLite) was never seeded — the Settings picker
reads the manifest, not storage. The two-step voice deploy is always *push bytes from the Mac*
(`push-tts-variants.ts`) **then** *seed the manifest on the droplet* (`seed-audio-variants.ts`).
Both are `deploy-prod` operations.

## Fixing prod

Once diagnosed: config/env fixes and container/tunnel restarts, seed runs, and rollback all live
in the **`deploy-prod`** skill. Code fixes go through `api-dev` / `study-app-dev` / `userscript-dev`
and then a deploy. This file's job ends at "which layer is broken and why."

## Ground truth (as of 2026-07)

Verified against `wk-enhanced-api/deploy/README.md` (compose path
`/opt/wk-enhanced-api/wk-enhanced-api/compose.yaml`; the two services + container names
`wk-enhanced-api`/`wk-study-app`; the ENV_FILE/DATA_DIR gotcha; the seed-verification curls; the
manual apex CNAME note; Full-Access/`S3_FORCE_PATH_STYLE` requirements; `verify-prod.ts`) and
`wk-enhanced-api/compose.yaml` (services `api`/`web`, ports 3000/8080). Droplet
`root@209.38.71.210` and the token-tunnel + manual-apex-CNAME topology are maintainer facts
corroborated by the deploy README. Prod `/v1/health` returned `status:ok`, ~6.7k warmed words at
authoring time. `docker compose logs api` (not `journalctl`) is the structured-log surface.
