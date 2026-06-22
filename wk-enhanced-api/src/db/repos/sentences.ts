// sentence store — the canonical sentence entity: the getSentences read choke-point
// (the privacy gate), user-authored CRUD, and the public curator/example seed paths.
// Shared assembly + reuse-by-hash helpers live in sentenceCore.ts. Backs 独り言
// Self-Talk AND built-in vocab example sentences. See schema.sql + CLAUDE.md.

import { getDb } from '../connection.ts';
import { ttsTextHash } from '../../services/tts.ts';
import {
    assembleSentenceRow,
    assertFuriganaMatches,
    compactLink,
    deleteOwnedLines,
    getSentenceRowById,
    insertPrivateSentenceRow,
    insertSentenceChildren,
    upsertPublicSentenceByHash,
    SENTENCE_ROW_COLS,
    VIEWER_VISIBLE,
} from './sentenceCore.ts';
import type {
    AnnotationBunsetsu,
    AnnotationToken,
    AssembledSentence,
    FuriganaSeg,
    SentenceLink,
    SentenceRow,
} from './sentenceCore.ts';

// THE choke-point read. Joins sentence_link → sentence for `ownerType` (optionally narrowed to
// one `ownerId`), and ALWAYS ANDs `(s.public = 1 OR s.created_by = :viewer)`. `viewer` defaults
// to null → public rows only (SQL `created_by = NULL` is never true, so a null viewer can't reach
// any private row). This single gate is what the whole feature's privacy rests on — keep the AND
// unconditional.
//
// Returns one entry PER LINK (not per sentence): a sentence reused by several cards/tiers comes
// back once per link, each carrying its own link, so the deck can rebuild v.levels keyed by
// owner_id + tier. Self-Talk is unaffected — its sentences have exactly one selftalk link each.
export function getSentences(opts: {
    ownerType: string;
    ownerId?: string | null;
    viewer?: number | null;
    includeAnnotations?: boolean;
}): AssembledSentence[] {
    const viewer = opts.viewer ?? null;
    const ownerId = opts.ownerId ?? null;
    // Opt-in token annotations (tap-to-lookup): LEFT JOIN sentence_annotation INSIDE the same
    // VIEWER_VISIBLE-gated query, so an annotation can only come back for a row the viewer already
    // passes the gate on — a private row's annotation can never ride the join to anon / another
    // user (pinned in the breach tests). Off by default → existing callers' payloads are unchanged.
    const annotate = opts.includeAnnotations ?? false;
    const annCols = annotate
        ? ', a.tokens AS a_tokens, a.bunsetsu AS a_bunsetsu, a.parser AS a_parser, a.parsed_at AS a_parsed_at'
        : '';
    const annJoin = annotate ? ' LEFT JOIN sentence_annotation a ON a.sentence_id = s.id' : '';
    const rows = getDb()
        .query(
            `SELECT s.id, s.ext_id, s.hash, s.text, s.furigana, s.lang, s.source,
                    s.public, s.visibility, s.created_by, s.created_at,
                    l.owner_type AS l_owner_type, l.owner_id AS l_owner_id, l.tier AS l_tier,
                    l.role AS l_role, l.ordinal AS l_ordinal,
                    l.clip_start_ms AS l_clip_start_ms, l.clip_end_ms AS l_clip_end_ms${annCols}
             FROM sentence_link l JOIN sentence s ON s.id = l.sentence_id${annJoin}
             WHERE l.owner_type = ? AND (? IS NULL OR l.owner_id = ?) AND ${VIEWER_VISIBLE}
             ORDER BY s.id, l.id`,
        )
        .all(opts.ownerType, ownerId, ownerId, viewer) as (SentenceRow & {
        l_owner_type: string;
        l_owner_id: string | null;
        l_tier: string | null;
        l_role: string | null;
        l_ordinal: number;
        l_clip_start_ms: number | null;
        l_clip_end_ms: number | null;
        a_tokens?: string | null;
        a_bunsetsu?: string | null;
        a_parser?: string | null;
        a_parsed_at?: number | null;
    })[];
    return rows.map((r) => {
        const out = assembleSentenceRow(
            r,
            compactLink({
                owner_type: r.l_owner_type,
                owner_id: r.l_owner_id,
                tier: r.l_tier,
                role: r.l_role,
                ordinal: r.l_ordinal,
                clip_start_ms: r.l_clip_start_ms,
                clip_end_ms: r.l_clip_end_ms,
            }),
        );
        // Attach only when requested AND the row actually has an annotation (LEFT JOIN → NULLs for
        // an unparsed sentence, which then simply carries no `annotation` field).
        if (annotate && r.a_tokens != null) {
            out.annotation = {
                tokens: JSON.parse(r.a_tokens) as AnnotationToken[],
                bunsetsu: JSON.parse(r.a_bunsetsu!) as AnnotationBunsetsu[],
                parser: r.a_parser!,
                parsedAt: r.a_parsed_at!,
            };
        }
        return out;
    });
}

