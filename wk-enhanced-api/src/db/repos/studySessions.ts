// study_sessions — append-only, never-pruned log of completed study sessions. The
// durable history record (the client keeps a capped copy in the verbs blob for
// charts, but this table is the source of truth). ON DELETE CASCADE from users.

import { getDb } from '../connection.ts';

// Append one completed session. Returns the new row id. Never pruned — this is
// the record we keep even when the in-blob `store.sessions` is capped for charts.
export function insertSession(
    userId: number,
    endedAt: number,
    right: number,
    total: number,
    mode: string | null,
    details: unknown | null,
    idempotencyKey: string | null = null,
): number {
    // A replay of a seen key returns the EXISTING row, so the client can safely retry / queue this
    // POST (which previously had to be fire-and-forget, since a blind retry would duplicate a
    // session). A NULL key keeps the legacy always-append behavior.
    const byKey = (): { id: number } | null =>
        idempotencyKey
            ? (getDb()
                  .query('SELECT id FROM study_sessions WHERE user_id = ? AND idempotency_key = ?')
                  .get(userId, idempotencyKey) as { id: number } | null)
            : null;
    const seen = byKey();
    if (seen) return seen.id;
    try {
        const r = getDb()
            .query(
                `INSERT INTO study_sessions (user_id, ended_at, right_count, total_count, mode, details, idempotency_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(userId, endedAt, right, total, mode, details == null ? null : JSON.stringify(details), idempotencyKey);
        return Number(r.lastInsertRowid);
    } catch (e) {
        const raced = byKey(); // lost a concurrent race on the same key (the unique index) → adopt the winner
        if (raced) return raced.id;
        throw e;
    }
}

// How many sessions this user has ever logged (lifetime count, uncapped).
export function countSessions(userId: number): number {
    const row = getDb()
        .query('SELECT COUNT(*) AS n FROM study_sessions WHERE user_id = ?')
        .get(userId) as { n: number };
    return row.n;
}
