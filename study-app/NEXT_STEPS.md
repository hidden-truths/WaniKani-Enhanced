# NEXT_STEPS — Japanese Verb Trainer (web study app)

What to do next, priority-ordered. Builds on the `OUTSTANDING WORK` block at the
top of [index.html](index.html); this file supersedes it where they disagree.
Architecture + dead-ends: [CLAUDE.md](CLAUDE.md). User overview: [README.md](README.md).
Card schema + authoring: [CARDS.md](CARDS.md).

> ⚠️ **DO NOT take down the running preview / dev servers.** The maintainer keeps a
> Vite dev server (study-app on **:5173**) and the API (`bun dev` on **:3000**,
> `COOKIE_SECURE=false`) running and tests in their own browser against them. **Do not
> `preview_stop`, `pkill`, or kill the process on :5173 or :3000** — you'll break the
> maintainer's live test tab. If you need to verify in *your* (headless) browser, drive the
> already-running preview rather than restarting it; only restart a server if it's actually
> down (`curl -s localhost:5173` / `localhost:3000/v1/health`). Minna is owner-gated, so the
> API must run with `MINNA_OWNER_EMAILS` including the signed-in account (dev `.env` already
> sets the maintainer's email).

The original backlog plus a large second wave (accounts + sync, SRS vs free study, the
file split, leveled examples, the みんなの日本語 dashboard with content/dedup/pitch, deck-wide
pitch accent) have all shipped — **and so has THE BIG ONE: the split into two apps.**

> **✅ DONE + DEPLOYED — audio-unify (was `minna-audio-unify` / `audio-followups`):** the whole
> epic shipped (Phases 1–3) AND the follow-up list ①–⑦ is complete. Phase 1 (server) = a unified
> `/v1/audio` route group + tagged voice-variant key scheme + `audio_variants` catalog + dual-gender
> Siri pre-gen (legacy `/v1/tts` + `/v1/minna/*` aliases kept). Phase 2 (client) = `core/audio.js`
> resolver + the shared `playItem` player + a per-context Voice-priority picker in Settings, with
> flashcards/Browse/Minna routed through it. Phase 3 = the record-and-compare "▶ native" generalized
> to "▶ reference" against any chosen voice. **Prod rollout closed 2026-06-12:** the Siri `siri:male`/
> `siri:female` clips were pushed to the prod Spaces bucket (`push-tts-variants.ts`) and the
> `audio_variants` manifest seeded on the droplet (`seed-audio-variants.ts`), so the picker offers
> the real voices in prod; the `/v1/audio/tts` ETag + `no-cache` headers (so a re-voiced clip
> propagates) are also live. Full status: [NEXT_AUDIO_UNIFY.md](../docs/history/NEXT_AUDIO_UNIFY.md).

## ✅ SHIPPED — split into two apps (the learning tool + the API)

This app was extracted from `wk-enhanced-api/web/` into its own standalone **Vite** project
(`study-app/`) + its own **nginx container**, served at the apex `wkenhanced.dev`; the API
(`api.wkenhanced.dev`) stopped serving it. Done in six reviewable commits:

1. **Scaffold** the Vite project alongside the still-live `web/`.
2. **Module split** — `app.js` (2208 lines, one global scope) → `src/core/*` (pure,
   unit-tested), `src/state.js` (the shared `store`/`DATA`/`minnaStore` hub), `src/data/*`;
   `verbs-core.test.ts` ported to Vitest + happy-dom against the real import graph.
3. **Container** — `study-app/Dockerfile` (vite build → nginx) + a 2nd `web:` service in
   the API's `compose.yaml` (127.0.0.1:8080).
4. **Cross-origin cut-over** — `API_BASE`/`VITE_API_BASE` rebasing + Minna `crossOrigin`;
   server cookie `Domain=.wkenhanced.dev` + an origin-scoped credentialed-CORS branch.
   Verified in-browser: cross-origin login + all four sync blobs + Minna audio.
5. **Decommission** — removed the API's static `web/` routes + `COPY web` + the dir.
6. **Docs** — this file + the others, and the cut-over runbook in
   [../wk-enhanced-api/deploy/README.md](../wk-enhanced-api/deploy/README.md).

**What's left = operator + optional polish:**
- **Deploy (manual — the only non-code work):** the Cloudflare apex-ingress repoint + the
  droplet env (`COOKIE_DOMAIN`, `STUDY_APP_ORIGINS`). The ordered, zero-downtime runbook is
  in [../wk-enhanced-api/deploy/README.md](../wk-enhanced-api/deploy/README.md).
- ~~**Optional follow-up:** peel `src/app.js` into `features/*` modules~~ — **shipped.**
  The 1934-line `app.js` is now one module per section under `src/features/*` (chrome, io,
  deck, flashcard, browse, stats, custom-cards, settings-page, minna, a11y, tts, cloud-core
  + cloud, render-helpers), plus `config`/`persistence/*`/`settings-store`/`sync-bus`. A thin
  `src/main.js` is the entry — it owns no feature logic, just builds the initial deck and
  calls each module's `initX()` in boot order. Forward-ref `typeof` guards became real
  imports; eval-time cycles are broken by callback seams + the sync-bus. Behavior unchanged,
  verified end-to-end against the dev API. See the CLAUDE.md change-log entry.

The original plan + constraints are kept below as the historical record.

## 🚩 THE BIG ONE — split into two apps: the learning tool and the API (original plan)

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
- ~~歌 / Songs tab — Read + Mine foundation~~ — **shipped** (the foundation-first scope; full design +
  per-phase checklist: [SONGS.md](SONGS.md)). A 6th tab turning real songs into reading/listening/
  speaking practice. **Server:** a `song` table + each lyric line as a `sentence` row
  (`owner_type='song'`, reusing the privacy gate); **`POST /v1/songs/analyze`** — the one genuinely
  new capability — calls Claude (`@anthropic-ai/sdk`, forced tool-use; `ANTHROPIC_MODEL` default
  `claude-opus-4-8`) to turn pasted lyrics into furigana + per-line English + grammar tags + per-word
  JLPT, with the **server computing the UTF-16 token offsets** (never trust an LLM to count code
  units); `ANTHROPIC_API_KEY`-gated → graceful **503** so it ships before the key is provisioned (the
  rest of Songs works without it), like the Siri-voice rollout. A 故郷 public-domain starter seed.
  **Client:** Library (your private songs + anon-readable starters, coverage %, source/level badges),
  Add (paste + YouTube → analyze → review-flags → save, oEmbed auto-fill), **Read** (furigana flip,
  reveal-on-tap English, tap-a-word via `overlayTokens`+`wireWordTaps`, grammar chips → reference,
  per-line replay), **Mine** (vocab by JLPT known/added/new → vocab-activation under `Source:歌`,
  grammar points + counts, save-line-as-Self-Talk-phrase). New `core/songs.js` (12 tests),
  `features/songs{,-youtube}.js`, the `song` Source facet, the `songs` audio context. 269 server +
  204 client tests + builds green; verified live in the preview. **Still to build** (specced in
  SONGS.md): **Listen** (cloze ⇄ full-line dictation), **Shadow** + tap-to-sync line timing + the
  YouTube IFrame sync, the `songs` synced progress blob (deferred to Shadow), starter-set curation,
  the inline Add-review editor. **Operator:** set `ANTHROPIC_API_KEY` on the droplet to enable Add.
- ~~Sentence-store Phase 2.5 — custom-card examples → private store rows (render-from-store)~~ —
  **shipped** (`sentence-store-phase2.5`). A custom card's whole example set (single `ex` + N5→N1
  `levels`) is dual-written to the server store as PRIVATE rows in one atomic call (`pushCardExamples`
  → `PUT /v1/sentences/card/{rank}` → `db.replaceUserCardExamples`, the per-user analog of
  `seedExampleSentence`'s wholesale replace, scoped to `created_by`); `deleteCardExamples` on delete; a
  one-time `migrateCardExamples` backfill on sign-in. **No new render path** — `attachLevels` already
  prefers `state.exampleLevels[rank]` and `GET ?ownerType=card` already returns own private rows, so a
  signed-in card renders FROM the store like a built-in (blob = offline/anon fallback). Pure builder
  `cardExamplesPayload`. Decision (maintainer): offline rendering is no longer a constraint → full
  render-unification, not a write-only mirror. Caveat: the public-only tooling (NLP/export/de-dup/
  TTS-pre-gen) doesn't cover private rows. 6 new tests (5 server + 1 client); curl + signed-in browser
  E2E (dual-write → store-wins render) verified.
- ~~Custom-card completeness (leveled examples + pitch accent in the Add-card modal)~~ —
  **shipped** (`custom-card-completeness`). The #verbModal gained a "Pitch accent & leveled
  examples" disclosure: a pitch-accent number with a live `pitchHtml` preview + a 5-tier
  (N5→N1) JP/EN editor. `saveVerb` validates via the new pure `parseAccent` / `buildLevels` /
  `isCleanRuby` (each tier's JP must be clean ruby — it's `innerHTML`-rendered) and stores
  `accent`+`levels` ON the card, which `attachLevels` preserves through rebuilds (a custom
  rank has no `exampleLevels` store entry to override). So a UI-authored card reaches built-in
  parity — same `renderExample`/`pitchHtml`/Browse-detail paths. 3 new core tests (107 total);
  browser-verified end-to-end (save → render, edit re-populate, both rejection paths). Closes
  the CARDS.md "custom-card gap". **Remaining nicety:** an optional "AI-generate" button to
  draft the tiers/accent server-side (deferred).
- ~~独り言 Self-Talk tab (output/speaking practice)~~ — **shipped** (`self-talk`, 7 commits). A 5th
  tab for narrating your day out loud. Built-in, **offline-first** starter phrases (7 scenes ×
  ~6–7 lines, model-authored → proofread) + **author-your-own** lines that sync under a new
  `selftalk` app key. Each phrase: ruby furigana, English, grammar tags, a ▶ play (unified player,
  new **`selftalk`** voice-priority context), and — in speaking mode — **record + compare against a
  reference voice** by reusing the now-generic record-and-compare engine (`minna-record.js` →
  `record-compare.js`, `lesson`→`scope`, parameterized audio-context) with a reserved
  `SELFTALK_SCOPE` partition + synth-only references. Structure: scene groups + a `localDay()`-keyed
  "Today's focus" filter + a grammar-tier filter. A lightweight **streak + "said today"** signal
  (pure `core/selftalk.js`), marked by a ✓ button or by saving a take. Mic auto-releases on tab
  switch + browser-tab hide. Full doc: [SELFTALK.md](SELFTALK.md). 7 new core tests (72 total).
  **TODO (optional):** add the phrases to the `generate-tts.ts` pre-gen corpus so the Siri reference
  is instant (first play Google-synths + caches regardless).
- ~~Audio-unify Phases 1 + 2 + UI fixes~~ — **shipped** (`minna-audio-unify`, ~13 commits).
  **Phase 1 (server):** a unified `/v1/audio` route group (`tts`/`native`/`recordings`/`variants`)
  with the legacy `/v1/tts` + `/v1/minna/*` audio paths kept as same-handler aliases; a tagged
  voice-clip key scheme (`audio/<provider>/<gender>/<hash>`) + `audio_variants` manifest; the
  3-tier TTS resolver factored into `resolveTts(text, voice?)`; `generate-tts.ts --variant` for
  dual-gender Siri pre-gen. **Phase 2 (client):** pure `core/audio.js` `resolveVariant` (per-context
  priority of specific-voice-or-kind) + the shared `playItem(item, context)` player (public synth vs
  credentialed native/take by a `gated` flag) + a per-context Voice-priority editor in Settings;
  flashcards/Browse/Minna all routed through it. **UI fixes:** Settings modal now bounds + scrolls
  (sticky ×); a copy-sentence button beside each example's ▶ play. Full status + remaining Phase 3 /
  ideas: [NEXT_AUDIO_UNIFY.md](../docs/history/NEXT_AUDIO_UNIFY.md) + the Ideas section below.
- ~~Minna furigana + local TTS pre-generation + native-audio prefetch~~ — **shipped** (6 commits
  on `minna-phase2-record-compare`). (1) **Furigana** on the Minna grammar/lesson/conversation
  sentences (L22–24, 79 sentences): a `rubyHtml()` sanitizer renders curated `<ruby>` while
  escaping everything else, so the existing `data-furigana` flip toggles them; content is
  model-generated and gated by `apply-furigana.ts` (round-trip-preserving validator). (2) **Local
  macOS TTS**: `/v1/tts` is now a three-tier storage-backed cache that **prefers a pre-generated
  Apple-voice `.m4a`** (Kyoko) over Google and persists Google clips; `jp-tts.swift`
  (`AVSpeechSynthesizer`→AAC) + `generate-tts.ts` voice every reading + example sentence and
  upload to storage. (3) **Example sentences are now spoken** (answer-side flashcard example,
  Browse detail modal, + Minna example rows, `speak(plainText(jp))`). (4) **Minna native audio** is prefetched into our
  storage (`prefetch-minna-audio.ts`) so we never round-trip to vnjpclub at play time. The
  Apple-voice readings/sentences still want a real-ear proofread, and the furigana wants a
  reading-accuracy proofread. See [MINNA.md](MINNA.md) + the TTS dead-end in [CLAUDE.md](CLAUDE.md).
- ~~UI chrome: sticky navbar + record-and-compare follow-ups~~ — **shipped** (on
  `minna-phase2-record-compare`). Replaced the old header (kicker + big headline + button
  toolbar) with a **sticky top navbar**: title (left); theme + settings as **icon-only** buttons;
  the account button (cloud icon + email; sync feedback is now a brief auto-clearing pill, no
  persistent "✓ synced"). **Import/Export moved into the Settings "Backup" row**; the "Everyday
  Japanese that sticks" headline removed. The みんなの日本語 **speaking/compare controls dock in the
  navbar** (`#navExtra` slot) so they float at the top while studying (the mic picker shows only
  while speaking). Plus the deferred Phase-2 items: a **per-lesson practice-history** overview
  (`GET /v1/minna/practice` → `recordingSummary`) and **auto-exit speaking mode** on in-app
  tab/lesson switch AND browser-tab change. See [MINNA.md](MINNA.md) + [CLAUDE.md](CLAUDE.md).
- ~~みんなの日本語 Phase 2 — record & compare (MVP)~~ — **shipped** (6 commits on
  `minna-phase2-record-compare`). Record your voice per vocab word / conversation line, save
  it to your account, and compare to the cached native audio. Server: a `minna_recordings`
  table + **private** storage objects served only via the owner-gated
  `POST/GET/DELETE /v1/minna/recordings`, pruned per item to a keep-N. Client (new
  `features/record-compare.js` + `core/recordings.js`): MediaRecorder capture with
  preview/re-record; a compare player (▶ you / ▶ native / ▶ native→you + loop); conversation
  lines slice the one whole-dialogue MP3 via per-line **clip** ranges (`line.clip` ∪ the
  synced in-app marker). Plus three UX refinements from testing: a **speaking-mode toggle**
  that holds ONE persistent mic stream (no `getUserMedia` per take → no hitching; controls
  only render while on), an **input-device picker** (`deviceId:{exact}` so AirPods stay
  high-quality), and **auto-trim silence** (adaptive threshold + generous lead pad so
  aspirated onsets like the ひ of 引きます survive; → WAV). Settings: `recordingsKeep` (1–20),
  `trimSilence`. Full feature doc + the remaining backlog: [MINNA.md](MINNA.md) "Roadmap".
  **Since shipped on top** (see MINNA.md): transient-tolerant trim (rejects laptop
  trackpad-click impulses); item #2 — **dual waveform + live cursor**, a **0.5/0.75/1× speed
  control**, **▶ both** (simultaneous), plus **speech-window alignment** (every compare plays
  the detected spoken region so ▶ both lines the onsets up despite the native MP3's padding);
  and **volume tools** — auto-**normalization** (native vs take to ~equal loudness) + a **▶ both
  balance slider** (you ⟷ native crossfader); item #3 — a **per-lesson practice-history**
  overview (`GET /v1/minna/practice` → a collapsed "Practice history" section, current lesson
  highlighted); and item #4 — **auto-exit speaking mode** on tab/lesson switch (releases the
  persistent mic on any navigation out of the lesson). **Still to do** (deferred, see MINNA.md):
  a **real-mic verification of the trim tuning** (the one path not verifiable headlessly).
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
  ([../src/lib/rateLimit.ts](../wk-enhanced-api/src/lib/rateLimit.ts)): login 20/15min, register
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
- **Unify voice-audio sourcing behind one tagged API** — **Phases 1 + 2 SHIPPED** (see Done /
  [NEXT_AUDIO_UNIFY.md](../docs/history/NEXT_AUDIO_UNIFY.md)): a unified `/v1/audio` surface, a tagged-variant
  catalog, the `core/audio.js` resolver + shared `playItem` player, and a per-context voice picker.
  Follow-ups + my suggestions below.

### Audio-unify — follow-ups & ideas (priority-ordered)
- ~~**① Generate the Siri voices (operator step).**~~ **DONE — local + prod (2026-06-12).** The
  two-pass macOS workflow ran locally — System Voice → Japanese Siri **male**,
  `bun scripts/generate-tts.ts --variant siri:male`; flip to **female**, `--variant siri:female` — so
  siri:* resolve to real clips locally. **Prod was then seeded by COPYING those local clips, not
  re-rendering** (you can only render a Siri voice on a Mac with the right System Voice): the bytes
  went to the prod Spaces bucket via `wk-enhanced-api/scripts/push-tts-variants.ts` (run on the Mac
  with the prod `S3_*` env), and the `audio_variants` manifest rows were written on the droplet via
  `seed-audio-variants.ts` (the picker reads the manifest, NOT storage, so the rows are what make the
  voices appear). The two-half split (bytes from the Mac, manifest on the droplet) + the runbook are
  in [../wk-enhanced-api/deploy/README.md](../wk-enhanced-api/deploy/README.md). Verified live: the
  prod picker offers siri:male/female and they play the right voice. **Optional follow-up:** a
  real-ear listen that the male clips actually sound male (they ship whatever the System Voice was).
- ~~**② "Preview voice" in the Settings picker.**~~ **Shipped.** Every row in the Voice-priority
  editor has a ▶ that auditions the sample word 食べる: a specific synth voice previews itself, a
  `kind:tts` row previews the synth voice that context actually resolves to, and `kind:native`/
  `kind:user` rows show a disabled ▶ (no sample for an arbitrary word). `features/audio.js`
  exports `previewVoice(voiceId, btn)` (+ `PREVIEW_SAMPLE`), forcing a specific voice past the
  resolver. Until ① is done, siri:* previews sound like the Google fallback.
- ~~**③ Per-item voice cycle/override.**~~ **Shipped.** **Alt/Shift-click** (⌥/⇧) any play button
  cycles that item's available voices for that one playback, on top of the global per-context
  default — no new markup, uniform everywhere (flashcard, Browse cards + detail, Minna words +
  example rows). Order: native → Siri F → Siri M → Google → your take, filtered to what the item
  offers (a plain tts-only card still cycles the three synth voices). `core/audio.js` adds the pure
  `variantOrder`/`variantIndex`; `features/audio.js` holds the per-item cursor + `cycleMod(e)`; the
  button's `title` surfaces the current voice + the hint. (Modifier-click chosen over a separate ⟳
  button to avoid cluttering dense surfaces.)