// Count a user's own (private) sentences — backs the per-user authoring cap in the route.
export function countUserSentences(viewer: number): number {
    const row = getDb().query('SELECT COUNT(*) AS n FROM sentence WHERE created_by = ?').get(viewer) as { n: number };
    return row.n;
}

// Fetch a user's OWN sentence by ext_id (assembled), or null if it doesn't exist or isn't
// theirs. Lets the create route stay idempotent on a re-POST of the same ext_id (the legacy
// Self-Talk migration replays the user's existing usr-<uuid> ids).
export function getUserSentence(opts: { extId: string; viewer: number }): AssembledSentence | null {
    const row = getDb()
        .query(`SELECT ${SENTENCE_ROW_COLS} FROM sentence WHERE ext_id = ? AND created_by = ?`)
        .get(opts.extId, opts.viewer) as SentenceRow | null;
    return row ? assembleSentenceRow(row) : null;
}

// Create a PRIVATE user-authored sentence (public=0, visibility='private'). `hash` is
// computed here from `text`; furigana is validated against `text` before insert.
export function createSentence(input: {
    extId: string;
    text: string;
    furigana?: FuriganaSeg[] | null;
    source: string;
    createdBy: number;
    translations?: Record<string, string>;
    tags?: Record<string, string | string[]>;
    link: SentenceLink;
}): AssembledSentence {
    const furigana = input.furigana ?? null;
    assertFuriganaMatches(furigana, input.text);
    const id = insertPrivateSentenceRow({
        extId: input.extId,
        text: input.text,
        furigana,
        source: input.source,
        createdBy: input.createdBy,
    });
    insertSentenceChildren(id, input.translations, input.tags, input.link);
    return assembleSentenceRow(getSentenceRowById(id)!);
}

// Replace a user's own sentence (full overwrite of text + children). Ownership is enforced
// IN SQL (`WHERE ext_id = ? AND created_by = ?`): a non-owner (or unknown ext_id) matches 0
// rows and returns null (the route maps that to 404).
export function updateUserSentence(input: {
    extId: string;
    viewer: number;
    text: string;
    furigana?: FuriganaSeg[] | null;
    translations?: Record<string, string>;
    tags?: Record<string, string | string[]>;
    link?: SentenceLink;
}): AssembledSentence | null {
    const db = getDb();
    const row = db
        .query('SELECT id FROM sentence WHERE ext_id = ? AND created_by = ?')
        .get(input.extId, input.viewer) as { id: number } | null;
    if (!row) return null;
    const id = row.id;
    const furigana = input.furigana ?? null;
    assertFuriganaMatches(furigana, input.text);
    db.query('UPDATE sentence SET text = ?, hash = ?, furigana = ? WHERE id = ?').run(
        input.text,
        ttsTextHash(input.text),
        furigana ? JSON.stringify(furigana) : null,
        id,
    );
    db.query('DELETE FROM translation WHERE sentence_id = ?').run(id);
    db.query('DELETE FROM sentence_tag WHERE sentence_id = ?').run(id);
    db.query('DELETE FROM sentence_link WHERE sentence_id = ?').run(id);
    insertSentenceChildren(id, input.translations, input.tags, input.link ?? { owner_type: 'selftalk' });
    return assembleSentenceRow(getSentenceRowById(id)!);
}

// Delete a user's own sentence (owner-scoped). Child rows cascade via the FK. Returns true
// when a row was removed; a non-owner / unknown ext_id is a no-op returning false.
export function deleteUserSentence(input: { extId: string; viewer: number }): boolean {
    const r = getDb()
        .query('DELETE FROM sentence WHERE ext_id = ? AND created_by = ?')
        .run(input.extId, input.viewer);
    return r.changes > 0;
}

