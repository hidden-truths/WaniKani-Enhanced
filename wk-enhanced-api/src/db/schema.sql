-- Schema for wk-enhanced-api. SQLite via bun:sqlite.
--
-- Vocab / warm tables (the original server job):
--   vocab_examples  — pre-warmed payload per word (one row per word)
--   index_meta      — singleton: cached IK encoded-title → {title, category} map
--   warm_jobs       — audit log for each warm pipeline run
--
-- Accounts / app-progress tables (added for the wkenhanced.dev study apps —
-- e.g. the Japanese verb trainer served at `/`):
--   users           — one row per account (email + Bun.password hash)
--   sessions        — opaque session tokens stored in an httpOnly cookie
--   user_progress   — per-user, per-app JSON progress blob (cloud-synced
--                     replacement for the study app's localStorage)

CREATE TABLE IF NOT EXISTS vocab_examples (
    word              TEXT PRIMARY KEY,        -- normalized (NFC) dictionary form
    payload           TEXT NOT NULL,           -- JSON: { examples: [...], fallbackImages: [...] }
    example_count     INTEGER NOT NULL,
    fetched_at        INTEGER NOT NULL,        -- epoch ms
    last_served_at    INTEGER,                 -- epoch ms; updated on each /v1/vocab/:word hit
    serve_count       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS vocab_examples_fetched_at_idx ON vocab_examples (fetched_at);

CREATE TABLE IF NOT EXISTS index_meta (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    decks             TEXT NOT NULL,           -- JSON: { <encoded>: { title, category }, ... }
    fetched_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS warm_jobs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    scope             TEXT NOT NULL,           -- 'all' | 'word'
    target            TEXT,                    -- word string when scope='word'
    started_at        INTEGER NOT NULL,
    finished_at       INTEGER,
    words_processed   INTEGER NOT NULL DEFAULT 0,
    words_failed      INTEGER NOT NULL DEFAULT 0,
    error             TEXT
);

-- ---------- Accounts / study-app progress ----------

CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    email             TEXT NOT NULL UNIQUE,    -- stored lowercased + trimmed
    password_hash     TEXT NOT NULL,           -- Bun.password.hash (argon2id)
    created_at        INTEGER NOT NULL         -- epoch ms
);

-- Opaque session tokens. One row per active login; the token is a random
-- 256-bit hex string handed to the browser as an httpOnly cookie. Rows are
-- pruned lazily when an expired token is presented (see db.getValidSession).
CREATE TABLE IF NOT EXISTS sessions (
    token             TEXT PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at        INTEGER NOT NULL,        -- epoch ms
    expires_at        INTEGER NOT NULL         -- epoch ms
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Per-user, per-app progress. `app` namespaces the blob so a single account
-- can back multiple study tools (currently just 'verbs'). `data` is the whole
-- client-side store serialized to JSON — the server treats it as opaque.
CREATE TABLE IF NOT EXISTS user_progress (
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app               TEXT NOT NULL,           -- e.g. 'verbs'
    data              TEXT NOT NULL,           -- JSON blob (opaque to the server)
    updated_at        INTEGER NOT NULL,        -- epoch ms
    PRIMARY KEY (user_id, app)
);

-- Append-only durable log of completed study sessions (the verb trainer). The
-- client also keeps a capped copy inside the `user_progress('verbs')` blob for
-- charts, but THIS table is the never-pruned record so session history is never
-- lost. One row per finished session. `mode` is the test direction
-- ('meaning'|'reading'); `details` is a small optional JSON sidecar for future
-- fields (deck filters, duration, …) without a migration.
CREATE TABLE IF NOT EXISTS study_sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ended_at          INTEGER NOT NULL,        -- epoch ms
    right_count       INTEGER NOT NULL,
    total_count       INTEGER NOT NULL,
    mode              TEXT,                    -- 'meaning' | 'reading' | null
    details           TEXT                     -- optional JSON sidecar
);

CREATE INDEX IF NOT EXISTS study_sessions_user_idx ON study_sessions (user_id, ended_at);

-- Per-user voice recordings for the みんなの日本語 record-and-compare feature
-- (Phase 2): the learner records themselves saying a vocab word or conversation
-- line and compares it to the cached native audio. The audio bytes live in the
-- storage layer (PRIVATE objects — personal voice data, never a public URL);
-- this table is the metadata index. `item_key` identifies what the recording is
-- of ('mnn:23:0' for a vocab word, 'mnn:23:conv:2' for a conversation line). Old
-- takes are pruned per (user, lesson, item_key) to the user's keep-N setting, so
-- this table stays small. `ON DELETE CASCADE` from users (storage objects are
-- dropped by the route, not the DB).
CREATE TABLE IF NOT EXISTS minna_recordings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson            INTEGER NOT NULL,
    item_key          TEXT NOT NULL,           -- 'mnn:23:0' (vocab) | 'mnn:23:conv:2' (line)
    storage_key       TEXT NOT NULL,           -- object key in the storage layer
    content_type      TEXT NOT NULL,           -- 'audio/webm' | 'audio/mp4' (Safari)
    duration_ms       INTEGER,                 -- recording length, for the UI
    created_at        INTEGER NOT NULL         -- epoch ms
);

