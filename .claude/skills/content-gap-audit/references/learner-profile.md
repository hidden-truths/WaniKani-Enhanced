# Learner profile — the one user this project serves

This is the **single home** for the learner profile. Other skills (`orient`, `add-minna-lesson`,
`jlpt-data`, `add-grammar-point`, ...) point here instead of duplicating it. If a fact here goes
stale, fix it here and the whole library stays correct.

The project has exactly **one user, who is also the maintainer**. Every content and feature
decision is made for this person's exam outcome — there is no "general audience". When you plan
work, plan it for *them*, not for a hypothetical cohort.

## Who they are (as of 2026-07)

- **Level:** roughly **JLPT N4**, actively pushing toward N3.
- **WaniKani:** level **22**, username **dylan_j_kelly**, **lifetime** subscription. WK is their
  primary kanji/vocab SRS. Its reviews are **reading-recognition only** — this is the gap the
  whole project fills (listening, visual, contextual, output).
- **Returned in early 2026** from a **~6-month break**, so they carry a large review backlog:
  **~331 leeches** as of 2026-07 (words that keep failing SRS). Leeches are a live, moving
  number — read the current count from the app, don't trust this one (see the lens table in
  SKILL.md). The leech backlog is a first-class content signal: drilling leeches is exam-relevant.
- **Textbook:** studies **みんなの日本語 (Minna no Nihongo)** lesson-by-lesson.
- **Tutor:** works with an **iTalki tutor** on those same lessons. Vocab the tutor covers arrives
  as a plain-text list at `~/Downloads/lessonNN_vocab.txt` (NN = lesson number) and gets tagged
  **`italki:true`** when imported into the deck. Which lesson they're currently on **moves week to
  week — ASK, never assume** (as of 2026-07 the lessons present in the repo are 22/23/24; run
  `ls wk-enhanced-api/data/minna/` for the live set).
- **Explicit wants beyond WK:** **listening, writing, and speaking** practice. WK gives them none
  of these; the study app's 独り言 (Self-Talk), 歌 (Songs), and audio surfaces exist for this.

## Goals & timeline

- **JLPT N3 this year** — exam default date **2026-12-06** (the `examDate` default in
  `study-app/src/features/jlpt/store.js`, `DEFAULT_EXAM_DATE`; the user can edit it in the 合格
  tab, so read the live value from the `jlpt` synced blob rather than hardcoding).
- **JLPT N2 eventually** — the level after N3, not the current focus.
- **Study budget:** roughly **1 hour/day**. The default pacing quotas encode this: **12 new
  vocab words/day + 5 grammar points/week** (`DEFAULT_TARGETS` in `study-app/src/core/jlpt.js`).
  The user can override both in the pacing strip; treat the defaults as the assumption, not a law.

## What this means for prioritization

- **Exam-focused content wins.** Grammar, vocab, listening, and reading that map to the N3 syllabus
  beat architectural polish. Engineering serves the exam.
- **Listening + reading practice deliberately stays EXTERNAL to the app** (the wave-1 hybrid
  decision). Don't propose building a reading tab or a listening tab as the default answer —
  recommend an external-material cadence instead, and only revisit if the user explicitly asks.
  The app's job is grammar drills, vocab coverage, self-talk (speaking), and songs (listening
  reinforcement), not being a full exam simulator.
- **The leech backlog and the current Minna lesson are the freshest signals.** Content the user
  needs *this week* (the lesson they're on, the leeches they're failing) outranks a nice-to-have
  someday-item.
- **Model-generated Japanese must be human-proofread before it's exam-trusted.** The user
  proofreads generated grammar/vocab content before relying on it. Flag any content you add for
  their review (the `content-proofread` roadmap record tracks this standing obligation).

## Ground truth (re-verify when updating)

- Source of these facts: the maintainer's own memory notes (not discoverable by reading the repo)
  plus repo-verified defaults. Volatile items (leech count, current lesson, WK level, exam date)
  drift — always prefer the live app value or an `ls`/blob read over the numbers frozen here.
- Repo-verified as of 2026-07: `DEFAULT_EXAM_DATE = '2026-12-06'` and
  `DEFAULT_TARGETS = { wordsPerDay: 12, grammarPerWeek: 5 }` (both in the files named above);
  Minna lessons 22–24 present under `wk-enhanced-api/data/minna/`.
