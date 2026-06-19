# 日常日本語 — Japanese Trainer (web study app)

A Vite-built, offline-degrading flashcard + spaced-repetition study tool for everyday
Japanese. The built-in content is currently the **100 most frequent Japanese
verbs** (BCCWJ corpus frequency, each tagged `cat:"verb"`) plus any cards you add
yourself in any part-of-speech category (verb / adjective / noun / adverb / phrase).
Flashcards with a
Leitner SRS (separate **SRS review** and **free study** modes), romaji-or-kana
typed-reading auto-grading, Google text-to-speech, **five JLPT-leveled (N5→N1)
example sentences per card**, **visual pitch-accent marks**, an upcoming-reviews
forecast, Jisho dictionary
links, a filterable browse grid, progress stats, a warm light / candle-lit dark
theme (the "Day / Night" design system), a Japanese-font switcher, JSON
export/import, and optional **email/password accounts that sync progress AND your
custom cards across devices**.

A **Vite** app (ES modules, no framework). [index.html](index.html) loads one entry
([src/main.js](src/main.js) — a thin boot file that wires the feature modules) on top of the
DOM/feature glue in [src/features/](src/features), the pure, unit-tested core
([src/core/](src/core)), the shared mutable state hub ([src/state.js](src/state.js)), and
the data modules ([src/data/](src/data) — the `VERBS` dataset + `EXAMPLES` leveled
sentences). It's a **standalone project** served by its own static (nginx) container at the
apex `https://wkenhanced.dev`, talking over HTTP to the API at `https://api.wkenhanced.dev`
(cross-origin, same-site). Originally one self-contained HTML file (the since-removed
`japanese-study/japanese-verbs.html`); grew into
classic-script files served by the API, then was extracted here as its own Vite project once
it outgrew "a few static files on the API droplet."

> New to the codebase? Read [CLAUDE.md](CLAUDE.md) for architecture + the
> dead-end warnings, and [ROADMAP.html](../ROADMAP.html) for what to do next.
> Adding content? [CARDS.md](CARDS.md) is the card data model + how to author a
> complete vocab card (every field, the furigana/pitch formats, and recipes).

## What it does

| View | What's there |
|---|---|
| **Flashcards** | A Leitner-box SRS. Pick test direction (JP→meaning/reading or reverse), an input mode (self-graded reveal, or **type the reading** for auto-graded kana), and optional **audio** (play the reading aloud). On the answer side, pick an **example sentence at any JLPT level (N5→N1)** to see the verb used in context. Filter the deck by independent, intersecting facets — type / transitivity / topic / JLPT / frequency rank (e.g. "Godan **and** Motion") — choose an order (shuffle / by frequency / worst-first), and run a session. A due-cards banner is the one-click SRS entry point. Grade with the mouse or keys — reveal with **space/enter**, then **space / enter / 2 = correct**, **x / 1 = wrong**. |
| **Browse** | A filterable grid of all verbs with the same facets plus free-text search and a font picker. Each card has a speaker button to hear the reading. Click a card to open a **detail view** — mnemonic, trap/tip, memory status, and example sentences are collapsible, with the examples **filtered by JLPT level**. **Add your own cards** ("Add card") in any category — verbs, adjectives (い/な), nouns, adverbs, phrases; they join the deck, filters, and stats; custom cards can be edited or deleted. |
| **Settings** | A gear (icon) in the navbar opens preferences (saved on the device, and synced to your account): default example level, show/hide furigana, default answer mode, audio, free-study-advances-due, and the みんなの日本語 record-and-compare options (recordings to keep per word, silence trim). It also holds **Backup** — JSON export/import of your progress. |
| **Stats & Leeches** | Overall accuracy, the SRS memory pipeline (Leitner box histogram), daily + per-session accuracy line charts, the leech list, and per-card rolling accuracy (worst-first, capped). All charts are hand-rolled SVG — no chart library. |
| **みんなの日本語** | A private, **account-gated** Minna no Nihongo lesson workbook (a 4th tab): pick a chapter and study its vocabulary with **native-speaker audio**, grammar points, example sentences, and the model conversation, keeping **per-lesson notes** synced to your account. "Add all vocab to deck" sends a chapter's words into the SRS deck as tagged cards. **Record-and-compare** (Phase 2): turn on speaking mode (controls dock in the navbar) to record your own voice per word / conversation line and **compare it to the native audio** — dual waveforms, 0.5–1× speed, you / native / both playback, and a per-lesson practice history. Owner-gated, so the copyrighted textbook material isn't public. Full doc: [MINNA.md](MINNA.md). |
| **歌 / Songs** | Turn real songs into reading, listening, and speaking practice (a 6th tab). Paste a song's lyrics + a YouTube link and one **full-auto analysis pass** adds furigana, a per-line English translation, grammar tags, and a JLPT profile (with a proofread step). Then **Read** the lyric viewer (furigana toggle, reveal-on-tap translation, tap-a-word lookup, grammar chips) and **Mine** it — vocabulary by JLPT (known vs new) bulk-adds to the SRS deck under `Source: 歌`, and grammar points cross-link to practice. A small CC/public-domain starter set is readable without an account; your own pasted lyrics stay private. **Listen** + **Shadow** (record-and-compare) + tap-to-sync line timing are coming. Full doc: [SONGS.md](SONGS.md). |
| **Accounts** | Optional. Sign in to mirror **progress + your custom verbs** to the server and sync across devices. Fully usable signed-out (localStorage). |

## Run it locally

Two processes — the Vite dev server (this app) and the backing API:

