// sentence_template (slot-swap generators; 独り言 Self-Talk).
//
// A template is a sentence GENERATOR (skeleton + slots + fillers), NOT a sentence row — see
// schema.sql. Curator rows are seeded from the study-app bundle (upsertPublicTemplate); user-
// authored templates + realization materialization arrive in a later slice. Reads go through
// getTemplates, which MIRRORS getSentences' privacy gate (public OR created_by=viewer), fail-
// closed. Pinned by a breach test — keep it green. `grammar`/`slots` are stored as JSON the
// server treats as opaque (parsed only to re-emit the client-render shape).

import { getDb } from '../connection.ts';
import {
    assembleSentenceRow,
    getSentenceRowById,
    insertSentenceChildren,
    upsertPublicSentenceByHash,
} from './sentenceCore.ts';
import type { AssembledSentence, FuriganaSeg, SentenceLink } from './sentenceCore.ts';
import { setGrammarTags } from './annotations.ts';

// One slot filler: the ruby `jp` substituted into a {slot} marker + its English gloss.
export interface TemplateFiller {
    jp: string;
    en: string;
}
// One swappable slot: stable `id` (matches a {id} marker in jp/en), a short `label`, its fillers.
export interface TemplateSlot {
    id: string;
    label: string;
    fillers: TemplateFiller[];
}
// The assembled template the API serves — the exact shape the client slot-swap UI renders. `id`
// is the stable ext_id (the SKELETON id record-compare keys on); `custom` = user-authored (a
// non-NULL created_by) — always false in this curator-only slice.
export interface AssembledTemplate {
    id: string;
    source: string;
    topic: string | null;
    thought?: string;
    grammar: string[];
    en: string;
    jp: string;
    slots: TemplateSlot[];
    custom: boolean;
}

type TemplateRow = {
    id: number;
    ext_id: string;
    source: string;
    topic: string | null;
    thought: string | null;
    grammar: string | null;
    en: string | null;
    jp: string | null;
    slots: string | null;
    public: number;
    visibility: string;
    created_by: number | null;
    created_at: number;
};

const TEMPLATE_ROW_COLS =
    'id, ext_id, source, topic, thought, grammar, en, jp, slots, public, visibility, created_by, created_at';

// THE template privacy gate — the literal mirror of VIEWER_VISIBLE, aliasing sentence_template as
// `t`. Binds ONE param (the viewer id; null → public only, since `t.created_by = NULL` is never
// true → fail-closed). getTemplates ANDs this in; the pinned breach test covers it. Keep it
// unconditional.
const TEMPLATE_VIEWER_VISIBLE = '(t.public = 1 OR t.created_by = ?)';

function getTemplateRowById(id: number): TemplateRow | null {
    return getDb()
        .query(`SELECT ${TEMPLATE_ROW_COLS} FROM sentence_template WHERE id = ?`)
        .get(id) as TemplateRow | null;
}

// Parse the opaque JSON columns back into the structured client shape. A malformed/absent column
// degrades to an empty array / blank string rather than throwing (the seed writes valid JSON; this
// is just defensive against a hand-edited row).
function assembleTemplateRow(row: TemplateRow): AssembledTemplate {
    let grammar: unknown = [];
    let slots: unknown = [];
    try { grammar = row.grammar ? JSON.parse(row.grammar) : []; } catch { grammar = []; }
    try { slots = row.slots ? JSON.parse(row.slots) : []; } catch { slots = []; }
    const out: AssembledTemplate = {
        id: row.ext_id,
        source: row.source,
        topic: row.topic,
        grammar: Array.isArray(grammar) ? (grammar as string[]) : [],
        en: row.en ?? '',
        jp: row.jp ?? '',
        slots: Array.isArray(slots) ? (slots as TemplateSlot[]) : [],
        custom: row.created_by != null,
    };
    if (row.thought) out.thought = row.thought;
    return out;
}

// THE choke-point read for templates. Mirrors getSentences: ALWAYS ANDs (t.public=1 OR
// t.created_by=:viewer); `viewer` null → public rows only (fail-closed). Optional `source` narrows
// to one surface ('selftalk'); omitted = all visible templates. Ordered by id (seed/insert order).
export function getTemplates(opts: { source?: string | null; viewer?: number | null }): AssembledTemplate[] {
    const viewer = opts.viewer ?? null;
    const source = opts.source ?? null;
    const rows = getDb()
        .query(
            `SELECT ${TEMPLATE_ROW_COLS} FROM sentence_template t
             WHERE (? IS NULL OR t.source = ?) AND ${TEMPLATE_VIEWER_VISIBLE}
             ORDER BY t.id`,
        )
        .all(source, source, viewer) as TemplateRow[];
    return rows.map(assembleTemplateRow);
}

