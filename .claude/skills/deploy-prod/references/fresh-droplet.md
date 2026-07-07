# Fresh droplet + migrations (rarely needed)

Read this only when standing up a **brand-new droplet** or **migrating an old one**. For a routine
deploy (git pull → rebuild → restart → seed → verify) stay in `SKILL.md` — you don't need any of
this. Every command here is lifted from `wk-enhanced-api/deploy/README.md`; re-read that section
before running any of it, and heed the SAFETY block in `SKILL.md`.

## Table of contents
- [Human prerequisites](#human-prerequisites)
- [Fresh droplet order of operations](#fresh-droplet-order-of-operations)
- [Spaces key must be Full Access](#spaces-key-must-be-full-access)
- [Migrating from a pre-Docker droplet](#migrating-from-a-pre-docker-droplet)
- [Updating a pre-rename droplet](#updating-a-pre-rename-droplet)
- [After bring-up: seeds](#after-bring-up-seeds)

## Human prerequisites

Before the commands: domain registered; DO account + droplet provisioned in SFO3; Spaces bucket +
**Full Access** keys created (see below); Cloudflare site + DNS + SSL configured; the droplet's
public IP captured. These are manual, one-time, and out of scope for automation.

## Fresh droplet order of operations

```bash
# 1. Install Docker Engine + Compose v2.
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version

# 2. Create the SQLite dir owned by uid:gid 1000:1000 (the container's `bun` user reads/writes
#    through the bind mount). You do NOT need to useradd anything on the host.
install -d -o 1000 -g 1000 /var/lib/wk-enhanced-api

# 3. Clone the repo. Server source is the NESTED wk-enhanced-api/ subdir.
git clone https://github.com/<your-user-or-org>/WaniKani /opt/wk-enhanced-api
cd /opt/wk-enhanced-api/wk-enhanced-api

# 4. Compose the env file. ADMIN_TOKEN: openssl rand -hex 32 (save it offline first).
install -d -m 700 /etc/wk-enhanced-api
install -m 600 -o root -g root deploy/env.production.template /etc/wk-enhanced-api/env
$EDITOR /etc/wk-enhanced-api/env

# 5. Install + start the systemd units (main service + the two timers).
install -m 644 deploy/wk-enhanced-api.service         /etc/systemd/system/wk-enhanced-api.service
install -m 644 deploy/wk-enhanced-api-warm.service    /etc/systemd/system/wk-enhanced-api-warm.service
install -m 644 deploy/wk-enhanced-api-warm.timer      /etc/systemd/system/wk-enhanced-api-warm.timer
install -m 644 deploy/wk-enhanced-api-backup.service  /etc/systemd/system/wk-enhanced-api-backup.service
install -m 644 deploy/wk-enhanced-api-backup.timer    /etc/systemd/system/wk-enhanced-api-backup.timer
systemctl daemon-reload
systemctl enable --now wk-enhanced-api
systemctl enable --now wk-enhanced-api-warm.timer
systemctl enable --now wk-enhanced-api-backup.timer

# 6. Verify boot (first start builds the image — a couple of minutes).
docker compose -f /opt/wk-enhanced-api/wk-enhanced-api/compose.yaml logs -f api
# In another shell:
curl -s http://127.0.0.1:3000/v1/health         # local check → {"status":"ok",...}
curl -s https://api.wkenhanced.dev/v1/health    # public check via Cloudflare
```

Then run the initial bulk warm once by hand (the timer's next fire may be weeks away), and
optionally one immediate backup to confirm the S3 path:

```bash
systemctl start wk-enhanced-api-warm
docker compose -f /opt/wk-enhanced-api/wk-enhanced-api/compose.yaml logs -f api | grep -E 'warm\.(word|all)'

systemctl start wk-enhanced-api-backup
journalctl -u wk-enhanced-api-backup -n 50
```

**Apex ingress + the manual apex CNAME** for serving the study app at the apex `wkenhanced.dev` →
`:8080` (while `api.` stays `:3000`) is the README's "Serving the study app at wkenhanced.dev
(two-container cut-over)" section. On the **current** droplet that cut-over already shipped
(2026-05-26) — you don't re-run it. The load-bearing gotcha to remember: a token/dashboard-managed
tunnel does NOT auto-create the apex DNS record; add `CNAME @ → <tunnel-uuid>.cfargotunnel.com`
(proxied) by hand under Cloudflare DNS → Records, or the apex resolves to nothing.

## Spaces key must be Full Access

The S3 driver sets `acl: 'public-read'` on every upload. **DO Spaces "Limited Access" keys do NOT
grant `s3:PutObjectAcl`** even with Read/Write/Delete scope — every upload fails `AccessDenied`.
Two workarounds were investigated and rejected (bucket policy: DO doesn't expose `PutBucketPolicy`;
two-step PUT-then-`s3cmd setacl`: adds latency + a failure mode). Give the Spaces key **Full
Access** in the DO control panel. Also required: `S3_FORCE_PATH_STYLE=true` (with `false`, Bun
addresses DO as `CreateBucket` and uploads silently fail). Both are pinned as dead-ends in
`wk-enhanced-api/CLAUDE.md`.

## Migrating from a pre-Docker droplet

Pre-Docker droplets ran Bun directly as the unprivileged `wkenhanced` host user. One-shot
conversion (verbatim from the README):

```bash
# 1. Stop the old bare-metal service + timers (don't disable — the new units reuse the names).
systemctl stop wk-enhanced-api wk-enhanced-api-warm.timer wk-enhanced-api-backup.timer

# 2. Install Docker if absent.
curl -fsSL https://get.docker.com | sh
docker compose version

# 3. Pull the new repo state (Dockerfile, compose.yaml, rewritten units).
cd /opt/wk-enhanced-api && git pull
cd wk-enhanced-api

# 4. Re-chown the SQLite dir to uid 1000 (the container's bun user); pre-Docker it was the host
#    wkenhanced user, whose uid may not be 1000.
chown -R 1000:1000 /var/lib/wk-enhanced-api

# 5. Replace the unit files (same paths, new contents).
install -m 644 deploy/wk-enhanced-api.service          /etc/systemd/system/
install -m 644 deploy/wk-enhanced-api-warm.service     /etc/systemd/system/
install -m 644 deploy/wk-enhanced-api-warm.timer       /etc/systemd/system/
install -m 644 deploy/wk-enhanced-api-backup.service   /etc/systemd/system/
install -m 644 deploy/wk-enhanced-api-backup.timer     /etc/systemd/system/
systemctl daemon-reload

# 6. First start triggers the build; subsequent restarts are fast.
systemctl start wk-enhanced-api
systemctl start wk-enhanced-api-warm.timer wk-enhanced-api-backup.timer
docker compose -f /opt/wk-enhanced-api/wk-enhanced-api/compose.yaml logs -f api
```

`DATABASE_FILE` stays `/var/lib/wk-enhanced-api/wk-enhanced-api.sqlite` (the bind mount uses the
same path inside and out), so the existing env file works unchanged. Cleanup (optional): the host
`wkenhanced` user and `/usr/local/bin/bun` are now unused but harmless — leave or remove.

## Updating a pre-rename droplet

For droplets provisioned before the 2026-05-25 `wk-vocab-api/` → `wk-enhanced-api/` source rebrand,
do this **once** before the first post-rename `git pull` (so `WorkingDirectory` matches reality):

```bash
systemctl stop wk-enhanced-api wk-enhanced-api-warm.timer
mv /opt/wk-enhanced-api/wk-vocab-api /opt/wk-enhanced-api/wk-enhanced-api
cd /opt/wk-enhanced-api && git pull
```

Then follow "Migrating from a pre-Docker droplet" above — both transitions can land in the same
`systemctl restart`.

## After bring-up: seeds

A fresh droplet has an empty content store until you run the seeds. Run them (droplet-side,
mounted-repo, `ENV_FILE`/`DATA_DIR` set) in order — `seed-sentences.ts` → `seed-songs.ts` (with
`-e NODE_PATH=/app/node_modules`) → `seed-annotations.ts` — then the voice two-step
(`push-tts-variants.ts` on the Mac → `seed-audio-variants.ts` on the droplet). Exact commands are
in `SKILL.md` "Seed steps". Finish with `bun scripts/verify-prod.ts`.
