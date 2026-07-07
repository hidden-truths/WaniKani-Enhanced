---
name: add-minna-lesson
description: Import or extend みんなの日本語 (Minna) textbook lessons - the scrape-minna.ts draft → hand curation → generated levels/mnem/accent → apply-furigana.ts → prefetch-minna-audio.ts → sentence-store seed pipeline, plus vocab activation into the deck and the user's iTalki tutor vocab lists (~/Downloads/lessonNN_vocab.txt, italki:true). Use for ANY Minna / 教科書-tab content work - adding a lesson, fixing lesson vocab/grammar/audio/furigana, tagging tutored words, or seeding Minna content to prod.
---

# Import a みんなの日本語 lesson

You are adding (or fixing) a chapter of the みんなの日本語 textbook in the study app's 教科書
tab. The content is copyrighted (3A Corporation), so the whole surface is account-gated and the
pipeline is careful: machine-scrape a draft, curate it by hand, generate the rich per-word study
content, validate everything mechanically, then seed the derived stores. This skill is the
end-to-end procedure with the exact commands, the dev-vs-prod split, and the maintainer's iTalki
tutoring workflow that feeds it.

## Before you start

1. Read [study-app/MINNA.md](../../../study-app/MINNA.md) — the feature authority for both
   halves (app + server). Minimum: "Content / data model", "The content pipeline (adding a
   lesson)", "Visibility & copyright", "Verifying Minna changes".
2. Read [study-app/CARDS.md](../../../study-app/CARDS.md) "Recipe A" + "Validation" — the
   per-word content contract (a Minna vocab entry becomes a full study card).
3. Check what exists: `ls wk-enhanced-api/data/minna/` — as of 2026-07 lessons **1–5, 22, 23, 24**
   are curated (`lesson-<n>.json`); L1–5 are the early-lesson backfill (generated JP flagged for
   maintainer proofread). Drafts L6–L10 are staged as `.draft.json`; L11–21 remain to scrape.
4. Ask the user which lesson they're on and whether a tutor vocab list exists in
   `~/Downloads/` (see the iTalki section). The lesson number moves — don't assume.
5. For live verification you need both dev servers (`./dev.sh` from repo root) and a signed-in
   session — the tab is gated, so anonymous browsing shows only the sign-in wall. Dev login
   creds are in `dev_account_password.txt` at repo root; dev needs `COOKIE_SECURE=false` or
   login silently won't stick.

The lesson JSON is the single content source of truth: git-tracked at
`wk-enhanced-api/data/minna/lesson-<n>.json`, shipped inside the container image
(`COPY data ./data` in `wk-enhanced-api/Dockerfile`), served verbatim by
`GET /v1/minna/lessons/{n}`. Everything else (sentence-store rows, audio cache, TTS clips) is
derived from it and re-seedable.

## The pipeline

Steps 1–4 edit the git-tracked lesson file (dev-local, no server needed). Steps 5–6 seed
derived stores and must be re-run per environment (dev now, prod at deploy).

### 1. Scrape a draft

```bash
cd wk-enhanced-api
bun scripts/scrape-minna.ts 27      # → data/minna/lesson-27.draft.json
```

- Accepts lesson 1–50. Fetches four vnjpclub pages (vocabulary / grammar / reading /
  conversation) with a 600 ms politeness gap — vnjpclub is a free community resource, don't
  tighten it.
- **Reliable:** the vocab table (kana / kanji / native-audio path / meaning) and the audio
  inventory. **Best-effort draft quality:** grammar / reading / conversation JP-EN pairs — the
  pages are table-and-i18n soup and grammar "structures" ship as PNGs upstream.
- The draft carries `_draft: true` and is **intentionally invisible** to the app:
  `GET /v1/minna/lessons` readdir()s `data/minna/` per request and only surfaces
  `lesson-<n>.json`. A half-finished draft can sit in the folder safely, and no server restart
  is needed when the curated file lands.

### 2. Curate by hand into `lesson-<n>.json`