// Replace the signed-in user's PRIVATE example sentences for one custom card (rank), wholesale —
// the per-user analog of seedExampleSentence's public replace, so the study app dual-writes a
// custom card's whole example set in ONE call (no client-side per-slot diffing / orphan rows).
// Deletes the caller's OWN (created_by = viewer) owner_type='card', owner_id=rank rows — scoped to
// created_by=viewer in SQL so it can NEVER touch a public built-in example (those are created_by
// NULL) — then inserts the given set as private rows (source='custom', public=0). ext_id is
// deterministic + user-scoped (usr-<viewer>-cardex-<rank>-<slot>) so it's stable across re-runs and
// can't collide with another account's same-ranked custom card. `slot` is 'ex' (untiered fallback)
// or a JLPT tier ('N5'..'N1'); the tier rides the link. An empty `examples` just clears the card's
// rows (used on card delete). All furigana invariants are checked BEFORE any mutation, so a bad
// slot aborts the whole replace rather than leaving a partial set.
export function replaceUserCardExamples(input: {
    rank: string;
    viewer: number;
    examples: Array<{ slot: string; text: string; furigana?: FuriganaSeg[] | null; en?: string }>;
}): AssembledSentence[] {
    for (const ex of input.examples) assertFuriganaMatches(ex.furigana ?? null, ex.text);
    // Drop the caller's OWN card-example rows (owner-scoped so it can't touch a public built-in),
    // then re-insert the set. children cascade via FK.
    deleteOwnedLines('card', input.rank, input.viewer);
    const out: AssembledSentence[] = [];
    for (const ex of input.examples) {
        const tier = ex.slot === 'ex' ? null : ex.slot;
        const id = insertPrivateSentenceRow({
            extId: `usr-${input.viewer}-cardex-${input.rank}-${ex.slot}`,
            text: ex.text,
            furigana: ex.furigana ?? null,
            source: 'custom',
            createdBy: input.viewer,
        });
        insertSentenceChildren(id, ex.en ? { en: ex.en } : undefined, undefined, {
            owner_type: 'card',
            owner_id: input.rank,
            tier,
        });
        out.push(assembleSentenceRow(getSentenceRowById(id)!));
    }
    return out;
}

// Seed/refresh a PUBLIC curator sentence (public=1, visibility='public', created_by=NULL).
// Idempotent by ext_id: re-running replaces the sentence + all child rows wholesale, so the
// seed script is a safe no-growth no-op on re-run. created_at is preserved across re-seeds.
export function upsertPublicSentence(input: {
    extId: string;
    text: string;
    furigana?: FuriganaSeg[] | null;
    source: string;
    translations?: Record<string, string>;
    tags?: Record<string, string | string[]>;
    link: SentenceLink;
}): AssembledSentence {
    const furigana = input.furigana ?? null;
    assertFuriganaMatches(furigana, input.text);
    const db = getDb();
    const now = Date.now();
    const r = db
        .query(
            `INSERT INTO sentence (ext_id, hash, text, furigana, lang, source, public, visibility, created_by, created_at)
             VALUES (?, ?, ?, ?, 'ja', ?, 1, 'public', NULL, ?)
             ON CONFLICT(ext_id) DO UPDATE SET
                 hash = excluded.hash, text = excluded.text, furigana = excluded.furigana,
                 source = excluded.source, public = 1, visibility = 'public', created_by = NULL
             RETURNING id`,
        )
        .get(
            input.extId,
            ttsTextHash(input.text),
            input.text,
            furigana ? JSON.stringify(furigana) : null,
            input.source,
            now,
        ) as { id: number };
    db.query('DELETE FROM translation WHERE sentence_id = ?').run(r.id);
    db.query('DELETE FROM sentence_tag WHERE sentence_id = ?').run(r.id);
    db.query('DELETE FROM sentence_link WHERE sentence_id = ?').run(r.id);
    insertSentenceChildren(r.id, input.translations, input.tags, input.link);
    return assembleSentenceRow(getSentenceRowById(r.id)!);
}

// Seed/refresh a PUBLIC built-in EXAMPLE sentence (Phase 2) and (re)set its card links. The seed
// passes the FULL card-link set for one text in a single call (it groups EXAMPLES by text first),
// so this REPLACES the sentence's owner_type='card' links wholesale — idempotent on re-seed (same
// hash → same row → same link set → no growth). The row itself is upserted reuse-by-hash via
// upsertPublicSentenceByHash (source='example'); card links are (re)attached even on a foreign reused
// row (e.g. a 'selftalk' row with identical text) — only card links are wiped, never the shared row's
// content or its non-card links.
export function seedExampleSentence(input: {
    text: string;
    furigana?: FuriganaSeg[] | null;
    translations?: Record<string, string>;
    cardLinks: SentenceLink[];
}): AssembledSentence {
    const { id } = upsertPublicSentenceByHash({
        source: 'example',
        extIdPrefix: 'ex',
        text: input.text,
        furigana: input.furigana ?? null,
        translations: input.translations,
    });
    const db = getDb();
    // Replace ONLY this sentence's card links (preserve any selftalk/other link on a shared row).
    db.query("DELETE FROM sentence_link WHERE sentence_id = ? AND owner_type = 'card'").run(id);
    for (const link of input.cardLinks) insertSentenceChildren(id, undefined, undefined, link);
    return assembleSentenceRow(getSentenceRowById(id)!);
}

