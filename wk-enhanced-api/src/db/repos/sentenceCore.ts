// Sentence-store shared substrate — the types + low-level helpers that the three
// sentence-store repos (sentences / annotations / templates) all build on. Kept in
// one module so the privacy gate (VIEWER_VISIBLE), the row-assembly composer, and
// the reuse-by-hash upsert can't drift between callers.
//
// One canonical row per sentence that surfaces REFERENCE by id. ALL reads go through
// getSentences (the privacy choke-point, in sentences.ts); anon/export touch the
// public_sentence VIEW. `text` is plainText(jp) byte-for-byte and `hash` is
// ttsTextHash(text) — computed HERE, never on the client — so the existing audio
// layer keeps resolving. `furigana` is structured [{t,r?}] with concat(t) === text
// (enforced on write). See schema.sql.

import { getDb } from '../connection.ts';
import { ttsTextHash } from '../../services/tts.ts';

// A furigana segment: base text `t`, optional reading `r` (kana over a kanji run). The
// derived full-kana reading is `seg.r ?? seg.t` joined — never stored.
export interface FuriganaSeg {
    t: string;
    r?: string;
}

// The link between a sentence and whatever owns/illustrates it. Self-Talk uses
// `{ owner_type: 'selftalk' }`; card/grammar/conversation owners arrive in later phases.
export interface SentenceLink {
    owner_type: string;
    owner_id?: string | null;
    tier?: string | null;
    role?: string | null;
    ordinal?: number;
    clip_start_ms?: number | null;
    clip_end_ms?: number | null;
}

// --- Annotation shapes (NLP enrichment, Phase 4). The TYPES live here because the
// assembled-sentence shape embeds an optional annotation; the read/write LOGIC lives
// in annotations.ts. See annotations.ts + SENTENCE_STORE_NLP.md for the offset contract.

// One morpheme. `start`/`end` are UTF-16 CODE-UNIT offsets into sentence.text (NOT codepoint —
// the client maps a tap by slicing `text` in JS, which is UTF-16-indexed; they diverge from
// codepoint offsets at non-BMP kanji). `lemma` (dictionary form) drives the card/Jisho link;
// `reading` is GiNZA's (the VISIBLE reading still comes from the stored furigana).
//
// `tag`/`dep`/`head` are GiNZA-only (a full dependency parse); they're OPTIONAL because the 歌/Songs
// analyzer (the runtime LLM pass) emits the same token shape WITHOUT a dependency parse. `jlpt`/
// `gloss` are the reverse — LLM-only enrichment (per-word level + a short English gloss) the offline
// GiNZA batch doesn't produce — feeding the Songs word popover + the Mine vocab panel. All are
// absent-tolerant: the offset gate only reads start/end/surface, and the client overlay reads
// start/end/lemma/pos/reading, so the two producers interoperate.
export interface AnnotationToken {
    i: number;
    start: number;
    end: number;
    surface: string;
    lemma: string;
    pos: string;
    reading: string;
    tag?: string;
    dep?: string;
    head?: number;
    jlpt?: string; // 'N5'..'N1' — LLM-estimated (Songs)
    gloss?: string; // short English gloss — LLM-sourced (Songs)
}

// A phrase chunk (also UTF-16 offsets into text), for phrase-level highlight / grammar matching.
export interface AnnotationBunsetsu {
    start: number;
    end: number;
}

export interface SentenceAnnotation {
    tokens: AnnotationToken[];
    bunsetsu: AnnotationBunsetsu[];
    parser: string;
    parsedAt: number;
}

// The assembled sentence the API serves (composed from sentence + translation + tag + link).
// `id` is the stable ext_id (builtin slug / user UUID); `custom` = "authored by a user"
// (created_by is non-NULL), which the client uses to show the "yours" badge + edit affordance.
export interface AssembledSentence {
    id: string;
    text: string;
    furigana: FuriganaSeg[] | null;
    translations: Record<string, string>;
    tags: Record<string, string | string[]>;
    link: SentenceLink;
    custom: boolean;
    // Opt-in (getSentences `includeAnnotations`): GiNZA token/bunsetsu structure for tap-to-lookup.
    // Rides the SAME VIEWER_VISIBLE gate via the LEFT JOIN, so a private row's annotation only ever
    // reaches its owner. Absent when not requested OR when the sentence has no annotation yet.
    annotation?: SentenceAnnotation;
}

