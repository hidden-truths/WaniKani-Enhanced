---
name: content-gap-audit
description: >-
  Plan and prioritize content/feature work for the JLPT exam mission — audit coverage gaps
  (vocab, grammar, listening, reading, songs, textbook lessons) and site rough edges against
  the learner's profile and the 2026-12-06 exam timeline, then turn the plan into ROADMAP
  records. Use when asked "what should we work on / what matters most / what's next", for
  exam-prep planning, content-fill sprints, "find the holes / gaps", or any prioritization of
  study-app content against the exam.
---

# Content-gap audit — what to build next for the exam

You are deciding **what content or feature work matters most right now** for the one user's
JLPT push. This skill grounds that decision in (a) the learner's actual state, (b) the app's
*measurable* coverage lenses, and (c) the open backlog — then hands you a ranked plan and the
ROADMAP records to capture it. The failure mode this prevents is planning from vibes or stale
memory: this project has real coverage math and a real backlog; use them.

The north star: **one user, JLPT N3 on 2026-12-06 (then N2), ~1 hr/day, wants
listening/writing/speaking that WaniKani's reading-only reviews don't give.** Exam-focused
content beats architectural polish. See [references/learner-profile.md](references/learner-profile.md)
— read it first; it is the single home for the learner facts and every number that drifts.

## Before you start

1. **Read [references/learner-profile.md](references/learner-profile.md)** in full. It carries the
   level, WK status, leech backlog, textbook + tutor workflow, goals, and — critically — which
   facts are volatile (leech count, current lesson, exam date) and must be read live.
2. **Ask the user what's changed** since the profile snapshot: current Minna lesson, whether the
   exam date moved, what's frustrating them right now. Their *felt* need is a first-class input;
   the lenses only measure what the app can see.
3. **Refuse to plan from stale memory.** The backlog lives in `ROADMAP.html` (the single source of
   truth — ~102 open records as of 2026-07). Read it, don't recall it. See the `roadmap` skill.

## The measurable lenses — read the learner's real state

These are the numbers the app already computes. Read them before proposing anything; a gap you
can measure beats a gap you imagine. All symbols below are verified present as of 2026-07.

| Lens | What it tells you | How to read it |
|---|---|---|
| **Vocab coverage** (per JLPT level) | of the level's list words, how many are in the deck and how many are "solid" (SRS box ≥4) | `deckJlptCoverage(map, level, data, cards)` in `study-app/src/core/jlpt.js` → `{ total, inDeck, solid }`. In-app: the 合格 tab readiness lens. WK-side coverage: `wkJlptCoverage(...)` → `{ total, onWk, started, guru }`. |
| **Grammar coverage** (N3, 81 points) | how many of the 81 catalog points are in the deck / learning / solid | `grammarCoverage(points, data, cards)` in `study-app/src/core/grammar.js` → `{ total, inDeck, learning, solid, points[] }`. Point count: `node -e "console.log(require('./study-app/tools/grammar-n3/points.json').length)"` (81 as of 2026-07). |
| **Pacing verdict** | are they ahead / on-track / behind on vocab AND grammar for the exam date | `pacePlan({ daysLeft, gap, targets, grammar })` in `core/jlpt.js` → `{ verdict, uncovered, neededPerDay, grammar:{verdict,...} }`. Assembled live by `collectSignals()` in `study-app/src/features/jlpt/view.js`. Defaults: `DEFAULT_TARGETS = { wordsPerDay: 12, grammarPerWeek: 5 }`; buffer `PACE_BUFFER_DAYS = 14`. |
| **Days to exam** | the clock everything scales against | `examCountdown(examDate, nowMs)` in `core/jlpt.js`. `examDate` default `2026-12-06` (`DEFAULT_EXAM_DATE`, `features/jlpt/store.js`) but user-editable — read the live value from the `jlpt` synced blob, don't hardcode. |
| **Leech backlog** | count of chronically-failing cards (a big, exam-relevant drill target) | the `leech` deck facet (`study-app/src/core/facets.js`, `isLeech(v.rank)`); surfaced on the Stats / 鰐蟹 tabs. ~331 as of 2026-07 but **moving — read it live**. |
| **Minna progression** | textbook lessons imported vs the lesson the user is actually on | `ls wk-enhanced-api/data/minna/` for imported lessons (22–24 as of 2026-07). The lesson they're *on* moves — **ASK**. |
| **Songs library** | how many songs, how many fully timed | `curl https://api.wkenhanced.dev/v1/songs` (public/anon-readable list). ~12 timed as of 2026-07. |
| **Daily checklist heat** | recent study consistency (14-day) | `checklistHeat(days, todayKey, n, taskCount)` in `core/jlpt.js`; the `jlpt` blob's `days{}` record. |