- ~~**④ Picker availability hinting.**~~ **Shipped.** The Voice-priority editor queries
  `GET /v1/audio/variants?text=食べる` once per modal-open and dims + annotates ("· not generated")
  any specific synth voice the server hasn't pre-generated (today both siri:* until ① runs; google
  is always available). Fails open — no dimming when the catalog can't be reached. `fetchAvailableVoices`
  in [src/features/audio.js](src/features/audio.js); the hinting + add-dropdown annotation in
  settings-page.js. Makes ① visible: after the operator generates the Siri clips, reopen Settings and
  the dimming clears.
- ~~**⑤ Phase 3 — compare against any voice.**~~ **Shipped.** The record-and-compare "▶ native" is
  now "▶ reference": the compare target resolves via `resolveVariant('minna', …)` (per-context
  priority picks the default) and **Alt/Shift-click** the ▶ reference button cycles the item's voices
  (native → Siri F/M → Google), reusing the windowing/normalization/waveform machinery. `seq`/`both`/
  `loop` compare against the selected reference; each control now carries its synth `text` so even a
  clipless conversation line can compare against Siri, and a word without native audio gains a synth
  reference. `referenceVariants`/`currentRef`/`refUrl`/`playReference` in
  [src/features/record-compare.js](src/features/record-compare.js). (Detail in [NEXT_AUDIO_UNIFY.md](../docs/history/NEXT_AUDIO_UNIFY.md).)
