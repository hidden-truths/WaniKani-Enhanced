---
name: land-a-change
description: >-
  Finish and commit work in the WKEnhanced repo to the maintainer's standard: per-surface
  validation commands, the stale-comment sweep, which doc owns what, ROADMAP.html records,
  house commit style, and the prose change-summary. Use the moment a feature/fix is
  code-complete, before ANY commit, or when asked to "wrap up", "ship it", "land this",
  "get it ready to commit", or "clean up and commit". This is the definition of done — run
  it even when the change "looks trivial".
---

# Land a change

You have finished writing code. You are **not done** until it is validated, the docs and
comments near it are honest, the ROADMAP record reflects reality, and it's committed in the
house style with a prose summary for the user. This skill is the maintainer's "definition of
done", made executable. Skipping steps here is how stale comments, un-recorded work, and
`git add -A` accidents ship — cheap to avoid, annoying to unwind.

Do the steps in order. Do not commit until every gate for the surfaces you touched is green.

## Before you commit — orient on what you touched

Which surface(s) did the change land in? That decides the validation commands, the doc that
must be updated, and the version ritual (if any).

- `wkenhanced.user.js` (repo root) → **userscript**.
- Anything under `wk-enhanced-api/` → **API server**.
- Anything under `study-app/` → **study app**.
- A payload/enum/endpoint contract touched on BOTH the server and a client → **cross-surface**
  (validate both sides; see `userscript-dev` / `study-app-dev` / `api-dev` for the paired file).

Run `git status --short` first. **Multiple agents sometimes share this working tree** — if you
see changes you did not make, leave them unstaged and stage only your own paths (below). Never
assume a clean tree.

## 1. Validation matrix — run the gates for every surface you touched

| Surface | Commands (exact) | Green means |
|---|---|---|
| userscript | `node --check wkenhanced.user.js` &nbsp;·&nbsp; `grep -n '@version\|SCRIPT_VERSION' wkenhanced.user.js` | syntax OK **and** the two version strings match (see §2) |
| API server | `cd wk-enhanced-api && bun test && bun run typecheck` | ~237 tests pass (<1s) and `tsc --noEmit` is clean |
| study app | `cd study-app && bun run test` | the Vitest + happy-dom suite (~21 files, three tiers) passes |
| study-app UI | the above **plus** visual verify in **both themes** | renders faithfully day AND night (see §1a) |
| cross-surface | run the gates of **both** surfaces | both green — a contract change that only passes one side is not done |

`bun run typecheck` maps to `bun tsc --noEmit`; `bun run test` (study-app) maps to `vitest run`.
Do not invent commands — these are the exact `scripts` entries in each `package.json`.

**Never commit with a red gate.** If a test fails and you can't fix it in scope, stop and say
so plainly in your summary — do not commit red and do not "fix" a test by loosening its
assertion (several tests in `wk-enhanced-api` deliberately pin dead-end cases to their *wrong*
output; read the comment before changing one — see `api-dev`).

### 1a. Both-themes verification (any study-app UI change)

A UI change that only looks right in one theme is **not done** — this is a standing maintainer
rule. Run the app (`.claude/launch.json` has the `study-app` preview config), then check the
change under both `data-theme="day"` and `data-theme="night"` on `<html>` (flip via the in-app
toggle or the attribute). Verify colours come from role tokens, not hardcoded hex. When matching
a mockup, fix the global chrome/navbar + page width FIRST, then the component — and don't call
the surface done until it is pixel-faithful in both themes, not just structurally close. Full
procedure + token rules live in the `design-system` skill.

## 2. Version ritual (userscript only)

The userscript is the ONLY surface with a version bump. On every edit, bump **both** together:

- `// @version      X.Y.Z` in the metadata block, **and**
- `const SCRIPT_VERSION = 'X.Y.Z';` in the IIFE.

They must match — the boot log line (`[wkenhanced] booting vX.Y.Z …`) is the source of truth for
which build is running, and the user re-imports manually (Tampermonkey does not auto-reload). If
the two drift, the log lies. The `grep` in the matrix is your check. See `userscript-dev`.

The API server and study app have **no** version ritual — their `package.json` `version` fields
(`0.1.0` / `1.0.0` as of 2026-07) are static and are not bumped per commit. Don't touch them.

