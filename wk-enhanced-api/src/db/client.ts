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
