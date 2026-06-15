// Songs (歌 / Songs tab) — the `song` metadata entity + its lyric lines.
//
// A song's METADATA (title/artist/youtube) lives in the `song` table (like sentence_template,
// it's not a sentence). Each lyric LINE is a row in the unified sentence store, linked via
// sentence_link(owner_type='song', owner_id=<song ext_id>, ordinal=<line index>,
// clip_start_ms=<per-line timing>). So song lines REUSE the existing furigana / tap-a-word
// (sentence_annotation) / grammar (sentence_tag) / translation machinery, and reads reuse the
// getSentences privacy gate verbatim (ownerType='song'). Per-line tap tokens are LLM-sourced
// (parser='llm:*') — songs are the first RUNTIME writer of sentence_annotation; the UTF-16 offset
// gate in upsertAnnotation still guards every offset.
//
// Privacy mirrors the sentence store: BYO songs are PRIVATE (public=0, created_by=<user>); a
// curated starter set is PUBLIC (public=1, created_by=NULL, anon-readable). getSongs/getSong always
// AND (public=1 OR created_by=:viewer), fail-closed (null viewer → public only). See schema.sql +
// ../../../study-app/SONGS.md.

import { getDb } from '../connection.ts';
import { ttsTextHash } from '../../services/tts.ts';
import { assertFuriganaMatches, insertSentenceChildren, upsertPublicSentenceByHash } from './sentenceCore.ts';
import { getSentences } from './sentences.ts';
import { upsertAnnotation } from './annotations.ts';
import type { AnnotationToken, AssembledSentence, FuriganaSeg } from './sentenceCore.ts';

// UD coarse POS tags that count as a "content word" for the Mine vocab panel + coverage — the rest
// (particles, auxiliaries, punctuation, symbols) aren't studiable vocabulary.
const CONTENT_POS = new Set(['NOUN', 'PROPN', 'VERB', 'ADJ', 'ADV']);

// One lyric line as written by the analyzer (or the seed): plainText + structured furigana, an
// English line, per-line grammar tags (catalog ids), LLM tokens (UTF-16 offsets, may carry
// jlpt/gloss), and an optional per-line clip start (tap-to-sync timing).
export interface SongLineInput {
    text: string;
    furigana?: FuriganaSeg[] | null;
    en?: string | null;
    grammar?: string[];
    tokens?: AnnotationToken[] | null;
    clipStartMs?: number | null;
}

export interface SongWord {
    lemma: string;
    jlpt: string | null;
}

export interface SongMeta {
    id: string; // ext_id
    title: string;
    artist: string | null;
    youtubeId: string | null;
    source: string;
    custom: boolean; // created_by != null → user-authored (private), drives the MINE vs STARTER badge
    lineCount: number;
    timedCount: number; // lines with a clip_start_ms (the "synced · N lines" / "not timed yet" badge)
}

// The library list adds a compact distinct content-word list per song (for the coverage % + the
// JLPT difficulty badge the library card shows before a song is opened).
export interface SongListItem extends SongMeta {
    words: SongWord[];
}

export interface AssembledSong extends SongMeta {
    lines: AssembledSentence[]; // ordered by link.ordinal; each carries furigana/en/grammar/tokens/clip
}

type SongRow = {
    id: number;
    ext_id: string;
    title: string;
    artist: string | null;
    youtube_id: string | null;
    source: string;
    public: number;
    visibility: string;
    created_by: number | null;
    created_at: number;
};

function songMetaFrom(row: SongRow, lineCount: number, timedCount: number): SongMeta {
    return {
        id: row.ext_id,
        title: row.title,
        artist: row.artist,
        youtubeId: row.youtube_id,
        source: row.source,
        custom: row.created_by != null,
        lineCount,
        timedCount,
    };
}

// The assembled-lines caller (getSong) derives the counts from the lines it already holds.
function songMeta(row: SongRow, lines: AssembledSentence[]): SongMeta {
    return songMetaFrom(row, lines.length, lines.filter((l) => l.link.clip_start_ms != null).length);
}