export type SentenceRow = {
    id: number;
    ext_id: string;
    hash: string;
    text: string;
    furigana: string | null;
    lang: string;
    source: string;
    public: number;
    visibility: string;
    created_by: number | null;
    created_at: number;
};

// Tag kinds that carry a LIST of values (grammar tokens); everything else is scalar (last wins).
const ARRAY_TAG_KINDS = new Set(['grammar']);

export const SENTENCE_ROW_COLS =
    'id, ext_id, hash, text, furigana, lang, source, public, visibility, created_by, created_at';

// THE privacy gate, as one SQL fragment so every read shares the exact same predicate and they
// can't drift. Aliases the sentence table as `s` and binds ONE param: the viewer id (null →
// public only, since `s.created_by = NULL` is never true → fail-closed). getSentences AND
// getAnnotation both AND this in; the pinned breach tests cover both. Keep it unconditional.
export const VIEWER_VISIBLE = '(s.public = 1 OR s.created_by = ?)';

// Throw unless the furigana segments reconstruct `text` exactly (concat(seg.t) === text).
// This is the structural-furigana invariant — a mismatch means the stored ruby would drift
// from the audio-keyed plain text. NULL furigana is allowed (no ruby).
export function assertFuriganaMatches(furigana: FuriganaSeg[] | null, text: string): void {
    if (furigana == null) return;
    if (!Array.isArray(furigana)) throw new Error('furigana must be an array of {t,r?} segments');
    const concat = furigana.map((s) => (s && typeof s.t === 'string' ? s.t : '')).join('');
    if (concat !== text) {
        throw new Error(`furigana segments do not reconstruct text: ${JSON.stringify(concat)} !== ${JSON.stringify(text)}`);
    }
}

export function getSentenceRowById(id: number): SentenceRow | null {
    return getDb()
        .query(`SELECT ${SENTENCE_ROW_COLS} FROM sentence WHERE id = ?`)
        .get(id) as SentenceRow | null;
}

// Trim a raw link row down to a compact object (omit NULL optional fields).
export function compactLink(r: {
    owner_type: string; owner_id: string | null; tier: string | null; role: string | null;
    ordinal: number; clip_start_ms: number | null; clip_end_ms: number | null;
}): SentenceLink {
    const link: SentenceLink = { owner_type: r.owner_type };
    if (r.owner_id != null) link.owner_id = r.owner_id;
    if (r.tier != null) link.tier = r.tier;
    if (r.role != null) link.role = r.role;
    if (r.ordinal) link.ordinal = r.ordinal;
    if (r.clip_start_ms != null) link.clip_start_ms = r.clip_start_ms;
    if (r.clip_end_ms != null) link.clip_end_ms = r.clip_end_ms;
    return link;
}

