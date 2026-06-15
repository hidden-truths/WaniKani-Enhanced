// sentence_template repo — slot-swap generators + lazy realization. db.getTemplates is the
// literal mirror of getSentences' VIEWER_VISIBLE gate; the first block is BREACH-PREVENTION
// pins (a private template must not leak), the second pins the materialization semantics
// (idempotency, foreign-row-reuse-untouched, grammar copy, furigana + server-hash invariants,
// and that combos do NOT leak into the Self-Talk read). If a pin breaks, fix the code.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from '../connection.ts';
import * as db from '../client.ts';
import { ttsTextHash } from '../../services/tts.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

describe('sentence_template privacy + ownership pins', () => {
    const tpl = (extId: string) => ({
        extId, source: 'selftalk', topic: 'minecraft', thought: 'resources', grammar: ['volitional'],
        en: 'go {x}', jp: '{x}に<ruby>行<rt>い</rt></ruby>こう。',
        slots: [{ id: 'x', label: 'where', fillers: [{ jp: '<ruby>家<rt>いえ</rt></ruby>', en: 'home' }] }],
    });
    const n = (sql: string) => (mem.query(sql).get() as { n: number }).n;
    // A raw private template (no repo fn creates one in this curator-only slice).
    const insertPrivate = (extId: string, createdBy: number) =>
        mem.query(`INSERT INTO sentence_template (ext_id, source, topic, grammar, en, jp, slots, public, visibility, created_by, created_at)
                   VALUES (?, 'selftalk', 'minecraft', '[]', 'x', 'x', '[]', 0, 'private', ?, 1)`).run(extId, createdBy);

    test('getTemplates({viewer:null}) returns only public rows; private rows are hidden', () => {
        const a = db.createUser('a@x.com', 'h');
        db.upsertPublicTemplate(tpl('tpl-1'));
        insertPrivate('tpl-priv', a.id);
        const anon = db.getTemplates({ viewer: null });
        expect(anon.map((t) => t.id)).toEqual(['tpl-1']);
        expect(anon.every((t) => t.custom === false)).toBe(true);
    });

    test('a private template is visible to its owner, invisible to another user and to anon', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        insertPrivate('tpl-priv', a.id);
        expect(db.getTemplates({ viewer: a.id }).map((t) => t.id)).toEqual(['tpl-priv']);
        expect(db.getTemplates({ viewer: b.id })).toEqual([]);
        expect(db.getTemplates({ viewer: null })).toEqual([]);
        expect(db.getTemplates({})).toEqual([]); // fail-closed default (no viewer)
    });

    test('the public_template VIEW excludes a private row and a gated (public=0) row', () => {
        db.upsertPublicTemplate(tpl('tpl-1'));
        // gated: public=0 but visibility='public' — the VIEW must still exclude it.
        mem.query(`INSERT INTO sentence_template (ext_id, source, grammar, en, jp, slots, public, visibility, created_at)
                   VALUES ('tpl-gated', 'selftalk', '[]', 'x', 'x', '[]', 0, 'public', 1)`).run();
        const view = (mem.query('SELECT ext_id FROM public_template ORDER BY ext_id').all() as { ext_id: string }[]).map((r) => r.ext_id);
        expect(view).toEqual(['tpl-1']);
    });

    test('upsertPublicTemplate is idempotent + round-trips the structure (grammar/slots JSON)', () => {
        db.upsertPublicTemplate(tpl('tpl-1'));
        db.upsertPublicTemplate(tpl('tpl-1')); // second run must not grow anything
        expect(n('SELECT COUNT(*) AS n FROM sentence_template')).toBe(1);
        const got = db.getTemplates({ viewer: null });
        expect(got).toHaveLength(1);
        expect(got[0]!).toMatchObject({
            id: 'tpl-1', source: 'selftalk', topic: 'minecraft', thought: 'resources',
            grammar: ['volitional'], custom: false,
        });
        expect(got[0]!.slots[0]!.fillers[0]).toEqual({ jp: '<ruby>家<rt>いえ</rt></ruby>', en: 'home' });
    });

    test('source filter narrows the read', () => {
        db.upsertPublicTemplate(tpl('tpl-1'));
        expect(db.getTemplates({ source: 'selftalk', viewer: null }).map((t) => t.id)).toEqual(['tpl-1']);
        expect(db.getTemplates({ source: 'nope', viewer: null })).toEqual([]);
    });

    test('getTemplate fetches one by ext_id through the gate (private → owner-only, fail-closed)', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.upsertPublicTemplate(tpl('tpl-1'));
        insertPrivate('tpl-priv', a.id);
        // public: visible to anon + any user; carries the curated grammar the realize route reads.
        expect(db.getTemplate({ extId: 'tpl-1', viewer: null })!.grammar).toEqual(['volitional']);
        expect(db.getTemplate({ extId: 'tpl-1', viewer: b.id })!.id).toBe('tpl-1');
        // private: owner only — never another user, never anon, never the fail-closed default.
        expect(db.getTemplate({ extId: 'tpl-priv', viewer: a.id })!.id).toBe('tpl-priv');
        expect(db.getTemplate({ extId: 'tpl-priv', viewer: b.id })).toBeNull();
        expect(db.getTemplate({ extId: 'tpl-priv', viewer: null })).toBeNull();
        expect(db.getTemplate({ extId: 'nope', viewer: null })).toBeNull();
    });
});