Write the curated file next to the draft. Top-level shape (verified against `lesson-22.json`):
`{ lesson, title, theme, source, vocab[], grammar[], examples[], conversation }` — full field
reference in MINNA.md "Content / data model". The draft's grammar/reading/conversation pairs are
raw material for `grammar[].examples`, the lesson-level `examples[]`, and `conversation.lines`.

Per vocab entry, the load-bearing minimum:

```jsonc
{
  "key": "mnn:27:0",          // STABLE id — the activation idempotency key. Never renumber shipped keys.
  "kana": "ききます", "kanji": "聞きます",   // textbook ます form
  "context": "先生に〜",       // optional usage frame, split OFF the headword (the scrape leaves it attached)
  "dict": "聞く", "dictRead": "きく",       // dictionary form — this is what becomes the SRS card
  "mean": "to ask (a teacher)",
  "cat": "verb", "type": "godan", "trans": "t",
  "audio": "/Audio/minnamoi/bai27/….mp3"   // from the scrape; must match the SSRF path shape (see Traps)
}
```

Expect and fix scrape errors — real examples from the L22/L24 import (`git show dd270af`):
着ます glossed "come" (着る/来る confusion), missing kanji on 履く/被る, a 会話 line attributed
to the wrong speaker. Cross-check against the physical textbook. Pick the whole-dialogue
conversation audio from the draft's audio inventory (e.g. L22 uses
`/Audio/minnahonsatsu1/75.mp3`) — the conversation has ONE file, not per-line audio; that's the
data model, not a gap.

### 3. Generate the rich per-word content

This is what makes activated cards reach built-in parity (examples, mnemonic, pitch).

- **Genuinely-new words** get `levels` (five JLPT-tiered `[jp_with_ruby, en]` example sentences
  N5→N1, headword in every one, escalating difficulty), `mnem` (mnemonic), `tip` (trap/usage
  note), and `accent` (Tokyo pitch number, integer 0–12).
- **Words that already exist as a built-in verb** get `accent` ONLY — they inherit the
  built-in's examples/mnemonic through the dedup overlay (historically ~10 of ~57 words across
  L22–24). Check overlap against the 100 built-ins (`study-app/src/data/verbs.js`).
- Optional per-word extras: `tts` (override for an ambiguous single kanji, e.g. 角 → つの),
  `italki` (next section).
- Precedent: a per-word agent fan-out (commit `78803a0` used one agent per word + one accent
  pass across 57 words).
- **Validate before writing** (the CARDS.md "Validation" contract): balanced `<ruby>`/`<rt>`
  tags; the headword's kanji stem appears in each stripped sentence; all 5 tiers present and
  non-empty; `accent` an integer in `[0,12]`. Then `python3 -c "import json;
  json.load(open('data/minna/lesson-27.json'))"` for JSON validity.
- **Flag the generated Japanese for human proofread in your summary.** Model-generated content
  is solid-but-not-exam-trusted until the user reads it — same status as `examples.js`.

### 4. Furigana on the lesson sentences

The grammar/example/conversation `jp` fields should carry `<ruby>` so the app's global furigana
toggle works on them.

- Generate a flat map `{ "<original jp>": "<annotated jp>" }` for every kanji-bearing sentence
  and save it at `/tmp/ruby-<n>.json`. The annotated form inserts ONLY `ruby`/`rt` tags — every
  other byte stays identical.
- Apply: `cd wk-enhanced-api && bun scripts/apply-furigana.ts 27` (the default lesson list is
  `22 23 24` — always pass your lesson number). The script validates ruby balance AND that
  stripping the ruby reproduces the original **byte-for-byte**, and refuses to write the file
  if ANY sentence fails (exit 1). Fix the map and re-run; don't hand-edit around the validator —
  it's what guarantees a bad generation can't corrupt lesson text.
- `vocab[].levels` already ship their own ruby (step 3) and are left untouched by this script.

### 5. Prefetch the native audio

Audio works lazily without this (the `/v1/audio/native` route fetches + caches on first play),
but the prefetch makes the catalog resilient if vnjpclub disappears:

