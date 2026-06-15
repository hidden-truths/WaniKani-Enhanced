// SQLite client + repository methods. Using bun:sqlite — synchronous,
// zero-install, plenty fast for our scale (bounded ~6500 rows).
//
// If we ever outgrow SQLite, swap to Postgres by replacing the implementation
// inside the repo functions. Callers don't see SQL.

import { Database } from 'bun:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.ts';
import { log } from '../lib/log.ts';
import { ttsTextHash } from '../services/tts.ts';
import type { IkIndexMetaEntry } from '../services/ik.ts';

let _db: Database | null = null;

// Open a fresh DB at the given path and apply the schema. Used by getDb()
// for the singleton and by tests that want an isolated in-memory DB.
// Pass ':memory:' for a transient DB that lives only as long as the
// returned Database instance.
export function openDb(file: string): Database {
    if (file !== ':memory:') {
        mkdirSync(dirname(resolve(file)), { recursive: true });
    }
    const db = new Database(file === ':memory:' ? ':memory:' : resolve(file), { create: true });
    // WAL gives us concurrent readers while the warmer holds a writer lock;
    // useful for serving /v1/vocab/:word while a warm run is in flight.
    // Skip WAL on :memory: where it isn't applicable.
    if (file !== ':memory:') {
        db.exec('PRAGMA journal_mode = WAL');
    }
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    db.exec(schema);
    return db;
}

export function getDb(): Database {
    if (_db) return _db;
    _db = openDb(config.databaseFile);
    log.info('db.ready', { file: config.databaseFile });
    return _db;
}

// Test-only: replace the singleton DB. Lets tests work against an in-memory
// DB without touching the dev-data sqlite file. Pass null to clear so the
// next getDb() call falls back to the configured file.
export function _useDbForTesting(db: Database | null): void {
    _db = db;
}

// ---------- vocab_examples ----------

export interface VocabRow {
    word: string;
    payload: any;
    exampleCount: number;
    fetchedAt: number;
    lastServedAt: number | null;
    serveCount: number;
}

export function getVocab(word: string): VocabRow | null {
    const row = getDb()
        .query('SELECT word, payload, example_count, fetched_at, last_served_at, serve_count FROM vocab_examples WHERE word = ?')
        .get(word) as
        | { word: string; payload: string; example_count: number; fetched_at: number; last_served_at: number | null; serve_count: number }
        | null;
    if (!row) return null;
    return {
        word: row.word,
        payload: JSON.parse(row.payload),
        exampleCount: row.example_count,
        fetchedAt: row.fetched_at,
        lastServedAt: row.last_served_at,
        serveCount: row.serve_count,
    };
}

export function upsertVocab(word: string, payload: any, exampleCount: number): void {
    const now = Date.now();
    getDb()
        .query(
            `INSERT INTO vocab_examples (word, payload, example_count, fetched_at, serve_count)
             VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(word) DO UPDATE SET
                 payload = excluded.payload,
                 example_count = excluded.example_count,
                 fetched_at = excluded.fetched_at`,
        )
        .run(word, JSON.stringify(payload), exampleCount, now);
}

export function recordVocabServe(word: string): void {
    const now = Date.now();
    getDb()
        .query(
            `UPDATE vocab_examples
             SET last_served_at = ?, serve_count = serve_count + 1
             WHERE word = ?`,
        )
        .run(now, word);
}

export function countVocabRows(): number {
    const row = getDb().query('SELECT COUNT(*) AS n FROM vocab_examples').get() as { n: number };
    return row.n;
}

// ---------- index_meta ----------

export interface IndexMetaRow {
    decks: Record<string, IkIndexMetaEntry>;
    fetchedAt: number;
}

export function getIndexMeta(): IndexMetaRow | null {
    const row = getDb()
        .query('SELECT decks, fetched_at FROM index_meta WHERE id = 1')
        .get() as { decks: string; fetched_at: number } | null;
    if (!row) return null;
    return { decks: JSON.parse(row.decks), fetchedAt: row.fetched_at };
}

