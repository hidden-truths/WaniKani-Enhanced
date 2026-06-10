# Japanese Verb Trainer (web study app)

A self-contained, offline-first flashcard + spaced-repetition study tool for the
**100 most frequent Japanese verbs** (BCCWJ corpus frequency). Flashcards with a
Leitner SRS, a filterable browse grid, progress stats, light/dark themes, five
Japanese fonts, JSON export/import, and optional **email/password accounts with
cross-device cloud sync**.

This is the single file [index.html](index.html). It is served at the apex of the
backing API server (`https://wkenhanced.dev/` and `https://api.wkenhanced.dev/`)
and is derived from the standalone, localStorage-only original at
[../../japanese-study/japanese-verbs.html](../../japanese-study/japanese-verbs.html)
plus a cloud-sync layer.

> New to the codebase? Read [CLAUDE.md](CLAUDE.md) for architecture + the
> dead-end warnings, and [NEXT_STEPS.md](NEXT_STEPS.md) for what to do next.

## What it does

| View | What's there |
|---|---|
| **Flashcards** | A Leitner-box SRS. Pick test direction (JP→meaning/reading or reverse), an input mode (self-graded reveal, or **type the reading** for auto-graded kana), and optional **audio** (play the reading aloud via the browser's built-in text-to-speech). Filter the deck (type / transitivity / topic / JLPT / frequency rank), choose an order (shuffle / by frequency / worst-first), and run a session. A due-cards banner is the one-click SRS entry point. Grade with the mouse or keys (space = reveal / enter = check, 1 = wrong, 2 = right). |
| **Browse** | A filterable grid of all 100 verbs with the same facets plus free-text search and a font picker. Each card has a speaker button to hear the reading. Tap a card to expand its mnemonic, trap/tip, memory status, and example sentences. |
| **Stats & Leeches** | Overall accuracy, the SRS memory pipeline (Leitner box histogram), daily + per-session accuracy line charts, the leech list, and per-card rolling accuracy (worst-first, capped). All charts are hand-rolled SVG — no chart library. |
| **Accounts** | Optional. Sign in to mirror progress to the server and sync across devices. Fully usable signed-out (localStorage). |

## Run it locally

It's served by the API server in the parent directory:

```bash
cd ..                # into wk-enhanced-api/
bun install          # one-time
cp .env.example .env # one-time
bun dev              # http://localhost:3000  → the study app is at /
```

Then open **http://localhost:3000/**.

- **Accounts/sync need the server.** Keep `COOKIE_SECURE=false` in `.env` for local
  dev — a `Secure` cookie is silently dropped over plain `http://localhost`, so
  login would appear to "not stick." (Defaults to `false` if unset.) See the
  server [README](../README.md) / [deploy notes](../deploy/README.md).
- **Pure offline:** you can also just open `index.html` directly in a browser
  (`file://`). Everything works except accounts/sync (the `/v1/auth/*` probe
  fails gracefully and the app stays in localStorage mode).

There is no build step, no bundler, no npm install for this file itself — it's
HTML + CSS + JS in one document. The only network dependency is Google Fonts,
which degrades gracefully (system fonts) when offline.

## Server endpoints it uses

Same-origin, cookie session (`credentials:'include'`), set by the backing server:

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/register` · `/login` · `/logout` | `{email,password}` |
| GET | `/v1/auth/me` | `{user:{id,email}\|null}` |
| GET | `/v1/progress/verbs` | `{data:<store>,updatedAt}` |
| PUT | `/v1/progress/verbs` | `{data:<store>}` (debounced full-store push) |

Server-side details (auth model, cookie, tables) live in
[../CLAUDE.md](../CLAUDE.md) under "Accounts + study app."

## Data + persistence

- **Verb dataset** is baked into `VERBS[]` in the file (100 entries; `jp`, `read`,
  `mean`, `type`, `jlpt`, `trans`, `tags`, `mnem`, `tip`, `ex`).
- **Progress** persists to `localStorage["jpverbs_v3"]`:
  `{ cards:{<rank>:{attempts,right,wrong,box,due}}, sessions:[…], daily:{…} }`.
  Signed in, the same blob is mirrored to the server (server wins on login).
- A few small UI prefs also live in localStorage: `jpverbs_font`,
  `jpverbs_topic_<panel>` (topic-disclosure open state), `jpverbs_signup_dismissed`,
  `jpverbs_input` (self-graded vs typed), `jpverbs_audio` (TTS autoplay).

## Tech notes

- **Single file by design** — open anywhere, zero setup. The cost is a growing
  ~1700-line file; the planned split point is documented in [NEXT_STEPS.md](NEXT_STEPS.md).
- **Functional color**: vermilion = godan, indigo = ichidan, stone = irregular,
  purple = leech. Conjugation class is what learners confuse, so it's encoded as
  a colored spine + a hanko-style stamp.
- **Icons** are an inline SVG sprite (no CDN/icon-font) so they work offline.
- **SRS** is Leitner boxes (transparent: box N → N-ish days), not SM-2.