## 3. Stale-comment & doc sweep — in the SAME commit

Standing maintainer feedback: **when a code change makes a nearby comment or doc stale, fix it in
the same commit and call the fix out in your summary.** Reviewers trust comments; a stale one is
worse than none.

Procedure: read the surrounding lines of every `git diff` hunk (not just the changed line — the
comment two lines up, the header prose, the doc bullet that names the old symbol). The reference
model is commit `4b0e23d` ("study-app: fix four stale code comments found in the doc audit") — it
fixed a blob-count comment that said "six" (it's eight), a mis-pointed file reference, an
enumeration missing one entry, and a stale test-name precedent. Sweep for exactly that class:
counts, renamed symbols/files, enumerations that grew, precedents that moved.

## 4. Doc ownership — update the doc that owns the change

Update the authoritative doc for the KIND of change. Route by this table; do not spray the same
note across several docs, and **never create a new status / progress / handoff `.md` file** —
that whole class was deliberately consolidated into `ROADMAP.html` on 2026-06-19 (~22 docs
deleted, commit `7adcb4b`). The backlog and the shipped record live in ROADMAP.html and nowhere
else.

| Change kind | Doc that owns it (repo-relative) |
|---|---|
| userscript behavior / architecture / dead-end | `CLAUDE.md` (root) |
| server architecture / endpoints / repos / dead-end | `wk-enhanced-api/CLAUDE.md` |
| **new/changed server env var or service** | `wk-enhanced-api/CLAUDE.md` — **add/update a row in the Dev ↔ prod parity table** (test: *would forgetting the prod side cause a runtime failure?* → yes → it needs a row) |
| study-app modules / architecture / design system | `study-app/CLAUDE.md` |
| study-app feature depth | `study-app/CARDS.md` · `MINNA.md` · `SONGS.md` · `SELFTALK.md` |
| study-app test conventions | `study-app/test/CLAUDE.md` |
| deploy procedure / prod ops | `wk-enhanced-api/deploy/README.md` |
| backlog item, or recording shipped work | `ROADMAP.html` **only** (see §5) |

### Keep the skill library honest

The skills under `.claude/skills/` assert concrete facts — paths, commands, enum values, step
sequences. When your change alters one of those (renames a file a skill points at, changes a
command, widens an enum a skill lists, reorders a documented procedure), **update the affected
skill in the same commit**, exactly as you would a stale code comment. A skill a cheaper model
trusts blindly is more dangerous stale than a comment. `grep -rl '<the-thing-you-changed>'
.claude/skills/` finds the skills that name it.

## 5. ROADMAP record

Shipped work updates or completes its ROADMAP.html record (or adds a completed one if the work
wasn't tracked). ROADMAP.html renders its records from a JS data array — do NOT hand-edit raw
HTML record markup by guessing selectors. The `roadmap` skill owns the add/complete mechanics
(the data shape, statuses, and id conventions); follow it rather than improvising.

## 6. Commit — house style, explicit paths

Commit at the end of each **logical unit** without waiting to be asked (root `CLAUDE.md` rule 5).
One feature/fix → one commit; don't batch unrelated work.

**Stage explicit paths only.** Because agents may share this tree, `git add -A` / `git add .` /
`git add <dir>` can sweep in a co-worker's uncommitted files. Always name the files:

```bash
git add wkenhanced.user.js CLAUDE.md              # example — your paths, explicitly
git commit
```

Commit on `main` (the working branch here). Leave any foreign changes from §Before unstaged.

**House commit style** — verified from `git log --oneline -20`:

- Subject: `<lowercase-area>: <imperative summary>`. Real areas in use: `study-app:`,
  `api:`, `jlpt-words:`, `docs:`, `docs(study-app):`. Examples from the log:
  - `study-app: fix the Songs→Browse grammar deep-link (songs-gobrowsegrammar)`
  - `api: grammar_point owner surface — enum widen, seed Pass 5, TTS enumeration`
  - `docs(study-app): deep refresh of CLAUDE.md/README/CARDS; add test/CLAUDE.md`
  - When the work closes a ROADMAP item, the roadmap id often rides in the subject in
    parentheses (e.g. `(songs-gobrowsegrammar)`, `(wk-exam-lens)`).
- Body (when the change isn't self-evident): prose that explains **why** and, for multi-file
  changes, what each file's change is for — see `0a8e5eb`'s body for the per-file paragraph
  style. Wrap at ~72 cols.
- **Every commit ends with this trailer** (all 20 recent commits have it):

  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

## 7. Tell the user what changed — prose, not a diff

Standing maintainer feedback: **after an edit batch, give a plain-prose overview of what changed
and why** — not just "here's the diff". Include:

- what the change does and the reasoning (especially any non-obvious decision),
- any stale comments/docs you fixed along the way (§3),
- what you verified and its result — paste the real gate line (e.g. the `bun test` summary or
  `node --check` clean exit), so "it passes" is evidenced, not asserted.

## When NOT to commit

- The user said to hold off, or asked only to draft/plan.
- A validation gate is red — say so plainly; never commit red.
- You've finished only half a logical unit — either complete it or commit the coherent part
  and name what remains.
- The tree has entangled foreign changes you can't cleanly separate — stage your explicit paths;
  if they're intertwined in the same file, stop and flag it rather than committing someone else's
  work.

## Traps

- **`git add -A` / `.` / `<dir>` in a shared tree** sweeps in another agent's work. Always stage
  explicit file paths. (Memory: parallel agents share this tree.)
- **Committing red**, or "fixing" a failing test by weakening its assertion. Some `wk-enhanced-api`
  tests pin dead-end cases to their *wrong* output on purpose — read the comment first.
- **A UI change verified in one theme only.** Both themes or it isn't done (§1a).
- **Version drift** on the userscript — `@version` and `SCRIPT_VERSION` out of sync makes the boot
  log lie. Grep both before committing.
- **Creating a `*_HANDOFF.md` / `PROGRESS.md` / status doc.** That class is gone by design
  (2026-06-19); the record goes in ROADMAP.html.
- **Leaving a skill stale.** If your change moved a path/command/enum a skill names, update the
  skill in the same commit (§4 "Keep the skill library honest").

## Verify (the whole skill, on yourself)

Before you consider the change landed: the surface's gate command exits clean; `git show --stat
HEAD` lists only your files; the subject matches `<area>: <imperative>`; the `Co-Authored-By`
trailer is present; and you've written the user a prose summary with a pasted gate line.

## Ground truth (as of 2026-07)

Re-verify these when updating this skill:

- **Validation commands**: `wk-enhanced-api/package.json` and `study-app/package.json` `scripts`
  (api: `test`=`bun test`, `typecheck`=`bun tsc --noEmit`; study-app: `test`=`vitest run`).
  Userscript check: `node --check wkenhanced.user.js`.
- **Commit rule + one-commit-per-unit**: root `CLAUDE.md` §"How to work on it" rule 5;
  `wk-enhanced-api/CLAUDE.md` §"When you change code" (steps 2 + 4); `study-app/CLAUDE.md`
  §"How to work on it" (commit-conventions bullet + stale-comment line).
- **Parity-table rule** for env vars: `wk-enhanced-api/CLAUDE.md` §"Dev ↔ prod parity".
- **Version pairing**: `@version` + `SCRIPT_VERSION` in `wkenhanced.user.js` (both `2.0.5`).
- **House commit style + trailer**: `git log --oneline -20` and `git log -6 --format='%h %s%n%b'`
  (lowercase area prefixes; `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` on all).
- **ROADMAP as sole record; status-doc consolidation**: root `CLAUDE.md` reading order + memory
  `wkenhanced-roadmap-hub.md` (built 2026-06-19, ~22 docs deleted, commit `7adcb4b`).
- **Maintainer feedback**: memory `feedback_stale_comments.md`, `feedback_change_summaries.md`,
  `design-mock-frame-first.md`, `parallel-agents-shared-tree.md`.
- **Stale-comment reference commit**: `4b0e23d`.

Related skills: `roadmap` (record mechanics), `design-system` (both-themes verify),
`deploy-prod` (when "done" includes shipping to prod), and the dev skills `userscript-dev`,
`api-dev`, `study-app-dev` for the paired-file / contract details of each surface.