export function upsertIndexMeta(decks: Record<string, IkIndexMetaEntry>): void {
    const now = Date.now();
    getDb()
        .query(
            `INSERT INTO index_meta (id, decks, fetched_at) VALUES (1, ?, ?)
             ON CONFLICT(id) DO UPDATE SET decks = excluded.decks, fetched_at = excluded.fetched_at`,
        )
        .run(JSON.stringify(decks), now);
}

// ---------- warm_jobs ----------

export interface WarmJob {
    id: number;
    // Narrowed to the two values we ever insert via createWarmJob. Lets
    // downstream consumers (the API response schema) discriminate without
    // runtime casts.
    scope: 'word' | 'all';
    target: string | null;
    startedAt: number;
    finishedAt: number | null;
    wordsProcessed: number;
    wordsFailed: number;
    error: string | null;
}

export function createWarmJob(scope: 'all' | 'word', target: string | null): number {
    const now = Date.now();
    const r = getDb()
        .query('INSERT INTO warm_jobs (scope, target, started_at) VALUES (?, ?, ?) RETURNING id')
        .get(scope, target, now) as { id: number };
    return r.id;
}

export function finishWarmJob(id: number, processed: number, failed: number, error: string | null): void {
    const now = Date.now();
    getDb()
        .query(
            'UPDATE warm_jobs SET finished_at = ?, words_processed = ?, words_failed = ?, error = ? WHERE id = ?',
        )
        .run(now, processed, failed, error, id);
}

type WarmJobRow = {
    id: number;
    scope: string;
    target: string | null;
    started_at: number;
    finished_at: number | null;
    words_processed: number;
    words_failed: number;
    error: string | null;
};

function rowToJob(row: WarmJobRow): WarmJob {
    return {
        id: row.id,
        // The DB column is TEXT for forward compatibility; createWarmJob only
        // ever writes 'word' or 'all', so the cast is safe.
        scope: row.scope as 'word' | 'all',
        target: row.target,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        wordsProcessed: row.words_processed,
        wordsFailed: row.words_failed,
        error: row.error,
    };
}

export function getLastWarmJob(): WarmJob | null {
    const row = getDb()
        .query(
            `SELECT id, scope, target, started_at, finished_at, words_processed, words_failed, error
             FROM warm_jobs ORDER BY id DESC LIMIT 1`,
        )
        .get() as WarmJobRow | null;
    return row ? rowToJob(row) : null;
}

// Recent jobs, newest first. `limit` is clamped to [1, 100] by callers; we
// trust the input here since it's not directly user-controlled.
export function listWarmJobs(limit: number): WarmJob[] {
    const rows = getDb()
        .query(
            `SELECT id, scope, target, started_at, finished_at, words_processed, words_failed, error
             FROM warm_jobs ORDER BY id DESC LIMIT ?`,
        )
        .all(limit) as WarmJobRow[];
    return rows.map(rowToJob);
}

// ---------- users ----------

export interface UserRow {
    id: number;
    email: string;
    passwordHash: string;
    createdAt: number;
}

// Public-facing user shape (never leaks the password hash to a response).
export interface PublicUser {
    id: number;
    email: string;
    createdAt: number;
}

// Thrown by createUser when the email is already registered. Callers map this
// to a 409 conflict. We detect the UNIQUE-constraint failure rather than doing
// a pre-check SELECT so the uniqueness check stays atomic with the insert.
export class EmailTakenError extends Error {
    constructor() {
        super('email already registered');
        this.name = 'EmailTakenError';
    }
}

