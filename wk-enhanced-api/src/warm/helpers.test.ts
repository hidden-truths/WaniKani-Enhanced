// Unit tests for the pure warm-pipeline helpers (warm/helpers.ts). These were module-private +
// untested inside pipeline.ts; extracting them lets the project's "pure logic always has tests" rule
// hold without mocking IK/DDG/TTS (none of these touch a service).

import { describe, test, expect } from 'bun:test';
import { aggregateMediaStats, batched, exampleId, type MediaStats } from './helpers.ts';
import type { IkExample } from '../services/ik.ts';

describe('exampleId', () => {
    test("prefers IK's own string id verbatim", () => {
        expect(exampleId({ id: 'ik-123', sentence: 'あ' }, 'title', 0)).toBe('ik-123');
    });

    test('falls back to a content hash when id is absent or non-string', () => {
        const noId = exampleId({ sentence: 'あ', sound: 's.mp3', image: 'i.jpg' }, 'kanon__2006_', 3);
        expect(noId).toMatch(/^kanon__2006__3_[0-9a-z]+$/); // `${title}_${index}_${base36hash}`
        // a non-string id is ignored (the `typeof === 'string'` guard) → also hashed, same shape.
        const numId = exampleId({ id: 123 as unknown as string, sentence: 'あ' }, 'title', 0);
        expect(numId).toMatch(/^title_0_[0-9a-z]+$/);
    });

    test('is deterministic — same (example, title, index) → same id', () => {
        const e: IkExample = { sentence: '猫が好き', sound: 'a.mp3', image: 'b.jpg' };
        expect(exampleId(e, 'deck', 2)).toBe(exampleId(e, 'deck', 2));
    });

    test('distinct content (or index) → distinct id (idempotent keys do not collide)', () => {
        const a = exampleId({ sentence: '猫が好き' }, 'deck', 0);
        const b = exampleId({ sentence: '犬が好き' }, 'deck', 0); // different sentence
        const c = exampleId({ sentence: '猫が好き' }, 'deck', 1); // same sentence, different index
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
    });
});

describe('batched', () => {
    test('processes every item and preserves input order', async () => {
        const out = await batched([1, 2, 3, 4, 5], 2, async (n) => n * 10);
        expect(out).toEqual([10, 20, 30, 40, 50]);
    });

    test('empty input → empty output, fn never called', async () => {
        let calls = 0;
        const out = await batched([], 3, async (n: number) => (calls++, n));
        expect(out).toEqual([]);
        expect(calls).toBe(0);
    });

    test('size ≥ length → one batch, all processed', async () => {
        const out = await batched([1, 2], 10, async (n) => n + 1);
        expect(out).toEqual([2, 3]);
    });

    test('runs at most `size` concurrently (bounds outbound parallelism)', async () => {
        let inFlight = 0;
        let max = 0;
        await batched([1, 2, 3, 4, 5], 2, async (n) => {
            inFlight++;
            max = Math.max(max, inFlight);
            await Promise.resolve();
            await Promise.resolve();
            inFlight--;
            return n;
        });
        expect(max).toBe(2); // reaches the cap, never exceeds it
    });
});

describe('aggregateMediaStats', () => {
    const mk = (
        audioSource: MediaStats['audioSource'],
        audioStorage: MediaStats['audioStorage'],
        imageSource: MediaStats['imageSource'],
        imageStorage: MediaStats['imageStorage'],
    ): MediaStats => ({ audioSource, audioStorage, imageSource, imageStorage });

    const sample: MediaStats[] = [
        mk('ik', 'cache', 'ik', 'fetched'),
        mk('tts', 'fetched', 'none', 'skipped'),
        mk('ik', 'cache', 'ik', 'failed'),
        mk('none', 'skipped', 'none', 'skipped'),
    ];

    test('tallies each bucket', () => {
        const s = aggregateMediaStats(sample);
        expect(s.audio).toEqual({ ik: 2, tts: 1, none: 1 });
        expect(s.audioStorage).toEqual({ cache: 2, fetched: 1, failed: 0, skipped: 1 });
        expect(s.image).toEqual({ ik_present: 2, ik_missing: 2 });
        expect(s.imageStorage).toEqual({ cache: 0, fetched: 1, failed: 1, skipped: 2 });
    });

    test('the operator-log invariant: every bucket-group sums to the example count', () => {
        const s = aggregateMediaStats(sample);
        const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
        expect(s.audio.ik + s.audio.tts + s.audio.none).toBe(sample.length);
        expect(sum(s.audioStorage)).toBe(sample.length);
        expect(s.image.ik_present + s.image.ik_missing).toBe(sample.length);
        expect(sum(s.imageStorage)).toBe(sample.length);
    });

    test('empty input → all-zero summary', () => {
        expect(aggregateMediaStats([])).toEqual({
            audio: { ik: 0, tts: 0, none: 0 },
            audioStorage: { cache: 0, fetched: 0, failed: 0, skipped: 0 },
            image: { ik_present: 0, ik_missing: 0 },
            imageStorage: { cache: 0, fetched: 0, failed: 0, skipped: 0 },
        });
    });
});
