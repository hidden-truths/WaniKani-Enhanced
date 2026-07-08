---
name: orient
description: Orientation map for the WKEnhanced/日常日本語 repo. Routes any task or symptom to the right surface (userscript / wk-enhanced-api / study-app), the authoritative doc, and the right sibling skill, and states the iron rules that bind every change. Use FIRST for any non-trivial task in this repo — when unsure where code lives, what 合格/教科書/独り言/歌/鰐蟹 refer to, "where do I start", what to work on next, or before planning work that spans surfaces.
---

# Orient: the WKEnhanced project map

You are starting work in a three-surface repo built for ONE user's Japanese study. This skill
routes you to the surface, the authoritative doc, and the sibling skill that owns your task —
plus the iron rules that hold regardless of what you touch. The root `CLAUDE.md` is auto-loaded
into your context; **every other doc named below is NOT** — read the owning doc before editing
its surface.

## Before you start

Cold-start reading order (per root `CLAUDE.md`):

1. `ROADMAP.html` — what to do next + the shipped record. THE backlog across all surfaces.
2. Root `CLAUDE.md` — userscript architecture + cross-surface rules (already in context).
3. `SERVER_DESIGN.md` — server rationale; the "Implementation deviations" section at the top matters most.
4. `wk-enhanced-api/CLAUDE.md` — server architecture + dead-ends.

Then jump to whichever surface doc your task needs (authority table below). Run `git status`
before touching anything — parallel agents sometimes share this working tree, and you must not
sweep a sibling's half-done work into your commit.

## The three surfaces

| Surface | What it is | Lives at | Prod |
|---|---|---|---|
| **Userscript** | Tampermonkey script injecting example sentences / audio / images into WaniKani vocab reviews. ONE file, no build step, no tests, no package manager. | `wkenhanced.user.js` (repo root) | "Deployed" by the user pasting it into Tampermonkey — no server step |
| **API server** | Bun + Hono + SQLite (S3 in prod). Backs both other surfaces: vocab payloads (ImmersionKit/DDG/TTS coalesced), accounts, per-user progress sync, sentence store, songs, Minna, TTS proxy. Has tests + typecheck. | `wk-enhanced-api/` | `https://api.wkenhanced.dev` |
| **Study app** | 日常日本語 Japanese trainer: Vite, deliberately NO framework, 8 tabs, email/password accounts. Talks to the API cross-origin. Vitest suite. | `study-app/` | `https://wkenhanced.dev` (apex) |

One DigitalOcean droplet (SFO3) runs two Docker containers (`api` + `web`/nginx) behind a
Cloudflare Tunnel; media lives on DO Spaces. Droplet ops belong to the `deploy-prod` and
`troubleshoot` skills — don't SSH casually.

### Study-app tab decoder

The user refers to tabs by their Japanese names. Map them before doing anything else
(all feature code under `study-app/src/features/`):

| # | Tab label | `data-tab` | Feature code | Notes |
|---|---|---|---|---|
| 1 | Flashcards | `study` | `flashcard.js` + `deck.js` | The SRS/free study session |
| 2 | Browse | `browse` | `browse.js` | Word library grid + detail modal |
| 3 | Stats | `stats` | `stats.js` | Charts + leeches |
| 4 | JLPT / **合格** | `jlpt` | `jlpt/` | Exam mission control: countdown, pacing coach, checklist, vocab-coverage + grammar lenses |
| 5 | **教科書** (= Minna) | `minna` | `minna/` | みんなの日本語 textbook dashboard. **Owner-gated in prod** (`MINNA_OWNER_EMAILS` — copyrighted content) |
| 6 | **独り言** (Self-Talk) | `selftalk` | `selftalk/` | Output/speaking practice |
| 7 | **歌** (Songs) | `songs` | `songs/` | Song & lyric study: Read/Listen/Shadow/Mine |
| 8 | **鰐蟹** (WaniKani) | `wanikani` | `wanikani/` | WK-account companion: leech triage, confusion groups, leech→deck activation |

