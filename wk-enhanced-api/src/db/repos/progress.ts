// user_progress — per-user, per-app opaque JSON blob (PK (user_id, app)). The
// cloud-synced replacement for the study app's localStorage. ON DELETE CASCADE
// from users.

import { getDb } from '../connection.ts';

export interface ProgressRow {
    data: any;
    updatedAt: number;
}

export function getProgress(userId: number, app: string): ProgressRow | null {
    const row = getDb()
        .query('SELECT data, updated_at FROM user_progress WHERE user_id = ? AND app = ?')
        .get(userId, app) as { data: string; updated_at: number } | null;
    if (!row) return null;
    return { data: JSON.parse(row.data), updatedAt: row.updated_at };
}

// Upsert the per-app progress blob. Returns the updated_at timestamp written.
export function upsertProgress(userId: number, app: string, data: any): number {
    const now = Date.now();
    getDb()
        .query(
            `INSERT INTO user_progress (user_id, app, data, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, app) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        )
        .run(userId, app, JSON.stringify(data), now);
    return now;
}
