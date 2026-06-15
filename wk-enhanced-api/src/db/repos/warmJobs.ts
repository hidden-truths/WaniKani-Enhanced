// warm_jobs — append-only audit log. One row per warmSingle / warmAll invocation,
// exposed via GET /v1/admin/jobs.

import { getDb } from '../connection.ts';

export interface WarmJob {
    id: number;
    // Narrowed to the two values we ever insert via createWarmJob. Lets
    // downstream consumers (the API response schema) discriminate without
    // runtime casts.
    scope: 'word' | 'all';
    target: string | null;
    startedAt: number;
    finishedAt: number | null;
    wordsProcessed: number;
    wordsFailed: number;
    error: string | null;
}

export function createWarmJob(scope: 'all' | 'word', target: string | null): number {
    const now = Date.now();
    const r = getDb()
        .query('INSERT INTO warm_jobs (scope, target, started_at) VALUES (?, ?, ?) RETURNING id')
        .get(scope, target, now) as { id: number };
    return r.id;
}

export function finishWarmJob(id: number, processed: number, failed: number, error: string | null): void {
    const now = Date.now();
    getDb()
        .query(
            'UPDATE warm_jobs SET finished_at = ?, words_processed = ?, words_failed = ?, error = ? WHERE id = ?',
        )
        .run(now, processed, failed, error, id);
}

type WarmJobRow = {
    id: number;
    scope: string;
    target: string | null;
    started_at: number;
    finished_at: number | null;
    words_processed: number;
    words_failed: number;
    error: string | null;
};

function rowToJob(row: WarmJobRow): WarmJob {
    return {
        id: row.id,
        // The DB column is TEXT for forward compatibility; createWarmJob only
        // ever writes 'word' or 'all', so the cast is safe.
        scope: row.scope as 'word' | 'all',
        target: row.target,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        wordsProcessed: row.words_processed,
        wordsFailed: row.words_failed,
        error: row.error,
    };
}

export function getLastWarmJob(): WarmJob | null {
    const row = getDb()
        .query(
            `SELECT id, scope, target, started_at, finished_at, words_processed, words_failed, error
             FROM warm_jobs ORDER BY id DESC LIMIT 1`,
        )
        .get() as WarmJobRow | null;
    return row ? rowToJob(row) : null;
}

// Recent jobs, newest first. `limit` is clamped to [1, 100] by callers; we
// trust the input here since it's not directly user-controlled.
export function listWarmJobs(limit: number): WarmJob[] {
    const rows = getDb()
        .query(
            `SELECT id, scope, target, started_at, finished_at, words_processed, words_failed, error
             FROM warm_jobs ORDER BY id DESC LIMIT ?`,
        )
        .all(limit) as WarmJobRow[];
    return rows.map(rowToJob);
}
