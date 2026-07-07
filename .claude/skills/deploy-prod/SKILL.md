---
name: deploy-prod
description: Deploy WKEnhanced/日常日本語 to production — the DO droplet, two Docker containers (api :3000 + web :8080), Cloudflare Tunnel. Covers routine update-after-git-pull, container rebuilds, the DB/sentence/song/grammar/annotation/TTS seed steps and their order, verify-prod, rollback, and the warm/backup timers. Use for ANY "ship to prod", "deploy the server", droplet operation, seed run, prod-config change, or when a shipped change isn't live on prod yet. Every command here is lifted from the deploy runbook — trust it over memory.
---

# Deploy to production

You are shipping code or content to the live production stack at `https://api.wkenhanced.dev`
(API) and `https://wkenhanced.dev` (the study app). This skill is the safe runbook: it lifts the
exact commands from `wk-enhanced-api/deploy/README.md`, which is the ONE authority — when this
skill and that README disagree, the README wins, and you re-read it before acting.

## SAFETY FIRST — read before you touch prod

Production is a live service. It has one user (the maintainer), but it is real: their accounts,
study progress, session history, and hashed passwords live in the droplet's SQLite, and the apex
is a browser tab they keep open.

- **Confirm scope with the user before acting** unless they explicitly asked you to deploy. "Ship
  this week's commits" is explicit; "I finished the fix" is NOT — ask.
- **You are documenting/operating, not free to improvise.** Every command below is verbatim from
  the README. Do NOT invent flags, paths, or a "faster" variant. An invented `docker`/`systemctl`
  line can take the service down or seed the wrong DB.
- **Never run destructive ops** (`docker volume rm`, `rm` of `/var/lib/wk-enhanced-api`, DB drop,
  `docker compose down -v`) without an explicit request AND a fresh-backup check.
- **A daily backup timer exists** (`wk-enhanced-api-backup.timer` → `deploy/backup.ts`, VACUUM-INTO
  snapshot to S3). Before any risky op, verify a recent snapshot: `journalctl -u
  wk-enhanced-api-backup -n 20` on the droplet, or `systemctl list-timers | grep backup` for the
  last-run time. If it hasn't run recently, take one first: `systemctl start wk-enhanced-api-backup`.
- **Restarting containers is user-visible** (a few seconds of apex/API downtime). Fine for a
  planned deploy; don't do it casually while diagnosing.
- Seeds and the verifier are **read-mostly and idempotent** — those are the safe operations.

## Topology (what you're deploying to)

