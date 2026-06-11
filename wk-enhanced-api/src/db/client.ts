// SQLite client + repository methods. Using bun:sqlite — synchronous,
// zero-install, plenty fast for our scale (bounded ~6500 rows).
//
// If we ever outgrow SQLite, swap to Postgres by replacing the implementation
// inside the repo functions. Callers don't see SQL.

import { Database } from 'bun:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.ts';
import { log } from '../lib/log.ts';
import type { IkIndexMetaEntry } from '../services/ik.ts';

let _db: Database | null = null;

// Open a fresh DB at the given path and apply the schema. Used by getDb()
// for the singleton and by tests that want an isolated in-memory DB.
// Pass ':memory:' for a transient DB that lives only as long as the
// returned Database instance.
export function openDb(file: string): Database {
    if (file !== ':memory:') {
        mkdirSync(dirname(resolve(file)), { recursive: true });
    }
    const db = new Database(file === ':memory:' ? ':memory:' : resolve(file), { create: true });
    // WAL gives us concurrent readers while the warmer holds a writer lock;
    // useful for serving /v1/vocab/:word while a warm run is in flight.
    // Skip WAL on :memory: where it isn't applicable.
    if (file !== ':memory:') {
        db.exec('PRAGMA journal_mode = WAL');
    }
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    db.exec(schema);
    return db;
}

export function getDb(): Database {
    if (_db) return _db;
    _db = openDb(config.databaseFile);
    log.info('db.ready', { file: config.databaseFile });
    return _db;
}

// Test-only: replace the singleton DB. Lets tests work against an in-memory
// DB without touching the dev-data sqlite file. Pass null to clear so the
// next getDb() call falls back to the configured file.
export function _useDbForTesting(db: Database | null): void {
    _db = db;
}

// ---------- vocab_examples ----------

export interface VocabRow {
    word: string;
    payload: any;
    exampleCount: number;
    fetchedAt: number;
    lastServedAt: number | null;
    serveCount: number;
}

export function getVocab(word: string): VocabRow | null {
    const row = getDb()
        .query('SELECT word, payload, example_count, fetched_at, last_served_at, serve_count FROM vocab_examples WHERE word = ?')
        .get(word) as
        | { word: string; payload: string; example_count: number; fetched_at: number; last_served_at: number | null; serve_count: number }
        | null;
    if (!row) return null;
    return {
        word: row.word,
        payload: JSON.parse(row.payload),
        exampleCount: row.example_count,
        fetchedAt: row.fetched_at,
        lastServedAt: row.last_served_at,
        serveCount: row.serve_count,
    };
}

export function upsertVocab(word: string, payload: any, exampleCount: number): void {
    const now = Date.now();
    getDb()
        .query(
            `INSERT INTO vocab_examples (word, payload, example_count, fetched_at, serve_count)
             VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(word) DO UPDATE SET
                 payload = excluded.payload,
                 example_count = excluded.example_count,
                 fetched_at = excluded.fetched_at`,
        )
        .run(word, JSON.stringify(payload), exampleCount, now);
}

export function recordVocabServe(word: string): void {
    const now = Date.now();
    getDb()
        .query(
            `UPDATE vocab_examples
             SET last_served_at = ?, serve_count = serve_count + 1
             WHERE word = ?`,
        )
        .run(now, word);
}

export function countVocabRows(): number {
    const row = getDb().query('SELECT COUNT(*) AS n FROM vocab_examples').get() as { n: number };
    return row.n;
}

// ---------- index_meta ----------

export interface IndexMetaRow {
    decks: Record<string, IkIndexMetaEntry>;
    fetchedAt: number;
}

export function getIndexMeta(): IndexMetaRow | null {
    const row = getDb()
        .query('SELECT decks, fetched_at FROM index_meta WHERE id = 1')
        .get() as { decks: string; fetched_at: number } | null;
    if (!row) return null;
    return { decks: JSON.parse(row.decks), fetchedAt: row.fetched_at };
}