A ninth feature, `grammar/`, has NO tab of its own — the N3 grammar catalog surfaces through the
JLPT tab's lens, the flashcard cloze branch, and Browse detail.

## The mission (encode this in your priorities)

The project serves one user — the maintainer: an N4-level learner, WaniKani level 22, studying
みんなの日本語 with an iTalki tutor, targeting **JLPT N3 on 2026-12-06** (about 5 months out as
of 2026-07), N2 eventually; they want listening/writing/speaking practice beyond WK's
reading-only reviews. Full learner profile: the `content-gap-audit` skill's references — point
there, don't re-derive.

Consequences:

- **Content > architecture.** Priorities are (1) exam-focused content, (2) cleaning up site
  rough edges and dead-end UI states, (3) filling content holes (lessons, songs, JLPT data,
  grammar waves). A change that helps ship study content safely beats an architectural nicety.
- **The study app is SERVER-REQUIRED by decision (2026-06-14).** Prefer cleaner server-required
  designs over offline-safe-but-complex ones. Anon/localStorage degradation exists but is NOT a
  design driver; "offline-first" wording in older docs is stale.
- The codebase is already heavily refactored (see the refactor doctrine in ROADMAP's refactor
  records) — don't re-split shipped modules; target new churn.

## Doc authority — who owns what

| Doc | Owns |
|---|---|
| `ROADMAP.html` | The ONLY backlog + shipped record, all surfaces. Filterable; data embedded as JSON. |
| Root `CLAUDE.md` | Userscript architecture, its dead-ends, cross-surface rules. Auto-loaded. |
| `wk-enhanced-api/CLAUDE.md` | Server: architecture, API surface, warm pipeline, dev↔prod parity table, accounts/CORS, log tables, its dead-ends. |
| `wk-enhanced-api/deploy/README.md` | Prod runbook: droplet setup, two-container cut-over, seeds, timers, rollback. |
| `study-app/CLAUDE.md` | App: module map, how-to-work, design system, its dead-ends (the dead-end section is long — search it). |
| `study-app/CARDS.md` / `MINNA.md` / `SONGS.md` / `SELFTALK.md` | Feature-depth docs: card data model, textbook pipeline, songs, self-talk. |
| `study-app/test/CLAUDE.md` | Vitest suite layout + the three test tiers (core / render / infra). |
| `SERVER_DESIGN.md` | Why the server exists; implementation deviations listed at top. |
| `SENTENCE_STORE_NLP.md`, `SENTENCE_STORE_PHASE4.md` | Sentence-store + GiNZA NLP design and runbook. |
| `README.md` (root, and per sub-project) | User-facing overviews + install instructions. |

Never wholesale-duplicate these into new docs; route to them. And never create new
status/progress/handoff `.md` files — see iron rule 3.

## Task → skill routing

| The task/symptom sounds like… | Invoke |
|---|---|
| Edit `wkenhanced.user.js`; WaniKani review-page sentences/audio/images/furigana reveal work | `userscript-dev` |
| Endpoints, Zod schemas, DB repos, warm pipeline, auth, TTS — anything under `wk-enhanced-api/` | `api-dev` |
| Study-app feature/bug/tab behavior under `study-app/src` or `study-app/test` | `study-app-dev` |
| ANY visual/CSS/layout/theme change in the study app; matching a mockup | `design-system` |
| A brand-new top-level tab/panel in the study app | `add-study-tab` |
| A feature needs per-user data that syncs across devices/sign-ins | `add-synced-blob` |
| N3 grammar catalog content: new points, fixing explanations/cloze examples | `add-grammar-point` |
| Songs (歌) library content: adding songs, timing, curation scripts | `add-song` |
| Importing a みんなの日本語 lesson; the tutor's `lessonNN_vocab.txt` lists | `add-minna-lesson` |
| JLPT word-list data wrong/missing; adding a level's data; coverage lens data | `jlpt-data` |
| "What should we build next" / exam-prep planning / find content holes | `content-gap-audit` |
| Something is BROKEN: empty cards, blank tabs, login/sync failures, silent audio, API errors, prod incidents | `troubleshoot` |
| Ship to prod, droplet operations, seed runs, rollback | `deploy-prod` |
| Work is code-complete: validation, doc updates, roadmap record, commit | `land-a-change` |
| Read/add/update/complete backlog records; tempted to write a TODO/status file | `roadmap` |

