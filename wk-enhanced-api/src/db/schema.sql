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