// Slice 2: a template realization (filler combo) is lazily materialized into a PUBLIC `sentence` row
// (source='template', created_by=NULL) linked via owner_type='template', so the store tooling covers
// it. Mirrors seedExampleSentence's reuse-by-hash; the privacy gate is unchanged (a public row), but
// these pin the materialization SEMANTICS: idempotency, foreign-row reuse-untouched, the grammar
// copy, the furigana + server-hash invariants, and that combos do NOT leak into the Self-Talk read.
describe('sentence_template realization (materialization)', () => {
    const seg = (text: string) => [{ t: text }];
    const n = (sql: string) => (mem.query(sql).get() as { n: number }).n;
    const M = (over: Partial<Parameters<typeof db.materializeTemplateRealization>[0]> = {}) =>
        db.materializeTemplateRealization({
            templateExtId: 'tpl-1', role: 'x:0', text: 'A。', furigana: seg('A。'), translations: { en: 'a' }, ...over,
        });

    test('creates a PUBLIC source=template row + its template link (custom=false)', () => {
        const s = M({ text: 'いえにかえる。', furigana: seg('いえにかえる。'), translations: { en: 'go home' }, grammar: ['volitional'] });
        expect(s.custom).toBe(false);
        expect(s.link).toEqual({ owner_type: 'template', owner_id: 'tpl-1', role: 'x:0' });
        expect(s.text).toBe('いえにかえる。');
        expect(s.translations).toEqual({ en: 'go home' });
        const row = mem.query('SELECT source, public, visibility, created_by FROM sentence WHERE hash = ?').get(ttsTextHash('いえにかえる。')) as any;
        expect(row).toMatchObject({ source: 'template', public: 1, visibility: 'public', created_by: null });
    });

    test('stored hash equals ttsTextHash(text) — server-computed', () => {
        M({ text: 'はをみがく。', furigana: [{ t: 'は' }, { t: 'を' }, { t: 'みがく。' }] });
        const row = mem.query("SELECT hash FROM sentence WHERE source = 'template'").get() as { hash: string };
        expect(row.hash).toBe(ttsTextHash('はをみがく。'));
    });

    test('idempotent by hash + (owner,role): re-materializing the same combo grows nothing', () => {
        M({ grammar: ['g1'] });
        M({ grammar: ['g1'] });
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(1);
        expect(n("SELECT COUNT(*) AS n FROM sentence_link WHERE owner_type = 'template'")).toBe(1);
        expect(n('SELECT COUNT(*) AS n FROM translation')).toBe(1);
        expect(n("SELECT COUNT(*) AS n FROM sentence_tag WHERE kind = 'grammar'")).toBe(1);
    });

    test('two combos of one template (different text) → two rows + two template links', () => {
        M({ role: 'x:0', text: 'A。', furigana: seg('A。') });
        M({ role: 'x:1', text: 'B。', furigana: seg('B。') });
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(2);
        expect(n("SELECT COUNT(*) AS n FROM sentence_link WHERE owner_type = 'template' AND owner_id = 'tpl-1'")).toBe(2);
    });

    test('grammar is copied onto the combo row (search includes it immediately, value-sorted)', () => {
        M({ grammar: ['volitional', 'te-iru'] });
        const got = db.getSentences({ ownerType: 'template', viewer: null });
        expect(got[0]!.tags.grammar).toEqual(['te-iru', 'volitional']);
    });

    test('re-materializing OUR row refreshes furigana + translations (corrected template propagates)', () => {
        M({ translations: { en: 'old' } });
        M({ translations: { en: 'new' } });
        expect(db.getSentences({ ownerType: 'template', viewer: null })[0]!.translations).toEqual({ en: 'new' });
        expect(n('SELECT COUNT(*) AS n FROM translation')).toBe(1);
    });

    test('reuse-by-hash: a combo matching a FOREIGN public row reuses it untouched, just links', () => {
        db.upsertPublicSentence({ extId: 'st-1', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', translations: { en: 'morning' }, tags: { topic: 'morning', grammar: ['phrase-g'] }, link: { owner_type: 'selftalk' } });
        M({ text: 'おはよう。', furigana: seg('おはよう。'), translations: { en: 'IGNORED for a foreign row' }, grammar: ['template-g'] });
        // ONE row total — the partial-unique-by-hash slice is honored (no duplicate public row).
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(1);
        // the foreign selftalk row's content + grammar are untouched (NOT clobbered with template-g).
        const st = db.getSentences({ ownerType: 'selftalk', viewer: null });
        expect(st.map((s) => [s.id, s.translations.en])).toEqual([['st-1', 'morning']]);
        expect(st[0]!.tags.grammar).toEqual(['phrase-g']);
        // reachable for tooling via the template link (one entry, the template link).
        const tplRead = db.getSentences({ ownerType: 'template', viewer: null });
        expect(tplRead.map((s) => [s.id, s.link.owner_id, s.link.role])).toEqual([['st-1', 'tpl-1', 'x:0']]);
    });

    test('combo rows are public (in the export VIEW) but NOT in the Self-Talk read (template-link only)', () => {
        M({ text: 'C。', furigana: seg('C。') });
        expect(db.getSentences({ ownerType: 'selftalk', viewer: null })).toEqual([]); // not a selftalk owner
        expect(n('SELECT COUNT(*) AS n FROM public_sentence')).toBe(1); // but IS export/anon-eligible
    });

    test('furigana that does not reconstruct text is rejected (the structural invariant)', () => {
        expect(() => M({ text: 'ほんとう。', furigana: [{ t: 'ちがう' }] })).toThrow();
    });
});
