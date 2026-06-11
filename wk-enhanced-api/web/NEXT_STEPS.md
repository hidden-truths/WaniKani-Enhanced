# NEXT_STEPS — Japanese Verb Trainer (web study app)

What to do next, priority-ordered. Builds on the `OUTSTANDING WORK` block at the
top of [index.html](index.html); this file supersedes it where they disagree.
Architecture + dead-ends: [CLAUDE.md](CLAUDE.md). User overview: [README.md](README.md).
Card schema + authoring: [CARDS.md](CARDS.md).

The original backlog plus a large second wave (accounts + sync, SRS vs free study, the
file split, leveled examples, the みんなの日本語 dashboard with content/dedup/pitch, deck-wide
pitch accent) have all shipped. The app has **outgrown "a few static files on the API
droplet."** The headline next move is structural, below.

## 🚩 THE BIG ONE — split into two apps: the learning tool and the API

**The decided topology (a requirement, not just an option).** Two **separate
applications**, each in its **own Docker container**, **co-located on the same
DigitalOcean droplet**:

- **Learning tool** (this study app) — its own project/repo + container — served at the
  apex **`https://wkenhanced.dev`**.
- **API server** (`wk-enhanced-api`) — its own container — served at
  **`https://api.wkenhanced.dev`** (auth, progress, TTS, Minna, vocab/warm).

One droplet, one `docker compose` with **two services**, one Cloudflare Tunnel with two
ingress rules (apex → tool container, `api.` → API container). The API **stops serving the
web app**; the learning tool **stops living in `wk-enhanced-api/web/`**. They communicate
over HTTP across the two hostnames — which makes them cross-origin (see constraints).

**Why now.** This started as a side surface of the API server (`wk-enhanced-api/web/`,
classic-script files served at the apex) and has become a full product: four tabs,
email/password accounts + cross-device sync, a Leitner SRS, the みんなの日本語 workbook,
pitch accent, ~2,300 lines of `app.js` in a **single global scope**, plus growing data
modules (`verbs.js`/`examples.js`/`ACCENTS`/`data/minna/*`). It's conceptually independent
of the userscript+API — it just shares the droplet. The no-build / one-giant-file model is
now the main thing slowing changes. Give it its **own project, a real module structure, a
build/test setup, and its own deploy.**

**Target shape.**
- Its own top-level project (a repo, or a workspace package under this repo) — e.g.
  `study-app/` — instead of `wk-enhanced-api/web/`.
- `app.js` split into **ES modules along the existing section banners**: `storage`+SRS,
  `deck`/facets (`passes`/`wireFacets`), `flashcard`, `browse`, `stats`/charts, `minna`,
  `cloud`/sync, `settings`, plus `verbs`/`examples`/`accents` as data modules and a thin
  entry that wires them.
- A Vite (or equivalent) dev server with HMR + a build, served from its **own lightweight
  container** (nginx or a tiny Bun static server) at `wkenhanced.dev` — *not* baked into the
  API image. Replace the `verbs-core.test.ts` concatenation hack with real module imports
  under jsdom/happy-dom.

**Constraints that make this non-trivial (decide these first).**
- **`file://` offline use vs ES modules.** Today `index.html` opens directly over `file://`
  because everything is classic `<script src>` — browsers **won't** load ES modules over
  `file://`. So "modules" and "double-click the file" are in tension. Decision: adopt a
  bundler (Vite) that outputs a single/inlined offline build, **or** stay classic-script and
  only modularize via an IIFE-per-file convention. (Recommend Vite + a `build` that produces
  an offline-capable bundle; the account/TTS/Minna features already need a server anyway.)
- **Cross-origin auth — the headline consequence of splitting.** The backend stays put
  (`/v1/auth/*`, `/v1/progress/*`, `/v1/tts`, `/v1/minna/*`, `/v1/sessions` on the API), but
  `wkenhanced.dev` (tool) and `api.wkenhanced.dev` (API) are **same-site yet cross-ORIGIN**.
  The httpOnly session cookie works today *only because* the app is served same-origin with
  the API; once it's a separate container the cookie must be **shared across the subdomains**:
  - **Cookie**: set `Domain=.wkenhanced.dev` (so it reaches both the apex and `api.`),
    `SameSite=Lax` (subdomains count as same-site, so the cookie rides cross-origin fetches),
    `Secure`, `HttpOnly`. Update `lib/auth.ts` (`COOKIE_DOMAIN` config).
  - **CORS with credentials**: the auth/progress/minna/sessions routes must answer the tool's
    origin specifically — `Access-Control-Allow-Origin: https://wkenhanced.dev` (an explicit
    origin, **never `*`** with credentials), `Access-Control-Allow-Credentials: true`, plus
    preflight handling. This is a **different policy** from the blanket
    `Access-Control-Allow-Origin: *` the *userscript's* vocab routes use (and `*` is
    incompatible with credentials), so the server needs an origin-scoped CORS branch for the
    study-app routes.
  - **Client**: the tool's `fetch` calls add `credentials:'include'` (they're same-origin
    today and don't). `COOKIE_SECURE=false` over `http://localhost` still applies in dev.
  This rework is **required** by the two-container topology — the old "just stay same-origin"
  escape hatch is off the table by decision.
