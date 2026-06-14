# Kickoff prompt — Templates → Sentence Store, **Slice 2** (lazy materialization + tooling)

Paste everything below the line into a fresh Claude Code session (run from `~/Development/WaniKani`).

---

We're continuing the 独り言 Self-Talk slot-swap **TEMPLATES → sentence store** work. **Slice 1
(template STRUCTURE in the DB) is SHIPPED and merged to `main`.** This session is **Slice 2: lazily
materialize a template's realizations as real `sentence` rows so the store tooling (NLP tap-to-lookup,
TTS pre-gen, grammar search, export, de-dup) covers the combos people actually use.**

**The full design, plan, phasing, and open questions are in [SENTENCE_STORE_TEMPLATES.md](SENTENCE_STORE_TEMPLATES.md)
— READ THAT FIRST; it is authoritative** (esp. "Part 2 — lazy, on-demand materialization", the
"What tooling works when" table, and the Slice-2 open questions). Don't re-derive the design; it's decided.

## What Slice 1 already shipped (don't rebuild it)

- **Table:** `sentence_template` (skeleton + slots + fillers; `public`/`visibility`/`created_by`) +
  a `public_template` VIEW (`wk-enhanced-api/src/db/schema.sql`).
- **Repo (`src/db/client.ts`):** `getTemplates({source?, viewer})` — the **literal mirror** of the
  `getSentences` `VIEWER_VISIBLE` gate via a `TEMPLATE_VIEWER_VISIBLE` fragment; `upsertPublicTemplate(...)`
  (curator seed, idempotent by ext_id); types `AssembledTemplate`/`TemplateSlot`/`TemplateFiller`.
- **Privacy:** a pinned breach-test block ("sentence_template privacy + ownership pins") in
  `src/db/client.test.ts`.
- **Route:** `GET /v1/templates[?source=]` (`src/routes/templates.ts`), schemas in `src/schemas.ts`
  (`TemplateSchema` etc.), mounted in `src/index.ts` + added to the `STUDY_ROUTE` CORS allowlist.
- **Seed:** `scripts/seed-sentences.ts` **Pass 3** → `upsertPublicTemplate` (18 templates).
- **Client:** `study-app/src/features/selftalk.js` fetches via `refreshTemplates()` → `storeTemplates`
  (read-through cache `jpverbs_selftalk_templates_cache`), local `templatesForTopic`; the realize/render
  code (`core/selftalk.js` `realizeTemplate`/`cyclePick`, `templateCardHtml`) is unchanged.
  `data/selftalk-templates.js` is now the **seed source**, not imported at runtime.

READ, in order:
1. **SENTENCE_STORE_TEMPLATES.md** — design + decided approach + phasing + Slice-2 open questions. START HERE.
2. The Slice 1 code above (so you build on it, not around it) — `client.ts` `getTemplates`/`upsertPublicTemplate`,
   `routes/templates.ts`, `seed-sentences.ts` Pass 3, `features/selftalk.js` fetch + the realize handlers.