Multi-surface work (e.g. a new payload field) usually chains skills: `api-dev` for the server
side, then `userscript-dev` or `study-app-dev` for the client, then `land-a-change`.

Worked example — "the 教科書 tab shows a blank panel after login on prod": decode 教科書 → the
Minna tab (study-app surface) → this is a symptom, so `troubleshoot`; and remember the tab is
owner-gated in prod (`MINNA_OWNER_EMAILS`), so "blank for a non-owner account" may be the
copyright gate working as designed, not a bug.

## Iron rules (violating any of these has burned real time)

1. **Userscript: bump `@version` AND `SCRIPT_VERSION` together; syntax-check with
   `node --check wkenhanced.user.js`; NEVER try to test it in a browser yourself.** Tampermonkey
   doesn't reload from disk — the user pastes the file manually, and the console boot line
   (`booting v<X.Y.Z>`) is the only proof of what's running.
2. **Any study-app UI change is verified in BOTH themes** (Day/Night — one `data-theme` flip on
   `<html>`). The design system is dual-theme by contract; a light-only check ships a broken
   dark mode. See `design-system`.
3. **`ROADMAP.html` is the ONLY backlog/status record.** Never create status/progress/handoff
   `.md` files — ~22 of them were deliberately deleted in the 2026-06-19 consolidation, and new
   ones re-fragment the record. Backlog work → the `roadmap` skill.
4. **Commit at the end of every logical unit without being asked; one feature = one commit;
   stage EXPLICIT paths (`git add <file> <file>`, never `-A`/`.`); commit to `main`.** Parallel
   agents sometimes share this working tree — blanket staging can swallow a sibling's half-done
   work. Leave foreign changes unstaged. House commit style: lowercase area prefix, e.g.
   `study-app: …`, `api: …`, `docs: …` (see `git log --oneline -15`).
5. **Fix stale comments near your change in the SAME commit** and mention it in your summary —
   explicit maintainer feedback, also codified in `study-app/CLAUDE.md` commit conventions.
6. **After every edit batch, give the user a short PROSE summary of what changed and why** —
   the maintainer wants overviews, not just diffs. Also maintainer feedback.
7. **Server changes: `bun test` + `bun run typecheck` (in `wk-enhanced-api/`) green before
   commit. Study-app changes: `bun run test` (in `study-app/`) green before commit.** Never
   commit red.
8. **Never lower the ImmersionKit rate-limit floor below 500ms** (`minGapMs` in
   `wk-enhanced-api/src/services/ik.ts`). A 50ms attempt in prod triggered a ~30-minute global
   per-IP 429 lockout. IK is a free community service; we stay a polite client.
9. **Dev secrets: the local dev-account password lives in `dev_account_password.txt` at repo
   root (git-ignored).** Never invent new secret files, and never commit secrets. The dev-account
   email defaults to the maintainer's (see the `VITE_DEV_EMAILS` default in
   `study-app/src/features/cloud.js`).

## Environment quick facts

- **`./dev.sh` from repo root starts both dev servers wired cross-origin** — API :3000
  (`bun dev`) + study app :5173 (Vite) — and sets `STUDY_APP_ORIGINS` / `VITE_API_BASE` /
  `MEDIA_PUBLIC_BASE` so login and media work. `-a`/`-s` pick ports; `--find-free` auto-bumps
  past busy ones. Prefer it over hand-starting the pair.