- **Droplet:** `ssh root@209.38.71.210` (DigitalOcean, SFO3). *(IP is maintainer-memory — if it
  fails, get the current droplet IP from the DO console; it isn't stored anywhere in the repo.)*
- **Repo on the droplet:** cloned at `/opt/wk-enhanced-api`. The **server source is nested one
  level down** at `/opt/wk-enhanced-api/wk-enhanced-api/` (the repo holds the userscript at the top
  and the server below — both named `wk-enhanced-api` after the 2026-05-25 rebrand). Almost every
  command runs from `/opt/wk-enhanced-api/wk-enhanced-api`.
- **Two Compose services** (`wk-enhanced-api/compose.yaml`):
  - `api` — the Bun server, bound `127.0.0.1:3000`, container name `wk-enhanced-api`.
  - `web` — the study app (Vite build → nginx), bound `127.0.0.1:8080`, container name
    `wk-study-app`. `VITE_API_BASE=https://api.wkenhanced.dev` is baked into the bundle at build
    time (Vite has no runtime env; override with the `STUDY_API_BASE` build arg).
- **systemd** `wk-enhanced-api.service` is a thin `oneshot` wrapper: `ExecStart=/usr/bin/docker
  compose up -d --remove-orphans`, `ExecStop=docker compose down`. It sets
  `Environment="ENV_FILE=/etc/wk-enhanced-api/env"` and `Environment="DATA_DIR=/var/lib/wk-enhanced-api"`
  — **the two variables a manual `docker compose` does NOT inherit** (see the gotcha below).
- **Cloudflare Tunnel** (token/dashboard-managed): `api.wkenhanced.dev` → `127.0.0.1:3000`, apex
  `wkenhanced.dev` → `127.0.0.1:8080`. TLS/edge/rate-limiting/cache all live at Cloudflare.
- **Apex DNS is MANUAL.** A token/dashboard-managed tunnel does NOT auto-create the apex DNS record
  (it does for sub-domains). The apex `CNAME @ → <tunnel-uuid>.cfargotunnel.com` (proxied) was added
  by hand under Cloudflare **DNS → Records**. *(maintainer-memory — verify in the Cloudflare
  dashboard.)* **Consequence:** if the apex 404s / `DNS_PROBE_FINISHED_NXDOMAIN` but
  `api.wkenhanced.dev` works, suspect that manual apex CNAME, not the tunnel.
- **Media:** DO Spaces bucket + CDN, reached as an outbound HTTPS dependency (`STORAGE_DRIVER=s3`).

## The ENV_FILE / DATA_DIR gotcha (the one that bites)

`compose.yaml` parameterizes two inputs: `env_file: ${ENV_FILE:-./.env}` and volume
`${DATA_DIR:-./.compose-data}:/var/lib/wk-enhanced-api`. The systemd unit injects the prod values;
**a bare `docker compose ...` you type by hand does NOT inherit the unit's `Environment=`
directives.** Get it wrong and:

- `ENV_FILE` falls back to `./.env` — which doesn't exist on prod → `env file … not found`, abort.
- `DATA_DIR` falls back to `./.compose-data` — an empty dir → the API (or a seed) runs against an
  **empty database**. Accounts/progress *look* gone; a seed writes the **wrong file**.

So **any manual compose invocation on the droplet must set both**, exactly as the unit does:

```bash
export ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api
```

`systemctl restart wk-enhanced-api` is the alternative that supplies both for you — prefer it for
bringing the stack up; use the explicit `export` only for `docker compose run` seed steps and
`build`.

## Routine deploy (ship this week's commits)

This is the "Updating after a `git pull`" procedure from the README — verbatim commands:

```bash
# On the droplet:
cd /opt/wk-enhanced-api && git pull
cd wk-enhanced-api
# Rebuild the image(s) with the new source. --pull keeps the bun base layer current.
docker compose build --pull
# Recreate the container(s) with the new image. Compose stops the old, starts the new in seconds.
systemctl restart wk-enhanced-api
```

Then, **in order**:
1. **Systemd units changed?** If any `deploy/*.service` or `deploy/*.timer` changed in the pull,
   re-copy them and `daemon-reload` BEFORE the restart:
   `install -m 644 deploy/wk-enhanced-api*.{service,timer} /etc/systemd/system/ && systemctl daemon-reload`.
2. **Schema changes apply automatically on restart** — `openDb()` runs `schema.sql` with
   `CREATE … IF NOT EXISTS` at boot. No migration step.
3. **Seeds** — one-time DATA seeds do NOT run automatically. If the deploy ships new seedable
   content, run the relevant seed(s) below AFTER the restart.
4. **Verify** — run the verifier (see Verify section) right after, to catch a half-applied deploy.

The `web` (study app) container rebuilds in the same `docker compose build --pull` +
`systemctl restart`. There is no separate app-deploy step. The **userscript** has no server
deploy at all — a userscript "deploy" is the user pasting the new file into Tampermonkey.

## Seed steps (run only what the deploy changed)

All seeds are **idempotent** (safe to re-run) and run on the **droplet** unless noted "Mac". They
use the mounted-repo pattern: the runtime image ships only `src/`+`data/`, NOT `scripts/` or
`study-app/`, so seeds mount the host checkout at `/repo`. **Every droplet seed carries the same
`ENV_FILE`/`DATA_DIR` gotcha** — set both or you seed the wrong DB.

| When the deploy adds/changes… | Run | Where | Order |
|---|---|---|---|
| Self-Talk phrases, vocab example sentences, Self-Talk templates, Minna sentences, **N3 grammar examples** | `seed-sentences.ts` (5 passes) | droplet | 1st |
| Curated 歌/Songs starter library (`data/songs/*.json`) | `seed-songs.ts` (needs `-e NODE_PATH=/app/node_modules`) | droplet | after sentences |
| Offline NLP tokens + grammar tags (`data/annotations.json`) | `seed-annotations.ts` | droplet | AFTER sentences (resolves rows by hash) |
| New tagged Siri voice **bytes** | `push-tts-variants.ts` (`--dry-run` then `--force`) | Mac | — |
| New tagged Siri voice **manifest rows** (voice picker) | `seed-audio-variants.ts` | droplet | after the byte push |
| Render new default/tagged voice clips from scratch | `generate-tts.ts` | Mac (needs the System Voice) | before push |

**`seed-sentences.ts` now has FIVE passes** (verify with `grep -n '^// *[0-9]\.' scripts/seed-sentences.ts`):
Pass 1 Self-Talk phrases → Pass 2 vocab examples (card links) → Pass 3 Self-Talk slot-swap templates
→ Pass 4 Minna sentences (GATED, `public=0`) → **Pass 5 N3 grammar-catalog example sentences**
(`owner_type='grammar_point'`, public). **Note:** the README's expected-output snippet ("seeded 44
… + 500 example sentences") predates Passes 3–5 (README last touched in the 2026-06-19 doc
consolidation; the grammar Pass 5 landed 2026-07, commit `38586d9`) — so expect five
"seeded …" lines, not two. The single `seed-sentences.ts` run covers grammar; there is no separate
grammar seed script.