```bash
# 1. the app (this dir)
bun install          # one-time
bun run dev          # → http://localhost:5173

# 2. the API (separate terminal)
cd ../wk-enhanced-api
bun install && cp .env.example .env   # one-time
bun dev                                # → http://localhost:3000
```

Then open **http://localhost:5173/**. Vite (:5173) and the API (:3000) are genuinely
cross-origin but same-site — exactly the prod `wkenhanced.dev` ↔ `api.wkenhanced.dev`
split — so the credentialed-CORS + cookie path is exercised locally rather than first in
prod. `VITE_API_BASE` (in [.env.development](.env.development)) points the app at the API;
the prod value is baked by the Dockerfile build arg.

- **Accounts/sync + TTS + みんなの日本語 need the API.** Keep `COOKIE_SECURE=false` and the
  default `STUDY_APP_ORIGINS=http://localhost:5173` in the API's `.env` — a `Secure` cookie
  is dropped over `http://localhost`, and the app's origin must be on the CORS allowlist.
  See the server [deploy notes](../wk-enhanced-api/deploy/README.md).
- **Build / preview the production bundle:** `bun run build` (→ `dist/`) + `bun run preview`.
- **Tests:** `bun run test` runs the pure-core suite (Vitest + happy-dom) against the real
  module graph — a broken export/import fails it loudly.
- Runtime **offline degradation** still works (no account / API unreachable → localStorage
  mode + Web Speech instead of Google TTS); the old `file://` double-click is gone by
  decision (server-only). Google Fonts remains the one always-on dep and degrades to system
  fonts offline.

## Server endpoints it uses

Cross-origin (the app rebases every call onto `VITE_API_BASE`), credentialed cookie
session (`credentials:'include'`), set by the backing server:

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/register` · `/login` · `/logout` | `{email,password}` (login/register rate-limited) |
| GET | `/v1/auth/me` | `{user:{id,email}\|null}` |
| GET/PUT | `/v1/progress/verbs` | `{data:<store>}` — progress blob (debounced push) |
| GET/PUT | `/v1/progress/custom-verbs` | `{data:{seq,verbs}}` — custom-verb definitions |
| GET/PUT | `/v1/progress/settings` | `{data:{exampleLevel,furigana,input,audio}}` — preferences |
| POST | `/v1/sessions` | `{right,total,mode}` — append to the durable session-history log |
| GET | `/v1/tts?text=<jp>` | Google TTS audio (`audio/mpeg`) for the reading |
| `/v1/minna/*` | (account/owner-gated) | みんなの日本語 lessons, native audio, record-and-compare recordings + `/v1/minna/practice` history — see [MINNA.md](MINNA.md) |
| `/v1/songs/*` | (anon-readable; writes account-gated) | 歌/Songs library + CRUD + the `analyze` LLM pass (+ `oembed`) — see [SONGS.md](SONGS.md) |

Server-side details (auth model, cookie, tables) live in
[../CLAUDE.md](../CLAUDE.md) under "Accounts + study app."

## Data + persistence

- **Verb dataset** lives in `VERBS[]` in [src/data/verbs.js](src/data/verbs.js) (100
  entries; `jp`, `read`, `mean`, `type`, `jlpt`, `trans`, `tags`, `mnem`, `tip`, `ex`).
- **Leveled example sentences**: `EXAMPLES` in [src/data/examples.js](src/data/examples.js),
  keyed by rank `{N5:[jp,en],…,N1:[jp,en]}` (five JLPT tiers), is the **seed source** for the
  server sentence store — the app fetches the sentences at runtime, not from this module.
- **Progress** persists to `localStorage["jpverbs_v3"]`:
  `{ cards:{<rank>:{attempts,right,wrong,box,due}}, sessions:[…], daily:{…} }`.
  Signed in, the same blob is mirrored to the server (server wins on login). The
  local `sessions` is capped (for charts) — every finished session is ALSO appended
  to a durable server log (`POST /v1/sessions`), so full history is never lost.
- **Settings** persist to `localStorage["jpverbs_settings"]` (`{exampleLevel,
  furigana, input, audio, freeReviewDue, recordingsKeep, trimSilence, compareSpeed}`) and
  sync as their own blob — set them on the Settings page.
- A few small UI prefs also live in localStorage: `jpverbs_font`,
  `jpverbs_topic_<panel>` (topic-disclosure open state), `jpverbs_signup_dismissed`,
  `jpverbs_theme`, and `jpverbs_micDevice` (the みんなの日本語 record-and-compare mic pick —
  device-local, not synced).
- **Custom verbs** live in `jpverbs_custom` (`{seq, verbs:[…]}`), merged into the
  deck at load. Signed in, they sync too (server `app` key `custom-verbs`, separate
  from the progress blob; server wins on login, removals propagate).

## Tech notes

- **Vite + ES modules** — one entry (`src/main.js`) wires the feature modules
  (`src/features/*`) on top of the pure core (`src/core/*`), the state hub
  (`src/state.js`), and the data modules (`src/data/*`,
  `export const VERBS`/`EXAMPLES`). Built + content-hashed by Vite, served by an nginx
  container. See [CLAUDE.md](CLAUDE.md) for the full module map.
- **Functional color**: vermilion = godan, indigo = ichidan, stone = irregular,
  purple = leech. Conjugation class is what learners confuse, so it's encoded as
  a colored spine + a hanko-style stamp.
- **Icons** are an inline SVG sprite (no CDN/icon-font) so they work offline.
- **SRS** is Leitner boxes (transparent: box N → N-ish days), not SM-2.
- **Keyboard-navigable filters**: each chip row is a single tab stop — Tab moves
  between rows, arrow keys (and Home/End) move within a row, Space/Enter selects.