// Compose the full sentence object from its child tables. Used by every read path so the
// shape never diverges between getSentences and the create/update return values.
//
// `linkOverride` carries the SPECIFIC link this entry is for (passed by getSentences, which
// returns one entry PER LINK so a sentence reused by several card/tiers reports every link).
// When omitted (the single-link create/update/upsert/seed return values), the first link is
// re-queried — Self-Talk has exactly one link per sentence, so that path is unchanged.
export function assembleSentenceRow(row: SentenceRow, linkOverride?: SentenceLink): AssembledSentence {
    const db = getDb();
    const trs = db
        .query('SELECT lang, text, ordinal FROM translation WHERE sentence_id = ? ORDER BY lang, ordinal')
        .all(row.id) as { lang: string; text: string; ordinal: number }[];
    const translations: Record<string, string> = {};
    for (const t of trs) if (!(t.lang in translations)) translations[t.lang] = t.text; // ordinal-0 / first per lang

    // Ordered (kind, value) for a deterministic result — sentence_tag has no ordinal column,
    // so a tag LIST (grammar tokens) comes back value-sorted, not in authored order. That's
    // fine: grammar is a membership filter and the filter chips derive their own display order
    // (grammarTokens), so per-phrase tag order is cosmetic only.
    const tagRows = db
        .query('SELECT kind, value FROM sentence_tag WHERE sentence_id = ? ORDER BY kind, value')
        .all(row.id) as { kind: string; value: string }[];
    const tags: Record<string, string | string[]> = {};
    for (const tg of tagRows) {
        if (ARRAY_TAG_KINDS.has(tg.kind)) ((tags[tg.kind] ??= []) as string[]).push(tg.value);
        else tags[tg.kind] = tg.value;
    }

    let link: SentenceLink;
    if (linkOverride) {
        link = linkOverride;
    } else {
        const linkRow = db
            .query(
                'SELECT owner_type, owner_id, tier, role, ordinal, clip_start_ms, clip_end_ms FROM sentence_link WHERE sentence_id = ? ORDER BY id LIMIT 1',
            )
            .get(row.id) as Parameters<typeof compactLink>[0] | null;
        link = linkRow ? compactLink(linkRow) : { owner_type: '' };
    }

    return {
        id: row.ext_id,
        text: row.text,
        furigana: row.furigana ? (JSON.parse(row.furigana) as FuriganaSeg[]) : null,
        translations,
        tags,
        link,
        custom: row.created_by != null,
    };
}

