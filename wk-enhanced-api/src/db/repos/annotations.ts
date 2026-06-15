// sentence_annotation (NLP enrichment, Phase 4) + grammar tags.
//
// GiNZA-derived structure layered onto the PUBLIC corpus by an OFFLINE batch (../sentence-nlp/)
// + the seed-annotations.ts deploy step — the server only ever READS this. One row per sentence,
// 1:1 by sentence_id. The annotation TYPES live in sentenceCore.ts (they're part of the assembled
// sentence shape); this module owns the read/write logic + the offset-integrity gate. See
// SENTENCE_STORE_NLP.md.

import { getDb } from '../connection.ts';
import { getSentenceRowById, VIEWER_VISIBLE } from './sentenceCore.ts';
import type { AnnotationBunsetsu, AnnotationToken, SentenceAnnotation } from './sentenceCore.ts';

// THE offset-integrity gate. Every token's [start,end) MUST reconstruct its surface under JS
// string slicing — this is the contract the tap-to-lookup UI relies on, and the parser already
// guarantees it (emitting UTF-16 offsets + self-checking). Re-asserting here against the real V8
// engine means a malformed artifact can NEVER land in the DB: a bad offset throws on write.
function assertAnnotationOffsets(tokens: AnnotationToken[], text: string): void {
    for (const t of tokens) {
        const slice = text.slice(t.start, t.end);
        if (slice !== t.surface) {
            throw new Error(
                `annotation offset mismatch: text.slice(${t.start},${t.end})=${JSON.stringify(slice)} !== surface ${JSON.stringify(t.surface)} (i=${t.i})`,
            );
        }
    }
}

// Upsert a sentence's annotation (seed-side; idempotent by sentence_id). Validates token offsets
// against the sentence's stored text BEFORE writing — throws on any mismatch (the offset gate).
// `sentenceId` is the internal numeric id; the seed resolves it from the artifact's content hash
// via getPublicSentenceByHash. No privacy gate on the WRITE — the gate is on the READ (the offline
// batch only ever annotates public rows anyway).
export function upsertAnnotation(input: {
    sentenceId: number;
    tokens: AnnotationToken[];
    bunsetsu: AnnotationBunsetsu[];
    parser: string;
}): void {
    const row = getSentenceRowById(input.sentenceId);
    if (!row) throw new Error(`upsertAnnotation: no sentence with id=${input.sentenceId}`);
    assertAnnotationOffsets(input.tokens, row.text);
    const now = Date.now();
    getDb()
        .query(
            `INSERT INTO sentence_annotation (sentence_id, tokens, bunsetsu, parser, parsed_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(sentence_id) DO UPDATE SET
                 tokens = excluded.tokens, bunsetsu = excluded.bunsetsu,
                 parser = excluded.parser, parsed_at = excluded.parsed_at`,
        )
        .run(input.sentenceId, JSON.stringify(input.tokens), JSON.stringify(input.bunsetsu), input.parser, now);
}

// Read one sentence's annotation BY ext_id, THROUGH the privacy gate: shares the exact
// VIEWER_VISIBLE predicate with getSentences, so a private sentence's annotation is returned only
// to its owner and never to anon (null viewer → public only). Returns null when the sentence isn't
// visible to the viewer OR has no annotation yet — the two are indistinguishable to the caller, so
// no existence is leaked. Pinned by a breach-prevention test.
export function getAnnotation(opts: { extId: string; viewer?: number | null }): SentenceAnnotation | null {
    const viewer = opts.viewer ?? null;
    const row = getDb()
        .query(
            `SELECT a.tokens, a.bunsetsu, a.parser, a.parsed_at
             FROM sentence s JOIN sentence_annotation a ON a.sentence_id = s.id
             WHERE s.ext_id = ? AND ${VIEWER_VISIBLE}`,
        )
        .get(opts.extId, viewer) as { tokens: string; bunsetsu: string; parser: string; parsed_at: number } | null;
    if (!row) return null;
    return {
        tokens: JSON.parse(row.tokens) as AnnotationToken[],
        bunsetsu: JSON.parse(row.bunsetsu) as AnnotationBunsetsu[],
        parser: row.parser,
        parsedAt: row.parsed_at,
    };
}

// Replace a sentence's grammar tags (sentence_tag kind='grammar') wholesale — the NLP grammar
// substrate. Touches ONLY kind='grammar', so scene/topic tags on the same sentence are preserved;
// idempotent (delete-then-insert). Populated by seed-annotations.ts from the offline parse's
// detected grammar ids (e.g. 'te-oku', 'passive') — the same id vocabulary the hand-authored
// Self-Talk tags use, so auto-detected + curated grammar search through one set. Also called by
// templates.materializeTemplateRealization to copy a template's curated grammar onto its row.
export function setGrammarTags(sentenceId: number, values: string[]): void {
    const db = getDb();
    db.query("DELETE FROM sentence_tag WHERE sentence_id = ? AND kind = 'grammar'").run(sentenceId);
    if (!values.length) return;
    const ins = db.query("INSERT OR IGNORE INTO sentence_tag (sentence_id, kind, value) VALUES (?, 'grammar', ?)");
    for (const v of values) ins.run(sentenceId, v);
}