// One template by ext_id THROUGH the same gate (public OR created_by=viewer; null viewer → public
// only). Returns null when it doesn't exist OR isn't visible to the viewer — the two are
// indistinguishable, so no private template's existence leaks. The realize route uses this to 404 an
// invisible/unknown template AND to read its curated grammar server-side (never trusting the client
// for the grammar that lands on a public row).
export function getTemplate(opts: { extId: string; viewer?: number | null }): AssembledTemplate | null {
    const viewer = opts.viewer ?? null;
    const row = getDb()
        .query(`SELECT ${TEMPLATE_ROW_COLS} FROM sentence_template t WHERE t.ext_id = ? AND ${TEMPLATE_VIEWER_VISIBLE}`)
        .get(opts.extId, viewer) as TemplateRow | null;
    return row ? assembleTemplateRow(row) : null;
}

// Seed/refresh a PUBLIC curator template (public=1, visibility='public', created_by=NULL).
// Idempotent by ext_id: re-running overwrites the row in place, so the seed script is a safe
// no-growth no-op on re-run (created_at preserved). The template analogue of upsertPublicSentence.
export function upsertPublicTemplate(input: {
    extId: string;
    source: string;
    topic?: string | null;
    thought?: string | null;
    grammar?: string[];
    en: string;
    jp: string;
    slots: TemplateSlot[];
}): AssembledTemplate {
    const now = Date.now();
    const r = getDb()
        .query(
            `INSERT INTO sentence_template (ext_id, source, topic, thought, grammar, en, jp, slots, public, visibility, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'public', NULL, ?)
             ON CONFLICT(ext_id) DO UPDATE SET
                 source = excluded.source, topic = excluded.topic, thought = excluded.thought,
                 grammar = excluded.grammar, en = excluded.en, jp = excluded.jp, slots = excluded.slots,
                 public = 1, visibility = 'public', created_by = NULL
             RETURNING id`,
        )
        .get(
            input.extId,
            input.source,
            input.topic ?? null,
            input.thought ?? null,
            JSON.stringify(input.grammar ?? []),
            input.en,
            input.jp,
            JSON.stringify(input.slots ?? []),
            now,
        ) as { id: number };
    return assembleTemplateRow(getTemplateRowById(r.id)!);
}

// Materialize ONE template realization (a filler combo) into a PUBLIC `sentence` row so the store
// tooling (de-dup / export / offline NLP / TTS / grammar search) covers the combos people actually
// use. Slice 2 — lazily called from the realize route on first ▶ play / record of a combo. The route
// reconstructs `text`/`furigana`/`translations` from the stored skeleton + the client's picks
// (decision #1: server-authoritative), computes the canonical `role`, and reads `grammar` off the
// stored template (decision #4: never client-trusted) — this fn is the DB half only.
//
// The row is upserted reuse-by-hash via upsertPublicSentenceByHash (source='template', decision #6;
// identity-by-hash so two combos with identical text reuse ONE row). Grammar is copied (setGrammarTags)
// ONLY onto rows we `owned` (created here / our own source='template') — never a foreign reused
// 'example'/'selftalk' row. The template link (owner_type='template', owner_id=<template ext_id>, role)
// is attached idempotently: re-materializing the same combo → same hash → same row → same (owner_id,
// role) → no new link. Returns the assembled sentence carrying the TEMPLATE link (the override), not
// whatever link the shared row happens to list first.
export function materializeTemplateRealization(input: {
    templateExtId: string;
    role: string;
    text: string;
    furigana?: FuriganaSeg[] | null;
    translations?: Record<string, string>;
    grammar?: string[];
}): AssembledSentence {
    const { id, owned } = upsertPublicSentenceByHash({
        source: 'template',
        extIdPrefix: 'tpl',
        text: input.text,
        furigana: input.furigana ?? null,
        translations: input.translations,
    });
    const db = getDb();

    // Copy the template's curated grammar onto rows we own only (decision #4) — never overwrite a
    // foreign reused row's tags. The offline NLP grammar detector skips source!='example' rows
    // (seed-annotations.ts), so this curated grammar survives later re-parses.
    if (owned && input.grammar) setGrammarTags(id, input.grammar);

    // Attach the template link idempotently (one per (sentence, owner_id, role)). No UNIQUE on the
    // link table, so check-then-insert: a re-materialized combo must not stack duplicate links.
    const link: SentenceLink = { owner_type: 'template', owner_id: input.templateExtId, role: input.role };
    const exists = db
        .query(
            "SELECT 1 FROM sentence_link WHERE sentence_id = ? AND owner_type = 'template' AND owner_id = ? AND role = ? LIMIT 1",
        )
        .get(id, input.templateExtId, input.role);
    if (!exists) insertSentenceChildren(id, undefined, undefined, link);

    return assembleSentenceRow(getSentenceRowById(id)!, link);
}