**The three pure-import droplet seeds** (`seed-sentences.ts`, `seed-annotations.ts`) — verbatim:

```bash
# Run on the droplet, in the compose dir, AFTER `systemctl restart wk-enhanced-api`.
cd /opt/wk-enhanced-api/wk-enhanced-api
ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api \
  docker compose run --rm --no-deps \
  -v /opt/wk-enhanced-api:/repo -w /repo/wk-enhanced-api \
  api bun scripts/seed-sentences.ts
# then (annotations resolve sentence rows by hash, so sentences MUST exist first):
ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api \
  docker compose run --rm --no-deps \
  -v /opt/wk-enhanced-api:/repo -w /repo/wk-enhanced-api \
  api bun scripts/seed-annotations.ts
```

**`seed-songs.ts` needs one EXTRA flag** — it imports `@anthropic-ai/sdk` transitively (via
`offsetTokens` from `src/services/songAnalyze.ts`), which the mounted host repo lacks, so point Bun
at the image's installed deps with `-e NODE_PATH=/app/node_modules`:

```bash
cd /opt/wk-enhanced-api/wk-enhanced-api
ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api \
  docker compose run --rm --no-deps \
  -e NODE_PATH=/app/node_modules \
  -v /opt/wk-enhanced-api:/repo -w /repo/wk-enhanced-api \
  api bun scripts/seed-songs.ts
```

**Voices are a two-step deploy — bytes from the Mac, then the manifest on the droplet.** A voice
can have its bytes in the bucket yet be absent from `/v1/audio/variants` because the picker reads
the `audio_variants` DB **manifest**, not storage. So always: (1) push bytes from the Mac with
`push-tts-variants.ts` (S3 is reachable from anywhere; a Mac can't reach the droplet's sqlite), then
(2) seed the manifest on the droplet with `seed-audio-variants.ts` (same mounted-repo pattern). See
`references/fresh-droplet.md` and deploy/README.md "Seeding / re-voicing the Siri TTS voices" for
the exact `push-tts-variants.ts` (`STORAGE_DRIVER=s3 S3_*=…`) invocation — it's Mac-side and takes
prod S3 creds, so verify the current command in the README before running it.

## Verify the deploy

Run the **read-only** verifier right after any deploy, from `wk-enhanced-api/` on any machine with
the repo (it makes anonymous GETs only — no `.env`, no creds — and exits non-zero on drift):