// Pre-validate every line's token offsets against its own text BEFORE any mutation, mirroring the
// furigana pre-check — so a bad LLM offset aborts the whole create/upsert cleanly instead of leaving
// a partial song (the song row written, then the line insert throwing). upsertAnnotation re-asserts
// this per-row on write too; this is the no-partial-write guard.
function assertTokenOffsets(lines: SongLineInput[]): void {
    for (const ln of lines) {
        for (const t of ln.tokens ?? []) {
            if (ln.text.slice(t.start, t.end) !== t.surface) {
                throw new Error(
                    `token offset mismatch in ${JSON.stringify(ln.text)}: slice(${t.start},${t.end})=${JSON.stringify(ln.text.slice(t.start, t.end))} !== surface ${JSON.stringify(t.surface)}`,
                );
            }
        }
    }
}

// Fold one line's content-word {lemma, jlpt} into `seen` (for the library coverage % + Mine vocab).
// Particles/auxiliaries/punctuation aren't studiable vocabulary. Mutates `seen` so a song's lines
// accumulate into one deduped set (a chorus word counted once). Operates on a raw token list so the
// library aggregate can feed it straight from the annotation blob — no full sentence assembly.
function collectContentWords(seen: Map<string, SongWord>, tokens: AnnotationToken[]): void {
    for (const t of tokens) {
        if (!CONTENT_POS.has(t.pos)) continue;
        const lemma = t.lemma || t.surface;
        if (!lemma || seen.has(lemma)) continue;
        seen.set(lemma, { lemma, jlpt: t.jlpt ?? null });
    }
}

// Insert one lyric line (sentence row + translation + grammar tags + the song link + LLM tokens).
// PRIVATE songs get a distinct row per line (ext_id `<songExtId>-L<ord>`; no hash-uniqueness on
// private rows, so a repeated chorus line is fine). PUBLIC (starter) songs REUSE-BY-HASH — a
// repeated line collapses to ONE public row carrying multiple song links (one per ordinal); grammar
// + tokens are written only on our OWN ('song'-source / freshly-created) row so a shared foreign row
// (e.g. a built-in example with identical text + its GiNZA annotation) is never clobbered.
function insertSongLine(
    songExtId: string,
    createdBy: number | null,
    isPublic: boolean,
    ordinal: number,
    line: SongLineInput,
    parser: string,
): void {
    assertFuriganaMatches(line.furigana ?? null, line.text);
    const db = getDb();
    const link = { owner_type: 'song', owner_id: songExtId, ordinal, clip_start_ms: line.clipStartMs ?? null };
    const grammar = line.grammar?.length ? { grammar: line.grammar } : undefined;
    const en = line.en ? { en: line.en } : undefined;

    if (isPublic) {
        const { id, owned } = upsertPublicSentenceByHash({
            source: 'song',
            extIdPrefix: 'song',
            text: line.text,
            furigana: line.furigana ?? null,
            translations: en,
        });
        // The song LINK always; grammar + tokens only on our own row (never a foreign reused one).
        insertSentenceChildren(id, undefined, owned ? grammar : undefined, link);
        if (owned && line.tokens?.length) upsertAnnotation({ sentenceId: id, tokens: line.tokens, bunsetsu: [], parser });
        return;
    }

    const r = db
        .query(
            `INSERT INTO sentence (ext_id, hash, text, furigana, lang, source, public, visibility, created_by, created_at)
             VALUES (?, ?, ?, ?, 'ja', 'song', 0, 'private', ?, ?) RETURNING id`,
        )
        .get(
            `${songExtId}-L${ordinal}`,
            ttsTextHash(line.text),
            line.text,
            line.furigana ? JSON.stringify(line.furigana) : null,
            createdBy,
            Date.now(),
        ) as { id: number };
    insertSentenceChildren(r.id, en, grammar, link);
    if (line.tokens?.length) upsertAnnotation({ sentenceId: r.id, tokens: line.tokens, bunsetsu: [], parser });
}

// Count a user's own songs — backs the per-user authoring cap in the route.
export function countUserSongs(viewer: number): number {
    const row = getDb().query('SELECT COUNT(*) AS n FROM song WHERE created_by = ?').get(viewer) as { n: number };
    return row.n;
}

