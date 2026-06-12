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
