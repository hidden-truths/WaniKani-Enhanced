// minna_recordings — metadata index for the みんなの日本語 record-and-compare feature.
// One row per saved voice take; the audio bytes are PRIVATE storage objects served
// only through the owner-scoped GET /v1/audio/recordings/{id}. Pruned per
// (user, lesson, item_key) to the user's keep-N. ON DELETE CASCADE from users.

import { getDb } from '../connection.ts';

export interface RecordingRow {
    id: number;
    userId: number;
    lesson: number;
    itemKey: string;
    storageKey: string;
    contentType: string;
    durationMs: number | null;
    createdAt: number;
}

type RawRecordingRow = {
    id: number;
    user_id: number;
    lesson: number;
    item_key: string;
    storage_key: string;
    content_type: string;
    duration_ms: number | null;
    created_at: number;
};

function rowToRecording(r: RawRecordingRow): RecordingRow {
    return {
        id: r.id,
        userId: r.user_id,
        lesson: r.lesson,
        itemKey: r.item_key,
        storageKey: r.storage_key,
        contentType: r.content_type,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
    };
}

const RECORDING_COLS =
    'id, user_id, lesson, item_key, storage_key, content_type, duration_ms, created_at';

// Append one voice take. Returns the new row id. The storage object is written
// separately by the route (its key is generated before insert, so no update dance).
export function insertRecording(
    userId: number,
    lesson: number,
    itemKey: string,
    storageKey: string,
    contentType: string,
    durationMs: number | null,
    createdAt: number,
    idempotencyKey: string | null = null,
): number {
    try {
        const r = getDb()
            .query(
                `INSERT INTO minna_recordings (user_id, lesson, item_key, storage_key, content_type, duration_ms, created_at, idempotency_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(userId, lesson, itemKey, storageKey, contentType, durationMs, createdAt, idempotencyKey);
        return Number(r.lastInsertRowid);
    } catch (e) {
        // Lost a concurrent race on the same key (the partial unique index) → adopt the winner's row.
        // The common replay case is short-circuited earlier in the upload route via
        // findRecordingByIdempotencyKey (which also skips the storage write); this is the race backstop.
        if (idempotencyKey) {
            const raced = findRecordingByIdempotencyKey(userId, idempotencyKey);
            if (raced) return raced.id;
        }
        throw e;
    }
}

// Look up an existing take by its client idempotency key (owner-scoped). Lets the upload route return
// the prior take on a retry WITHOUT re-storing bytes / re-inserting / re-pruning. null if unseen.
export function findRecordingByIdempotencyKey(userId: number, idempotencyKey: string): RecordingRow | null {
    const row = getDb()
        .query(`SELECT ${RECORDING_COLS} FROM minna_recordings WHERE user_id = ? AND idempotency_key = ?`)
        .get(userId, idempotencyKey) as RawRecordingRow | null;
    return row ? rowToRecording(row) : null;
}

// All of a user's takes for one lesson, newest first. The client groups these by
// item_key to render per-word/per-line take lists.
export function listRecordings(userId: number, lesson: number): RecordingRow[] {
    const rows = getDb()
        .query(
            `SELECT ${RECORDING_COLS} FROM minna_recordings
             WHERE user_id = ? AND lesson = ? ORDER BY created_at DESC, id DESC`,
        )
        .all(userId, lesson) as RawRecordingRow[];
    return rows.map(rowToRecording);
}

// One take by id, scoped to the owner (so a guessed id from another account
// 404s rather than leaking). Used to serve bytes and to authorize delete.
export function getRecording(userId: number, id: number): RecordingRow | null {
    const row = getDb()
        .query(`SELECT ${RECORDING_COLS} FROM minna_recordings WHERE id = ? AND user_id = ?`)
        .get(id, userId) as RawRecordingRow | null;
    return row ? rowToRecording(row) : null;
}

// Delete one take (owner-scoped). Returns the deleted row so the caller can also
// drop its storage object; null if it didn't exist / wasn't the owner's.
export function deleteRecording(userId: number, id: number): RecordingRow | null {
    const row = getRecording(userId, id);
    if (!row) return null;
    getDb().query('DELETE FROM minna_recordings WHERE id = ? AND user_id = ?').run(id, userId);
    return row;
}

// Prune a (user, lesson, item_key) group down to the newest `keep` takes. Returns
// the deleted rows so the caller can drop their storage objects. `keep` is clamped
// to >= 1 here as a backstop; the route clamps to the [1, 20] policy range.
export function pruneRecordings(
    userId: number,
    lesson: number,
    itemKey: string,
    keep: number,
): RecordingRow[] {
    const k = Math.max(1, Math.floor(keep));
    const stale = getDb()
        .query(
            `SELECT ${RECORDING_COLS} FROM minna_recordings
             WHERE user_id = ? AND lesson = ? AND item_key = ?
             ORDER BY created_at DESC, id DESC
             LIMIT -1 OFFSET ?`,
        )
        .all(userId, lesson, itemKey, k) as RawRecordingRow[];
    if (!stale.length) return [];
    const del = getDb().query('DELETE FROM minna_recordings WHERE id = ?');
    for (const r of stale) del.run(r.id);
    return stale.map(rowToRecording);
}

// Per-lesson practice summary for a user: one row per lesson they've recorded in,
// with the distinct-item count, total take count, and the most-recent take's time.
// Powers the みんなの日本語 "Practice history" overview (a cross-lesson aggregate the
// per-lesson listRecordings can't give without fetching every lesson). Lessons with
// no takes are absent (so an empty result = the user has never recorded).
export interface RecordingLessonSummary {
    lesson: number;
    items: number; // distinct item_keys recorded in this lesson
    takes: number; // total takes in this lesson
    lastCreatedAt: number; // newest take's createdAt (epoch ms)
}

export function recordingSummary(userId: number): RecordingLessonSummary[] {
    return getDb()
        .query(
            `SELECT lesson,
                    COUNT(DISTINCT item_key) AS items,
                    COUNT(*)               AS takes,
                    MAX(created_at)        AS lastCreatedAt
             FROM minna_recordings
             WHERE user_id = ?
             GROUP BY lesson
             ORDER BY lesson ASC`,
        )
        .all(userId) as RecordingLessonSummary[];
}