// Library list: public starters + the caller's own private songs (privacy-gated), newest first,
// each with its line/timed counts + the distinct content-word list (coverage + difficulty).
//
// TWO gated queries total — NOT a per-song full assembly. The old path called getSentences per song
// (a translation + tag sub-query PER LINE, plus furigana/token JSON.parse) just to derive counts +
// words: ~O(total lines) round-trips on every library load, and the route is no-store. Instead we
// pull every visible song line ONCE — only its clip flag + token blob — and fold it into per-song
// aggregates. The line gate mirrors the song gate (a song's lines share its visibility), so this
// returns exactly the lines of the songs selected above; the LEFT JOIN keeps unannotated lines.
export function getSongs(opts: { viewer?: number | null }): SongListItem[] {
    const viewer = opts.viewer ?? null;
    const db = getDb();
    const rows = db
        .query('SELECT * FROM song WHERE public = 1 OR created_by = ? ORDER BY created_at DESC')
        .all(viewer) as SongRow[];
    if (!rows.length) return [];

    const lineRows = db
        .query(
            `SELECT l.owner_id AS song, l.clip_start_ms AS clip, a.tokens AS tokens
               FROM sentence_link l
               JOIN sentence s ON s.id = l.sentence_id
               LEFT JOIN sentence_annotation a ON a.sentence_id = s.id
              WHERE l.owner_type = 'song' AND (s.public = 1 OR s.created_by = ?)`,
        )
        .all(viewer) as { song: string | null; clip: number | null; tokens: string | null }[];

    type Agg = { lineCount: number; timedCount: number; words: Map<string, SongWord> };
    const bySong = new Map<string, Agg>();
    for (const r of lineRows) {
        if (r.song == null) continue;
        let agg = bySong.get(r.song);
        if (!agg) bySong.set(r.song, (agg = { lineCount: 0, timedCount: 0, words: new Map() }));
        agg.lineCount++;
        if (r.clip != null) agg.timedCount++;
        if (r.tokens) collectContentWords(agg.words, JSON.parse(r.tokens) as AnnotationToken[]);
    }

    return rows.map((row) => {
        const agg = bySong.get(row.ext_id);
        return { ...songMetaFrom(row, agg?.lineCount ?? 0, agg?.timedCount ?? 0), words: agg ? [...agg.words.values()] : [] };
    });
}

// One song: metadata + its ordered lines (furigana/en/grammar/tokens/clip), through the gate.
export function getSong(opts: { extId: string; viewer?: number | null }): AssembledSong | null {
    const viewer = opts.viewer ?? null;
    const row = getDb()
        .query('SELECT * FROM song WHERE ext_id = ? AND (public = 1 OR created_by = ?)')
        .get(opts.extId, viewer) as SongRow | null;
    if (!row) return null;
    const lines = getSentences({ ownerType: 'song', ownerId: opts.extId, viewer, includeAnnotations: true }).sort(
        (a, b) => (a.link.ordinal ?? 0) - (b.link.ordinal ?? 0),
    );
    return { ...songMeta(row, lines), lines };
}

// Create a PRIVATE user song from a reviewed analysis. All furigana invariants are checked BEFORE
// any mutation, so a bad line aborts the whole create. `parser` is the annotation provenance
// (e.g. 'llm:claude-…'). The route guards idempotency (re-POST of an owned ext_id → existing song).
export function createSong(input: {
    extId: string;
    title: string;
    artist?: string | null;
    youtubeId?: string | null;
    createdBy: number;
    lines: SongLineInput[];
    parser?: string;
}): AssembledSong {
    for (const ln of input.lines) assertFuriganaMatches(ln.furigana ?? null, ln.text);
    assertTokenOffsets(input.lines);
    const db = getDb();
    db.query(
        `INSERT INTO song (ext_id, title, artist, youtube_id, source, public, visibility, created_by, created_at)
         VALUES (?, ?, ?, ?, 'song', 0, 'private', ?, ?)`,
    ).run(input.extId, input.title, input.artist ?? null, input.youtubeId ?? null, input.createdBy, Date.now());
    input.lines.forEach((ln, i) => insertSongLine(input.extId, input.createdBy, false, i, ln, input.parser ?? 'llm'));
    return getSong({ extId: input.extId, viewer: input.createdBy })!;
}