- **Preserve the design-system contracts + dead-ends** in [CLAUDE.md](CLAUDE.md) (chip
  wiring by class/`data-*`, roving-tabindex radiogroups, the inline-SVG-sprite trap, the
  six AND'd facets, the `.frow/.chips` layout) and the [CARDS.md](CARDS.md) data model
  through the refactor — they're load-bearing.
- **Don't reflexively adopt a framework.** The hand-rolled SVG charts + no-dependency ethos
  are a feature; a module split + Vite likely suffices. Reach for a framework only if the
  UI complexity genuinely demands it.

**Phased plan (each step shippable, reversible).**
1. Move `web/` → a dedicated project dir/repo (`study-app/`). The API keeps serving it
   byte-for-byte *for now* (no behavior change) to establish the boundary cheaply.
2. Introduce the build tool (Vite) with the current files as-is; wire dev/preview to it.
3. Split `app.js` into modules incrementally (one section per commit); port the
   `verbs-core.test.ts` coverage to real imports.
4. Move `verbs`/`examples`/`accents`/Minna data to typed data modules.
5. **Stand up the learning-tool container** (a static server for the built assets) as a
   second service in `compose.yaml`; add a Cloudflare Tunnel ingress `wkenhanced.dev → tool
   container`, remove the apex ingress from the API, and **delete the API's static `web/`
   routes** (`/`, `/study`, `/styles.css`, …). Now two containers, one droplet.
6. **Flip auth to cross-origin** (the constraint above): cookie `Domain=.wkenhanced.dev`,
   origin-scoped credentialed CORS for the study-app routes, `credentials:'include'` in the
   tool. Verify login + progress/custom/settings/minna sync + the Minna owner-gate all work
   across the two origins. Update `deploy/README.md` + the dev↔prod parity table.

This is the priority. The items below are smaller and can follow.

## Done (most recent first)
- ~~みんなの日本語: content parity, dedup, pitch accent~~ — **shipped.** Activated Minna
  cards were second-class (no examples/mnemonics, duplicated built-ins, flat TTS pitch).
  Now: (1) words that match a built-in verb **reuse it** via a synced provenance overlay
  (`minnaStore.overlays`) — no duplicates, they inherit the built-in's examples+mnemonic;
  (2) the 47 genuinely-new words got **generated** N5–N1 examples (ruby furigana) +
  mnemonic + trap/tip (a 48-agent workflow, validated) so they reach parity; (3) **pitch
  accent** is shown visually (`pitchHtml` overline+drop notation, per-word `accent`) since
  Google TTS can't be pitch-controlled — and TTS now sends the **kanji** headword so the
  audio accent improves for homographs (橋≠箸). Model-generated content — worth a proofread.
  Re-activate a lesson ("Update N tags") to pull the content onto already-added cards.
- ~~みんなの日本語: iTalki tag + Source filter + lessons 22 & 24~~ — **shipped.** An
  `italki:true` flag in the lesson JSON marks words covered in the maintainer's iTalki
  lessons (all of L23, from `~/Downloads/lesson23_vocab.txt`); activated cards gain an
  `iTalki` tag + flag and a vocab-table badge. A new **`source` filter facet** (a sixth
  AND'd facet: みんなの日本語 / iTalki / per-lesson `L22·L23·L24`) studies any provenance
  slice from the normal deck — hidden until the deck has Minna cards, chips tinted to
  match the badges. Re-activation now PATCHES metadata (the button shows "Update N tags")
  so already-added cards pick up the iTalki tag without a delete/re-add. Browse cards
  decluttered (provenance badge replaces the redundant みんなの日本語/lesson tag chips).
  **Lessons 22 (noun-modifying clauses) and 24 (giving & receiving)** curated from the
  scraper into `data/minna/lesson-<n>.json`. The Minna roadmap (Phase 2, furigana, …)
  still lives in [MINNA.md](MINNA.md). Verified live; 25 web-core tests (4 new).
- ~~みんなの日本語 dashboard (Chapter 23)~~ — **shipped.** A 4th, **account-gated** tab:
  a Minna no Nihongo lesson dashboard (vocab with native audio, grammar, example
  sentences, conversation) fetched at runtime from `/v1/minna/*` (signed-in only — the
  copyrighted content never reaches anon visitors). Vocab "activates" into the SRS deck
  as tagged custom cards (`みんなの日本語` + `mnn-l<n>`, dictionary form); per-lesson notes
  sync under the new `minna` app key. Content is curated in `data/minna/lesson-23.json`
  from the `scripts/scrape-minna.ts` extractor. Verified end-to-end (gated 401s, render,
  audio proxy+cache, deck merge, notes sync) desktop + mobile. See the みんなの日本語
  dead-end in [CLAUDE.md](CLAUDE.md). **Next: Phase 2** (record-and-compare, below).
- ~~Multi-category content (de-verb-ify, the UI half)~~ — **shipped.** A `cat` filter
  facet (`verb/adjective/noun/adverb/phrase`) leads both filter panels as a fifth
  AND'd facet; the Type + Transitivity rows are `.verb-only` and hide (`syncVerbRows`)
  when the category excludes verbs. The add-card modal gained a Category picker —
  `syncVerbFields` shows Type for verbs+adjectives (い/な = `i-adj`/`na-adj`) and
  Transitivity for verbs only. `cardStamp`/`colorClass` paint per-category spine +
  hanko stamp (teal/amber/rose/slate accents); `annotateCatChips` dims empty
  categories. Tests added. **Remaining transition work** (now the only "Ideas" item
  with teeth): conjugation drills, and proofed built-in non-verb *content* — the
  dataset is still 100 verbs; categories are a capability users populate.
- ~~Design-polish pass (4 commits)~~ — **shipped.** (1) Responsive/bug fixes: mobile
  toolbar wrap, modal-× pin, empty-session → picker, ≥40px tap targets. (2) Readability:
  `--muted` darkened to AA, chart titles de-uppercased (uppercase = short labels only),
  bigger small labels. (3) Chip/picker: tinted (not solid-ink) active chips, secondary
  rows collapsed behind a "More filters & options" `<details>`. (4) Motion: reveal /
  card-advance / modal / tab / stats / bar entrance animations + press feedback, all
  gated by `prefers-reduced-motion` (which now kills `animation` too).
- ~~Free study advances due cards (setting)~~ — **shipped.** New `freeReviewDue`
  setting (default on): grading an already-due card in free study advances its SRS
  schedule; not-due cards are still never touched. Gate in `grade`.
- ~~Header click/select bug~~ — **fixed.** The inline SVG sprite was hidden via
  `width="0" height="0"` attributes, which the global `svg{width:100%;height:auto}`
  chart rule overrode → a full-width invisible overlay over the header in
  Firefox/Safari (height:auto → ~150px there). Now hidden via inline style.
- ~~De-verb-ify groundwork~~ — **shipped (partial, by design).** Renamed to
  日常日本語 / "Japanese Trainer", dropped "verbs-only" framing from the headers/
  empty-states, and tagged every card with `cat:'verb'` (`attachLevels` default +
  `saveVerb`). The verb-conjugation UI (Type filter, Add-verb modal, `type` field)
  is still verb-shaped — finishing that is the "multi-category content" idea below.
- ~~Jisho dictionary links~~ — **shipped.** Each card links out to
  `https://jisho.org/word/<headword>` (`jishoUrl`): on the flashcard answer side
  and in the Browse detail modal, opening in a new tab. New `i-external` icon.
- ~~SRS vs free study~~ — **shipped.** "Study type" picker toggle (`cfg.kind`):
  free study practices any deck and never changes review dates; SRS review serves
  only due cards and reschedules them. `grade` only reschedules when
  `kind==='srs' && isDue` (so an early review can't promote a card). Sessions are
  tagged with `kind` (local + the durable `details.kind`); Stats shows separate
  SRS-reviews / Free-study-reviews counts (with per-kind accuracy on hover).
- ~~Romaji typed input~~ — **shipped.** Typed-reading mode now accepts romaji:
  `romajiToKana` (greedy Hepburn + wāpuro variants, sokuon/ん handling) folds the
  input to hiragana before the `normKana` compare. Kana/IME typists are unaffected
  (non-romaji passes through). Tests in `verbs-core.test.ts`.
- ~~Visual SRS box indicator~~ — **shipped.** The Browse detail modal's
  "Box N · next review" text is now a 5-segment Leitner track (lit pips in
  `BOX_COLORS` maturity tones) + box number + a "next review" chip that flips red
  ("due now") when due. `detailMemoryLine`.
- ~~Upcoming-review forecast~~ — **shipped.** Study panel "Upcoming reviews" card:
  a vertical-bar timeline of how many scheduled cards come due, with a
  24h/Week/Month/Year horizon toggle (`reviewForecast`/`renderForecast`,
  refreshed from `updateDueBanner`). Tests for the bucketing.
- ~~Browse detail modal~~ — **shipped.** Clicking a Browse card opens a modal (not an
  inline expand); Mnemonic/Trap/Examples are collapsible, examples JLPT-level-filtered.
- ~~Settings page (DB-backed)~~ — **shipped.** Toolbar gear → modal: default example
  level, furigana show/hide, default answer mode, audio. Stored in `jpverbs_settings`,
  synced as app `settings`. Furigana is a global `<html data-furigana>` CSS flip.
- ~~More grading keys~~ — **shipped.** After reveal: Space/Enter/2 = correct, X/1 = wrong.
- ~~Durable session history~~ — **shipped.** Append-only `study_sessions` table +
  `POST /v1/sessions`; `endSession` logs every session so nothing is lost beyond the
  capped local `store.sessions` (now 1000, charts only). A GET/aggregate view is a
  future add — the data is already captured.
- ~~Leveled example sentences~~ — **shipped.** `examples.js` (`EXAMPLES`) holds five
  JLPT tiers (N5→N1) per built-in verb. Answer-side N5–N1 selector (`renderExample`,
  pref `jpverbs_exlevel`) + Browse leveled list; `exampleForLevel`/`availableTiers`
  with fallback to `ex`; tests in `verbs-core.test.ts`. Sentences are model-generated
  + format-validated (see the dead-end in CLAUDE.md) — worth a human proofread pass.
- ~~The file split (in-file #7)~~ — **shipped.** index.html → index.html + styles.css
  + verbs.js + app.js, classic scripts (not modules) so `file://` still works; the
  server serves the three new assets statically. `verbs-core.test.ts` concatenates
  verbs.js + app.js.
- ~~Google TTS~~ — **shipped.** `GET /v1/tts` proxies Google Translate TTS (cached);
  `speak()` plays it via `<audio>` when served over http, falling back to Web Speech
  over `file://` or on failure. Replaces the uneven browser speechSynthesis voices.
- ~~Cloud-sync custom verbs~~ — **shipped.** Second synced blob (server `app` key
  `custom-verbs`); add/edit/delete propagate (removals too); server wins on login.
- ~~Add / edit / delete custom verbs (in-file #3)~~ — **shipped.** "Add verb" in
  Browse opens a modal; custom verbs persist in `jpverbs_custom` and merge into
  `DATA` (rebuildData) so they join the deck/filters/stats; CUSTOM badge + Edit/
  Delete on each. MAXRANK extends the rank filter past 100.
- ~~A test suite for the pure core (in-file #8)~~ — **shipped.** `web/verbs-core.test.ts`
  concatenates verbs.js + app.js and runs them under a DOM stub (bun:test); covers
  passes/facets/scheduleCard/isDue/rollingAcc/isLeech/normKana/filterSummary.
- ~~Category vs Semantic as separate AND'd facets (in-file #2)~~ — **shipped.** Four
  AND'd facets (type/trans/topic/status) via `wireFacets` + `TOKEN_FACET`; "Godan +
  Motion" now intersects. Single "All" chip clears all facets.
- ~~Stats line charts too basic~~ — **shipped.** Axis caption, dashed average line,
  per-point value labels, area fill, `<title>` hover readouts, theme-aware gridlines.
- ~~Sign-up banner timing~~ — **shipped.** Deferred from first paint to after the
  first completed session (`maybeShowSignup`).
- ~~JLPT N2/N1 near-empty filters (in-file #5)~~ — **shipped.** `annotateJlptChips`
  disables (dims) levels with zero verbs + tooltips counts; roving nav skips them.
- ~~Rate limiting on `/v1/auth/*`~~ — **shipped (server).** Per-IP in-memory limiter
  ([../src/lib/rateLimit.ts](../src/lib/rateLimit.ts)): login 20/15min, register
  8/hr → `429 {code:'rate_limited'}` + Retry-After.
- ~~Typed-reading mode + TTS (in-file #1)~~ — **shipped.** Input toggle auto-grades
  typed kana (`normKana`/`submitTyped`, advisory verdict); Audio toggle + speaker
  buttons play the reading via `speechSynthesis`. Prefs persist.
- ~~Keyboard navigation for chip groups (in-file #4)~~ — **shipped.** `setupRoving`
  roving-tabindex per `.chips`/`.topic-inner`; arrows/Home/End, role=group + labels.
- ~~ARIA radiogroup semantics for single-select chip rows~~ — **shipped.** Study
  type / Test direction / Input / Audio / Order declare `role="radiogroup"` in the
  markup; `setupRoving` makes their chips `role=radio` with synced `aria-checked`
  and arrows move the SELECTION (not just focus). Multi-select facet rows stay
  `role=group` toolbars. See the roving dead-end in [CLAUDE.md](CLAUDE.md).
- ~~Accounts + cloud sync (in-file #6)~~ — **shipped.** Email/password + debounced
  cross-device sync (`/v1/auth/*` + `/v1/progress/verbs`).
- ~~Filter wall / misaligned rows / no icons / endless bar wall / blocking modal~~ —
  all shipped (`.frow`/`.chips` layout, SVG sprite, worst-20 cap, inline banner).

## Deferred (needs infra — intentionally not done)
- **Password reset / email verification (server).** A forgotten password currently
  means a new account. Needs an outbound-email provider + secrets, not worth
  provisioning until the app has real users. Tracked in [../CLAUDE.md](../CLAUDE.md)
  "What's deliberately NOT in v1."

## Ideas / not yet scoped
- **Close the custom-card completeness gap.** The "Add card" modal sets every field
  EXCEPT `levels` (the 5 N5→N1 tiers) and `accent` (pitch), so a UI-created card isn't a
  *complete* card (see [CARDS.md](CARDS.md) "the custom-card gap"). Add a leveled-example
  editor + an accent field to `#verbModal` (and/or a "generate with AI" button that calls a
  small server endpoint), so users can author full-value cards without hand-editing the
  exported JSON. Built-ins/Minna are already complete; this is the user-content parity piece.
- **Pitch accent for the rest.** Built-ins (`ACCENTS` in `verbs.js`) + Minna words have
  pitch; **user custom cards don't** (no field, and `ACCENTS` is keyed by built-in rank).
  The accents are model-generated and want a **proofread pass** (esp. the nakadaka/odaka
  calls); wiring an authoritative source (OJAD/NHK data) would beat regeneration.
- **みんなの日本語 (Minna no Nihongo) dashboard.** Its full roadmap — Phase 2
  (record-and-compare), more lessons/sections, furigana on lesson sentences — lives
  in its own dedicated doc: [MINNA.md](MINNA.md) "Roadmap / next steps".
- **Built-in non-verb content.** The category *capability* shipped (filters, modal,
  per-category stamps/spines), but the 100 baked-in cards are all verbs — users add
  non-verbs themselves. A curated set of common adjectives/nouns/adverbs in `verbs.js`
  (+ leveled examples in `examples.js`) would make the categories useful out of the
  box. Rename the `VERBS`/`verbs.js` internals only if/when it stops being mostly verbs.
- **Conjugation drills.** The dataset has `type` (godan/ichidan/irregular) — enough
  to quiz て-form / past / negative / potential. A natural next study mode.
- **Custom-verb sync conflict handling.** Today it's last-write-wins + server-wins on
  login (fine for one user); two devices adding verbs offline could collide on a
  `seq`-assigned rank. A UUID-per-verb id would remove the collision if it matters.

## Verification notes
- Browse + Stats were verified at desktop width (1280) and mobile (390): label
  alignment, search-icon field, dimmed N2/N1, leech list, enhanced charts, and the
  ≤640px label-stacking all confirmed via screenshot. The earlier "capture real wide
  screenshots" debt is closed.
- Preview tooling reloads the tab on capture (resets in-memory state) — verify
  transient state (open modal, applied filters, seeded stats) via DOM `eval`, not a
  follow-up screenshot. See the dead-end note in [CLAUDE.md](CLAUDE.md).