```bash
cd wk-enhanced-api
bun scripts/prefetch-minna-audio.ts --lesson 27 --dry-run   # list what would be fetched
bun scripts/prefetch-minna-audio.ts --lesson 27             # download into storage
```

- Run from `wk-enhanced-api/` so `.env` loads the storage driver. Flags: `--force`
  (re-download), `--delay <ms>` (default 400 between upstream fetches — politeness, don't
  lower it much), `--dry-run`.
- It mirrors the route's caching exactly (`keys.minnaAudio(path)`) and stores with
  `acl:'private'` — gated content, never a public URL.
- It warns and skips any `audio` value that fails the SSRF path validation — treat a
  `skip invalid audio path` warning as a curation bug in your lesson JSON.
- For prod, the same command runs on the Mac with the prod `S3_*` env (see "Ship to prod").

### 6. Seed the sentence store (+ NLP tokens)

The lesson's grammar/example/conversation sentences also become GATED sentence-store rows
(`source='minna'`, `public=0` — dark to the public `getSentences` gate, served only through the
email-gated `/v1/minna` route). That row existence is what lets the offline GiNZA batch attach
tap-a-word tokens.

```bash
cd wk-enhanced-api
bun scripts/seed-sentences.ts        # Pass 4 = Minna; idempotent (ext_id mnn-<n>-{g…|ex-…|conv-…})
```

Tap-a-word tokens **lag by design**: they appear only after the offline GiNZA parse re-runs
(no Python on the droplet). Order matters — `sentence-nlp/parse.py` reads the dev DB, so seed
sentences FIRST, then:

```bash
cd sentence-nlp && .venv/bin/python parse.py      # → regenerates wk-enhanced-api/data/annotations.json (commit it)
cd ../wk-enhanced-api && bun scripts/seed-annotations.ts
```

Environment specifics (Python 3.10 venv, WAL-safety beside running servers) are in
`SENTENCE_STORE_PHASE4.md` §6 "Operational runbook" — read it before running the parse. Until
the parse runs, the new sentences render plain ruby instead of tappable tokens — fail-soft, not
a bug. New text also becomes TTS-pre-gen work eventually (`scripts/generate-tts.ts` enumerates
Minna readings + sentences via `scripts/collectTtsTexts.ts`), but `/v1/tts` falls back to Google
lazily, so pre-gen is optional polish — see the `deploy-prod` skill.

## The iTalki workflow (maintainer-specific)

The user studies Minna lesson-by-lesson with an iTalki tutor. This is not in any repo doc except
as flags — encode it:

- Tutor vocab lists arrive at `~/Downloads/lessonNN_vocab.txt` — repeating blocks of
  `english meaning` / `かな reading` / blank line (verified against `lesson23_vocab.txt`).
- Fold the list into the lesson JSON by matching each entry to a vocab item (by kana + meaning)
  and setting `"italki": true` on it. Precedent: commit `1613f6e` tagged all 23 L23 words from
  `~/Downloads/lesson23_vocab.txt`.
- Effect on activation: flagged words get the `iTalki` tag + `italki:true` card flag → a filled
  badge in the vocab table and the `iTalki` chip in the Source filter facet, so the user can
  study "just my tutored words".
- Flags are an ongoing edit, not a one-shot: tutoring sessions happen after a lesson ships.
  Re-clicking "Add all vocab to deck" (the button reads "Update N tags") PATCHES the new
  metadata onto already-activated cards without losing rank/SRS progress — so adding
  `italki:true` later reaches existing cards. As of 2026-07, L23 carries flags; L22/L24 don't
  (open ROADMAP record `minna-italki-flags`).
- A tutor list may contain words NOT in the textbook chapter — those aren't lesson entries;
  offer to add them as ordinary custom cards instead (tag `iTalki`), not to force them into the
  lesson JSON.

## Client side: what happens for free (build nothing)

The UI is already N-lesson aware — a new `lesson-<n>.json` gets a chapter chip with no client
change. Know the machinery so you don't duplicate it:

- "Add all vocab to deck" → `activateMinnaVocab` (`study-app/src/features/minna/activate.js`,
  over the pure `planMinnaActivation` in `study-app/src/core/minna.js`). New words become
  dictionary-form custom cards tagged `みんなの日本語` + `mnn-l<n>` (+ `iTalki`), stored in
  `jpverbs_custom` and synced under the existing `custom-verbs` key. Idempotent by `minnaKey`.
- **Built-in-overlap words become provenance OVERLAYS** (`minnaStore.overlays`, keyed by
  built-in rank, synced under the `minna` key) — never a duplicate card. The `minna` blob holds
  only notes + lastLesson + overlays + conversation clips; cards never live there.
- The overlay mechanism is Minna-specific and **stays**: the newer wk/jlpt/songs activation
  paths deliberately use headword-skip dedup instead (decision, 2026-07). Don't "unify" Minna
  onto headword-skip and don't add overlays to the other paths.
- Per-lesson audio, notes, record-and-compare, practice history: all shared machinery — see
  MINNA.md. Anything vocab-entry-shaped you add (a new machine-set field that lands on cards)
  must also be added to the edit-modal carry-through list in
  `study-app/src/features/custom-cards.js` (see the `saveVerb` dead-end in
  `study-app/CLAUDE.md`) or editing a card orphans it from the lesson.

## Ship to prod

The lesson file and `data/annotations.json` ship **in the image**, so prod pickup is a normal
container rebuild — then the derived stores need their droplet-side seeds. In order:

