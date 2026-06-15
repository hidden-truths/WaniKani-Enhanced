// audio_variants — manifest of pre-generated TAGGED voice clips (one row per
// (text_hash, provider, gender)). Lets GET /v1/audio/variants list which specific
// voices exist for a text in one indexed query. Text-addressed, no FK.

import { getDb } from '../connection.ts';

export interface AudioVariantRow {
    textHash: string;
    provider: string;
    gender: string; // '' when the provider has no gender axis
    ext: string;
    createdAt: number;
}

type RawAudioVariantRow = { text_hash: string; provider: string; gender: string; ext: string; created_at: number };

// Record that a tagged voice clip exists for a text (idempotent: re-rendering the same
// (text, provider, gender) refreshes ext + created_at rather than duplicating). The storage
// object itself is written separately by the pre-gen driver.
export function insertAudioVariant(textHash: string, provider: string, gender: string, ext: string): void {
    const now = Date.now();
    getDb()
        .query(
            `INSERT INTO audio_variants (text_hash, provider, gender, ext, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(text_hash, provider, gender) DO UPDATE SET ext = excluded.ext, created_at = excluded.created_at`,
        )
        .run(textHash, provider, gender || '', ext, now);
}

// Which specific voices have been pre-generated for a text. Drives the catalog endpoint;
// `google` + the legacy `default` tts voice are implicit and not stored here.
export function listAudioVariants(textHash: string): AudioVariantRow[] {
    const rows = getDb()
        .query(
            `SELECT text_hash, provider, gender, ext, created_at FROM audio_variants
             WHERE text_hash = ? ORDER BY provider ASC, gender ASC`,
        )
        .all(textHash) as RawAudioVariantRow[];
    return rows.map((r) => ({ textHash: r.text_hash, provider: r.provider, gender: r.gender, ext: r.ext, createdAt: r.created_at }));
}
