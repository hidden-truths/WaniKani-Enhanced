// user_progress — per-user, per-app opaque JSON blob (PK (user_id, app)). The
// cloud-synced replacement for the study app's localStorage. ON DELETE CASCADE
// from users.

import { getDb } from '../connection.ts';

export interface ProgressRow {
    data: any;
    updatedAt: number;
}

// upsertProgress result: a successful write (with the new timestamp) or an optimistic-concurrency
// conflict carrying the server's current copy so the caller can return it on a 409.
export type UpsertProgressResult =
    | { ok: true; updatedAt: number }
    | { ok: false; current: ProgressRow };

export function getProgress(userId: number, app: string): ProgressRow | null {
    const row = getDb()
        .query('SELECT data, updated_at FROM user_progress WHERE user_id = ? AND app = ?')
        .get(userId, app) as { data: string; updated_at: number } | null;
    if (!row) return null;
    return { data: JSON.parse(row.data), updatedAt: row.updated_at };
}

// Upsert the per-app progress blob.
//   baseUpdatedAt === undefined → unconditional upsert (last-write-wins; the legacy path).
//   baseUpdatedAt provided       → compare-and-set: write only if the stored updated_at still
//                                  equals it (or there is no row yet); otherwise a conflict with
//                                  the current copy. The CAS rides the `WHERE updated_at = ?` clause
//                                  so it's atomic (bun:sqlite is synchronous + serialized).
export function upsertProgress(
    userId: number,
    app: string,
    data: any,
    baseUpdatedAt?: number,
): UpsertProgressResult {
    const now = Date.now();
    const db = getDb();

    if (baseUpdatedAt === undefined) {
        db.query(
            `INSERT INTO user_progress (user_id, app, data, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, app) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        ).run(userId, app, JSON.stringify(data), now);
        return { ok: true, updatedAt: now };
    }

    const existing = db
        .query('SELECT updated_at FROM user_progress WHERE user_id = ? AND app = ?')
        .get(userId, app) as { updated_at: number } | null;
    if (!existing) {
        // No row yet — nothing to clobber, so the base check can't fail; just create it.
        db.query('INSERT INTO user_progress (user_id, app, data, updated_at) VALUES (?, ?, ?, ?)')
            .run(userId, app, JSON.stringify(data), now);
        return { ok: true, updatedAt: now };
    }
    const res = db
        .query('UPDATE user_progress SET data = ?, updated_at = ? WHERE user_id = ? AND app = ? AND updated_at = ?')
        .run(JSON.stringify(data), now, userId, app, baseUpdatedAt);
    if (res.changes === 0) {
        return { ok: false, current: getProgress(userId, app)! };   // base moved → conflict
    }
    return { ok: true, updatedAt: now };
}