// Seed/refresh a GATED みんなの日本語 (Minna) sentence — copyright-gated CURATOR content (Phase 3).
// Like upsertPublicSentence but PUBLIC=0, so it's excluded from the public_sentence VIEW *and* dark
// to the getSentences gate (`public=1 OR created_by=:viewer` — never true for public=0 + created_by
// NULL): the generic read path can NEVER surface it, only the email-gated /v1/minna route reads these
// rows (via getMinnaAnnotations). visibility='public' + created_by=NULL mark it curator-owned. The
// row's mere existence is what lets the offline GiNZA batch attach tap-to-lookup tokens (resolved by
// the unique ext_id — Minna text has bunsetsu spaces, so it never shares a hash with a space-free
// public example, but ext_id resolution is collision-proof regardless). Idempotent by ext_id (the
// seed owns the `mnn-<lesson>-<type>-<idx>` namespace); replaces translations + the single link on
// re-seed, but preserves sentence_tag so seed-annotations' GiNZA grammar survives a content re-seed.
export function seedMinnaSentence(input: {
    extId: string;
    text: string;
    furigana?: FuriganaSeg[] | null;
    translations?: Record<string, string>;
    link: SentenceLink;
}): AssembledSentence {
    const furigana = input.furigana ?? null;
    assertFuriganaMatches(furigana, input.text);
    const db = getDb();
    const r = db
        .query(
            `INSERT INTO sentence (ext_id, hash, text, furigana, lang, source, public, visibility, created_by, created_at)
             VALUES (?, ?, ?, ?, 'ja', 'minna', 0, 'public', NULL, ?)
             ON CONFLICT(ext_id) DO UPDATE SET
                 hash = excluded.hash, text = excluded.text, furigana = excluded.furigana,
                 source = 'minna', public = 0, visibility = 'public', created_by = NULL
             RETURNING id`,
        )
        .get(input.extId, ttsTextHash(input.text), input.text, furigana ? JSON.stringify(furigana) : null, Date.now()) as {
        id: number;
    };
    db.query('DELETE FROM translation WHERE sentence_id = ?').run(r.id);
    db.query('DELETE FROM sentence_link WHERE sentence_id = ?').run(r.id);
    insertSentenceChildren(r.id, input.translations, undefined, input.link);
    return assembleSentenceRow(getSentenceRowById(r.id)!);
}

// Read every gated Minna annotation as a hash → {tokens, furigana} map (Phase 3 serving). The
// /v1/minna route enriches its lesson JSON by matching each sentence's ttsTextHash against this map
// to attach tap-to-lookup tokens. Scoped to source='minna' (so it can't pick up a space-free public
// example that happens to share a hash) + curator rows; identical-text Minna rows carry identical
// GiNZA tokens, so a hash key is unambiguous for the lookup. NOT gated by viewer — the caller
// (routes/minna.ts) already applies the MINNA_OWNER_EMAILS gate, and these rows are public=0.
export function getMinnaAnnotations(): Map<string, { tokens: AnnotationToken[]; furigana: FuriganaSeg[] | null }> {
    const rows = getDb()
        .query(
            `SELECT s.hash, s.furigana, a.tokens
             FROM sentence s JOIN sentence_annotation a ON a.sentence_id = s.id
             WHERE s.source = 'minna' AND s.public = 0 AND a.tokens IS NOT NULL`,
        )
        .all() as { hash: string; furigana: string | null; tokens: string }[];
    const map = new Map<string, { tokens: AnnotationToken[]; furigana: FuriganaSeg[] | null }>();
    for (const r of rows) {
        map.set(r.hash, {
            tokens: JSON.parse(r.tokens) as AnnotationToken[],
            furigana: r.furigana ? (JSON.parse(r.furigana) as FuriganaSeg[]) : null,
        });
    }
    return map;
}

// Resolve a Minna sentence row by its (unique) ext_id — the seed-annotations resolver for source=
// 'minna'. Public rows resolve by hash (reuse-by-hash dedup), but Minna rows aren't hash-deduped and
// a space-free Minna sentence could share a hash with a public example, so the annotation seed keys
// Minna by ext_id instead (collision-proof). Scoped to source='minna' so it can't return anything else.
export function getMinnaSentenceByExtId(extId: string): SentenceRow | null {
    return getDb()
        .query(`SELECT ${SENTENCE_ROW_COLS} FROM sentence WHERE ext_id = ? AND source = 'minna' AND public = 0`)
        .get(extId) as SentenceRow | null;
}
