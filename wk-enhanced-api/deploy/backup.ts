#!/usr/bin/env bun
// SQLite → S3 backup. Invoked by the wk-enhanced-api-backup.service systemd
// oneshot unit (typically daily at 03:00 UTC). Reads env from
// /etc/wk-enhanced-api/env via systemd's EnvironmentFile= directive.
//
// Pipeline:
//   1. VACUUM INTO a snapshot file in /tmp (SQLite's online-backup primitive;
//      atomic, WAL-safe, and produces a defragmented copy smaller than the
//      live DB). Source is opened readonly so the script provably can't
//      corrupt the live state if it crashes mid-run.
//   2. Upload to s3://<bucket>/backups/YYYY-MM-DD.sqlite (UTC date). The
//      object is private — no acl:'public-read' — because it contains every
//      cached payload, not media bytes that already live at public URLs.
//   3. List + prune older backups per the GFS policy in retention.ts
//      (default 7 daily + 4 weekly + 12 monthly).
//   4. Best-effort delete the temp file in a finally{}.
//
// Failure handling: any error throws and exits non-zero, which makes the
// systemd unit fail. `journalctl -u wk-enhanced-api-backup` shows what went
// wrong; `systemctl list-units --failed` surfaces persistent failures.

import { Database } from 'bun:sqlite';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectBackupsToKeep, DEFAULT_POLICY } from './retention.ts';

function log(level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) {
    const line = { ts: new Date().toISOString(), level, event, ...(fields || {}) };
    const sink = level === 'info' ? console.log : console.error;
    sink(JSON.stringify(line));
}

function required(name: string): string {
    const v = process.env[name];
    if (!v) {
        log('error', 'backup.env_missing', { name });
        process.exit(1);
    }
    return v;
}

function todayStampUtc(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
    const databaseFile = required('DATABASE_FILE');
    const bucket = required('S3_BUCKET');
    const endpoint = required('S3_ENDPOINT');
    const accessKeyId = required('S3_ACCESS_KEY_ID');
    const secretAccessKey = required('S3_SECRET_ACCESS_KEY');
    const region = process.env.S3_REGION || 'us-east-1';
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() !== 'false';
    const prefix = process.env.BACKUP_PREFIX || 'backups/';
    const policy = {
        daily: Number(process.env.BACKUP_RETAIN_DAILY ?? DEFAULT_POLICY.daily),
        weekly: Number(process.env.BACKUP_RETAIN_WEEKLY ?? DEFAULT_POLICY.weekly),
        monthly: Number(process.env.BACKUP_RETAIN_MONTHLY ?? DEFAULT_POLICY.monthly),
    };

    const stamp = todayStampUtc();
    const snapshotPath = join(tmpdir(), `wk-enhanced-api-backup-${stamp}-${process.pid}.sqlite`);
    const targetKey = `${prefix}${stamp}.sqlite`;

    const t0 = Date.now();
    log('info', 'backup.start', { databaseFile, targetKey, policy });

    try {
        // 1. Snapshot. Open readonly so a script bug can't damage the live
        // DB. VACUUM INTO is permitted on read-only databases (it writes
        // only to the destination); confirmed working with bun:sqlite + a
        // WAL-mode source. Path goes into a literal string in the SQL —
        // escape any embedded single quote even though tmpdir() should
        // never produce one in practice.
        const src = new Database(databaseFile, { readonly: true });
        try {
            const escaped = snapshotPath.replace(/'/g, "''");
            src.run("VACUUM INTO '" + escaped + "'");
        } finally {
            src.close();
        }
        const snapshotBytes = Bun.file(snapshotPath).size;
        log('info', 'backup.snapshot_ready', { snapshotPath, snapshotBytes });

        // 2. Upload. Bun.S3Client speaks standard S3 against DO Spaces.
        // Match the production storage layer's path-style addressing
        // (S3_FORCE_PATH_STYLE=true) so a misconfigured environment fails
        // the same way both code paths fail. No public-read ACL: the
        // backup contains every cached payload including server-internal
        // job audit data, so default-private is correct.
        const client = new Bun.S3Client({
            accessKeyId,
            secretAccessKey,
            bucket,
            endpoint,
            region,
            virtualHostedStyle: !forcePathStyle,
        });
        const body = await Bun.file(snapshotPath).arrayBuffer();
        await client.file(targetKey).write(body, { type: 'application/x-sqlite3' });
        log('info', 'backup.uploaded', { targetKey, bytes: snapshotBytes });

        // 3. Prune. List everything under the prefix, partition via the
        // pure retention helper, delete the losers. Listing once + deleting
        // sequentially is fine — even with multi-year retention we expect
        // <50 objects under the prefix.
        const listing = await client.list({ prefix });
        const allKeys: string[] = Array.isArray(listing?.contents)
            ? listing.contents.map((o: { key: string }) => o.key)
            : [];
        const decision = selectBackupsToKeep(allKeys, policy);
        log('info', 'backup.retention_decided', {
            total: allKeys.length,
            keep: decision.keep.length,
            remove: decision.remove.length,
        });

        let deleted = 0;
        let deleteFailed = 0;
        for (const key of decision.remove) {
            try {
                await client.delete(key);
                deleted++;
                log('info', 'backup.deleted', { key });
            } catch (err) {
                deleteFailed++;
                log('warn', 'backup.delete_failed', { key, err: (err as Error).message });
            }
        }

        log('info', 'backup.done', {
            ms: Date.now() - t0,
            uploadedKey: targetKey,
            uploadedBytes: snapshotBytes,
            deleted,
            deleteFailed,
            retained: decision.keep.length,
        });
    } finally {
        // Best-effort temp cleanup. Don't let a failed unlink mask a real
        // error — PrivateTmp=true in the systemd unit also gives us
        // per-instance /tmp that's torn down automatically.
        try {
            await unlink(snapshotPath);
        } catch {
            /* ignore */
        }
    }
}

main().catch((err) => {
    log('error', 'backup.failed', { err: err.message, stack: err.stack });
    process.exit(1);
});
