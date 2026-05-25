# wk-enhanced-api deploy templates

Paste-ready artifacts for deploying the server to a single DigitalOcean droplet (or any Ubuntu-flavoured Linux host) with DO Spaces for media + Cloudflare in front for TLS / rate-limiting / edge cache.

The deployed thing is called **wk-enhanced-api** in DigitalOcean and at `api.wkenhanced.dev`. The source code that runs on it lives in **`wk-vocab-api/`** in this repo (kept as-is for git history continuity). On the droplet you'll think "wk-enhanced-api"; in the source tree you see "wk-vocab-api". They're the same thing.

These are templates — not part of the running service. The shipped runtime under [../src/](../src/) is unchanged.

Read the canonical deploy walkthrough in [../README.md](../README.md) under **"Going to production"** before touching these. The files here are what that section's bullet points expand into.

## Files

| File | Lives at on host | What it does |
|---|---|---|
| `env.production.template` | `/etc/wk-enhanced-api/env` | Env file the systemd unit loads. Replace every `<REPLACE_ME_*>` placeholder. `chmod 600`, `chown root:root`. |
| `wk-enhanced-api.service` | `/etc/systemd/system/wk-enhanced-api.service` | Main service unit. Runs `bun run start` as a dedicated unprivileged `wkenhanced` user. Hardened with the usual `Protect*=` flags. |
| `wk-enhanced-api-warm.service` | `/etc/systemd/system/wk-enhanced-api-warm.service` | One-shot unit that hits the local `POST /v1/admin/warm {"scope":"all"}` endpoint. Reads `ADMIN_TOKEN` from the same env file as the main service. |
| `wk-enhanced-api-warm.timer` | `/etc/systemd/system/wk-enhanced-api-warm.timer` | Schedule for the one-shot. Fires `*-*-01 04:00:00` (1st of month, 04:00 local). |

## Order of operations

Assumes you've already done the human-side prerequisites from the main README (domain registered, DO account + droplet provisioned in SFO3, Spaces bucket + access keys created, Cloudflare site + DNS + SSL configured, droplet's public IP captured).

```bash
# 1. Create the runtime user + state directory.
useradd --system --no-create-home --shell /usr/sbin/nologin wkenhanced
install -d -o wkenhanced -g wkenhanced /var/lib/wk-enhanced-api

# 2. Install Bun. Two-step: the official installer drops it in /root/.bun/bin
#    (only readable by root), so we then copy it to /usr/local/bin/bun where
#    the unprivileged `wkenhanced` user — and systemd's ProtectHome=true
#    sandbox — can actually execute it.
curl -fsSL https://bun.sh/install | bash    # as root → /root/.bun/bin/bun
install -m 755 /root/.bun/bin/bun /usr/local/bin/bun
/usr/local/bin/bun --version    # sanity

# 3. Pull the repo + install prod deps.
git clone https://github.com/<your-user-or-org>/WaniKani /opt/wk-enhanced-api
cd /opt/wk-enhanced-api/wk-vocab-api
bun install --production
chown -R wkenhanced:wkenhanced /opt/wk-enhanced-api

# 4. Compose the env file. ADMIN_TOKEN: openssl rand -hex 32 (save first).
install -d -m 700 /etc/wk-enhanced-api
install -m 600 -o root -g root \
    /opt/wk-enhanced-api/wk-vocab-api/deploy/env.production.template \
    /etc/wk-enhanced-api/env
$EDITOR /etc/wk-enhanced-api/env

# 5. Install + start systemd units.
install -m 644 /opt/wk-enhanced-api/wk-vocab-api/deploy/wk-enhanced-api.service \
    /etc/systemd/system/wk-enhanced-api.service
install -m 644 /opt/wk-enhanced-api/wk-vocab-api/deploy/wk-enhanced-api-warm.service \
    /etc/systemd/system/wk-enhanced-api-warm.service
install -m 644 /opt/wk-enhanced-api/wk-vocab-api/deploy/wk-enhanced-api-warm.timer \
    /etc/systemd/system/wk-enhanced-api-warm.timer
systemctl daemon-reload
systemctl enable --now wk-enhanced-api
systemctl enable --now wk-enhanced-api-warm.timer

# 6. Verify boot.
journalctl -fu wk-enhanced-api
curl -s http://127.0.0.1:3000/v1/health   # local check; should be {"status":"ok",...}
curl -s https://api.wkenhanced.dev/v1/health   # public check via Cloudflare
```

After this, run the initial bulk warm once manually (the timer's next fire is the 1st of next month, which may be weeks away):

```bash
systemctl start wk-enhanced-api-warm
# Then watch: journalctl -fu wk-enhanced-api | grep -E 'warm\.(word|all)'
```

## Updating after a `git pull`

```bash
cd /opt/wk-enhanced-api && git pull
cd wk-vocab-api && bun install --production
systemctl restart wk-enhanced-api
```

If any of the files in this directory changed, re-copy them (`install -m 644 ... /etc/systemd/system/...`) and `systemctl daemon-reload` before restart.

## Spaces key permissions — use Full Access

The S3 driver sets `acl: 'public-read'` on every upload so the resulting CDN URL is anonymously readable. **DO Spaces "Limited Access" keys do NOT grant `s3:PutObjectAcl`**, even with Read/Write/Delete scope — every upload fails with `AccessDenied`. Two workarounds were investigated and rejected:

- **Bucket policy** (`PutBucketPolicy`): not exposed by DO Spaces' S3 API. Returns 403 even with a Full Access key. Don't waste time on `s3cmd setpolicy`.
- **Two-step PUT then `s3cmd setacl`**: works but requires a post-upload hook in code, adds latency and another failure mode.

The clean path is to give the Spaces key **Full Access** in the DO control panel. On a single-tenant production droplet (one bucket, one app, key never leaves `/etc/wk-enhanced-api/env`) the practical risk delta vs Limited Access is marginal. If you need Limited Access for a multi-tenant setup, you'll need to implement the two-step approach.

## Things to remember

- **Bun path** in `wk-enhanced-api.service`'s `ExecStart` is `/usr/local/bin/bun`. The official installer drops the binary in `/root/.bun/bin/bun`, but `wkenhanced` can't read that (root's home is mode 700) and the systemd unit's `ProtectHome=true` would block it even if perms allowed. Step 2 above copies it to `/usr/local/bin/bun` to bridge the gap.
- **DATABASE_FILE** lives at `/var/lib/wk-enhanced-api/wk-enhanced-api.sqlite` so it survives `git pull` in `/opt/wk-enhanced-api`. The `wkenhanced` user must own this directory.
- **The warm timer's `OnCalendar`** uses server-local time. If you didn't `timedatectl set-timezone`, that's UTC, which is fine — just know it.
- **Backups**: not automated yet. `sqlite3 /var/lib/wk-enhanced-api/wk-enhanced-api.sqlite ".backup /tmp/snap.sqlite"` + `s3cmd put` to Spaces is the documented recipe in the main README; see NEW_FEATURES.md for the tracked work.
