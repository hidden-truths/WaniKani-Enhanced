// audio_variants repo — the tagged voice-clip manifest, scoped + idempotent per
// (text_hash, provider, gender).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from '../connection.ts';
import * as db from '../client.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

describe('audio_variants (tagged voice-clip manifest)', () => {
    test('insert + list returns a text’s variants', () => {
        db.insertAudioVariant('hash1', 'siri', 'female', 'm4a');
        db.insertAudioVariant('hash1', 'siri', 'male', 'm4a');
        const list = db.listAudioVariants('hash1');
        expect(list.map((r) => `${r.provider}:${r.gender}`).sort()).toEqual(['siri:female', 'siri:male']);
        expect(list[0]!.ext).toBe('m4a');
    });

    test('list is scoped per text_hash', () => {
        db.insertAudioVariant('hashA', 'siri', 'female', 'm4a');
        db.insertAudioVariant('hashB', 'siri', 'male', 'm4a');
        expect(db.listAudioVariants('hashA')).toHaveLength(1);
        expect(db.listAudioVariants('hashB')).toHaveLength(1);
        expect(db.listAudioVariants('missing')).toEqual([]);
    });

    test('re-inserting the same (text, provider, gender) is idempotent (no duplicate)', () => {
        db.insertAudioVariant('h', 'siri', 'female', 'm4a');
        db.insertAudioVariant('h', 'siri', 'female', 'm4a'); // same voice again
        expect(db.listAudioVariants('h')).toHaveLength(1);
    });

    test('gender defaults to empty string for a no-gender provider', () => {
        db.insertAudioVariant('h2', 'siri', '', 'm4a');
        expect(db.listAudioVariants('h2')[0]!.gender).toBe('');
    });
});