To read a lens live, the cleanest path is the running app (`./dev.sh` from repo root, then the
合格 tab) — see the `study-app-dev` skill for the dev loop. For pure numbers you can also `node`
the core function against fixture data, but the app is the honest view.

## The audit procedure

1. **Refresh state.** Read the lenses above + ask the user what changed (step 2 of Before-you-
   start). Compute **months-to-exam** from the live `examDate` — this reshapes priorities (below).
2. **Inventory open content records.** From `ROADMAP.html`, the standing content-gap ids (all
   verified present as of 2026-07 — re-grep, they change): `grammar-mcq-drills` (PARTIAL — the
   文法形式判断 drill + a 10-point bank + the per-point score trail (苦手 drill) shipped 2026-07-08;
   並べ替え + 71 unbanked points remain) and
   `jlpt-vocab-drills` (the 語彙 half of wave 2), `grammar-n3-residue`, `jlpt-followups` (now
   PARTIAL — the mock-test log SHIPPED 2026-07-08; the listening auto-signal + per-level guidance
   remain), `minna-more-lessons`, `minna-section-types`
   (exercises/listening/kanji), `minna-per-line-audio`, `minna-italki-flags`,
   `songs-byo-timing-editor`, `songs-inline-add-review`, `cards-builtin-nonverb`,
   `cards-custom-pitch`, `content-proofread`, `selftalk-larger-set`,
   `store-tier2-grammar`. (`minna-more-lessons` and `cards-conjugation-drills` shipped
   2026-07-08 — kept here only so a stale citation is caught.) Confirm any id is still open
   with `grep '"<id>"' ROADMAP.html` before you cite it.