CREATE INDEX IF NOT EXISTS minna_recordings_item_idx
    ON minna_recordings (user_id, lesson, item_key, created_at);

-- Manifest of pre-generated TAGGED voice clips (audio-unify work). One row per
-- (text, provider, voice) we've rendered into the storage layer's
-- `audio/<provider>/<gender|'default'>/<hash>.<ext>` keys, so the catalog endpoint
-- (`GET /v1/audio/variants?text=`) can list which specific voices exist for a text in a
-- single indexed query instead of N storage probes. Only SPECIFIC voices are recorded
-- here (currently Siri male/female); the `google` (lazy gtx) + legacy `default` tts voices
-- are implicit/always-available and carry no row. `text_hash` matches services/tts.ts
-- ttsTextHash(). `gender` is '' for a voice with no gender axis (kept NOT NULL so it can sit
-- in the PK without SQLite's NULL-in-primary-key quirk). Populated by scripts/generate-tts.ts.
CREATE TABLE IF NOT EXISTS audio_variants (
    text_hash   TEXT NOT NULL,           -- sha256(text) 40-char slice (ttsTextHash)
    provider    TEXT NOT NULL,           -- 'siri' (google/default are implicit)
    gender      TEXT NOT NULL DEFAULT '', -- 'male' | 'female' | ''
    ext         TEXT NOT NULL,           -- 'm4a'
    created_at  INTEGER NOT NULL,        -- epoch ms
    PRIMARY KEY (text_hash, provider, gender)
);

-- ---------- Unified sentence store (Phase 1: 独り言 Self-Talk slice) ----------
--
-- One canonical row per Japanese sentence that every surface REFERENCES by id
-- instead of embedding inline (foundation for de-dup / cross-surface reuse /
-- later NLP). Phase 1 wires only Self-Talk: built-in phrases seed as PUBLIC rows;
-- user phrases are first-class PRIVATE rows. The DB is the runtime source of
-- truth; curator content is seeded from the git-tracked study-app bundle
-- (scripts/seed-sentences.ts), user content is written via /v1/sentences.
--
-- Load-bearing invariants:
--   • `text` == plainText(jp) byte-for-byte, `hash` == services/tts.ts
--     ttsTextHash(text) — this is the audio-layer key; the server computes the
--     hash on insert, the client never does.
--   • `furigana` is structured JSON [{t, r?}] with concat(seg.t) === text. The
--     full kana reading is DERIVED (seg.r ?? seg.t), never stored.
--   • Privacy choke-point: ALL reads go through db.getSentences, which always
--     ANDs (public=1 OR created_by=:viewer); anon/export read the
--     public_sentence VIEW. No cross-user de-dup — only the public+public-vis
--     slice is unique-by-hash (partial index below).
CREATE TABLE IF NOT EXISTS sentence (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ext_id      TEXT NOT NULL UNIQUE,           -- stable external id: builtin slug or user UUID
    hash        TEXT NOT NULL,                  -- ttsTextHash(text); audio key + dedup key
    text        TEXT NOT NULL,                  -- plainText canonical (byte-for-byte)
    furigana    TEXT,                           -- JSON [{t,r?}]; concat(t) === text
    lang        TEXT NOT NULL DEFAULT 'ja',
    source      TEXT NOT NULL,                  -- 'selftalk' | 'example' | 'custom' (private user card) | 'template' (materialized combo)
    public      INTEGER NOT NULL DEFAULT 0,     -- 1 = export/anon eligible
    visibility  TEXT NOT NULL DEFAULT 'public', -- 'public' | 'private'
    created_by  INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = curator
    created_at  INTEGER NOT NULL                -- epoch ms
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sentence_public_hash
    ON sentence(hash) WHERE public = 1 AND visibility = 'public';
CREATE INDEX IF NOT EXISTS ix_sentence_created_by ON sentence(created_by);

CREATE TABLE IF NOT EXISTS translation (
    sentence_id INTEGER NOT NULL REFERENCES sentence(id) ON DELETE CASCADE,
    lang        TEXT NOT NULL,
    text        TEXT NOT NULL,
    ordinal     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sentence_id, lang, ordinal)
);

-- Polymorphic ownership, designed up front so card / grammar / conversation /
-- lesson owners can be wired in later phases without a migration. Self-Talk uses
-- owner_type='selftalk' (owner_id NULL); built-in vocab EXAMPLE sentences (Phase 2)
-- use owner_type='card' (owner_id=<rank>, tier='N5'..'N1'). A sentence reused by
-- several cards/tiers has ONE sentence row + one link per (card, tier). Slot-swap
-- TEMPLATE realizations (Slice 2) use owner_type='template' (owner_id=<template
-- ext_id>, role=<canonical combo key>) — see sentence_template below.
CREATE TABLE IF NOT EXISTS sentence_link (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence_id   INTEGER NOT NULL REFERENCES sentence(id) ON DELETE CASCADE,
    owner_type    TEXT NOT NULL,   -- 'card'|'grammar_point'|'conversation'|'lesson'|'selftalk'|'template'
    owner_id      TEXT,            -- NULL for selftalk; card rank / template ext_id / lesson no / etc.
    tier          TEXT,            -- 'N5'..'N1' for card examples
    role          TEXT,            -- conversation speaker; template combo key ('slotId:idx,…')
    ordinal       INTEGER NOT NULL DEFAULT 0,
    clip_start_ms INTEGER,
    clip_end_ms   INTEGER
);
CREATE INDEX IF NOT EXISTS ix_link_owner    ON sentence_link(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS ix_link_sentence ON sentence_link(sentence_id);

CREATE TABLE IF NOT EXISTS sentence_tag (
    sentence_id INTEGER NOT NULL REFERENCES sentence(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,     -- 'topic' (Self-Talk; 'scene' is the legacy alias) | 'thought' (sub-cluster) | 'grammar'
    value       TEXT NOT NULL,
    PRIMARY KEY (sentence_id, kind, value)
);

-- NLP enrichment (Phase 4). Populated by an OFFLINE GiNZA batch (../../sentence-nlp/) +
-- scripts/seed-annotations.ts — the server only ever READS this (no Python on the prod droplet).
-- One row per sentence. token start/end are UTF-16 CODE-UNIT offsets into sentence.text (NOT
-- codepoint — the client slices `text` in JS, which is UTF-16-indexed; the two diverge at non-BMP
-- kanji). db.upsertAnnotation re-asserts text.slice(start,end)===surface on write, so a bad offset
-- can't land. Reads go through db.getAnnotation (the same privacy gate as getSentences).
CREATE TABLE IF NOT EXISTS sentence_annotation (
    sentence_id INTEGER PRIMARY KEY REFERENCES sentence(id) ON DELETE CASCADE,
    tokens      TEXT,   -- JSON [{i,start,end,surface,lemma,pos,tag,reading,dep,head}] (UTF-16 offsets)
    bunsetsu    TEXT,   -- JSON [{start,end}] (UTF-16 offsets)
    parser      TEXT,   -- provenance, e.g. 'ja_ginza_electra/5.2.0 ginza/5.2.0 splitC'
    parsed_at   INTEGER -- epoch ms
);

-- Anon reads and any export read ONLY this view — cannot see private/gated rows.
CREATE VIEW IF NOT EXISTS public_sentence AS
    SELECT * FROM sentence WHERE public = 1 AND visibility = 'public';

-- ---------- Sentence templates (slot-swap generators; 独り言 Self-Talk) ----------
--
-- A TEMPLATE is a sentence GENERATOR, not a sentence: a skeleton `jp`/`en` with `{slot}` markers
-- plus a `slots` array of fillers. It has NO single fixed text/hash/furigana, so it can't be a
-- `sentence` row — it lives here, curator-seeded from the study-app bundle
-- (data/selftalk-templates.js → scripts/seed-sentences.ts), served via GET /v1/templates, and
-- rendered client-side (the slot-swap UI). Picking a filler per slot REALIZES a concrete sentence;
-- those realizations become PUBLIC `sentence` rows (source='template', linked via sentence_link
-- owner_type='template'), lazily materialized on first play/record (Slice 2 — SHIPPED) by
-- db.materializeTemplateRealization (reuse-by-hash, idempotent), so de-dup/export/grammar/NLP/TTS
-- cover the combos people use. Full design + phasing: ../../SENTENCE_STORE_TEMPLATES.md.
--
-- Privacy MIRRORS the sentence store: ALL reads go through db.getTemplates, which always ANDs
-- (public=1 OR created_by=:viewer), fail-closed; anon/export read the public_template VIEW. This
-- slice is curator-only (only upsertPublicTemplate writes rows); the private columns + the gate +
-- a pinned breach test ship now so user-authored templates can be added later without a migration.
--   • `ext_id` is the stable SKELETON id (e.g. 'tpl-minecraft-gather') — the record-compare itemKey
--     on the client, preserved verbatim + immutable.
--   • `grammar` + `slots` are JSON the server treats as OPAQUE (parsed only to re-emit the
--     client-render shape); `topic`/`thought` mirror the sentence_tag taxonomy for grouping.
CREATE TABLE IF NOT EXISTS sentence_template (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ext_id      TEXT NOT NULL UNIQUE,           -- stable skeleton id, e.g. 'tpl-minecraft-gather'
    source      TEXT NOT NULL,                  -- 'selftalk'
    topic       TEXT,                           -- taxonomy topic id (SELFTALK_TAXONOMY)
    thought     TEXT,                           -- optional sentence-thought sub-cluster id
    grammar     TEXT,                           -- JSON string[] of teaching-grammar ids
    en          TEXT,                           -- English skeleton with {slot} markers
    jp          TEXT,                           -- JP skeleton with {slot} markers (ruby on fixed kanji)
    slots       TEXT,                           -- JSON [{id,label,fillers:[{jp,en}]}]
    public      INTEGER NOT NULL DEFAULT 0,     -- 1 = export/anon eligible
    visibility  TEXT NOT NULL DEFAULT 'public', -- 'public' | 'private'
    created_by  INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = curator
    created_at  INTEGER NOT NULL                -- epoch ms
);
CREATE INDEX IF NOT EXISTS ix_template_created_by ON sentence_template(created_by);

-- Anon reads and any export read ONLY this view — cannot see private/gated template rows.
CREATE VIEW IF NOT EXISTS public_template AS
    SELECT * FROM sentence_template WHERE public = 1 AND visibility = 'public';
