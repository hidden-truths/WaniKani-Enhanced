# Phase 1 — Unified Sentence Store (Self-Talk vertical slice)

> Executable plan for a **fresh session**. This is Phase 1 of a larger rearchitecture. Read the
> **Context** and **Background** before touching code — the architecture was negotiated over a long
> design conversation and several constraints are load-bearing. A condensed decision record also
> lives in memory at `sentence-store-rearchitecture.md`.

---

## Context (why)

Japanese sentences are scattered across three incompatible representations: bundled
`study-app/src/data/examples.js` (`EXAMPLES[rank]={N5:[jp,en],…}`), server JSON
`wk-enhanced-api/data/minna/lesson-<n>.json`, and bundled+synced Self-Talk
(`study-app/src/data/selftalk.js` + the per-user `selftalk` blob). They share no shape and no store;
the only convergence today is the audio layer, which keys on `ttsTextHash(plainText(jp))`.

The goal is **one canonical `sentence` entity** in the server DB that everything **references by id**
instead of embedding inline — a foundation for de-dup, cross-surface reuse, grammar search, and
(later, separate project) GiNZA NLP enrichment (highlight a span → lemma/POS/card-or-Jisho link).

**Phase 1 proves the store end-to-end on ONE surface — 独り言 Self-Talk** — because it is standalone
(no card-join modeling), low-traffic (doesn't touch the flashcard/deck core), and is where
**user-authored sentences as first-class rows** first earns its keep. Outcome: Self-Talk phrases
(built-in **and** user-authored) live in the sentence store; the app fetches them instead of reading
the bundle/blob; authoring writes private rows via the API.

---

## Background — converged architecture (constraints that must survive)

1. **DB is the runtime source of truth** for sentences (server SQLite). Curator content is **seeded
   from git-tracked files** (keeps the flat-file authoring workflow); user content is written via API.
2. **Option A — user sentences are first-class private rows** (`created_by`, `visibility='private'`,
   `public=0`). Self-Talk user phrases migrate out of the opaque `selftalk` blob into rows.
3. **Offline support is being removed; anon read is KEPT.** Phase 1 scopes this to Self-Talk only:
   the tab fetches from the API with a **localStorage read-through cache**; **authoring now requires
   an account** (writes go to the server). Do **not** attempt a global offline-first teardown here —
   that is a separate sweep.
4. **Furigana = structured `[{t, r?}]` segments**, stored on the sentence, source of truth (NOT from
   GiNZA). Invariant: `concat(seg.t) === sentence.text`. Full kana `read` is **derived**
   (`seg.r ?? seg.t`), not stored.
5. **`sentence.text` MUST equal `plainText(jp)` byte-for-byte**, and `hash = ttsTextHash(text)` — so the
   existing audio layer keeps resolving. `plainText` = `study-app/src/core/text.js:36`
   (`replace(/<rt>.*?<\/rt>/g,'').replace(/<\/?ruby>/g,'')`); `ttsTextHash` =
   `wk-enhanced-api/src/services/tts.ts:15` (`sha256(text).slice(0,40)`). Server computes the hash on
   insert; the client never computes it.
6. **Polymorphic ownership, designed up front:** `sentence_link(owner_type, owner_id, tier, role,
   ordinal, clip_*)`. Self-Talk uses `owner_type='selftalk'`. (Card/grammar/conversation owners get
   wired in later phases; the schema supports them now.)
7. **No cross-gate / cross-user de-dup.** `public=1` is the only export-eligible slice; partial unique
   index `UNIQUE(hash) WHERE public=1 AND visibility='public'`. Private rows may share a hash.
8. **Privacy filter = new load-bearing security.** All sentence reads go through ONE choke-point repo
   fn that always ANDs `(public=1 OR created_by=:viewer)`; fail-closed default (no viewer → public
   only); anon/export read a physical `public_sentence` VIEW; pinned breach tests.
9. **Preserve the external phrase id.** Built-in phrase ids (`st-morning-1`) and user UUIDs
   (`usr-<uuid>`) are the record-compare `itemKey` and practice-`doneToday` keys. Store them as
   `sentence.ext_id` and keep them verbatim — zero key migration for recordings/practice.
10. **Scope guard:** this is *sentences*, not *cards*. Don't pull card definitions into the store.

**Repo conventions:** branch off `main`; **one logical change → one commit**; commit at end of each
unit without being asked; fix stale nearby comments in the same commit. Gates before each commit:
server `bun test` + `bun run typecheck` (in `wk-enhanced-api/`); client `bun run test` + `bun run
build` (in `study-app/`). Pure logic goes in `src/core/*` (DOM-free, tested).

---

## Data model (DDL — append to `wk-enhanced-api/src/db/schema.sql`)

Schema is applied idempotently at boot (`openDb()` → `db.exec(schema)` in
`wk-enhanced-api/src/db/client.ts:20`); there is **no migration framework**, so `CREATE … IF NOT
EXISTS` is the whole story. Mirror the existing table style (`INTEGER PRIMARY KEY AUTOINCREMENT`,
`REFERENCES users(id) ON DELETE CASCADE`, epoch-ms `INTEGER` timestamps, JSON-as-TEXT).

```sql
CREATE TABLE IF NOT EXISTS sentence (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id      TEXT NOT NULL UNIQUE,           -- stable external id: builtin slug or user UUID
  hash        TEXT NOT NULL,                  -- ttsTextHash(text); audio key + dedup key
  text        TEXT NOT NULL,                  -- plainText canonical (byte-for-byte)
  furigana    TEXT,                           -- JSON [{t,r?}]; concat(t) === text
  lang        TEXT NOT NULL DEFAULT 'ja',
  source      TEXT NOT NULL,                  -- 'builtin' | 'minna' | 'selftalk' | 'user'
  public      INTEGER NOT NULL DEFAULT 0,     -- 1 = export/anon eligible
  visibility  TEXT NOT NULL DEFAULT 'public', -- 'public' | 'private'
  created_by  INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = curator
  created_at  INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS sentence_link (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_id   INTEGER NOT NULL REFERENCES sentence(id) ON DELETE CASCADE,
  owner_type    TEXT NOT NULL,   -- 'card'|'grammar_point'|'conversation'|'lesson'|'selftalk'
  owner_id      TEXT,            -- NULL for selftalk; card rank / lesson no / etc. later
  tier          TEXT,            -- 'N5'..'N1' for card examples
  role          TEXT,            -- conversation speaker
  ordinal       INTEGER NOT NULL DEFAULT 0,
  clip_start_ms INTEGER,
  clip_end_ms   INTEGER
);
CREATE INDEX IF NOT EXISTS ix_link_owner    ON sentence_link(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS ix_link_sentence ON sentence_link(sentence_id);

CREATE TABLE IF NOT EXISTS sentence_tag (
  sentence_id INTEGER NOT NULL REFERENCES sentence(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,     -- 'scene' | 'grammar' | 'topic'
  value       TEXT NOT NULL,
  PRIMARY KEY (sentence_id, kind, value)
);

-- Designed now, populated in the later NLP phase. Token offsets index into sentence.text.
CREATE TABLE IF NOT EXISTS sentence_annotation (
  sentence_id INTEGER PRIMARY KEY REFERENCES sentence(id) ON DELETE CASCADE,
  tokens      TEXT,   -- JSON [{i,start,end,surface,lemma,pos,tag,reading,dep,head}]
  bunsetsu    TEXT,   -- JSON [{start,end}]
  parser      TEXT,
  parsed_at   INTEGER
);

-- Anon reads and any export read ONLY this view — cannot see private/gated rows.
CREATE VIEW IF NOT EXISTS public_sentence AS
  SELECT * FROM sentence WHERE public = 1 AND visibility = 'public';
```

**Assembled "sentence" shape returned by the API** (server composes from the tables):

```jsonc
{ "id": "st-morning-1", "text": "歯を磨いている。",
  "furigana": [{"t":"歯","r":"は"},{"t":"を"},{"t":"磨","r":"みが"},{"t":"いている。"}],
  "translations": {"en": "I'm brushing my teeth."},
  "tags": {"scene": "morning", "grammar": ["te-iru"]},
  "link": {"owner_type":"selftalk"}, "custom": false }
```

---

## Part A — Server (`wk-enhanced-api/`)

### A1. Schema + repo functions + tests  *(commit 1)*

- **`src/db/schema.sql`** — append the DDL above.
- **`src/db/client.ts`** — add repo functions (follow the `getProgress`/`upsertProgress`/`insertSession`
  style at `client.ts:317-361`: positional `?` binds, `JSON.parse`/`stringify` at the boundary, no SQL
  outside this file). Needed:
  - **`getSentences({ ownerType, viewer })`** — THE choke-point read. Joins `sentence_link` →
    `sentence`, LEFT JOINs `translation` + `sentence_tag`, and **always** applies
    `(s.public = 1 OR s.created_by = :viewer)` where `viewer` defaults to `null` (→ public only).
    Returns assembled sentence objects (shape above). This is the single gate the privacy of the whole
    feature rests on.
  - **`createSentence({ extId, text, furigana, source, createdBy, translations, tags, link })`** —
    INSERT with `public=0, visibility='private'`, `hash=ttsTextHash(text)` (import from
    `../services/tts`), `created_at=Date.now()`. Insert translation/tag/link rows in the same call.
    Returns the assembled sentence. Enforce `concat(furigana.t)===text` (throw on violation).
  - **`updateUserSentence({ extId, viewer, … })`** / **`deleteUserSentence({ extId, viewer })`** —
    ownership enforced in SQL (`WHERE ext_id=? AND created_by=?`); a non-owner update/delete affects 0
    rows (return not-found).
  - **`upsertPublicSentence({ extId, text, furigana, source, translations, tags, link })`** — for the
    seed script: `public=1, visibility='public', created_by=NULL`, idempotent
    `ON CONFLICT(ext_id) DO UPDATE`. Replaces child translation/tag/link rows each run.
- **`src/db/client.test.ts`** — extend the existing `_useDbForTesting(openDb(':memory:'))` pattern
  (`client.test.ts`). **Pin the privacy invariants** (à la the `ikTitles` dead-end pins):
  - `getSentences({viewer:null})` never returns a `public=0` or `visibility='private'` row.
  - A private row created by user A is invisible to `getSentences({viewer: B})` and to `{viewer:null}`.
  - `SELECT * FROM public_sentence` excludes a private row and a `public=0` (gated) row.
  - `upsertPublicSentence` is idempotent (second call doesn't duplicate links/tags; row count stable).
  - `updateUserSentence`/`deleteUserSentence` by a non-owner affects 0 rows.
  - **Gate:** `bun test` + `bun run typecheck` green.

### A2. Zod schemas + `/v1/sentences` routes  *(commit 2)*

- **`src/schemas.ts`** — add `SentenceSchema`, `SentenceListResponseSchema`, `SentenceCreateRequestSchema`
  (`{ id (ext_id), text, furigana, translations, tags, link }`), `SentenceUpdateRequestSchema`. Follow
  the `.object({…}).openapi('Name')` style (`schemas.ts:278-340`).
- **`src/routes/sentences.ts`** — `new OpenAPIHono({ defaultHook: zodHook })` (the `defaultHook` is
  **mandatory per sub-router** — `progress.ts:22`). Routes via `createRoute` + `.openapi(handler)`:
  - **`GET /v1/sentences?ownerType=selftalk`** — `const user = currentUser(c)` (null = anon);
    `return getSentences({ ownerType, viewer: user?.id ?? null })`. Serves anon (public) and signed-in
    (public + own private) through the one read. `Cache-Control: no-store`.
  - **`POST /v1/sentences`** — `currentUser` required (401 else, via the `unauthorized` helper pattern
    `progress.ts:42`). Body carries the **client-generated `id`** (ext_id); calls `createSentence`
    with `source: 'selftalk'` (or `'user'`), `createdBy: user.id`. Apply a per-request size guard like
    `MAX_BLOB_BYTES` (`progress.ts:40`) and a **per-user row cap** (e.g. reject beyond N private
    sentences — pick a generous N like 2000).
  - **`PUT /v1/sentences/{id}`** / **`DELETE /v1/sentences/{id}`** — `currentUser` required; pass
    `viewer: user.id` so ownership is enforced in SQL; 404 if not owned.
- **`src/index.ts`** —
  - **CORS (CRITICAL):** add `sentences` to the `STUDY_ROUTE` regex at `index.ts:57`
    (`/^\/v1\/(auth|progress|sessions|minna|audio|sentences)\b/`). The study-app's `api()` always sends
    `credentials:'include'`, so even the anon GET is a credentialed request and **must** receive the
    echoed origin, never `*` (a wildcard + credentials is rejected by the browser). This is why a
    "public" endpoint still belongs in `STUDY_ROUTE`.
  - **Mount:** `app.route('/v1/sentences', sentencesRouter)` alongside the others (`index.ts:101-109`).
  - **Gate:** `bun run typecheck`; manual `curl` (see Verification).

### A3. Seed script — built-in Self-Talk phrases → public rows  *(commit 3)*

- **`scripts/seed-sentences.ts`** — model on `scripts/generate-tts.ts:47-57` (operator script: run from
  `wk-enhanced-api/` so `.env` loads; `import * as db from '../src/db/client.ts'`; cross-package import
  from the study-app is already the norm). Steps:
  1. Import `SELFTALK`, `SELFTALK_SCENES`, `SELFTALK_GRAMMAR` from
     `../../study-app/src/data/selftalk.js`, and `plainText`, `rubyToSegments` from
     `../../study-app/src/core/text.js` (A/B4 adds `rubyToSegments`).
  2. For each built-in phrase: `text = plainText(jp)`, `furigana = rubyToSegments(jp)` (assert
     `concat(t)===text`), `translations = {en: mean}`, `tags = {scene, grammar[]}`,
     `link = {owner_type:'selftalk'}`, `ext_id = phrase.id`, `source='selftalk'`.
  3. `db.upsertPublicSentence(...)` each (idempotent).
  - Log count seeded. **Run against dev DB** (`bun scripts/seed-sentences.ts`); re-running is a no-op.
  - **Prod note:** this seed must run as a deploy step (point `DATABASE_FILE`/`S3_*` at prod, same as
    `generate-tts.ts` prod seeding). Add to the deploy runbook in a later commit.

---

## Part B — Client (`study-app/`)

### B4. Pure ruby↔segments helpers + tests  *(commit 4)*

- **`src/core/text.js`** — add three pure functions next to `plainText` (`text.js:36`):
  - **`rubyToSegments(jp)`** → `[{t,r?}]`. Parse `<ruby>X<rt>Y</rt></ruby>` into `{t:'X',r:'Y'}` and
    runs of non-ruby text into `{t:'…'}`. Invariant: `segments.map(s=>s.t).join('') === plainText(jp)`.
  - **`segmentsToRuby(segs)`** → the `<ruby>…</ruby>` HTML string. Must round-trip:
    `segmentsToRuby(rubyToSegments(jp)) === jp` for well-formed input.
  - **`segmentsToReading(segs)`** → `segs.map(s=>s.r ?? s.t).join('')` (the derived full-kana `read`).
- **`test/core.test.ts`** — add a block mirroring the existing Self-Talk dataset test
  (`core.test.ts:694`): for **every** built-in `SELFTALK` phrase assert the round-trip + that
  `segmentsToReading(rubyToSegments(jp)) === phrase.read` (catches furigana drift in the data).
  - **Gate:** `bun run test` + `bun run build`. Pure-only change; no behavior shift yet.

### B5. Self-Talk reads from the store (read-through cache)  *(commit 5)*

Replace the bundle/blob phrase source with a server fetch + localStorage cache, **behavior-preserving**
(same phrases render). Key files: `src/features/selftalk.js`, `src/persistence/selftalk.js`,
`src/state.js`.

- **Fetch:** on Self-Talk tab activation (and at boot/sign-in), `api('/v1/sentences?ownerType=selftalk')`
  (the `api()` helper, `cloud-core.js:21`). Map each returned sentence → the phrase shape the UI already
  uses via a small adapter `sentenceToPhrase(s)`:
  `{ id: s.id, jp: segmentsToRuby(s.furigana), read: segmentsToReading(s.furigana), mean:
  s.translations.en, scene: s.tags.scene, grammar: s.tags.grammar||[], custom: s.custom }`. Put
  `sentenceToPhrase` in `src/core/selftalk.js` (pure, tested) so render code is unchanged downstream.
- **Read-through cache:** store the last good fetch in localStorage (e.g. key `jpverbs_selftalk_cache`).
  `allPhrases()` (`selftalk.js:44`) returns the fetched/cached set instead of `SELFTALK.concat(...)`.
  Offline/failed fetch → render from cache (degrade, don't break). The bundled `SELFTALK` constant stays
  in the repo as the **seed source** but is no longer read at runtime (leave a comment to that effect).
- **`state.selftalkStore`** now holds only `{ practice }` going forward (phrases move to the store/cache).
  Keep `loadSelftalk`/`saveSelftalk` for the `practice` blob; the `phrases` field is migrated out in B6.
  Practice keying is unchanged (`donePhraseIds`/`applyPractice` key by phrase `id` = `ext_id`).
  - **Gate:** `bun run test` + `bun run build`; preview-verify the tab renders the same built-in
    phrases, scene groups, grammar filter, today's-focus, play button, and (signed-in) record controls.

### B6. Authoring → API (Option A) + legacy migration + account gate  *(commit 6)*

- **Authoring CRUD** (`selftalk.js` `savePhrase`/`deletePhrase`, `selftalk.js:211-236`): replace the
  `state.selftalkStore.phrases` mutation + `saveSelftalk()` with **optimistic API writes**:
  - Create: keep `newPhraseId()` (`selftalk.js:207`, already `usr-<uuid>`); `POST /v1/sentences` with
    `{ id, text: plainText(jp), furigana: rubyToSegments(jp), translations:{en:mean}, tags:{scene,
    grammar}, link:{owner_type:'selftalk'} }`. Update the local cache + re-render immediately; the POST
    confirms in the background (UUID is final from birth → no reconciliation).
  - Edit → `PUT /v1/sentences/{id}`; Delete → `DELETE /v1/sentences/{id}`. Both update cache optimistically.
- **Account gate:** authoring now requires sign-in (writes are server rows). Gate the "Add phrase"
  affordance on `account` (`cloud-core.js:7`); show a sign-in nudge for anon (mirror how record controls
  already gate on `account`, `selftalk.js:109`). Reading stays anon.
- **One-time legacy migration:** existing users have phrases in their `selftalk` blob (local and/or
  cloud, `persistence/selftalk.js`). On sign-in (in/after `pullSelftalkCloud`, `cloud.js:67`), if the
  blob has `phrases`, `POST` each to the store (idempotent by `ext_id` — they already carry `usr-…`
  ids), then write the blob back **without** `phrases`. `normalizeSelftalk` (`persistence/selftalk.js:17`)
  should drop `phrases` going forward so the blob is `{ practice }` only.
- **Sync trio:** `pushSelftalkCloud`/`pullSelftalkCloud` (`cloud.js:62-74`) now sync only `{ practice }`.
  Leave the `selftalk` app key as-is (server enum already includes it, `progress.ts:26`).
  - **Gate:** `bun run test` + `bun run build`; preview-verify add/edit/delete round-trips to the
    server, anon sees the gate, a signed-in user's legacy local phrases migrate once and then render
    from the store.

---

## Commit sequence (one logical change each)

1. **server: sentence store schema + repo + privacy-pinned tests** (A1)
2. **server: /v1/sentences routes + schemas + CORS + mount** (A2)
3. **server: seed-sentences script (Self-Talk built-ins → public rows)** (A3)
4. **study-app: ruby↔segments core helpers + round-trip tests** (B4)
5. **study-app: Self-Talk reads phrases from the store (read-through cache)** (B5)
6. **study-app: Self-Talk authoring writes private rows + legacy migration + account gate** (B6)

Each is independently shippable and reversible; the old path stays intact until its successor is
verified (no flag day — same discipline as the two-app split).

---

## Gotchas / invariants to preserve

- **`text` must be `plainText(jp)` byte-for-byte**, incl. nothing extra — it is the audio key. Never
  normalize spaces or trim here (Minna's bunsetsu spaces matter in later phases; Self-Talk has none).
- **`hash = ttsTextHash(text)` computed server-side only.** Don't recompute on the client; don't reuse
  the client's FNV `hashStr` (`core/selftalk.js:11`, that's for today's-set rotation, unrelated).
- **Preserve `ext_id` verbatim** (`st-morning-1`, `usr-<uuid>`) — it's the record-compare `itemKey`
  (`SELFTALK_SCOPE=90000`, `selftalk.js:29,109`) and practice `doneToday` key. Changing it orphans
  recordings.
- **CORS:** `/v1/sentences` MUST be in `STUDY_ROUTE` or anon (credentialed) fetches break — see A2.
- **Privacy:** every sentence read goes through `getSentences`; anon/export only ever touch
  `public_sentence`. Keep the pinned tests green — they are breach-prevention, not nice-to-haves.
- **De-dup boundary:** only `public=1, visibility='public'` rows are unique-by-hash. Don't add a global
  `UNIQUE(hash)` — two users with the same text would collide.
- **Scope:** don't migrate card definitions or other surfaces here. Examples.js / Minna are Phases 2–3.
- **Don't tear out global offline-first** in this phase; scope offline removal to the Self-Talk fetch
  path only.

---

## Verification (end-to-end)

**Server (`wk-enhanced-api/`):**
- `bun test` (privacy pins + idempotency + ownership) and `bun run typecheck`.
- `bun dev`, then:
  - `bun scripts/seed-sentences.ts` → seeds ~44 built-ins; re-run → no growth.
  - Anon: `curl 'http://localhost:3000/v1/sentences?ownerType=selftalk'` → returns built-ins only.
  - Signed-in (grab the `wk_session` cookie via `/v1/auth/login`): same call returns built-ins + that
    user's private phrases. `POST`/`PUT`/`DELETE /v1/sentences` round-trip; a second user cannot see or
    mutate the first's rows (expect 404 on cross-user PUT/DELETE).

**Study-app (`study-app/`):**
- `bun run test` (ruby↔segments round-trip + reading derivation over all built-ins) and `bun run build`.
- `bun run dev` (+ `bun dev` in `wk-enhanced-api`). Drive with the preview tooling (the tab reloads on
  capture — assert transient state via DOM `eval`; seed via the API, not in-memory):
  - Anon: Self-Talk renders built-ins (scene groups, grammar filter, today's-focus, ▶ play); "Add
    phrase" shows the sign-in gate; no record controls.
  - Signed-in: add a phrase → appears immediately, persists across reload, visible from a second
    browser; edit/delete round-trip; record a take against a phrase and confirm the take + practice ✓
    still bind (ext_id unchanged); a pre-existing local phrase migrates into the store once.

**Prod deploy (note for the runbook, not Phase 1 code):** run `seed-sentences.ts` against the prod DB +
storage env as part of the rollout (same pattern as `generate-tts.ts` prod seeding); confirm the apex
study-app fetches `https://api.wkenhanced.dev/v1/sentences` with the echoed-origin CORS header.

---

## Explicit non-goals (later phases)

- GiNZA / NLP enrichment + the highlight popover (Phase 4; `sentence_annotation` is created but unused).
- `examples.js` → store + `card` links + deck-boot fetch (Phase 2).
- Minna → store, grammar-point/conversation ids, gated reads (Phase 3).
- Grammar search over `sentence_tag` (mid-term).
- Global offline-first removal across all surfaces (separate sweep).