```bash
cd wk-enhanced-api
bun scripts/verify-prod.ts                                # check api.wkenhanced.dev
bun scripts/verify-prod.ts --full                         # exhaustive voice probe (slower, ~1175 GETs)
bun scripts/verify-prod.ts --base http://localhost:3000   # check a local/dev server instead
```

It checks: `/v1/health`; songs (`/v1/songs` vs `data/songs/*.json`); selftalk + examples +
annotations (`/v1/sentences`); templates (`/v1/templates`); and a **sample** of TTS voices
(`/v1/audio/variants` — are `siri:male`/`siri:female` live?). Voices are **sampled, not
exhaustive** — when it flags a missing voice, the authoritative byte+manifest reconcile is
`seed-audio-variants.ts` on the droplet. A clean run prints `✓ prod is in sync with local content`.

Plus a manual spot-check:

```bash
curl -s https://api.wkenhanced.dev/v1/health                          # {"status":"ok",...,"warmedWords":N,...}
curl -s https://api.wkenhanced.dev/v1/vocab/食べる | head -c 200        # a real payload
curl -sI https://wkenhanced.dev/ | head -1                            # 200 (the app container)
curl -s 'https://api.wkenhanced.dev/v1/sentences?ownerType=selftalk' | head -c 120   # seeds landed
```

Then open `https://wkenhanced.dev/`, sign in, confirm the email chip + progress survive a reload.

## Timers (warm + backup)

Two systemd timers run against the live container. Check they're alive with
`systemctl list-timers | grep wk-enhanced-api`:

- **`wk-enhanced-api-warm.timer`** — fires `*-*-01 04:00:00` (1st of month, server-local): `POST
  /v1/admin/warm {"scope":"all"}`. A full-cold corpus warm takes **6–10 hours** at the 500ms IK
  rate limit; a re-warm is fast (freshness check short-circuits). Needs `WK_API_TOKEN` in the env
  file (enumerates the WK corpus). Manual run: `systemctl start wk-enhanced-api-warm`.
- **`wk-enhanced-api-backup.timer`** — fires `*-*-* 03:00:00 UTC` (daily): VACUUM-INTO snapshot to
  `s3://<bucket>/backups/YYYY-MM-DD.sqlite`, GFS retention. Manual: `systemctl start
  wk-enhanced-api-backup`; tail: `journalctl -fu wk-enhanced-api-backup`.

## Rollback

The routine code rollback is checkout-a-prior-sha + rebuild (README "Rollback" path (b)), verbatim:

```bash
cd /opt/wk-enhanced-api && git log --oneline -20     # find the good sha
git checkout <old-sha>
cd wk-enhanced-api
ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api \
  docker compose up -d --build --remove-orphans
```

- **Schema-ADDITIVE changes are safe to roll back over** — the old code ignores the new
  tables/columns (`CREATE … IF NOT EXISTS` never dropped anything). *(This is judgment from how the
  schema applies, not a tested guarantee — confirm the specific change was additive.)*
- **A destructive schema change** (dropped/renamed column, altered data) is NOT safe to roll back
  by code alone — restore the DB from the pre-deploy backup snapshot. Verify a snapshot exists
  first (Safety block).
- The README also documents a two-container **cut-over** rollback (repoint the apex Tunnel ingress
  `:8080` → `:3000` and restore the pre-cut-over image) — that's for the historical single-→two-
  container migration, not a routine code deploy. You almost certainly want the git-checkout path
  above.

## Before you assume "prod == main"