1. Commit + deploy (rebuild `api` container, restart) — the `deploy-prod` skill owns this.
2. On the droplet: run `seed-sentences.ts` THEN `seed-annotations.ts` via the mounted-repo
   pattern in `wk-enhanced-api/deploy/README.md` — both invocations MUST set
   `ENV_FILE=/etc/wk-enhanced-api/env DATA_DIR=/var/lib/wk-enhanced-api` (a manual
   `docker compose run` does not inherit the systemd `Environment=` directives; without them
   you'd seed the wrong DB). Lift the exact command from the README, don't reconstruct it.
3. On the Mac with the prod `S3_*` env: `bun scripts/prefetch-minna-audio.ts --lesson <n>` to
   seed the prod bucket. Optionally `generate-tts.ts` for the new sentences.
4. Confirm `/etc/wk-enhanced-api/env` still carries `MINNA_OWNER_EMAILS` — it is NOT updated by
   `git pull`, and a rebuilt server without it serves the copyrighted tab to ANY signed-in
   account.

## Verify

Dev, after steps 1–6 (this compresses MINNA.md "Verifying Minna changes"):

- **Tests:** `bun test && bun run typecheck` in `wk-enhanced-api/` (the scraper's pure helpers
  have tests in `scripts/scrape-minna.test.ts`); `bun run test` in `study-app/` (Vitest;
  includes `test/minna-render.test.js`).
- **Gating (most important):** a signed-in NON-owner gets 401 from `/v1/minna/lessons`,
  `/v1/minna/lessons/{n}`, and `/v1/audio/native` while `/v1/auth/me` still returns 200 (proves
  allowlist gating, not a broken session). With a blank `MINNA_OWNER_EMAILS`, any signed-in
  account gets 200. The audio response carries `Cache-Control: private, …`.
- **Render:** the new chapter chip appears; Vocabulary/Grammar/Examples/Conversation sections
  render; furigana toggles with the global setting.
- **Audio:** first play of a file logs `cached:false` (or is already cached from step 5), the
  next `cached:true` with no vnjpclub round-trip. If audio 401s in the browser, remember the
  gated `<audio>` needs `crossOrigin='use-credentials'` — existing code has it; see the
  `troubleshoot` skill.
- **Activation:** "Add all vocab to deck" bumps the `N/M` count, adds ✓s, words appear in
  Browse with the `みんなの日本語 · L<n>` badge and in the Source facet (`L<n>` chip);
  re-clicking is a no-op ("All vocab in your deck").
- Wrap up per the `land-a-change` skill, and update the ROADMAP record `minna-more-lessons`
  (its summary lists the shipped lessons — extend it; see the `roadmap` skill).

## Traps

- **`*.draft.json` is invisible to the app on purpose** — only `lesson-<n>.json` is listed.
  Don't "fix" the list route to include drafts.
- **Don't bake lesson content into a static client module.** The gated live-fetch design IS the
  copyright posture (the tab is deliberately not offline-first). Content never leaves the
  server ungated.
- **The audio path regex is load-bearing SSRF protection**: paths must match
  `^/Audio/[A-Za-z0-9_]+(?:/[A-Za-z0-9_]+)*\.mp3$` against the hard-coded vnjpclub host. Don't
  loosen it to admit an odd path — fix the path or extend the shape with the same
  anti-traversal care (`wk-enhanced-api/src/services/minnaAudio.ts`).
- **Native audio stays `Cache-Control: private`** — `public` would let the shared Cloudflare
  cache serve gated bytes to anyone. Never match it to the public media CDN pattern.
- **Vocab `key` values (`mnn:<n>:<idx>`) are activation idempotency keys** — never renumber
  shipped ones; appending new entries is fine. Renumbering re-adds duplicates of every card.
- **`apply-furigana.ts` refusing to write is the feature.** A roundtrip failure means the
  generated ruby altered the base text — regenerate that map entry; hand-editing the lesson to
  match a bad map corrupts the curated sentence.
- **The conversation has ONE audio file** for the whole dialogue; per-line native compare
  slices it via clip ranges. Per-line audio is a ROADMAP idea (`minna-per-line-audio`), not a
  missing field.
- **Minna sentence rows are deliberately DARK to the public store gate** (`public=0`,
  `source='minna'`). If a new lesson's sentences don't show up in `GET /v1/sentences`, that's
  correct — they're only served through `/v1/minna/lessons/{n}` enrichment
  (`enrichLessonAnnotations` in `wk-enhanced-api/src/routes/minna.ts`).
- **Re-seeding order:** `seed-annotations.ts` resolves Minna rows by ext_id and everything else
  by content hash — the sentence rows must exist first. Always `seed-sentences.ts` before
  `seed-annotations.ts`, dev and prod.
- **Be polite to vnjpclub** (free community resource): keep the scraper's 600 ms gap and the
  prefetcher's 400 ms default delay.

## Ground truth (re-verify here before trusting this skill, as of 2026-07)

- `study-app/MINNA.md` — the feature authority (data model, pipeline, gating, phases,
  verification checklist).
- `study-app/CARDS.md` — Recipe A (the Minna word path) + the Validation contract.
- `wk-enhanced-api/scripts/scrape-minna.ts`, `apply-furigana.ts`, `prefetch-minna-audio.ts` —
  header comments carry the authoritative CLI + caveats.
- `wk-enhanced-api/scripts/seed-sentences.ts` (Pass 4 = Minna, of five passes) +
  `seed-annotations.ts` + `SENTENCE_STORE_PHASE4.md` §6 (offline-parse runbook).
- `wk-enhanced-api/CLAUDE.md` — the みんなの日本語 dashboard bullet, the `MINNA_OWNER_EMAILS`
  parity row, and the sentence-store section (`source='minna'` gating).
- `wk-enhanced-api/deploy/README.md` — the droplet seed-run pattern + ENV_FILE/DATA_DIR gotcha.
- History worth reading before a new import: `git show dd270af` (L22/L24 curation),
  `1613f6e` (iTalki flags), `78803a0` (content generation), `1900dd9` (furigana pass),
  `a56f219`/`616d191`/`c49dd9b` (sentence-store Phase 3).
- ROADMAP records (5 minna-* as of 2026-07): `minna-more-lessons`, `minna-italki-flags`,
  `minna-section-types`, `minna-per-line-audio`, `minna-trim-mic-verify`.

Related skills: `deploy-prod` (droplet seeds + rebuild), `study-app-dev` (app dev loop),
`content-gap-audit` (whether more lessons are the right next content), `troubleshoot` (audio
401s, blank tabs), `land-a-change` + `roadmap` (finishing discipline).