export function upsertIndexMeta(decks: Record<string, IkIndexMetaEntry>): void {
    const now = Date.now();
    getDb()
        .query(
            `INSERT INTO index_meta (id, decks, fetched_at) VALUES (1, ?, ?)
             ON CONFLICT(id) DO UPDATE SET decks = excluded.decks, fetched_at = excluded.fetched_at`,
        )
        .run(JSON.stringify(decks), now);
}

// ---------- warm_jobs ----------

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

// ---------- users ----------

export interface UserRow {
    id: number;
    email: string;
    passwordHash: string;
    createdAt: number;
}

// Public-facing user shape (never leaks the password hash to a response).
export interface PublicUser {
    id: number;
    email: string;
    createdAt: number;
}

// Thrown by createUser when the email is already registered. Callers map this
// to a 409 conflict. We detect the UNIQUE-constraint failure rather than doing
// a pre-check SELECT so the uniqueness check stays atomic with the insert.
export class EmailTakenError extends Error {
    constructor() {
        super('email already registered');
        this.name = 'EmailTakenError';
    }
}

export function createUser(email: string, passwordHash: string): PublicUser {
    const now = Date.now();
    try {
        const r = getDb()
            .query('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?) RETURNING id')
            .get(email, passwordHash, now) as { id: number };
        return { id: r.id, email, createdAt: now };
    } catch (err) {
        // bun:sqlite surfaces UNIQUE violations as an error whose message
        // contains "UNIQUE constraint failed". Narrow to email-taken; rethrow
        // anything else (disk full, etc.).
        if (err instanceof Error && /UNIQUE constraint failed: users\.email/i.test(err.message)) {
            throw new EmailTakenError();
        }
        throw err;
    }
}

export function getUserByEmail(email: string): UserRow | null {
    const row = getDb()
        .query('SELECT id, email, password_hash, created_at FROM users WHERE email = ?')
        .get(email) as { id: number; email: string; password_hash: string; created_at: number } | null;
    if (!row) return null;
    return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
}

export function getUserById(id: number): PublicUser | null {
    const row = getDb()
        .query('SELECT id, email, created_at FROM users WHERE id = ?')
        .get(id) as { id: number; email: string; created_at: number } | null;
    if (!row) return null;
    return { id: row.id, email: row.email, createdAt: row.created_at };
}

// ---------- sessions ----------

export function createSession(token: string, userId: number, expiresAt: number): void {
    const now = Date.now();
    getDb()
        .query('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(token, userId, now, expiresAt);
}

// Resolve a session token to its user, enforcing expiry. Expired (or missing)
// tokens return null; an expired token is also deleted as lazy housekeeping so
// the table doesn't accumulate dead rows between the periodic sweep.
export function getValidSession(token: string): PublicUser | null {
    const row = getDb()
        .query(
            `SELECT s.expires_at AS expires_at, u.id AS id, u.email AS email, u.created_at AS created_at
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?`,
        )
        .get(token) as { expires_at: number; id: number; email: string; created_at: number } | null;
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
        deleteSession(token);
        return null;
    }
    return { id: row.id, email: row.email, createdAt: row.created_at };
}

export function deleteSession(token: string): void {
    getDb().query('DELETE FROM sessions WHERE token = ?').run(token);
}

// Housekeeping: drop all expired sessions. Called on a timer from index.ts.
// Returns the number of rows removed (for logging).
export function deleteExpiredSessions(): number {
    const r = getDb().query('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    return r.changes;
}

// ---------- user_progress ----------

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

// ---------- study_sessions (append-only durable history) ----------

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

// ---------- minna_recordings (record-and-compare voice takes) ----------

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
): number {
    const r = getDb()
        .query(
            `INSERT INTO minna_recordings (user_id, lesson, item_key, storage_key, content_type, duration_ms, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, lesson, itemKey, storageKey, contentType, durationMs, createdAt);
    return Number(r.lastInsertRowid);
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
