# みんなの日本語 — lesson dashboard

The **source of truth for the みんなの日本語 (Minna no Nihongo) surface** — a 4th tab
in the study app that turns the textbook into an interactive, account-gated workbook:
vocabulary with native-speaker audio, grammar points, example sentences, a model
conversation, and a per-lesson notes scratchpad. Chapter 23 shipped first (the
maintainer's iTalki lesson); the design generalizes to all 50 lessons.

This feature spans **both** halves of the codebase. This doc is the one place that
ties them together; the layer-specific docs carry quick local references that point
back here:

- **Frontend** (the tab itself): [index.html](index.html) `#panel-minna` +
  [src/features/minna.js](src/features/minna.js) + Minna styles in [src/styles.css](src/styles.css).
  Contributor notes: the みんなの日本語 dead-end in [CLAUDE.md](CLAUDE.md).
- **Server** (content + audio + gating): [../wk-enhanced-api/src/routes/minna.ts](../wk-enhanced-api/src/routes/minna.ts),
  [../wk-enhanced-api/src/services/minnaAudio.ts](../wk-enhanced-api/src/services/minnaAudio.ts),
  [../wk-enhanced-api/data/minna/](../wk-enhanced-api/data/minna/). API rows + the `MINNA_OWNER_EMAILS` parity row
  live in [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md).
- **Roadmap**: the [Next steps](#roadmap--next-steps) section below is the Minna-specific
  backlog (Phase 2 = record-and-compare). The general [NEXT_STEPS.md](NEXT_STEPS.md)
  points here for anything Minna.

It is a **separate concern from the verb trainer** it lives beside — different data
source, account-gated, fetched live — but it deliberately *reuses* the verb trainer's
custom-card + cloud-sync machinery rather than inventing a parallel one (see
[Vocab activation](#vocab-activation-reuses-the-custom-card-system)).

---

## Why it exists

WaniKani + the verb trainer cover recognition and frequency vocab. They don't track a
*textbook* the way a tutored learner actually moves through one — chapter by chapter,
with that chapter's grammar, its set phrases, its model conversation, and the learner's
own margin notes. This dashboard is that workbook: a place to study each みんなの日本語
lesson with native audio and to **augment it as you study with your tutor**, with the
words flowing straight into the SRS deck so they're never studied just once.

---

## How it works (end to end)

```
 Tab click ─► renderMinna()                         [features/minna.js]
              │  no account?  → renderMinnaGate()  (sign-in wall)
              │  GET /v1/minna/lessons              → chapter chips  L23 …
              ▼
        renderMinnaLesson(n)
              │  GET /v1/minna/lessons/{n}          → curated lesson JSON
              │     server reads data/minna/lesson-<n>.json   [routes/minna.ts]
              ▼
        render sections (collapsible <details>):
          Vocabulary · Grammar · Example sentences · Conversation · My notes
              │
   audio ────┼─► GET /v1/minna/audio?src=/Audio/…mp3
              │     gate → storage.get(key) ─ miss ─► fetchMinnaAudio()  → vnjpclub
              │                                       store.put(key)   [cached forever]
              │     serve bytes, Cache-Control: private  ◄─ one reused <audio> element
              │
  vocab ─────┼─► "Add all vocab to deck" → activateMinnaVocab()
              │     → tagged dict-form custom cards (joins SRS/Browse/Stats,
              │       syncs under the existing `custom-verbs` key)
              │
  notes ─────┴─► <textarea> per lesson → debounced saveMinna()
                    → localStorage `jpverbs_minna` + PUT /v1/progress/minna
```

Everything in the tab is **gated and fetched live** — unlike the rest of the app, it is
intentionally *not* offline-first, so the copyrighted textbook material never ships to
anonymous visitors. The session cookie is same-origin, so `fetch` from the page
authorizes the `/v1/minna/*` calls automatically.

---

## Server endpoints

All three are **signed-in only**, optionally narrowed to an owner allowlist
(`MINNA_OWNER_EMAILS`). The gate returns a single `401` for *both* "not signed in" and
"not on the allowlist" so a non-owner can't even probe which lessons exist.

| Method | Path | Cache | Description |
|---|---|---|---|
| GET | `/v1/minna/lessons` | `no-store` | Lesson numbers that have curated content (reads `data/minna/`; ignores `*.draft.json`). |
| GET | `/v1/minna/lessons/{n}` | `no-store` | The curated lesson JSON, served verbatim from `data/minna/lesson-<n>.json`. `404` if absent. |
| GET | `/v1/minna/audio?src=…` | `private, immutable` | A native-audio MP3, proxied from vnjpclub once and cached in storage thereafter. |
| POST | `/v1/minna/recordings?lesson&itemKey&durationMs&keep` | — | **(Phase 2)** Save a voice take (raw `audio/webm`/`mp4` body, ≤2 MB) as a **private** storage object; prune the item to `keep` (≤20). Returns the new take + the item's take list. |
| GET | `/v1/minna/recordings?lesson=` | `no-store` | **(Phase 2)** List the user's takes for a lesson, newest first (metadata only). |
| GET | `/v1/minna/recordings/{id}` | `private, immutable` | **(Phase 2)** Stream one of the **owner's** recordings (404 for a non-owner/missing id). |
| DELETE | `/v1/minna/recordings/{id}` | — | **(Phase 2)** Delete one of the owner's recordings + its storage object (idempotent). |

Defined in [../wk-enhanced-api/src/routes/minna.ts](../wk-enhanced-api/src/routes/minna.ts); mounted at `/v1/minna` in
[../wk-enhanced-api/src/index.ts](../wk-enhanced-api/src/index.ts). Schemas in [../wk-enhanced-api/src/schemas.ts](../wk-enhanced-api/src/schemas.ts)
(`MinnaLessons…`, `MinnaLesson`, `MinnaAudioQuery`).

### The audio proxy (and its SSRF guard)

[../wk-enhanced-api/src/services/minnaAudio.ts](../wk-enhanced-api/src/services/minnaAudio.ts) is the only thing that
talks to vnjpclub. It is deliberately narrow:

- **Host is hard-coded** (`https://www.vnjpclub.com`); the caller supplies only a
  *path*, validated against `^/Audio/[A-Za-z0-9_]+(?:/[A-Za-z0-9_]+)*\.mp3$` — no `..`,
  no other host, no query. A caller can never steer this at an arbitrary URL.
- Fetched with a browser `User-Agent` + `Referer: https://www.vnjpclub.com/` (vnjpclub
  serves a near-empty body otherwise), 12 s timeout. A `< 1 KB` body is treated as a
  miss (that's vnjpclub's "file not found" response).
- **Cached in our storage layer** via `keys.minnaAudio(path)` →
  `minna/audio/<path-minus-/Audio/>` (the new `storage.get()` method in
  [../wk-enhanced-api/src/services/storage.ts](../wk-enhanced-api/src/services/storage.ts) makes get-or-fetch possible).
  So vnjpclub is hit **at most once per file, ever**; every later play is served
  same-origin from us. In prod that cache is the DO Spaces bucket; in dev it's
  `dev-data/media/minna/audio/…`.

**Why `Cache-Control: private` and not `public`:** the audio is account-gated, so a
*shared* cache (Cloudflare, in front of the origin in prod) must never store it — that
would hand gated bytes to unauthorized users and bypass the gate. `private` keeps it in
the owner's own browser cache (a year, immutable, since keys are content-addressed)
while forbidding any shared/CDN cache from holding it.

---

## Content / data model

> The vocab fields below become a study **card** — for the full card schema, the
> furigana/pitch formats, and how to author a *complete* card, see [CARDS.md](CARDS.md).
> This section covers the lesson-JSON wrapper around them.

Curated lessons live at **`data/minna/lesson-<n>.json`** (git-tracked, in the container
image via the Dockerfile's `COPY data ./data`). Shape (see
[../wk-enhanced-api/data/minna/lesson-23.json](../wk-enhanced-api/data/minna/lesson-23.json)):

| Field | Type | Notes |
|---|---|---|
| `lesson`, `title`, `theme` | number, string, string | Header. `theme` is the one-line "what this chapter is about." |
| `source` | object | Attribution: `{ name, vocabUrl, grammarUrl, note }` — vnjpclub (Minna no Nihongo 第2版), for personal study. |
| `vocab[]` | array | One entry per word (see below). |
| `grammar[]` | array | `{ pattern, structure, explain, examples:[{jp,en}] }`. |
| `examples[]` | array | Lesson-level `[{jp,en}]` sentences. |
| `conversation` | object | `{ title, audio, lines:[{role,jp,en}] }` — **one** audio file for the whole 会話 (not per line). |

**Vocab entry:**

```jsonc
{
  "key":   "mnn:23:0",          // stable id — the activation idempotency key
  "kana":  "ききます",            // textbook (ます) form, with…
  "kanji": "聞きます",            // …its kanji form
  "context": "先生に〜",          // optional usage frame from the textbook
  "dict":  "聞く", "dictRead": "きく",  // DICTIONARY form — what becomes the SRS card
  "mean":  "to ask (a teacher)",
  "cat":   "verb", "type": "godan", "trans": "t",  // feeds the trainer's facets
  "italki": true,               // OPTIONAL — this word was covered in an iTalki lesson.
                                //   Adds the `iTalki` tag + `italki:true` flag to the
                                //   activated card (Source-facet filter + a table badge).
                                //   Omit / false for words you haven't studied with a tutor.
  "accent": 0,                  // OPTIONAL — Tokyo pitch-accent number (0=heiban, 1=atama-
                                //   daka, k=drop after mora k). Drives the visual pitch marks.
  "levels": {                   // OPTIONAL — five JLPT-tiered example sentences (N5→N1),
    "N5": ["…<ruby>聞<rt>き</rt></ruby>く…", "…english…"]   //   each [jp_with_ruby, en], headword in every one.
  },                            //   Same shape/role as the built-ins' examples.js.
  "mnem": "…",                  // OPTIONAL — mnemonic. "tip": "…" — a trap/usage note.
  "tts":  "かど",                // OPTIONAL — TTS-text override for an ambiguous single kanji
                                //   (e.g. 角, which Google may read つの). Defaults to the kanji.
  "audio": "/Audio/minnamoi/bai23/00010101011101110.mp3"  // → the audio proxy
}
```

`accent`/`levels`/`mnem`/`tip` are **generated** (a per-word agent workflow, validated for
ruby balance + headword presence; see the `scripts/scrape-minna.ts` companion approach) and
are worth a human proofread — same status as `examples.js`. Words that already exist as a
baked-in verb don't carry `levels`/`mnem` (they reuse the built-in's — see [dedup](#vocab-activation-reuses-the-custom-card-system)),
only `accent`.

### The content pipeline (adding a lesson)

1. **Draft** with the extractor:
   [../wk-enhanced-api/scripts/scrape-minna.ts](../wk-enhanced-api/scripts/scrape-minna.ts) pulls the vnjpclub
   vocabulary + grammar pages for a lesson and emits a `*.draft.json`. It's a *draft* —
   the grammar/conversation HTML is messy and needs a human pass.
2. **Curate** by hand into `data/minna/lesson-<n>.json` — fix readings, add dictionary
   forms (`dict`/`dictRead`), tidy grammar explanations, pick the conversation audio.
   The list route only surfaces `lesson-<n>.json`, so a half-finished `*.draft.json`
   sitting in the folder is invisible to the app.
3. **Audio just works** — the `audio` paths point at vnjpclub; the proxy fetches +
   caches on first play. Nothing to pre-download.
4. **Ship**: it's static data in the image, so a lesson add is a normal redeploy
   (`docker compose build` — see [../wk-enhanced-api/deploy/README.md](../wk-enhanced-api/deploy/README.md)).

---

## Frontend

`#panel-minna` is near-empty in [index.html](index.html);
[src/features/minna.js](src/features/minna.js) fills it on tab activation (`renderMinna()`,
lazy — same pattern as Stats). Key pieces:

- **`renderMinna()` / `renderMinnaLesson(n)`** — gate wall when `!account`, else chapter
  chips + the active lesson. Sections are collapsible `<details>` (`mnSection`):
  Vocabulary + Grammar open by default, Example sentences / Conversation / My notes
  closed. `minnaLessonCache` avoids refetching on re-render; `minnaStore.lastLesson`
  remembers the chapter.
- **Audio** — `mnAudioBtn` renders a play button (`data-aud`); `mnPlay` plays it through
  **one reused `<audio>`** pointed at `/v1/minna/audio?src=…`. The whole-conversation
  audio uses the same button.
- **Notes** — a per-lesson `<textarea>`; debounced (500 ms) `input` → `saveMinna()` →
  localStorage + a synced PUT, with a "saved · synced" / "saved on this device" tell.

### Vocab activation reuses the custom-card system

"**Add all vocab to deck**" does **not** introduce a new data path. `activateMinnaVocab`
turns each word into a **dictionary-form custom card** via the existing
`loadCustom`/`saveCustom` + `seq` machinery, tagged `みんなの日本語` + `mnn-l<n>` (plus
`iTalki` for words flagged `italki:true`) and marked
`{ minna:true, italki, minnaKey, minnaLesson }`. So an activated word:

- joins the unified `DATA` pool → studyable in Flashcards/SRS, visible in Browse + Stats;
- **syncs for free** under the existing `custom-verbs` progress key (no new sync path);
- is **idempotent + self-updating** — re-activating doesn't duplicate (`minnaKey` is the
  key) but it *does* patch the textbook-derived metadata onto an already-added card
  (preserving its rank → SRS progress), so a card activated before the lesson gained the
  iTalki flag picks it up by re-clicking. `minnaActivationStatus` previews
  `{inDeck,toAdd,toUpdate}`; the button reads "Add all vocab", "Update N tags", or the
  disabled "All vocab in your deck" accordingly. The dashboard shows a live `N/M in your
  SRS deck` count + a ✓ per word;
- shows a `みんなの日本語 · L<n>` provenance badge over the plain `CUSTOM` badge in Browse
  (`provenanceBadge`); iTalki words also show a filled `iTalki` badge in the vocab table.

**Dedup — words that already exist as a built-in verb REUSE it** (no bare duplicate).
~10 Minna words (聞く, 出る, 着る, くれる…) are already among the 100 baked-in verbs, which
*have* leveled examples + a mnemonic. For those, activation writes a **provenance overlay**
(`minnaStore.overlays`, keyed by built-in rank, synced under the `minna` key) instead of a
custom card; `applyMinnaOverlays` merges it onto a *copy* of the built-in at DATA-build
time, so the card keeps its examples/mnemonic/rank/SRS-progress but gains the
みんなの日本語/iTalki tags + flags + `accent`. `migrateMinnaDupes` converts any pre-dedup
duplicate to an overlay on boot/cloud-pull. So a Minna word is EITHER a custom card (with
generated `levels`/`mnem`) OR an overlay on a built-in — never both, never a bare twin.

### Pitch accent

Each card's `accent` drives `pitchHtml(reading, accent)` — Tokyo-dialect notation (an
overline over the high morae + a step-down at the drop) shown on the flashcard answer,
Browse card, and detail modal. It's the **visible** source of truth for pitch because
Google TTS (the audio) can't be pitch-controlled through `/v1/tts`; as a partial audio fix,
`ttsText(v)` sends the **kanji** headword (not the kana reading) so Google applies the
dictionary accent — disambiguating homographs like 橋/箸 (`v.tts` overrides an ambiguous
single kanji). See the TTS + pitch dead-ends in [CLAUDE.md](CLAUDE.md).

### The Source filter facet

Activated cards are filterable by provenance in both the Study picker and Browse via a
sixth AND'd facet, **`source`** (`DECK_FACETS`/`TOKEN_FACET`/`oneGroup`): chips for
`みんなの日本語` (any Minna card), `iTalki` (the tutored subset), and per-lesson `L22/L23/L24`
(`mnn-l<n>` tags, routed to `source` by a regex in `tokenFacet`). `annotateSourceChips`
hides the whole row until the deck has Minna cards and dims chips that match nothing.
So you can study "just my iTalki words" or "just Lesson 24" from the normal deck.

The **only new synced blob** is the per-lesson notes (below).

### State / storage keys

| Where | Key | Shape |
|---|---|---|
| localStorage + synced app `minna` | `jpverbs_minna` | `{ notes:{ "<lesson>": "<text>" }, lastLesson:<n> }` — the notes scratchpad + last-open chapter. The **4th** sync trio (`scheduleMinnaSync`/`pushMinnaCloud`/`pullMinnaCloud`), mirroring custom-verbs/settings; chained into `pullCloud` on sign-in. |
| localStorage + synced app `custom-verbs` | `jpverbs_custom` | Activated vocab lives **here** as tagged cards — *not* in `jpverbs_minna`. |
| server `data/minna/lesson-<n>.json` | — | Lesson content — server-owned, git-tracked, never in localStorage. |

The `minna` progress key is a one-line widen of the `app` enum in
[../wk-enhanced-api/src/routes/progress.ts](../wk-enhanced-api/src/routes/progress.ts); the table is already opaque +
per-`(user, app)`.

---

## Visibility & copyright

The dashboard rehosts vnjpclub's aggregated Minna no Nihongo content + native audio
(3A Corporation's copyrighted textbook). The app is public at `wkenhanced.dev`, so the
tab is **account-gated to an owner allowlist** to keep that material out of public view.

- **`MINNA_OWNER_EMAILS`** — comma-separated allowlist, parsed in
  [../wk-enhanced-api/src/config.ts](../wk-enhanced-api/src/config.ts) (`config.minna.ownerEmails`, lowercased).
  **Blank = any signed-in account**; set = only those emails. Set to the owner's email
  in prod ([../wk-enhanced-api/deploy/env.production.template](../wk-enhanced-api/deploy/env.production.template)).
- Gating is enforced at the **origin** on every request (the `gate()` in
  `routes/minna.ts`), and the audio's `private` cache stops a shared cache from serving
  around it. Client-side rendering is just UX — the data never leaves the server without
  passing the gate.
- **Prod note:** the live droplet's `/etc/wk-enhanced-api/env` must carry
  `MINNA_OWNER_EMAILS` (it's not updated by `git pull`); without it a rebuilt server
  serves the tab to any signed-in account. See the redeploy steps in
  [../wk-enhanced-api/deploy/README.md](../wk-enhanced-api/deploy/README.md).

---

## Things that look like bugs but aren't (dead-ends)

- **The tab is account-gated + fetched live by design — not offline-first.** Every other
  surface works over `file://`/offline; this one shows a sign-in wall and needs the
  server. That's the copyright trade-off, not a regression. Don't "fix" it by baking the
  content into a static `minna.js`.
- **Vocab activation reuses `custom-verbs`; there is no Minna card store.** Cards live in
  `jpverbs_custom` and sync there. The `minna` key holds *only* notes + `lastLesson`.
  Don't add a parallel Minna card list — `minnaKey` idempotency + the tags are the whole
  mechanism.
- **The audio path is SSRF-guarded and the host is hard-coded.** The strict
  `/Audio/…\.mp3` regex is load-bearing — don't loosen it to "support more paths"; add a
  new path *shape* only with the same anti-traversal care.
- **Audio is `private`-cached on purpose.** It's gated content; `public` would let
  Cloudflare serve it unauthenticated. Don't change it back to match the public media
  CDN pattern.
- **`*.draft.json` in `data/minna/` is intentionally invisible** to the list route — only
  `lesson-<n>.json` is served. A scraped draft can sit there safely until it's curated.
- **The conversation has one audio file for the whole dialogue**, not one per line — the
  data model reflects vnjpclub (`conversation.audio`). Per-line audio is a future idea,
  not a missing field.

---

## Roadmap / next steps

Minna-specific backlog (the general study-app roadmap in [NEXT_STEPS.md](NEXT_STEPS.md)
points here). Roughly priority-ordered.

### Phase 2 — record & compare  *(the marquee feature)*

Record your own voice and compare it to the cached native audio. This is the headline
reason the audio is already proxied + stored same-origin in Phase 1.

- **Capture** — `MediaRecorder` (`getUserMedia` audio) → an opus/webm blob, with
  preview + re-record before saving.
- **Store** — per-user recordings on the server: a `minna_recordings` table
  (`user_id, lesson, item_key, storage_key, duration_ms, created_at`, following the
  `study_sessions` template) + `recording/<user>/<lesson>/<item>/<id>.webm` via the
  storage layer + authed `POST`/`GET`/`DELETE /v1/minna/recordings`. Add a per-user (or
  per-item "keep last N") cap so storage stays bounded.
- **Compare player** — for a given word/line: ▶ example, ▶ you, ▶ example→you (sequential),
  ▶ simultaneous; optional **dual waveform** (Web Audio `decodeAudioData` → canvas) and
  speed/loop controls. The comparison target is the native vnjpclub audio Phase 1 already
  caches same-origin (so Web Audio can read its bytes without CORS).

### More lessons & sections

- **More chapters** — run [../wk-enhanced-api/scripts/scrape-minna.ts](../wk-enhanced-api/scripts/scrape-minna.ts) for
  other lessons and curate them into `data/minna/lesson-<n>.json`. The whole UI is
  already N-lesson aware (chapter chips, `lastLesson`). **Shipped so far: L22, L23, L24.**
  (L23 carries iTalki flags from the maintainer's lesson; L22/L24 don't yet — add
  `italki:true` per word as those tutoring sessions happen.)
- **More section types** — exercises/drills (interactive, auto-checked), listening,
  kanji. The lesson JSON can grow new top-level arrays; `renderMinnaLesson` adds a
  section renderer per type.
- ~~**A みんなの日本語 source filter in Browse**~~ — **shipped.** The `source` facet
  (みんなの日本語 / iTalki / per-lesson) is wired into both pickers — see
  [The Source filter facet](#the-source-filter-facet) above.

### Polish

- **Furigana** on the example/conversation sentences (plain JP today) — reuse the global
  `<html data-furigana>` flip the rest of the app already has.
- **Per-line conversation audio** if vnjpclub (or another source) exposes it — the line
  model would gain an optional `audio` field; the single-file player stays as a fallback.
- **A `GET` over recordings/sessions** for a per-lesson practice history once Phase 2
  lands.

---

## Verifying Minna changes

- **Gating** (most important): a signed-in **non-owner** must get `401` from *all* of
  `/v1/minna/lessons`, `/lessons/{n}`, and `/audio` — while `/v1/auth/me` still returns
  `200` (proves it's the allowlist gating, not a broken session). With a **blank**
  allowlist, any signed-in account gets `200` and the audio response carries
  `Cache-Control: private, …`. (Both verified during the allowlist commit.)
- **Audio cache** — first `/v1/minna/audio?src=…` for a path logs `cached:false` and
  writes `minna/audio/…`; the next logs `cached:true` and never touches vnjpclub.
- **Activation** — "Add all vocab to deck" bumps the `N/M` count, adds ✓s, and the words
  appear in Browse with the みんなの日本語 badge; re-clicking is a no-op.
- **Notes** — type in My notes → "saved · synced" → reload → text persists; sign in on a
  second browser → notes pull down.
- Drive it with the browser preview (`.claude/launch.json` `wk-enhanced-api` config) and
  remember dev needs `COOKIE_SECURE=false` (else login won't stick). The preview reloads
  the tab on capture, so assert transient state via DOM `eval`.