- Solo loops: `bun dev` inside `wk-enhanced-api/` (hot reload) vs `bun run dev` inside
  `study-app/` — note the different commands. API docs UI: `http://localhost:3000/docs`.
- `.claude/launch.json` preview configs (as of 2026-07): `wk-enhanced-api` (:3000 — runs
  `bun start`, i.e. no hot reload), `study-app` (:5173), `study-app-design` (:5191),
  `redesign-mocks` (:5190), `sleek-mocks` (:5192), `roadmap` (:5188 — serves the repo root, so
  open `/ROADMAP.html`).
- Prod probe: `curl -s https://api.wkenhanced.dev/v1/health` → `{"status":"ok",...}`.

## What to work on next

Open work lives ONLY in `ROADMAP.html` — 103 open / 62 completed records as of 2026-07-08.
Do NOT plan from memory or from this skill: counts, priorities, and pending items move. Use the
`roadmap` skill for record mechanics and `content-gap-audit` for mission-level planning.

**Prod can lag `main`.** As of 2026-07-06 the grammar wave-1 sentence seed and recent
progress-enum widens were still pending deploy (see the `infra-prod-deploy-wanikani` record).
Before assuming prod matches the code you're reading, check ROADMAP and probe prod.

## Sanity checks

- `git status` — clean, or entangled parallel-agent work? (Rule 4.)
- `git log --oneline -10` — what shipped recently; tells you which wave a mid-stream session is in.
- `curl -s https://api.wkenhanced.dev/v1/health` — prod reachable before blaming code.
- Have you actually read the owning surface doc's relevant section (authority table) before
  editing that surface? Root `CLAUDE.md` alone is not enough for server or app work.

## Traps

- **Japanese tab names are aliases, not typos.** "The 歌 tab" = Songs. Decode with the tab table
  before grepping.
- **Each surface doc has a "Things that look like bugs but aren't" dead-end section** (root
  `CLAUDE.md`, `wk-enhanced-api/CLAUDE.md`, `study-app/CLAUDE.md`). Search it BEFORE debugging
  "impossible" behavior — those entries each represent hours already sunk and documented.
- **Only root `CLAUDE.md` is auto-loaded.** The server and app CLAUDE.mds must be read
  explicitly, and they are the authority for their trees.
- **A blank 教科書/Minna tab on prod may be the owner gate** (`MINNA_OWNER_EMAILS`), not a bug.
- **Counts in docs are as-of snapshots** ("eight tabs", "81 grammar points", "103 open
  records" — as of 2026-07). Re-derive live where it matters (`grep`/`ls`/the ROADMAP filters).

## Ground truth (re-verify here; all "as of 2026-07-06")

- Root `CLAUDE.md` (surfaces, reading order, userscript rules); `study-app/CLAUDE.md` "What this
  is" / "How to work on it" / "Architecture (module map)" (tab order, commit conventions);
  `wk-enhanced-api/CLAUDE.md` "How to work on it" / "Dev ↔ prod parity" (commands,
  `MINNA_OWNER_EMAILS`, prod topology) and its IK rate-limit dead-end.
- `study-app/index.html` tab strip (the `data-tab` buttons + Japanese labels);
  `study-app/src/features/` listing (feature directories).
- `dev.sh` header comment (ports, flags, env wiring); `.claude/launch.json` (preview configs).
- `ROADMAP.html` (`<script type="application/json" id="roadmap-data">` block; footer records the
  2026-06-19 consolidation); record counts from the 2026-07-06 recon.
- `wk-enhanced-api/src/services/ik.ts` (`minGapMs: 500`); `.gitignore` line ignoring
  `dev_account_password.txt`; live `GET https://api.wkenhanced.dev/v1/health`.
- Maintainer-memory facts not discoverable in the repo: the learner profile, the server-required
  decision (2026-06-14), parallel-agents staging discipline, and the prose-summary feedback.
