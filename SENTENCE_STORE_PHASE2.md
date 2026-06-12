# Phase 2 — Unified Sentence Store (built-in vocab EXAMPLE sentences)

> Executable plan for a **fresh session**. Phase 2 of the rearchitecture begun in
> [SENTENCE_STORE_VISION.md](SENTENCE_STORE_VISION.md). Phase 1 (Self-Talk) shipped on branch
> `sentence-store-phase1`; its plan + shipped code are the reference implementation — read
> [SENTENCE_STORE_PHASE1.md](SENTENCE_STORE_PHASE1.md) and the memory note
> `sentence-store-rearchitecture.md` before touching code. Several invariants are load-bearing.

---

## Context (why)

The 100 built-in vocab cards' **leveled example sentences** live bundled in
`study-app/src/data/examples.js` as `EXAMPLES[rank] = { N5:[jp,en], …, N1:[jp,en] }`. They are
attached to deck cards at boot by `attachLevels()` (`state.js`) as `v.levels`, read by
`exampleForLevel`/`availableTiers` (`core/examples.js`), and rendered on the flashcard answer side
(`renderExample`, `#exSpeak` in `features/flashcard.js`) and the Browse detail modal
(`renderDetailExample`, `#dExSpeak` in `features/browse.js`).

Phase 2 moves these sentences **into the sentence store** as PUBLIC rows LINKED to cards, and has
the deck **fetch them by reference** instead of bundling — the same store-first / read-through
shape Phase 1 proved on Self-Talk. After this phase:

- Each example sentence is a `sentence` row (`public=1`, `source='example'`) with a
  `sentence_link(owner_type='card', owner_id=<rank>, tier='N5'..'N1')` per (card, tier) it
  illustrates. **Tier lives on the link, not the sentence** (a sentence reused across cards/tiers
  has ONE row + many links).