// Insert a sentence's child rows (translations / tags / link). Shared by create + upsert;
// callers DELETE the existing children first when replacing.
export function insertSentenceChildren(
    sentenceId: number,
    translations: Record<string, string> | undefined,
    tags: Record<string, string | string[]> | undefined,
    link: SentenceLink | undefined,
): void {
    const db = getDb();
    if (translations) {
        const ins = db.query('INSERT INTO translation (sentence_id, lang, text, ordinal) VALUES (?, ?, ?, 0)');
        for (const [lang, text] of Object.entries(translations)) if (text != null) ins.run(sentenceId, lang, text);
    }
    if (tags) {
        const ins = db.query('INSERT OR IGNORE INTO sentence_tag (sentence_id, kind, value) VALUES (?, ?, ?)');
        for (const [kind, val] of Object.entries(tags)) {
            const vals = Array.isArray(val) ? val : val == null ? [] : [val];
            for (const v of vals) ins.run(sentenceId, kind, String(v));
        }
    }
    if (link) {
        db.query(
            `INSERT INTO sentence_link (sentence_id, owner_type, owner_id, tier, role, ordinal, clip_start_ms, clip_end_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            sentenceId,
            link.owner_type,
            link.owner_id ?? null,
            link.tier ?? null,
            link.role ?? null,
            link.ordinal ?? 0,
            link.clip_start_ms ?? null,
            link.clip_end_ms ?? null,
        );
    }
}

// INSERT one PRIVATE sentence row (public=0, visibility='private', lang='ja') and return its new id.
// The exact column list + ttsTextHash(text) + furigana-JSON encoding were hand-rolled in THREE places
// (createSentence, replaceUserCardExamples, the songs private-line insert) — one copy here so a column,
// a literal, or the hash derivation can't drift between them. `hash` is computed HERE from `text` (the
// audio-layer key, never client-set). Callers attach their own children (insertSentenceChildren) +
// annotations and assemble the return value. `ext_id` must be unique (the caller owns the namespace).
export function insertPrivateSentenceRow(input: {
    extId: string;
    text: string;
    furigana: FuriganaSeg[] | null;
    source: string;
    createdBy: number;
}): number {
    const r = getDb()
        .query(
            `INSERT INTO sentence (ext_id, hash, text, furigana, lang, source, public, visibility, created_by, created_at)
             VALUES (?, ?, ?, ?, 'ja', ?, 0, 'private', ?, ?) RETURNING id`,
        )
        .get(
            input.extId,
            ttsTextHash(input.text),
            input.text,
            input.furigana ? JSON.stringify(input.furigana) : null,
            input.source,
            input.createdBy,
            Date.now(),
        ) as { id: number };
    return r.id;
}

// Delete the viewer's OWN private sentence rows linked under (ownerType, ownerId). Child rows
// (translations / tags / links / annotations) cascade via FK. Scoped to `created_by = viewer` in SQL
// so it can NEVER touch a public/curator row or another user's private row — the owner-scoping is the
// load-bearing safety property. One copy of the delete-by-join so it can't drift between the three
// callers (replaceUserCardExamples card re-save; replaceSongLines + deleteSong). Call inside the
// caller's transaction when the follow-up re-insert must be atomic with it.
export function deleteOwnedLines(ownerType: string, ownerId: string, viewer: number): void {
    getDb()
        .query(
            `DELETE FROM sentence WHERE id IN (
                 SELECT s.id FROM sentence s JOIN sentence_link l ON l.sentence_id = s.id
                 WHERE l.owner_type = ? AND l.owner_id = ? AND s.created_by = ?
             )`,
        )
        .run(ownerType, ownerId, viewer);
}

// The PUBLIC sentence with this hash, or null. The partial unique index
// `(hash) WHERE public=1 AND visibility='public'` guarantees at most one — so this is the
// reuse key: an identical-text sentence already in the public slice (regardless of its ext_id
// namespace, e.g. a Self-Talk 'st-*' row) must be REUSED, not duplicated, or the second insert
// would violate that index.
export function getPublicSentenceByHash(hash: string): SentenceRow | null {
    return getDb()
        .query(`SELECT ${SENTENCE_ROW_COLS} FROM sentence WHERE hash = ? AND public = 1 AND visibility = 'public'`)
        .get(hash) as SentenceRow | null;
}

// Reuse-by-hash upsert of a PUBLIC sentence row — the shared skeleton behind seedExampleSentence
// and materializeTemplateRealization. Resolves the public row by content `hash` (the partial unique
// index `(hash) WHERE public=1 AND visibility='public'` means at most one). If absent, INSERTs it
// (ext_id=`${extIdPrefix}-${hash}`, the given `source`, public + curator-owned). If present AND ours
// (existing.source === source), refreshes furigana + translations so a corrected bundle propagates
// (text/hash ARE the reuse key, unchanged). If present but FOREIGN (a different source's public row
// with identical text), leaves its content + translations UNTOUCHED. Returns the row id + whether we
// `owned` it (created here, or same-source) so the caller can decide whether it may (re)write the
// grammar/links it controls. Touches NO sentence_link — link + grammar policy lives in the callers.
export function upsertPublicSentenceByHash(input: {
    source: string;
    extIdPrefix: string;
    text: string;
    furigana: FuriganaSeg[] | null;
    translations?: Record<string, string>;
}): { id: number; owned: boolean } {
    assertFuriganaMatches(input.furigana, input.text);
    const db = getDb();
    const hash = ttsTextHash(input.text);
    const furiganaJson = input.furigana ? JSON.stringify(input.furigana) : null;
    const existing = getPublicSentenceByHash(hash);
    if (existing) {
        const owned = existing.source === input.source;
        if (owned) {
            // Our own row — refresh furigana + translations (text/hash unchanged, they ARE the reuse key).
            db.query('UPDATE sentence SET furigana = ? WHERE id = ?').run(furiganaJson, existing.id);
            db.query('DELETE FROM translation WHERE sentence_id = ?').run(existing.id);
            insertSentenceChildren(existing.id, input.translations, undefined, undefined);
        }
        // else: foreign public row with identical text — leave its content + translations alone.
        return { id: existing.id, owned };
    }
    const r = db
        .query(
            `INSERT INTO sentence (ext_id, hash, text, furigana, lang, source, public, visibility, created_by, created_at)
             VALUES (?, ?, ?, ?, 'ja', ?, 1, 'public', NULL, ?) RETURNING id`,
        )
        .get(`${input.extIdPrefix}-${hash}`, hash, input.text, furiganaJson, input.source, Date.now()) as { id: number };
    insertSentenceChildren(r.id, input.translations, undefined, undefined);
    return { id: r.id, owned: true };
}