// Edit a song's metadata (title/artist/youtube). Owner-scoped in SQL → null if not the caller's.
export function updateSong(input: {
    extId: string;
    viewer: number;
    title: string;
    artist?: string | null;
    youtubeId?: string | null;
}): AssembledSong | null {
    const db = getDb();
    const row = db.query('SELECT id FROM song WHERE ext_id = ? AND created_by = ?').get(input.extId, input.viewer) as
        | { id: number }
        | null;
    if (!row) return null;
    db.query('UPDATE song SET title = ?, artist = ?, youtube_id = ? WHERE id = ?').run(
        input.title,
        input.artist ?? null,
        input.youtubeId ?? null,
        row.id,
    );
    return getSong({ extId: input.extId, viewer: input.viewer });
}

// Save per-line clip starts from the tap-to-sync pass (owner-scoped). Each entry sets one line's
// clip_start_ms by ordinal; the end is inferred from the next line's start at render time.
export function updateSongTiming(input: {
    extId: string;
    viewer: number;
    timings: Array<{ ordinal: number; clipStartMs: number | null }>;
}): AssembledSong | null {
    const db = getDb();
    const owns = db.query('SELECT 1 FROM song WHERE ext_id = ? AND created_by = ?').get(input.extId, input.viewer);
    if (!owns) return null;
    const upd = db.query(
        "UPDATE sentence_link SET clip_start_ms = ? WHERE owner_type = 'song' AND owner_id = ? AND ordinal = ?",
    );
    for (const t of input.timings) upd.run(t.clipStartMs, input.extId, t.ordinal);
    return getSong({ extId: input.extId, viewer: input.viewer });
}

// Delete a user's own song + its private line rows (children cascade via FK). Owner-scoped no-op
// returning false for a non-owner / unknown id.
export function deleteSong(input: { extId: string; viewer: number }): boolean {
    const db = getDb();
    const row = db.query('SELECT id FROM song WHERE ext_id = ? AND created_by = ?').get(input.extId, input.viewer) as
        | { id: number }
        | null;
    if (!row) return false;
    db.query(
        `DELETE FROM sentence WHERE id IN (
             SELECT s.id FROM sentence s JOIN sentence_link l ON l.sentence_id = s.id
             WHERE l.owner_type = 'song' AND l.owner_id = ? AND s.created_by = ?
         )`,
    ).run(input.extId, input.viewer); // children cascade
    db.query('DELETE FROM song WHERE id = ?').run(row.id);
    return true;
}

// Seed/refresh a PUBLIC starter song (public=1, created_by=NULL, anon-readable) — the curator path
// for the CC / public-domain starter set. Idempotent by song ext_id: re-running clears the song's
// existing line links and re-attaches them (lines reuse-by-hash, so a re-seed doesn't grow rows).
// NOTE: a re-seed with CHANGED lyrics can orphan the old public sentence rows (no link) — acceptable
// for the small curated set; the deferred curation pass can prune if it ever matters.
export function upsertPublicSong(input: {
    extId: string;
    title: string;
    artist?: string | null;
    youtubeId?: string | null;
    lines: SongLineInput[];
    parser?: string;
}): AssembledSong {
    for (const ln of input.lines) assertFuriganaMatches(ln.furigana ?? null, ln.text);
    assertTokenOffsets(input.lines);
    const db = getDb();
    db.query(
        `INSERT INTO song (ext_id, title, artist, youtube_id, source, public, visibility, created_by, created_at)
         VALUES (?, ?, ?, ?, 'song', 1, 'public', NULL, ?)
         ON CONFLICT(ext_id) DO UPDATE SET
             title = excluded.title, artist = excluded.artist, youtube_id = excluded.youtube_id,
             public = 1, visibility = 'public', created_by = NULL`,
    ).run(input.extId, input.title, input.artist ?? null, input.youtubeId ?? null, Date.now());
    db.query("DELETE FROM sentence_link WHERE owner_type = 'song' AND owner_id = ?").run(input.extId);
    input.lines.forEach((ln, i) => insertSongLine(input.extId, null, true, i, ln, input.parser ?? 'llm'));
    return getSong({ extId: input.extId, viewer: null })!;
}