export function createUser(email: string, passwordHash: string): PublicUser {
    const now = Date.now();
    try {
        const r = getDb()
            .query('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?) RETURNING id')
            .get(email, passwordHash, now) as { id: number };
        return { id: r.id, email, createdAt: now };
    } catch (err) {
        // bun:sqlite surfaces UNIQUE violations as an error whose message
        // contains "UNIQUE constraint failed". Narrow to email-taken; rethrow
        // anything else (disk full, etc.).
        if (err instanceof Error && /UNIQUE constraint failed: users\.email/i.test(err.message)) {
            throw new EmailTakenError();
        }
        throw err;
    }
}

export function getUserByEmail(email: string): UserRow | null {
    const row = getDb()
        .query('SELECT id, email, password_hash, created_at FROM users WHERE email = ?')
        .get(email) as { id: number; email: string; password_hash: string; created_at: number } | null;
    if (!row) return null;
    return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
}

export function getUserById(id: number): PublicUser | null {
    const row = getDb()
        .query('SELECT id, email, created_at FROM users WHERE id = ?')
        .get(id) as { id: number; email: string; created_at: number } | null;
    if (!row) return null;
    return { id: row.id, email: row.email, createdAt: row.created_at };
}

// ---------- sessions ----------

export function createSession(token: string, userId: number, expiresAt: number): void {
    const now = Date.now();
    getDb()
        .query('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(token, userId, now, expiresAt);
}

// Resolve a session token to its user, enforcing expiry. Expired (or missing)
// tokens return null; an expired token is also deleted as lazy housekeeping so
// the table doesn't accumulate dead rows between the periodic sweep.
export function getValidSession(token: string): PublicUser | null {
    const row = getDb()
        .query(
            `SELECT s.expires_at AS expires_at, u.id AS id, u.email AS email, u.created_at AS created_at
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?`,
        )
        .get(token) as { expires_at: number; id: number; email: string; created_at: number } | null;
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
        deleteSession(token);
        return null;
    }
    return { id: row.id, email: row.email, createdAt: row.created_at };
}

export function deleteSession(token: string): void {
    getDb().query('DELETE FROM sessions WHERE token = ?').run(token);
}

