# 日常日本語 — Japanese Trainer (web study app)

A no-build, offline-capable flashcard + spaced-repetition study tool for everyday
Japanese. The built-in content is currently the **100 most frequent Japanese
verbs** (BCCWJ corpus frequency, each tagged `cat:"verb"`) plus any cards you add
yourself — the data model is being generalized beyond verbs. Flashcards with a
Leitner SRS (separate **SRS review** and **free study** modes), romaji-or-kana
typed-reading auto-grading, Google text-to-speech, **five JLPT-leveled (N5→N1)
example sentences per card**, an upcoming-reviews forecast, Jisho dictionary
links, a filterable browse grid, progress stats, light/dark themes, five Japanese
fonts, JSON export/import, and optional **email/password accounts that sync
progress AND your custom cards across devices**.

Five static files — [index.html](index.html) (markup) + [styles.css](styles.css)
+ [verbs.js](verbs.js) (dataset) + [examples.js](examples.js) (leveled sentences)
+ [app.js](app.js) (logic) — loaded as classic
`<link>`/`<script src>` (not ES modules), so opening `index.html` directly still
works. Served at the apex of the backing API server (`https://wkenhanced.dev/` and
`https://api.wkenhanced.dev/`). Originally one self-contained HTML file (derived
from [../../japanese-study/japanese-verbs.html](../../japanese-study/japanese-verbs.html));
split once it outgrew a single document.

> New to the codebase? Read [CLAUDE.md](CLAUDE.md) for architecture + the
> dead-end warnings, and [NEXT_STEPS.md](NEXT_STEPS.md) for what to do next.

## What it does

| View | What's there |
|---|---|
| **Flashcards** | A Leitner-box SRS. Pick test direction (JP→meaning/reading or reverse), an input mode (self-graded reveal, or **type the reading** for auto-graded kana), and optional **audio** (play the reading aloud). On the answer side, pick an **example sentence at any JLPT level (N5→N1)** to see the verb used in context. Filter the deck by independent, intersecting facets — type / transitivity / topic / JLPT / frequency rank (e.g. "Godan **and** Motion") — choose an order (shuffle / by frequency / worst-first), and run a session. A due-cards banner is the one-click SRS entry point. Grade with the mouse or keys — reveal with **space/enter**, then **space / enter / 2 = correct**, **x / 1 = wrong**. |
| **Browse** | A filterable grid of all verbs with the same facets plus free-text search and a font picker. Each card has a speaker button to hear the reading. Click a card to open a **detail view** — mnemonic, trap/tip, memory status, and example sentences are collapsible, with the examples **filtered by JLPT level**. **Add your own verbs** ("Add verb") — they join the deck, filters, and stats; custom cards can be edited or deleted. |
| **Settings** | A toolbar gear opens preferences (saved on the device, and synced to your account): default example level, show/hide furigana, default answer mode, audio. |
| **Stats & Leeches** | Overall accuracy, the SRS memory pipeline (Leitner box histogram), daily + per-session accuracy line charts, the leech list, and per-card rolling accuracy (worst-first, capped). All charts are hand-rolled SVG — no chart library. |
| **Accounts** | Optional. Sign in to mirror **progress + your custom verbs** to the server and sync across devices. Fully usable signed-out (localStorage). |

## Run it locally

It's served by the API server in the parent directory:

```bash
cd ..                # into wk-enhanced-api/
bun install          # one-time
cp .env.example .env # one-time
bun dev              # http://localhost:3000  → the study app is at /
```

Then open **http://localhost:3000/**.

- **Accounts/sync + TTS need the server.** Keep `COOKIE_SECURE=false` in `.env` for
  local dev — a `Secure` cookie is silently dropped over plain `http://localhost`,
  so login would appear to "not stick." (Defaults to `false` if unset.) See the
  server [README](../README.md) / [deploy notes](../deploy/README.md).
- **Offline:** you can also just open `index.html` directly in a browser
  (`file://`) — the assets load as classic scripts, so it runs. Accounts/sync are
  off (the `/v1/auth/*` probe fails gracefully → localStorage mode), and audio
  falls back from the server's Google TTS to the browser's built-in speech.

No build step, no bundler, no npm install for the app itself — plain HTML/CSS/JS.
The only always-on network dependency is Google Fonts, which degrades gracefully
(system fonts) when offline.

## Server endpoints it uses

Same-origin, cookie session (`credentials:'include'`), set by the backing server:

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/register` · `/login` · `/logout` | `{email,password}` (login/register rate-limited) |
| GET | `/v1/auth/me` | `{user:{id,email}\|null}` |
| GET/PUT | `/v1/progress/verbs` | `{data:<store>}` — progress blob (debounced push) |
| GET/PUT | `/v1/progress/custom-verbs` | `{data:{seq,verbs}}` — custom-verb definitions |
| GET/PUT | `/v1/progress/settings` | `{data:{exampleLevel,furigana,input,audio}}` — preferences |
| POST | `/v1/sessions` | `{right,total,mode}` — append to the durable session-history log |
| GET | `/v1/tts?text=<jp>` | Google TTS audio (`audio/mpeg`) for the reading |

Server-side details (auth model, cookie, tables) live in
[../CLAUDE.md](../CLAUDE.md) under "Accounts + study app."

## Data + persistence

- **Verb dataset** lives in `VERBS[]` in [verbs.js](verbs.js) (100 entries; `jp`,
  `read`, `mean`, `type`, `jlpt`, `trans`, `tags`, `mnem`, `tip`, `ex`).
- **Leveled example sentences** live in `EXAMPLES` in [examples.js](examples.js),
  keyed by rank: `{N5:[jp,en],…,N1:[jp,en]}` (five JLPT tiers, increasing complexity).
- **Progress** persists to `localStorage["jpverbs_v3"]`:
  `{ cards:{<rank>:{attempts,right,wrong,box,due}}, sessions:[…], daily:{…} }`.
  Signed in, the same blob is mirrored to the server (server wins on login). The
  local `sessions` is capped (for charts) — every finished session is ALSO appended
  to a durable server log (`POST /v1/sessions`), so full history is never lost.
- **Settings** persist to `localStorage["jpverbs_settings"]` (`{exampleLevel,
  furigana, input, audio}`) and sync as their own blob — set them on the Settings page.
- A few small UI prefs also live in localStorage: `jpverbs_font`,
  `jpverbs_topic_<panel>` (topic-disclosure open state), `jpverbs_signup_dismissed`,
  `jpverbs_theme`.
- **Custom verbs** live in `jpverbs_custom` (`{seq, verbs:[…]}`), merged into the
  deck at load. Signed in, they sync too (server `app` key `custom-verbs`, separate
  from the progress blob; server wins on login, removals propagate).

## Tech notes

- **No build, five files** — `index.html` + `styles.css` + `verbs.js` +
  `examples.js` + `app.js`, loaded as classic `<link>`/`<script src>` (not modules)
  so `file://` still works. `verbs.js`/`examples.js` (globals `VERBS`/`EXAMPLES`)
  must load before `app.js`.
- **Functional color**: vermilion = godan, indigo = ichidan, stone = irregular,
  purple = leech. Conjugation class is what learners confuse, so it's encoded as
  a colored spine + a hanko-style stamp.
- **Icons** are an inline SVG sprite (no CDN/icon-font) so they work offline.
- **SRS** is Leitner boxes (transparent: box N → N-ish days), not SM-2.
- **Keyboard-navigable filters**: each chip row is a single tab stop — Tab moves
  between rows, arrow keys (and Home/End) move within a row, Space/Enter selects.
