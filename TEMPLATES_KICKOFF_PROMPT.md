# Kickoff prompt — Templates → Sentence Store

Paste everything below the line into a fresh Claude Code session (run from `~/Development/WaniKani`).

---

We're integrating the 独り言 Self-Talk slot-swap **TEMPLATES** into the server sentence store — moving
them out of the client-only JavaScript bundle so the content is DB-sourced and the store tooling
(NLP tap-to-lookup, TTS pre-gen, grammar search, export, de-dup) can cover template realizations.

**The full design, plan, phasing, and open questions are in [SENTENCE_STORE_TEMPLATES.md](SENTENCE_STORE_TEMPLATES.md)
— READ THAT FIRST; it is authoritative.** Don't re-derive the design; it's already decided.

READ FIRST, in order:
1. **SENTENCE_STORE_TEMPLATES.md** — the design + decided approach + phasing + open questions. START HERE.
2. study-app/SELFTALK.md "Templates (slot-swap)" — the current client-only feature.
3. study-app/src/data/selftalk-templates.js, src/core/selftalk.js (`realizeTemplate`/`cyclePick`),
   src/features/selftalk.js (`templateCardHtml` + the slot-swap handlers + the grid tally) — current code.
4. SENTENCE_STORE_NLP.md + wk-enhanced-api/CLAUDE.md "Sentence store" — the store schema, the
   `db.getSentences` VIEWER_VISIBLE privacy choke-point, and the invariants
   (text==plainText, server-computed hash, concat(seg.t)===text furigana).

THE DECIDED APPROACH (don't re-litigate — settle only the listed open questions):
- A new **`sentence_template` table** holds the template structure (skeleton + slots + fillers), curator-
  seeded from `data/selftalk-templates.js` (which becomes the seed source, like `data/selftalk.js` for
  phrases), served via the API; the client **fetches** it instead of importing the bundle.
- Realizations are **LAZILY MATERIALIZED**: the first time a user requests a given config (combo), the
  server generates that realization as a real `sentence` row on demand (idempotent by hash, linked to the
  template) so the store tooling covers the combos people actually use — **no pre-generation** of the full
  combo space.
- **NLP tap-to-lookup tokens LAG** until the next offline re-parse (NLP is offline-batch only — no Python
  on prod); a freshly-materialized combo degrades to plain ruby until then (the existing fallback).

PHASING — do **Slice 1 first** and get the maintainer's sign-off before Slice 2:
- **Slice 1 — structure in DB:** the table + the privacy gate (+ `public_template` view + a pinned breach
  test) + a seed pass + `GET /v1/templates` + the client fetch/cache replacing the JS import. The slot-swap
  UI stays unchanged, just DB-sourced. Content leaves JavaScript. Verify the UI still works.
- **Slice 2 — lazy materialization + tooling:** `POST /v1/templates/{id}/realize` + `sentence_link`
  `owner_type='template'` + the client requesting materialization at the right moment + the grammar-tag
  copy + the offline NLP picking up the materialized combos.

BEFORE WRITING CODE for each slice: propose a short plan and settle that slice's open questions
(SENTENCE_STORE_TEMPLATES.md "Open questions") WITH me — propose-with-a-recommendation, I pick, then build
in slices. Same collaborative pattern as the rest of this feature.

INVARIANTS / GATES:
- Preserve: text==plainText byte-for-byte; server-computed hash; concat(seg.t)===text furigana; a template
  read path that MIRRORS the getSentences VIEWER_VISIBLE predicate (public OR created_by=viewer), fail-
  closed, with its own pinned breach test; Self-Talk anon-readable + account-gated authoring/recording;
  record-compare keys on the SKELETON id (don't switch to the combo's sentence id); ext_ids immutable;
  design system + no-framework + core/* DOM-free & unit-tested. Built-in content is model-generated →
  proofread.
- ENV (this machine): dev API on :3000 + Vite on :5173 are usually already running — DON'T kill them. Dev
  DB: wk-enhanced-api/dev-data/wk-vocab.sqlite (re-seed after seed/content changes). Bash cwd persists —
  cd explicitly.
- GATES: study-app `bun run test` (Vitest + happy-dom) AND browser-verify via the preview tooling;
  wk-enhanced-api `bun test` + `bun run typecheck`. One logical change → one commit; commit at the end of
  each slice without being asked; update SELFTALK.md + the SENTENCE_STORE_* docs + fix stale nearby
  comments in the same commit.
- BRANCH: the template feature lives on `selftalk-grid` (8 commits ahead of `main`, not yet merged).
  Confirm with me whether to branch this work from `selftalk-grid` or from `main` after a merge.

Start by reading the docs above, then propose the Slice 1 plan + settle its open questions with me.
