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
): number {
    const r = getDb()
        .query(
            `INSERT INTO study_sessions (user_id, ended_at, right_count, total_count, mode, details)
             VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, endedAt, right, total, mode, details == null ? null : JSON.stringify(details));
    return Number(r.lastInsertRowid);
}

// How many sessions this user has ever logged (lifetime count, uncapped).
export function countSessions(userId: number): number {
    const row = getDb()
        .query('SELECT COUNT(*) AS n FROM study_sessions WHERE user_id = ?')
        .get(userId) as { n: number };
    return row.n;
}