3. **The materialization MODEL to copy:** `db.seedExampleSentence` (reuse-by-hash via
   `getPublicSentenceByHash` + `assertFuriganaMatches` + server-computed `ttsTextHash`) and the vocab
   lazy-warm pattern. `sentence_link` (the polymorphic owner; you'll add `owner_type='template'`),
   `createSentence`/`upsertPublicSentence` for the insert shape.
4. `study-app/src/core/selftalk.js` `realizeTemplate` (returns `{jp, read, mean, text}`; `text` =
   `plainText(jp)`, the materialization text; `rubyToSegments(jp)` → furigana segments) — the client
   already derives everything the materialize call needs.
5. `wk-enhanced-api/CLAUDE.md` "Sentence store" + SENTENCE_STORE_NLP.md — the `getSentences`
   `VIEWER_VISIBLE` choke-point, the offline-only NLP, and the invariants
   (text==plainText, server-computed hash, concat(seg.t)===text furigana).

THE DECIDED APPROACH (don't re-litigate — settle only the listed open questions):
- Realizations are **LAZILY MATERIALIZED** — the first time a user requests a given combo, the server
  inserts a PUBLIC `sentence` row (`source='template'`), **idempotent by hash** (re-request → existing
  row), **linked via `sentence_link(owner_type='template', owner_id=<template ext_id>, role=<combo key>)`**.
  **No pre-generation** of the combo space.
- **Copy the template's curated `grammar` onto the combo row** as `sentence_tag(kind='grammar')` so
  grammar search includes it immediately (before any NLP).
- **NLP tap-to-lookup LAGS** until the next offline `parse.py` → `seed-annotations.ts` re-parse (no
  Python on prod); a freshly-materialized combo degrades to plain ruby until then (existing fallback).
- **Record-compare keeps keying on the SKELETON id (template ext_id)** — do NOT switch the itemKey to
  the materialized combo's sentence id.

SLICE 2 SCOPE:
- **`POST /v1/templates/{extId}/realize`** — body carries the picks (+, per the open Qs, likely the
  realized `{text, furigana, translations}` the client already derives). Server validates the furigana
  invariant, computes `hash` server-side, upserts the public `sentence` row idempotent-by-hash, attaches
  the `owner_type='template'` link + the grammar tags, returns the assembled sentence.
- A repo fn (e.g. `materializeTemplateRealization(...)`) mirroring `seedExampleSentence`'s reuse-by-hash,
  + its own tests; a schema + the route (in `STUDY_ROUTE`).
- **Client:** request materialization at the chosen trigger (see open Q #2); keep playing via the lazy
  TTS path otherwise; keep record-compare on the skeleton id.
- **Offline NLP** picks up the materialized public rows on the next batch (they're public `sentence`
  rows) — document the lag; no prod Python.

SETTLE THESE OPEN QUESTIONS FIRST (propose-with-a-recommendation → I pick → then build):
- **#1 Furigana for materialized combos:** client-sends-`{text,furigana}`-and-server-validates
  (reuses `realizeTemplate`'s output) vs. server-reconstructs-from-structure+picks.
- **#2 Materialization trigger:** on first ▶ play / tap-to-lookup / record, or proactively for the
  default combo? (Cheapest: trigger when a canonical sentence is first needed — tap-to-lookup or record.)
- **#4 Grammar at materialization:** copy the template's curated `grammar` tag onto the combo row
  (recommended).
- **#6 `source` value** for materialized combo rows (`'template'`?) and whether they appear in the
  Self-Talk `GET /v1/sentences?ownerType=selftalk` set or only via the template owner link.
  (#3 route shape and #5 user-authored templates were settled in Slice 1.)

INVARIANTS / GATES:
- Preserve: `text == plainText(jp)` byte-for-byte; **server-computed** `hash = ttsTextHash(text)`;
  furigana `concat(seg.t) === text`; the public-slice partial-unique-by-hash index (reuse, don't
  duplicate); the `getTemplates`/`getSentences` `VIEWER_VISIBLE` gates stay fail-closed (+ their pinned
  breach tests green); Self-Talk anon-readable + account-gated authoring/recording; **record-compare keys
  on the SKELETON id** (template ext_id) — NOT the combo sentence id; `ext_id`s immutable; design system +
  no-framework + `core/*` DOM-free & unit-tested. Built-in content is model-generated → proofread.
- ENV (this machine): dev API on :3000 + Vite on :5173 are usually already running — DON'T kill them
  (if you must browser-verify, the API CORS only allowlists `http://localhost:5173`, so the preview must
  own :5173 — ask before taking it). Dev DB per local `.env` = `wk-enhanced-api/dev-data/wk-vocab.sqlite`
  (re-seed after seed/content changes; note the `.env.example` default is `wk-enhanced-api.sqlite`). Bash
  cwd persists — cd explicitly.
- GATES: study-app `bun run test` (Vitest + happy-dom) AND browser-verify via the preview tooling;
  wk-enhanced-api `bun test` + `bun run typecheck` (+ `bun run build` for the study app). One logical
  change → one commit; commit at the end of the slice without being asked; update SELFTALK.md + the
  SENTENCE_STORE_* docs + the `CLAUDE.md`s + fix stale nearby comments in the same commit.
- BRANCH: Slice 1 is merged to `main`. **Branch Slice 2 fresh from `main`.**

Start by reading the docs above, then propose the Slice 2 plan + settle its open questions (#1, #2, #4, #6) with me.
