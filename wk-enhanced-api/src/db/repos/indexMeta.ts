// index_meta — singleton row (id=1) caching IK's /index_meta deck map.

import { getDb } from '../connection.ts';
import type { IkIndexMetaEntry } from '../../services/ik.ts';

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
