// Pure, side-effect-free helpers for the warm pipeline. Carved out of pipeline.ts so the project's
// own rule — "pure logic should always have tests, these are the things future refactors break
// silently" (CLAUDE.md) — actually holds for them: the deterministic example-id builder, the generic
// batching primitive, and the per-example media-stats aggregation were all module-private and untested.
// None of these touch IK/DDG/TTS/storage, so they unit-test directly (warm/helpers.test.ts) without the
// "we don't mock external services" caveat that keeps the rest of the pipeline at manual-curl coverage.

import type { IkExample } from '../services/ik.ts';

// Per-example media outcome, collected during warmOneExample and aggregated into the warm.word.done
// log line so the operator can see how much of a warm hit the storage-cache vs required fresh
// IK / TTS / DDG calls. Internal — not part of the public payload.
export interface MediaStats {
    audioSource: 'ik' | 'tts' | 'none';
    audioStorage: 'cache' | 'fetched' | 'failed' | 'skipped';
    imageSource: 'ik' | 'none';
    imageStorage: 'cache' | 'fetched' | 'failed' | 'skipped';
}

// The aggregate shape logged on warm.word.done. `audio.ik + audio.tts + audio.none` and every
// *Storage bucket-sum each equal the number of examples; image splits ik_present/ik_missing.
export interface MediaStatsSummary {
    audio: { ik: number; tts: number; none: number };
    audioStorage: { cache: number; fetched: number; failed: number; skipped: number };
    image: { ik_present: number; ik_missing: number };
    imageStorage: { cache: number; fetched: number; failed: number; skipped: number };
}

// Stable, deterministic example id even when IK gives us no `id` (rare but happens with some test
// data). Prefers IK's own string id; otherwise combines the encoded title + index + a content hash of
// the sentence/sound/image so the same example always lands at the same media object key across
// re-warms (idempotency), and two DIFFERENT examples under one title don't collide.
export function exampleId(e: IkExample, encodedTitle: string, index: number): string {
    if (e.id && typeof e.id === 'string') return e.id;
    const text = (e.sentence || '') + '|' + (e.sound || '') + '|' + (e.image || '');
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return `${encodedTitle}_${index}_${(hash >>> 0).toString(36)}`;
}

// Process `items` through `fn` in parallel batches of at most `size`, preserving input order in the
// output. Bounds outbound concurrency (the per-example media downloads inside one word; the DDG pool
// upload) so we stay a polite upstream client without serializing everything.
export async function batched<T, U>(items: T[], size: number, fn: (item: T) => Promise<U>): Promise<U[]> {
    const out: U[] = [];
    for (let i = 0; i < items.length; i += size) {
        const slice = items.slice(i, i + size);
        const results = await Promise.all(slice.map(fn));
        out.push(...results);
    }
    return out;
}

// Fold the per-example MediaStats into the warm.word.done summary. Pure tally — `audio.<source>` and
// each `*Storage` bucket-sum equal `allStats.length` by construction (every example contributes
// exactly one increment to each), which is the invariant the operator log relies on.
export function aggregateMediaStats(allStats: MediaStats[]): MediaStatsSummary {
    const summary: MediaStatsSummary = {
        audio: { ik: 0, tts: 0, none: 0 },
        audioStorage: { cache: 0, fetched: 0, failed: 0, skipped: 0 },
        image: { ik_present: 0, ik_missing: 0 },
        imageStorage: { cache: 0, fetched: 0, failed: 0, skipped: 0 },
    };
    for (const s of allStats) {
        summary.audio[s.audioSource]++;
        summary.audioStorage[s.audioStorage]++;
        if (s.imageSource === 'ik') summary.image.ik_present++;
        else summary.image.ik_missing++;
        summary.imageStorage[s.imageStorage]++;
    }
    return summary;
}
