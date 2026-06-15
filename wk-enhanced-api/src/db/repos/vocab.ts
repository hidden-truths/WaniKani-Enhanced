// vocab_examples — pre-warmed payload per word (one row per word). serve_count /
// last_served_at track usage for later LRU eviction.

import { getDb } from '../connection.ts';

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
