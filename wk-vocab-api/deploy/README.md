# wk-vocab-api deploy templates

Paste-ready artifacts for deploying wk-vocab-api to a single DigitalOcean droplet (or any Ubuntu-flavoured Linux host) with DO Spaces for media + Cloudflare in front for TLS / rate-limiting / edge cache.

These are templates — not part of the running service. The shipped runtime under [../src/](../src/) is unchanged.

Read the canonical deploy walkthrough in [../README.md](../README.md) under **"Going to production"** before touching these. The files here are what that section's bullet points expand into.

## Files

| File | Lives at on host | What it does |
|---|---|---|
| `env.production.template` | `/etc/wk-vocab-api/env` | Env file the systemd unit loads. Replace every `<REPLACE_ME_*>` placeholder. `chmod 600`, `chown root:root`. |
| `wk-vocab-api.service` | `/etc/systemd/system/wk-vocab-api.service` | Main service unit. Runs `bun run start` as a dedicated unprivileged `wkvocab` user. Hardened with the usual `Protect*=` flags. |
| `wk-vocab-api-warm.service` | `/etc/systemd/system/wk-vocab-api-warm.service` | One-shot unit that hits the local `POST /v1/admin/warm {"scope":"all"}` endpoint. Reads `ADMIN_TOKEN` from the same env file as the main service. |
| `wk-vocab-api-warm.timer` | `/etc/systemd/system/wk-vocab-api-warm.timer` | Schedule for the one-shot. Fires `*-*-01 04:00:00` (1st of month, 04:00 local). |

## Order of operations

Assumes you've already done the human-side prerequisites from the main README (domain registered, DO account + droplet provisioned in SFO3, Spaces bucket + access keys created, Cloudflare site + DNS + SSL configured, droplet's public IP captured).

```bash
# 1. Create the runtime user + state directory.
useradd --system --no-create-home --shell /usr/sbin/nologin wkvocab
install -d -o wkvocab -g wkvocab /var/lib/wk-vocab-api

# 2. Install Bun.
curl -fsSL https://bun.sh/install | bash    # as root → /root/.bun/bin/bun

# 3. Pull the repo + install prod deps.
git clone https://github.com/<your-user-or-org>/WaniKani /opt/wk-vocab-api
cd /opt/wk-vocab-api/wk-vocab-api
bun install --production
chown -R wkvocab:wkvocab /opt/wk-vocab-api

# 4. Compose the env file. ADMIN_TOKEN: openssl rand -hex 32 (save first).
install -d -m 700 /etc/wk-vocab-api
install -m 600 -o root -g root \
    /opt/wk-vocab-api/wk-vocab-api/deploy/env.production.template \
    /etc/wk-vocab-api/env
$EDITOR /etc/wk-vocab-api/env

# 5. Install + start systemd units.
install -m 644 /opt/wk-vocab-api/wk-vocab-api/deploy/wk-vocab-api.service \
    /etc/systemd/system/wk-vocab-api.service
install -m 644 /opt/wk-vocab-api/wk-vocab-api/deploy/wk-vocab-api-warm.service \
    /etc/systemd/system/wk-vocab-api-warm.service
install -m 644 /opt/wk-vocab-api/wk-vocab-api/deploy/wk-vocab-api-warm.timer \
    /etc/systemd/system/wk-vocab-api-warm.timer
systemctl daemon-reload
systemctl enable --now wk-vocab-api
systemctl enable --now wk-vocab-api-warm.timer

# 6. Verify boot.
journalctl -fu wk-vocab-api
curl -s http://127.0.0.1:3000/v1/health   # local check; should be {"status":"ok",...}
curl -s https://api.wkenhanced.dev/v1/health   # public check via Cloudflare
```

After this, run the initial bulk warm once manually (the timer's next fire is the 1st of next month, which may be weeks away):

```bash
systemctl start wk-vocab-api-warm
# Then watch: journalctl -fu wk-vocab-api | grep -E 'warm\.(word|all)'
```

## Updating after a `git pull`

```bash
cd /opt/wk-vocab-api && git pull
cd wk-vocab-api && bun install --production
systemctl restart wk-vocab-api
```

If any of the files in this directory changed, re-copy them (`install -m 644 ... /etc/systemd/system/...`) and `systemctl daemon-reload` before restart.

## Things to remember

- **Bun path** in `wk-vocab-api.service`'s `ExecStart` assumes `/root/.bun/bin/bun` (the official installer's location when run as root). If you installed Bun as a non-root user, edit that line.
- **DATABASE_FILE** lives at `/var/lib/wk-vocab-api/wk-vocab.sqlite` so it survives `git pull` in `/opt/wk-vocab-api`. The `wkvocab` user must own this directory.
- **The warm timer's `OnCalendar`** uses server-local time. If you didn't `timedatectl set-timezone`, that's UTC, which is fine — just know it.
- **Backups**: not automated yet. `sqlite3 /var/lib/wk-vocab-api/wk-vocab.sqlite ".backup /tmp/snap.sqlite"` + `s3cmd put` to Spaces is the documented recipe in the main README; see NEW_FEATURES.md for the tracked work.
