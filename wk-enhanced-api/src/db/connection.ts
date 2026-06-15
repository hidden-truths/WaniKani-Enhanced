// SQLite connection layer. Owns the single Database handle + the test seam.
// Using bun:sqlite — synchronous, zero-install, plenty fast for our scale
// (bounded ~6500 rows).
//
// Every repo module under db/repos/* reaches the DB through getDb() here, so the
// singleton (and the test-only swap) is shared across the whole repository layer.
// If we ever outgrow SQLite, swap to Postgres by replacing the implementation
// inside the repo functions — callers never see SQL.

import { Database } from 'bun:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.ts';
import { log } from '../lib/log.ts';

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
    // schema.sql lives next to this file in db/, so the relative URL resolves
    // regardless of which repo module triggered the first getDb().
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