Shipped-to-`main` does not mean shipped-to-prod — seeds and enum widens can lag. As of **2026-07**:
- The **N3 grammar wave 1** (grammar-n3 catalog + Pass 5 seed) and the **wanikani/jlpt progress
  enum widens** may still be **pending on prod** (roadmap `infra-prod-deploy-wanikani`; the
  maintainer's proofread-then-deploy for grammar was outstanding as of 2026-07-06). A new
  `PUT /v1/progress/jlpt` (or `wanikani`) 4xx-ing on prod means the server enum wasn't widened +
  redeployed yet.
- Confirm what's live before deciding prod is behind: check the ROADMAP (see the `roadmap` skill),
  `curl https://api.wkenhanced.dev/v1/health`, and probe the specific endpoint/enum in question.

## Traps

- **The ENV_FILE/DATA_DIR gotcha** (above) is the single most damaging mistake — a manual seed with
  `DATA_DIR` unset seeds `./.compose-data`, an empty scratch DB, and prod content silently stays
  empty. Always `export` both on the droplet.
- **Seed ordering matters:** `seed-annotations.ts` resolves rows by content hash, so
  `seed-sentences.ts` MUST run first, or annotations find no rows and silently no-op. `seed-songs.ts`
  runs after sentences too.
- **`seed-songs.ts` without `-e NODE_PATH=/app/node_modules`** fails with `Cannot find module
  '@anthropic-ai/sdk'` — it's the only seed with a transitive SDK import.
- **Voices: bytes ≠ visible.** Pushing clip bytes from the Mac does nothing for the picker until you
  seed the `audio_variants` manifest ON THE DROPLET. Two steps, always.
- **Apex vs api split-brain:** apex DNS is a manual Cloudflare record; the api subdomain is
  tunnel-managed. If only the apex is down, it's a DNS/ingress issue, not the container. (See
  Topology.)
- **Don't lower the IK 500ms rate limit** to speed up the monthly warm — 50ms triggered a ~30-min
  global 429 lockout in prod. This is a hard floor (see `wk-enhanced-api/CLAUDE.md` dead-ends).
- **CI image publishing is NOT set up** (as of 2026-07) — deploys build the image locally on the
  droplet (`docker compose build`). There is no `docker compose pull` step yet; the roadmap tracks a
  GHCR publish follow-up.

## Ground truth

This skill compresses (as of 2026-07):
- **`wk-enhanced-api/deploy/README.md`** — THE authority. All command lines are lifted from it; when
  in doubt re-read it, especially "Updating after a `git pull`", the seed blocks, the two-container
  cut-over, "Verify the whole deploy in one shot", "Migrating from a pre-Docker droplet", "Updating
  a pre-rename droplet", and "Things to remember".
- `wk-enhanced-api/deploy/` unit files (`wk-enhanced-api.service` — the `Environment=` directives +
  `ExecStart`; the `*-warm.*` + `*-backup.*` timers/services — schedules + curls) and `deploy/backup.ts`.
- `wk-enhanced-api/compose.yaml` — the `api` + `web` services, `${ENV_FILE}`/`${DATA_DIR}`
  parameterization, port binds, the `VITE_API_BASE` build arg.
- `wk-enhanced-api/scripts/{seed-sentences,seed-songs,seed-annotations,seed-audio-variants,verify-prod,collectTtsTexts}.ts`
  headers — pass structure, the `NODE_PATH` note, the verifier's scope limits.
- `wk-enhanced-api/CLAUDE.md` — the dev↔prod parity table + "Cost & deploy" + the IK-rate-limit and
  S3 dead-ends.
- **Maintainer-memory (not in the repo — verify on the droplet / in Cloudflare):** droplet IP
  `209.38.71.210` + `ssh root@`; the token-tunnel + **manually-created apex CNAME**; the git-checkout
  rollback shape (corroborated by the README's path (b)).
- **Verified live during authoring (2026-07-06):** `curl https://api.wkenhanced.dev/v1/health` →
  `{"status":"ok",...,"warmedWords":6734,...}`.

For a **fresh droplet** or a **pre-Docker / pre-rename migration** — rare, keep them out of your
head — read `references/fresh-droplet.md`.

Cross-refs: the `troubleshoot` skill (`references/prod.md` — the incident triage ladder when prod
is *broken*, not being deployed); `add-grammar-point`, `add-song`, `add-minna-lesson`, `jlpt-data`
(each ends by pointing here for its seed step); `land-a-change` (when "done" includes shipping);
`api-dev` (server changes that precede a deploy); `roadmap` (what's pending-prod).