- The deck **batch-fetches** all card examples once on boot (`GET /v1/sentences?ownerType=card`),
  caches them in localStorage (read-through, like Self-Talk's `jpverbs_selftalk_cache`), and
  rebuilds `v.levels` from the cached set via a pure tested adapter. Offline → degrade to cache.
- `examples.js` stays in the repo as the **seed source** for `scripts/seed-sentences.ts`, no longer
  read at runtime (it tree-shakes out of the app bundle once `state.js` stops importing it).

This is **sentences only** — card *definitions* (`verbs.js`, the custom-verbs blob) stay where they
are. Minna (Phase 3) and GiNZA NLP (Phase 4) are later.

---

## Background — what carries over from Phase 1 (must survive)

1. **`sentence.text === plainText(jp)` byte-for-byte; `hash = ttsTextHash(text)` computed
   SERVER-SIDE only** (the audio-layer key). The client never computes the hash.
2. **Furigana is structured `[{t,r?}]`** with `concat(seg.t) === text` (reuse `rubyToSegments`;
   enforced by `assertFuriganaMatches` on write). The full kana reading is derived, not stored.
3. **TIER LIVES ON THE LINK** (`sentence_link.tier`, `'N5'..'N1'`); `owner_id` = the card rank
   (as TEXT). A sentence can carry multiple links.
4. **One privacy choke-point.** Every read still goes through `getSentences`; anon/export only ever
   touch the `public_sentence` VIEW. Examples are PUBLIC rows. The Phase-1 breach pins stay green;
   Phase 2 ADDS pins for the per-link card read.
5. **Reuse, not duplication.** The partial unique index `UNIQUE(hash) WHERE public=1 AND
   visibility='public'` means two PUBLIC sentences with identical text COLLIDE. So if two
   cards/tiers (or a card and an existing Self-Talk public row) share identical text, the seed must
   REUSE the existing public row (add another `sentence_link`), never insert a second row.
6. **Repo conventions:** branch off `main`; one logical change → one commit; commit at end of each
   unit without being asked; fix stale nearby comments in the same commit. Gates before EVERY
   commit: server `bun test` + `bun run typecheck` (in `wk-enhanced-api/`); client `bun run test` +
   `bun run build` (in `study-app/`). Pure logic goes in `src/core/*` (DOM-free, tested). Land
   additive/behavior-preserving commits first, then the deck cut-over.

---

## Key design decisions (decided up front)

### D1 — No DDL change. The schema already supports this.
`sentence_link` already has `owner_type`, `owner_id`, `tier`. `source` is a free TEXT column. So
Phase 2 adds **no new tables/columns**; it adds the value `source='example'`, the `owner_type='card'`
link shape, repo functions, and the read change. (Update the `source` enum comment in `schema.sql`
+ `client.ts` to include `'example'`.)

### D2 — ext_id scheme = `ex-<hash>`, identity-by-hash; per-(card,tier) lives on the LINK.
A reused sentence has ONE row (one `ext_id`) and MANY links, so `ext_id` **cannot** be
`ex-<rank>-<tier>` (that's per-link). The natural per-sentence key is the audio hash:
`ext_id = 'ex-' + ttsTextHash(text)` for a newly-created example row. Two identical example texts
therefore collide on `ext_id` AND on the partial unique `hash` index → the same row is reused. The
per-(rank,tier) facts are carried only by `sentence_link.owner_id`/`tier`. (The seed computes the
hash via the repo, not by hand — see D3.)

### D3 — Reuse path resolves by HASH, not ext_id. `upsertPublicSentence` is NOT enough.
`upsertPublicSentence` keys `ON CONFLICT(ext_id)` and **replaces all links wholesale** each call —
wrong for examples, where (a) a reused sentence needs *accumulated* links and (b) an example text
may already exist as a Self-Talk public row under a *different* ext_id namespace (`st-*`), so an
`ex-<hash>` insert would collide on the hash index. New repo function **`seedExampleSentence`**
resolves the public row **by hash** (the unique public slice → ≤1 row), creates it only if absent,
and **replaces just the `owner_type='card'` links** for that sentence (leaving any `selftalk` link
on a shared row intact). Idempotent: re-seed → same hash → same row → same card-link set → no
growth. (The seed passes the FULL card-link set for one text in a single call, since it groups by
text first — so no cross-call link accumulation is needed; only example↔selftalk hash-reuse needs
the by-hash lookup.)

### D4 — The read returns one assembled sentence PER LINK (not per sentence).
Today `getSentences` returns DISTINCT sentences with a single `LIMIT 1` link — fine for Self-Talk
(one link each), but it would drop the extra links of a reused example, so the deck couldn't learn
every (rank,tier) a shared sentence covers. Phase 2 refactors the choke-point to return **one entry
per matching link**, each carrying its own `link`. Self-Talk is unaffected (its sentences have
exactly one `selftalk` link → one entry each; a `selftalk` sentence that an example later reuses
still returns once under `ownerType=selftalk` because the `owner_type` filter only matches its
selftalk link). The privacy `WHERE` is unchanged → Phase-1 pins stay green. Add an optional
`ownerId` filter (cheap, future single-card refetch); the deck boot uses the no-`ownerId` batch.

### D5 — Custom-card examples (the `ex` field) are DEFERRED to a later sub-phase (2.5).
The vision wants custom-card `ex` sentences in the store eventually (Option A private rows,
`owner_type='card'`, `created_by`). They are **out of scope for Phase 2.** Rationale: built-in
examples are PUBLIC, read-only, and curator-seeded — a clean, low-risk slice that mirrors the
public half of Phase 1. Custom `ex` is user-authored PRIVATE content requiring the whole authoring
vertical (optimistic API writes + account gate + a one-time `custom-verbs`-blob → store migration on
sign-in) — that's a second vertical analogous to Self-Talk's B6 and would bloat this phase.
`exampleForLevel`'s existing `v.ex` fallback keeps custom-card examples rendering from the blob,
unchanged, throughout Phase 2. Phase 2.5 will lift them in (noted in non-goals).

### D6 — Bundle is seed-only; degrade to cache offline.
`examples.js` is no longer imported by `state.js`/`attachLevels` at runtime — only by the seed
script (server-side, outside the Vite graph), so Vite drops it from the app bundle. A returning
client renders from the localStorage cache instantly; a brand-new client fetches on boot. A
brand-new client that is *also offline* shows no examples until its first online boot — the SAME
tradeoff Self-Talk already shipped (anon read stays, offline-first is being retired). Acceptable.

---

## Part A — Server (`wk-enhanced-api/`)

### A1. Repo: per-link read + example seed/reuse path + pins  *(commit 1)*

- **`src/db/schema.sql`** — comment-only: add `'example'` to the `source` enum comment on the
  `sentence` table; note `owner_type='card'` (owner_id=rank, tier=N5..N1) on `sentence_link`.
- **`src/db/client.ts`:**
  - **`assembleSentenceRow(row, link?)`** — accept an optional pre-resolved `SentenceLink`. When
    provided (from the choke-point join), use it instead of the `LIMIT 1` re-query, so per-link
    reads carry the *correct* link. Create/update/upsert single-link return values pass no override
    (keep the `LIMIT 1` path — Self-Talk + the seed return value).
  - **`getSentences({ ownerType, ownerId?, viewer })`** — change the choke-point to select the link
    columns in the JOIN and return **one assembled entry per matching link** (drop `DISTINCT`),
    ordered `s.id, l.id`. Keep the `WHERE l.owner_type = ? AND (s.public = 1 OR s.created_by = ?)`
    AND **unchanged**; AND an optional `l.owner_id = ?` when `ownerId` is supplied. This stays THE
    single privacy gate.
  - **`getPublicSentenceByHash(hash)`** — `SELECT … FROM sentence WHERE hash=? AND public=1 AND
    visibility='public'` (the partial-unique slice guarantees ≤1). Backs the reuse path.
  - **`seedExampleSentence({ text, furigana?, translations?, cardLinks: SentenceLink[] })`** — the
    example seed/reuse path (D3): `assertFuriganaMatches`; `hash = ttsTextHash(text)`; resolve via
    `getPublicSentenceByHash`. If absent → INSERT public row (`ext_id='ex-'+hash`,
    `source='example'`, furigana) + translations. If present and `source==='example'` → refresh
    furigana + replace translations (so a bundle fix propagates on re-seed); if present and foreign
    (e.g. a `selftalk` row) → leave the sentence + its translations untouched. Then **replace only
    the card links**: `DELETE FROM sentence_link WHERE sentence_id=? AND owner_type='card'` + insert
    each `cardLink`. Returns the assembled sentence.
- **`src/db/client.test.ts`** — extend the `sentence store privacy + ownership pins` describe:
  - **Per-link card read:** seed two card sentences with distinct (rank,tier) links → anon
    `getSentences({ownerType:'card'})` returns one entry per link, each with the right
    `link.owner_id`/`link.tier`.
  - **Reuse (example↔example):** `seedExampleSentence` for the SAME text under two different
    (rank,tier) `cardLinks` (one call, two links) → ONE `sentence` row, TWO `sentence_link` rows;
    the read returns two entries.
  - **Reuse (example↔selftalk):** an existing public `selftalk` row, then `seedExampleSentence`
    with the SAME text → still ONE `sentence` row (no hash-index violation); the selftalk read
    returns it once (selftalk link), the card read returns it once (card link); the selftalk row's
    text/translations are untouched.
  - **Idempotency:** running the example seed twice doesn't grow `sentence`/`sentence_link`/
    `translation` (counts stable).
  - **Privacy still holds:** a `public=0` card-linked row is invisible to anon `ownerType=card` and
    excluded from `public_sentence` (mechanism guard, even though examples are public).
  - **Gate:** `bun test` + `bun run typecheck`.

### A2. Route + schema: widen `ownerType`, add `ownerId`  *(commit 2)*

- **`src/schemas.ts`** — `SentenceListQuerySchema.ownerType` → `z.enum(['selftalk','card'])`; add
  `ownerId: z.string().optional()`. (`SentenceLinkSchema` already carries `owner_id`/`tier`.)
- **`src/routes/sentences.ts`** — pass `ownerId` through to `db.getSentences`. Unchanged otherwise
  (still `no-store`, still anon-readable for public rows, still in `STUDY_ROUTE`).
- **CORS:** already allowlisted (`/v1/sentences` ∈ `STUDY_ROUTE`); the anon card GET is credentialed
  like the selftalk one — no `index.ts` change.
- **Gate:** `bun run typecheck`; `curl` (Verification).

### A3. Seed: examples pass in `scripts/seed-sentences.ts`  *(commit 3)*

- Extend the existing seed (don't fork a new script). Import `EXAMPLES` from
  `../../study-app/src/data/examples.js` and `plainText`, `rubyToSegments` from
  `../../study-app/src/core/text.js`.
- Build a `Map<text, { text, furigana, translations:{en}, cardLinks:[] }>`: for each `rank`, each
  tier in `EXAMPLES[rank]`, take `[jp, en]`, compute `text = plainText(jp)`,
  `furigana = rubyToSegments(jp)` (assert `concat(t)===text`, name the offender on mismatch), and
  push a link `{ owner_type:'card', owner_id:String(rank), tier, ordinal:0 }`. Grouping by `text`
  collapses identical sentences so each unique text gets ONE `seedExampleSentence` call with its full
  card-link set. (Translations are first-wins per text; `console.warn` if a later identical text
  carries a different `en` — a data smell worth surfacing, not a failure.)
- `db.seedExampleSentence(...)` per unique text. Log `seeded N example sentences (M links across K
  cards)`. Re-run = no growth (idempotent). Keep the existing Self-Talk pass above it.
- **Prod:** the seed step already exists in the runbook; A6 adds the doc note.

---

## Part B — Client (`study-app/`)

### B4. Pure adapter `sentencesToLevels` + tests  *(commit 4)*

- **`src/core/examples.js`** — add a pure adapter next to `exampleForLevel` (analogous to
  `sentenceToPhrase`): **`sentencesToLevels(sentences)`** → `{ [rankStr]: { N5:[jp,en], … } }`. For
  each store sentence, read `link.owner_id` (rank) + `link.tier`; set
  `out[owner_id][tier] = [segmentsToRuby(furigana), translations.en]`. Ignore entries missing
  `owner_id`/`tier`/`furigana`. Import `segmentsToRuby` from `./text.js`. DOM-free.
- **`test/core.test.ts`** — add:
  - **Adapter grouping:** synthetic store sentences with `owner_type='card'` links group by
    rank+tier; reused sentence (two card links) lands under both ranks/tiers; ruby is reconstructed.
  - **Seed round-trip (the strong test):** build synthetic store sentences from the real `EXAMPLES`
    bundle (`text=plainText(jp)`, `furigana=rubyToSegments(jp)`, link per rank+tier) and assert
    `sentencesToLevels(...)` reconstructs `EXAMPLES[rank][tier] === [jp, en]` byte-for-byte (proves
    the seed→store→adapter loop). Import `EXAMPLES` directly here (the test is now the only place it
    is read besides the seed).
  - Keep the existing **bundle-integrity** test (all 100 cards × 5 well-formed tiers) but import
    `EXAMPLES` directly rather than via `attachLevels`/`v.levels`.
  - **Gate:** `bun run test` + `bun run build`. Pure-only; no behavior shift yet.

### B5. Deck fetches examples from the store (read-through cache)  *(commit 5 — the cut-over)*

- **`src/persistence/examples.js`** (new) — `loadExampleCache()/saveExampleCache(levels)` over
  `localStorage["jpverbs_examples_cache"]` (the `{ [rank]: {N5:[jp,en],…} }` model), try/catch like
  `selftalk.js`.
- **`src/state.js`** — add `state.exampleLevels` and hydrate it **synchronously at module eval**
  from `loadExampleCache()` (so the first `attachLevels()` at `main.js:47` already has cached
  examples). Change `attachLevels()` to read `state.exampleLevels[v.rank] || v.levels || null`
  instead of `EXAMPLES[v.rank]`. **Remove the `import { EXAMPLES }`** from `state.js` (no longer read
  at runtime; leave a one-line comment that `examples.js` is now seed-only). `ACCENTS`/`cat`
  defaulting is unchanged. (Minna custom cards keep their embedded `v.levels` via the `|| v.levels`
  branch since they have no store card link.)
- **`src/features/examples.js`** (new) — `initExamples()`: `api('/v1/sentences?ownerType=card')` →
  `sentencesToLevels` → set `state.exampleLevels` → `saveExampleCache(...)` → `attachLevels()` →
  re-render the live example if a session is active (`renderExample(session.deck[session.i])`) /
  refresh Browse if open. Degrade to cache on failure (don't blank existing levels). Fire-and-forget
  from `main.js` after the deck build (mirror Self-Talk's `showSelftalk` instant-paint-then-refresh).
- **`src/main.js`** — call `initExamples()` once at boot (not awaited).
- **Gate:** `bun run test` + `bun run build`; preview-verify the flashcard answer-side example + the
  Browse detail modal render the same sentences, the tier selector works, `#exSpeak`/`plainText`
  audio key is unchanged, offline (kill the API) still renders from cache.

---

## Commit sequence (one logical change each)

1. **server: per-link sentence read + example seed/reuse repo path + pins** (A1)
2. **server: /v1/sentences ownerType=card + ownerId query** (A2)
3. **server: seed-sentences gains the built-in examples pass** (A3)
4. **study-app: sentencesToLevels adapter + seed round-trip tests** (B4)
5. **study-app: deck fetches examples from the store (read-through cache)** (B5)
6. **docs: deploy runbook note + CLAUDE.md/SELFTALK-style updates** (A6 / below)

Each is independently shippable; the bundle path stays intact until B5 cuts over (no flag day).

### A6 / docs (commit 6)
- `wk-enhanced-api/deploy/README.md` — note the seed step now also seeds examples (same command,
  `bun scripts/seed-sentences.ts`; the prod seed step already exists — no new step, just scope).
- `wk-enhanced-api/CLAUDE.md` (sentence-store bullet) + `study-app/CLAUDE.md` (leveled-examples
  bullet + the `examples.js`-is-seed-only / `jpverbs_examples_cache` note) — record the cut-over.
- Update the memory note `sentence-store-rearchitecture.md` Phase 2 line to ✅ shipped with the
  per-link-read + `ex-<hash>` + custom-deferred deviations.

---

## Gotchas / invariants to preserve

- **`text` must be `plainText(jp)` byte-for-byte** — the audio key. Never normalize/trim in the
  seed. Examples have no bunsetsu spaces; just `plainText` + `rubyToSegments`.
- **`hash = ttsTextHash(text)` server-side only;** the client/adapter never hash. The deck groups by
  `link.owner_id`/`tier`, not by hash.
- **Tier on the LINK, never the sentence.** `ext_id = 'ex-<hash>'` is per-sentence; `(rank,tier)` is
  per-link. A reused sentence = one row, many links.
- **Reuse by hash, not ext_id.** `seedExampleSentence` resolves `getPublicSentenceByHash` first;
  inserting `ex-<hash>` blindly would violate the partial unique `hash` index against an existing
  public row (selftalk or already-seeded). Don't route examples through `upsertPublicSentence`.
- **Per-link read must keep the privacy `WHERE` unconditional** — `(public=1 OR created_by=:viewer)`,
  fail-closed on null viewer. Per-link is a JOIN/projection change only; the Phase-1 breach pins must
  stay green.
- **`owner_id` is TEXT (`String(rank)`).** Object property access coerces (`obj[1]===obj['1']`), so
  `attachLevels` can look up `state.exampleLevels[v.rank]` with a number — but the adapter keys with
  the string verbatim.
- **`v.levels` fallback order is `store || embedded || null`** — Minna cards' embedded `levels` and
  the `|| v.levels` branch must survive; only built-ins (rank ≤100, store-linked) come from the
  store.
- **Custom-card `ex` stays on the blob** (`exampleForLevel`'s `v.ex` fallback) — D5, deferred.
- **Bundle is seed-only.** Don't re-import `EXAMPLES` into `state.js`/`attachLevels`; that would
  re-bundle it and re-couple runtime to the bundle.

---

## Verification (end-to-end)

**Server (`wk-enhanced-api/`):** `bun test` (per-link + reuse + idempotency pins) + `bun run
typecheck`. Then `bun dev`:
- `bun scripts/seed-sentences.ts` → seeds the Self-Talk built-ins (unchanged) + the example
  sentences; re-run → no growth.
- Anon `curl 'http://localhost:3000/v1/sentences?ownerType=card'` → public example sentences, one
  entry per (card,tier) link with `link.owner_id`/`link.tier`.
- `curl '…?ownerType=card&ownerId=1'` → only rank-1's tiers.
- Reuse check: pick a sentence that two cards/tiers share (or contrive one) → confirm ONE `sentence`
  row + N `sentence_link` rows in SQLite; the read returns N entries.
- Self-Talk read (`?ownerType=selftalk`) is byte-for-byte unchanged.

**Study-app (`study-app/`):** `bun run test` (adapter + seed round-trip) + `bun run build`. Then
`bun run dev` (+ `bun dev` in the API):
- Flashcard: answer-side example renders, the N5–N1 tier selector works, `#exSpeak` plays
  `plainText` (same audio), `#exCopy` copies — for a built-in card, same sentences as before.
- Browse detail modal: leveled examples + `#dExSpeak` render the same sentences; the modal's tier
  filter is a local view.
- Cache: reload with the API up (fast paint from cache, then refresh); then stop the API and reload
  → examples still render from `jpverbs_examples_cache` (degrade, don't blank).
- A custom card still shows its `ex` example (unchanged fallback).

---

## Explicit non-goals (later phases)

- **Custom-card `ex` → store** as private `owner_type='card'` rows + a `custom-verbs`-blob migration
  (Phase 2.5).
- Minna → store (`public=0`; grammar-point/conversation ids) (Phase 3).
- GiNZA / NLP enrichment + the highlight popover (Phase 4; `sentence_annotation` stays unused).
- Grammar search over `sentence_tag`; global offline-first removal (separate sweeps).