// Housekeeping: drop all expired sessions. Called on a timer from index.ts.
// Returns the number of rows removed (for logging).
export function deleteExpiredSessions(): number {
    const r = getDb().query('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    return r.changes;
}

// ---------- user_progress ----------

export interface ProgressRow {
    data: any;
    updatedAt: number;
}

export function getProgress(userId: number, app: string): ProgressRow | null {
    const row = getDb()
        .query('SELECT data, updated_at FROM user_progress WHERE user_id = ? AND app = ?')
        .get(userId, app) as { data: string; updated_at: number } | null;
    if (!row) return null;
    return { data: JSON.parse(row.data), updatedAt: row.updated_at };
}

// Upsert the per-app progress blob. Returns the updated_at timestamp written.
export function upsertProgress(userId: number, app: string, data: any): number {
    const now = Date.now();
    getDb()
        .query(
            `INSERT INTO user_progress (user_id, app, data, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, app) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        )
        .run(userId, app, JSON.stringify(data), now);
    return now;
}

// ---------- study_sessions (append-only durable history) ----------

// Append one completed session. Returns the new row id. Never pruned — this is
// the record we keep even when the in-blob `store.sessions` is capped for charts.
export function insertSession(
    userId: number,
    endedAt: number,
    right: number,
    total: number,
    mode: string | null,
    details: unknown | null,
): number {
    const r = getDb()
        .query(
            `INSERT INTO study_sessions (user_id, ended_at, right_count, total_count, mode, details)
             VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, endedAt, right, total, mode, details == null ? null : JSON.stringify(details));
    return Number(r.lastInsertRowid);
}

// How many sessions this user has ever logged (lifetime count, uncapped).
export function countSessions(userId: number): number {
    const row = getDb()
        .query('SELECT COUNT(*) AS n FROM study_sessions WHERE user_id = ?')
        .get(userId) as { n: number };
    return row.n;
}

// ---------- minna_recordings (record-and-compare voice takes) ----------

export interface RecordingRow {
    id: number;
    userId: number;
    lesson: number;
    itemKey: string;
    storageKey: string;
    contentType: string;
    durationMs: number | null;
    createdAt: number;
}

type RawRecordingRow = {
    id: number;
    user_id: number;
    lesson: number;
    item_key: string;
    storage_key: string;
    content_type: string;
    duration_ms: number | null;
    created_at: number;
};

function rowToRecording(r: RawRecordingRow): RecordingRow {
    return {
        id: r.id,
        userId: r.user_id,
        lesson: r.lesson,
        itemKey: r.item_key,
        storageKey: r.storage_key,
        contentType: r.content_type,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
    };
}

const RECORDING_COLS =
    'id, user_id, lesson, item_key, storage_key, content_type, duration_ms, created_at';

// Append one voice take. Returns the new row id. The storage object is written
// separately by the route (its key is generated before insert, so no update dance).
export function insertRecording(
    userId: number,
    lesson: number,
    itemKey: string,
    storageKey: string,
    contentType: string,
    durationMs: number | null,
    createdAt: number,
): number {
    const r = getDb()
        .query(
            `INSERT INTO minna_recordings (user_id, lesson, item_key, storage_key, content_type, duration_ms, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, lesson, itemKey, storageKey, contentType, durationMs, createdAt);
    return Number(r.lastInsertRowid);
}

// All of a user's takes for one lesson, newest first. The client groups these by
// item_key to render per-word/per-line take lists.
export function listRecordings(userId: number, lesson: number): RecordingRow[] {
    const rows = getDb()
        .query(
            `SELECT ${RECORDING_COLS} FROM minna_recordings
             WHERE user_id = ? AND lesson = ? ORDER BY created_at DESC, id DESC`,
        )
        .all(userId, lesson) as RawRecordingRow[];
    return rows.map(rowToRecording);
}

// One take by id, scoped to the owner (so a guessed id from another account
// 404s rather than leaking). Used to serve bytes and to authorize delete.
export function getRecording(userId: number, id: number): RecordingRow | null {
    const row = getDb()
        .query(`SELECT ${RECORDING_COLS} FROM minna_recordings WHERE id = ? AND user_id = ?`)
        .get(id, userId) as RawRecordingRow | null;
    return row ? rowToRecording(row) : null;
}

// Delete one take (owner-scoped). Returns the deleted row so the caller can also
// drop its storage object; null if it didn't exist / wasn't the owner's.
export function deleteRecording(userId: number, id: number): RecordingRow | null {
    const row = getRecording(userId, id);
    if (!row) return null;
    getDb().query('DELETE FROM minna_recordings WHERE id = ? AND user_id = ?').run(id, userId);
    return row;
}

// Prune a (user, lesson, item_key) group down to the newest `keep` takes. Returns
// the deleted rows so the caller can drop their storage objects. `keep` is clamped
// to >= 1 here as a backstop; the route clamps to the [1, 20] policy range.
export function pruneRecordings(
    userId: number,
    lesson: number,
    itemKey: string,
    keep: number,
): RecordingRow[] {
    const k = Math.max(1, Math.floor(keep));
    const stale = getDb()
        .query(
            `SELECT ${RECORDING_COLS} FROM minna_recordings
             WHERE user_id = ? AND lesson = ? AND item_key = ?
             ORDER BY created_at DESC, id DESC
             LIMIT -1 OFFSET ?`,
        )
        .all(userId, lesson, itemKey, k) as RawRecordingRow[];
    if (!stale.length) return [];
    const del = getDb().query('DELETE FROM minna_recordings WHERE id = ?');
    for (const r of stale) del.run(r.id);
    return stale.map(rowToRecording);
}

// Per-lesson practice summary for a user: one row per lesson they've recorded in,
// with the distinct-item count, total take count, and the most-recent take's time.
// Powers the みんなの日本語 "Practice history" overview (a cross-lesson aggregate the
// per-lesson listRecordings can't give without fetching every lesson). Lessons with
// no takes are absent (so an empty result = the user has never recorded).
export interface RecordingLessonSummary {
    lesson: number;
    items: number; // distinct item_keys recorded in this lesson
    takes: number; // total takes in this lesson
    lastCreatedAt: number; // newest take's createdAt (epoch ms)
}

export function recordingSummary(userId: number): RecordingLessonSummary[] {
    return getDb()
        .query(
            `SELECT lesson,
                    COUNT(DISTINCT item_key) AS items,
                    COUNT(*)               AS takes,
                    MAX(created_at)        AS lastCreatedAt
             FROM minna_recordings
             WHERE user_id = ?
             GROUP BY lesson
             ORDER BY lesson ASC`,
        )
        .all(userId) as RecordingLessonSummary[];
}

// ---------- audio_variants (tagged voice-clip manifest) ----------

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

// ---------- sentence store (unified sentence entity; Phase 1: 独り言 Self-Talk) ----------
//
// One canonical row per sentence that surfaces REFERENCE by id. ALL reads go through
// getSentences (the privacy choke-point); anon/export touch the public_sentence VIEW.
// `text` is plainText(jp) byte-for-byte and `hash` is ttsTextHash(text) — computed HERE,
// never on the client — so the existing audio layer keeps resolving. `furigana` is
// structured [{t,r?}] with concat(t) === text (enforced on write). See schema.sql.

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

type SentenceRow = {
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

const SENTENCE_ROW_COLS =
    'id, ext_id, hash, text, furigana, lang, source, public, visibility, created_by, created_at';

// THE privacy gate, as one SQL fragment so every read shares the exact same predicate and they
// can't drift. Aliases the sentence table as `s` and binds ONE param: the viewer id (null →
// public only, since `s.created_by = NULL` is never true → fail-closed). getSentences AND
// getAnnotation both AND this in; the pinned breach tests cover both. Keep it unconditional.
const VIEWER_VISIBLE = '(s.public = 1 OR s.created_by = ?)';

// Throw unless the furigana segments reconstruct `text` exactly (concat(seg.t) === text).
// This is the structural-furigana invariant — a mismatch means the stored ruby would drift
// from the audio-keyed plain text. NULL furigana is allowed (no ruby).
function assertFuriganaMatches(furigana: FuriganaSeg[] | null, text: string): void {
    if (furigana == null) return;
    if (!Array.isArray(furigana)) throw new Error('furigana must be an array of {t,r?} segments');
    const concat = furigana.map((s) => (s && typeof s.t === 'string' ? s.t : '')).join('');
    if (concat !== text) {
        throw new Error(`furigana segments do not reconstruct text: ${JSON.stringify(concat)} !== ${JSON.stringify(text)}`);
    }
}

function getSentenceRowById(id: number): SentenceRow | null {
    return getDb()
        .query(`SELECT ${SENTENCE_ROW_COLS} FROM sentence WHERE id = ?`)
        .get(id) as SentenceRow | null;
}

// Trim a raw link row down to a compact object (omit NULL optional fields).
function compactLink(r: {
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
function assembleSentenceRow(row: SentenceRow, linkOverride?: SentenceLink): AssembledSentence {
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
function insertSentenceChildren(
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
    // user (pinned in client.test.ts). Off by default → existing callers' payloads are unchanged.
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
    const db = getDb();
    const now = Date.now();
    const r = db
        .query(
            `INSERT INTO sentence (ext_id, hash, text, furigana, lang, source, public, visibility, created_by, created_at)
             VALUES (?, ?, ?, ?, 'ja', ?, 0, 'private', ?, ?) RETURNING id`,
        )
        .get(
            input.extId,
            ttsTextHash(input.text),
            input.text,
            furigana ? JSON.stringify(furigana) : null,
            input.source,
            input.createdBy,
            now,
        ) as { id: number };
    insertSentenceChildren(r.id, input.translations, input.tags, input.link);
    return assembleSentenceRow(getSentenceRowById(r.id)!);
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
    const db = getDb();
    db.query(
        `DELETE FROM sentence WHERE id IN (
             SELECT s.id FROM sentence s JOIN sentence_link l ON l.sentence_id = s.id
             WHERE l.owner_type = 'card' AND l.owner_id = ? AND s.created_by = ?
         )`,
    ).run(input.rank, input.viewer); // children cascade via FK
    const now = Date.now();
    const ins = db.query(
        `INSERT INTO sentence (ext_id, hash, text, furigana, lang, source, public, visibility, created_by, created_at)
         VALUES (?, ?, ?, ?, 'ja', 'custom', 0, 'private', ?, ?) RETURNING id`,
    );
    const out: AssembledSentence[] = [];
    for (const ex of input.examples) {
        const tier = ex.slot === 'ex' ? null : ex.slot;
        const r = ins.get(
            `usr-${input.viewer}-cardex-${input.rank}-${ex.slot}`,
            ttsTextHash(ex.text),
            ex.text,
            ex.furigana ? JSON.stringify(ex.furigana) : null,
            input.viewer,
            now,
        ) as { id: number };
        insertSentenceChildren(r.id, ex.en ? { en: ex.en } : undefined, undefined, {
            owner_type: 'card',
            owner_id: input.rank,
            tier,
        });
        out.push(assembleSentenceRow(getSentenceRowById(r.id)!));
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
function upsertPublicSentenceByHash(input: {
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

// ---------- sentence_annotation (NLP enrichment, Phase 4) ----------
//
// GiNZA-derived structure layered onto the PUBLIC corpus by an OFFLINE batch (../sentence-nlp/)
// + the seed-annotations.ts deploy step — the server only ever READS this. One row per sentence,
// 1:1 by sentence_id. See SENTENCE_STORE_NLP.md.

// One morpheme. `start`/`end` are UTF-16 CODE-UNIT offsets into sentence.text (NOT codepoint —
// the client maps a tap by slicing `text` in JS, which is UTF-16-indexed; they diverge from
// codepoint offsets at non-BMP kanji). `lemma` (dictionary form) drives the card/Jisho link;
// `reading` is GiNZA's (the VISIBLE reading still comes from the stored furigana).
export interface AnnotationToken {
    i: number;
    start: number;
    end: number;
    surface: string;
    lemma: string;
    pos: string;
    tag: string;
    reading: string;
    dep: string;
    head: number;
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
// no existence is leaked. Pinned by a breach-prevention test in client.test.ts.
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
// Self-Talk tags use, so auto-detected + curated grammar search through one set.
export function setGrammarTags(sentenceId: number, values: string[]): void {
    const db = getDb();
    db.query("DELETE FROM sentence_tag WHERE sentence_id = ? AND kind = 'grammar'").run(sentenceId);
    if (!values.length) return;
    const ins = db.query("INSERT OR IGNORE INTO sentence_tag (sentence_id, kind, value) VALUES (?, 'grammar', ?)");
    for (const v of values) ins.run(sentenceId, v);
}

// ---------- sentence_template (slot-swap generators; 独り言 Self-Talk) ----------
//
// A template is a sentence GENERATOR (skeleton + slots + fillers), NOT a sentence row — see
// schema.sql. Curator rows are seeded from the study-app bundle (upsertPublicTemplate); user-
// authored templates + realization materialization arrive in a later slice. Reads go through
// getTemplates, which MIRRORS getSentences' privacy gate (public OR created_by=viewer), fail-
// closed. Pinned by a breach test in client.test.ts — keep it green. `grammar`/`slots` are stored
// as JSON the server treats as opaque (parsed only to re-emit the client-render shape).

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