- ~~**⑦ Token hygiene.**~~ **Shipped.** `settings.audioPrefs` is now pruned of unknown tokens on load
  AND on cloud-pull (`normalizeSettings` → `pruneAudioPrefs` in [settings-store.js](src/settings-store.js)),
  dropping any token a future/foreign palette wouldn't understand and dropping a context that empties
  out (→ falls back to the default). Pure core fns `isKnownAudioToken`/`pruneAudioPrefs` in
  [core/audio.js](src/core/audio.js), tested. (`resolveVariant` already ignored unknowns at play time;
  this keeps the saved list + the Settings editor clean too.)
- **Copy button polish (just shipped).** Optional extensions: a copy on conversation lines + vocab
  words too, and a modifier/long-press to copy the kana reading or the JP+EN pair. Today it copies
  the plain (kanji, ruby-stripped) sentence for dictionary lookup.
- **Pitch accent for the rest.** Built-ins (`ACCENTS` in `verbs.js`) + Minna words have
  pitch; **user custom cards don't** (no field, and `ACCENTS` is keyed by built-in rank).
  The accents are model-generated and want a **proofread pass** (esp. the nakadaka/odaka
  calls); wiring an authoritative source (OJAD/NHK data) would beat regeneration.
- **みんなの日本語 (Minna no Nihongo) dashboard.** Phase 2 (record-and-compare) has
  **shipped** (see Done above). The remaining roadmap — record-and-compare polish (dual
  waveform, speed, simultaneous, practice-history `GET`), more lessons/sections, furigana on
  lesson sentences — lives in its own dedicated doc: [MINNA.md](MINNA.md) "Roadmap / next steps".
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