3. **Hunt UN-tracked gaps** the backlog hasn't captured:
   - **Dead-end UI states** — empty states, flows that need a Connect step the user hasn't done,
     surfaces that render blank when their data is dry (walk the 8 tabs in the app).
   - **`grep -rIn 'TODO\|FIXME' study-app/src wk-enhanced-api/src wkenhanced.user.js`** — as of
     2026-07 this returns **0** (the codebase is clean); a nonzero hit is a fresh, real signal.
   - **Surfaces whose content ran dry** — e.g. all Self-Talk Daily-5 templates seen, all timed
     songs studied, the current Minna lesson missing from `data/minna/`.
   - **Content the user's CURRENT lesson/level needs that the app lacks** — the freshest signal
     of all (their leeches, this week's tutor vocab).
4. **Score** each candidate by **exam-impact × effort × freshness-of-need**. High impact = moves a
   coverage lens or a pacing verdict toward the exam. Freshness = the user needs it *this week*
   (current lesson, active leeches) vs someday.
5. **Output a ranked plan** with a **2–4 week horizon**, then **record it**: update/complete the
   relevant ROADMAP records or add new ones (route to the `roadmap` skill for record mechanics —
   never write a separate TODO/plan `.md` file; ROADMAP.html is the only backlog by deliberate
   2026-06-19 consolidation).

### Time-awareness (how priorities shift as the exam nears)

Scale the plan against months-to-exam (compute from the live `examDate`):

- **Early / far out (>~3 months):** breadth — vocab coverage and grammar *introduction* (fill the
  81-point deck, close the biggest `deckJlptCoverage` gaps, keep the pacing verdict `on-track`).
- **Mid:** shift weight toward **retention and drills** — leech reduction, grammar moving from
  `learning`→`solid`, the wave-2 MCQ drills (`grammar-mcq-drills`, `jlpt-vocab-drills`) rise in
  priority inside ~3 months because recognition-under-time is what the exam tests.
- **Late (<~1 month):** mock-test rhythm + weak-area targeting; the mock-test log (SHIPPED — the
  合格 tab's 模試 card) becomes the tracking surface. Read the latest verdict's `weakSections` to
  aim the last weeks.

## Verify (prove the audit is grounded, not guessed)

- Every ROADMAP id you cite still exists and is open: `grep '"<id>"' ROADMAP.html`.
- Every lens symbol you rely on still exists:
  `grep -nE 'export (function|const)' study-app/src/core/jlpt.js study-app/src/core/grammar.js`.
- The defaults you quote are live: grammar point count via the `node -e` line above; exam date +
  targets via `grep -n 'DEFAULT_EXAM_DATE\|DEFAULT_TARGETS' study-app/src/features/jlpt/store.js study-app/src/core/jlpt.js`.
- The volatile learner numbers (leeches, current lesson) came from **asking the user or reading the
  live app**, not from the frozen profile. If you couldn't, say so in the plan.

## Traps

- **Don't propose a reading tab or a listening tab as the default answer.** Reading + listening
  practice **deliberately stay EXTERNAL** to the app (the wave-1 hybrid decision). Recommend an
  external-material cadence instead; only build in-app if the user explicitly asks to revisit.
- **The `jlpt-followups` mock-test log SHIPPED (2026-07-08)** — a `mocks` array on the `jlpt` blob,
  union-merged by id on 409, exempt from the 60-day day pruning, capped at 50. Pure math (pass marks,
  verdict, trend) is in `core/jlpt.js`; the 模試 card is in `features/jlpt/view.js`. Its N1–N3 three-
  section score sheet does NOT fit N4/N5 (which report two sections) — that extension is still open,
  as are the record's other two items (the listening auto-signal + per-level guidance copy).
- **Prefer finishing partial surfaces over launching new ones.** A half-built surface (BYO song
  timing editor, more Self-Talk templates, the current Minna lesson) that the user *already uses*
  beats a shiny new tab. New surfaces are expensive (see the `add-study-tab` skill's full pattern).
- **Model-generated content is not exam-trusted until the user proofreads it.** Any grammar/vocab
  you add must be flagged for human review in your summary — the `content-proofread` record is the
  standing reminder. Never present generated Japanese as exam-ready.
- **Read volatile numbers live.** The leech count, current lesson, and even the exam date drift.
  A plan built on a stale leech number or the wrong lesson targets the wrong content.

## Ground truth (sources this skill compresses — as of 2026-07)

- **Learner facts:** the maintainer's memory (not in the repo) + repo-verified defaults, all in
  [references/learner-profile.md](references/learner-profile.md). Re-verify volatile items live.
- **Lens math:** `study-app/src/core/jlpt.js` (`deckJlptCoverage`, `wkJlptCoverage`, `pacePlan`,
  `examCountdown`, `jlptTargets`, `DEFAULT_TARGETS`, `PACE_BUFFER_DAYS`),
  `study-app/src/core/grammar.js` (`grammarCoverage`), assembled by `collectSignals()` in
  `study-app/src/features/jlpt/view.js`. Exam date: `DEFAULT_EXAM_DATE` in
  `study-app/src/features/jlpt/store.js`.
- **Backlog:** `ROADMAP.html` (single source of truth; content-gap ids listed in step 2). See the
  `roadmap` skill for record format and the `orient` skill for the project map and mission.
- **Executing the plan** routes to the content skills: `add-grammar-point`, `add-song`,
  `add-minna-lesson`, `jlpt-data`. Deploying content to prod routes to `deploy-prod`.
