-- Schema for wk-vocab-api. SQLite via bun:sqlite.
--
-- Three tables:
--   vocab_examples  — pre-warmed payload per word (one row per word)
--   index_meta      — singleton: cached IK encoded-title → {title, category} map
--   warm_jobs       — audit log for each warm pipeline run

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
