---
name: roadmap
description: Read, add, update, or complete records in ROADMAP.html — the WKEnhanced repo's single source of truth for backlog + shipped work (records live as inline JSON; id/status/surface/prio conventions; filterable board). Use when picking what to work on next, recording a new idea/bug/feature/techdebt, marking work shipped after it lands, or ANY time you are tempted to write a TODO / status / handoff / NEXT_STEPS markdown file — that content goes here instead, never in a new .md.
---

# Roadmap: the single source of truth

`ROADMAP.html` at the repo root is THE backlog and shipped record across all three surfaces
(userscript, wk-enhanced-api, study-app) plus the NLP / song-alignment subprojects. It is a
self-contained HTML file whose data is a JSON array; the page renders a filterable board over
it. Your job in this skill: find work in it, add records to it, and mark records shipped —
without breaking the JSON or the single-source-of-truth contract.

**The doctrine (why this matters).** On 2026-06-19 ~40 scattered status/backlog/handoff docs
were consolidated into this one file and DELETED (branch `docs/roadmap-consolidation`). The
architecture docs (`CLAUDE.md`s, `SERVER_DESIGN.md`, feature docs) stay authoritative for
*how* things work; ROADMAP.html owns *what* is planned and *when* it shipped. So: never create
a parallel backlog/status/TODO/handoff `.md`. If you find a stray `TODO`/`FIXME` in code worth
tracking, convert it into a record here. This is a hard rule the maintainer will enforce — see
the `land-a-change` skill's doc-ownership table.

## Before you start

- The root `CLAUDE.md` is auto-loaded; ROADMAP.html is not — open it when you need to read or
  edit records. Do NOT hand-scan the raw HTML for a record; parse the JSON (commands below).
- To view the rendered board: `.claude/launch.json` has a `roadmap` config (`python3 -m
  http.server 5188`, cwd repo root) → open `http://localhost:5188/ROADMAP.html`. Or, when the
  study-app dev server is up on :5173, a DEV-ONLY "Roadmap" link appears in the topbar
  (`updateDevRoadmapLink` in `study-app/src/features/cloud.js`, served via a `vite.config.js`
  middleware) → `/ROADMAP.html`.
- Rails for THIS repo: stage explicit paths on commit (`git add ROADMAP.html`), never `git add
  -A` — parallel agents may share the working tree. See `land-a-change` for commit discipline.

## Where the data lives

Records are a JSON array inside a single tag:

```html
<script type="application/json" id="roadmap-data"> [ … records … ] </script>
```

The page reads it with `JSON.parse(document.getElementById('roadmap-data').textContent)`. There
is **no per-record HTML** — every record is one JSON object in that array, rendered on demand.
Find the block by its id, never by a remembered line number (line numbers rot):

```bash
grep -n 'id="roadmap-data"' ROADMAP.html        # opening tag line
```

## Record shape

One object per record. Only `id`, `surface`, `type`, `status`, `prio`, `title`, `summary` are
effectively always present; the rest are optional and used when they add value.

| field | required | meaning |
|---|---|---|
| `id` | yes | kebab-case, area-prefixed, STABLE identity (never rename a shipped id). |
| `surface` | yes | which surface/area — one of the surface tags below. |
| `type` | yes | `feature` · `bug` · `polish` · `content` · `infra` · `techdebt` · `idea`. |
| `status` | yes | `todo` · `partial` · `blocked` · `followup` · `idea` · `completed` (6). |
| `prio` | yes | `high` · `med` · `low`. |
| `title` | yes | one-line human title. Completed records prefix it with `✓`. |
| `summary` | yes | self-contained overview. Completed records conventionally start `SHIPPED:`. |
| `detail` | no | deeper breakdown — architecture, DECISIONS made, settled shapes ("don't re-derive"). |
| `when` | completed | ship date `YYYY-MM-DD`. Present iff `status:"completed"`. |
| `example` | no | a code pointer, URL, or shape snippet (e.g. an endpoint or data shape). |
| `note` | no | a warning / clarification. |
| `mock` | no | array of `["path/to/mock.html","Label"]` pairs (design records). |
| `src` | no | array of owning file/module paths so a future session finds the code. |
| `star` | no | `true` to pin within its group (sorts starred-first). |

Field vocabularies are enforced only by convention + the render JS (the facet rows and glyph
maps). Verify the live set of any field before inventing a new value:

```bash
python3 -c "import json,re; d=json.loads(re.search(r'id=\"roadmap-data\">(.*?)</script>',open('ROADMAP.html').read(),re.S).group(1)); [print(k,sorted({r.get(k) for r in d})) for k in ('status','prio','type','surface')]"
```

### Surface tags & id prefixes

`surface` groups the record. The full set defined in the `SURFACES` meta (with a Japanese
group glyph + accent each) is: `store` · `api` · `userscript` · `songs` · `minna` ·
`selftalk` · `wanikani` · `jlpt` · `cards` · `core` · `design` · `infra` · `refactor` ·
`tooling`. Beware: the surface-grouped view iterates a SEPARATE `SURFACE_ORDER` array that (as
of 2026-07) **omits `jlpt`**, so `surface:"jlpt"` records are silently dropped from the default
board — see Traps. The `id` prefix mirrors the area: `us-*` (userscript), `api-*`, `songs-*`,
`minna-*`, `selftalk-*`, `jlpt-*` / `grammar-*` (JLPT tab + grammar), `wk-*` (wanikani tab),
`cards-*`, `store-*` (sentence store), `core-*`, `design-*`, `infra-*`, `refactor-*`,
`tooling-*`; big shipped milestones use `done-*` (each still carries a real `surface` from the
set above — there is no catch-all surface). Kebab-case throughout.

### Status semantics (glyphs from `STATUS_GLYPH`)

`todo` ◔ (planned, not started) · `partial` ◑ (started/some shipped) · `blocked` ◓ (waiting on
a dependency/decision) · `followup` ◕ (residue of a shipped thing) · `idea` ○ (parking-lot,
unvalidated) · `completed` ● (shipped — needs a `when` date). Be honest with these: a cold
reader trusts the status. `idea` ≠ `todo`; `blocked` names a real blocker in the detail.

## Reading the board for planning

- Default view is forward-looking: `completed` records are HIDDEN behind the **✓ Show shipped**
  toggle (`#shipToggle`). Filters are Set-based over status/surface/type/prio plus a full-text
  query across id/title/summary/detail/src/example; `groupBy` regroups by surface/status/type/prio.
- Within a group the sort is **open-first → priority (high < med < low) → starred-first**
  (`isOpen`, `prioRank`, `star`). So high-prio open work floats to the top of each surface.
- Inventory as of 2026-07: **102 open / 51 shipped** (153 records total). Derive current counts
  instead of trusting that number:

```bash
python3 -c "import json,re; d=json.loads(re.search(r'id=\"roadmap-data\">(.*?)</script>',open('ROADMAP.html').read(),re.S).group(1)); o=[r for r in d if r['status']!='completed']; print('total',len(d),'| open',len(o),'| shipped',len(d)-len(o))"
```

To answer "what should we work on for the exam?", don't just read raw records — use the
`content-gap-audit` skill, which scores open content records against the learner's state and
the exam timeline.

## Adding or updating a record

1. **Choose a stable `id`** (area prefix + kebab slug). Search first so you don't collide or
   duplicate: `grep -o '"id":"[^"]*"' ROADMAP.html | sort` (or the python parse). If a record
   for the work already exists, UPDATE it rather than adding a second.
2. **Edit the JSON in place.** Records are appended to the array as work is discovered; keep
   valid JSON — double-quoted keys, no trailing commas, escape `"` and backslashes inside
   strings (Japanese text is fine as literal UTF-8). Match the compact one-object-per-record
   formatting already in the file.
3. **Write to the quality bar** (below).
4. **Validate the JSON parses** (mandatory — a broken block blanks the whole board). Run this
   exact one-liner from the repo root; it must print `OK <n> records`:

```bash
python3 -c "import json,re,sys; m=re.search(r'id=\"roadmap-data\">(.*?)</script>',open('ROADMAP.html').read(),re.S); d=json.loads(m.group(1)); print('OK',len(d),'records')"
```

   Node equivalent if you prefer: `node -e "const h=require('fs').readFileSync('ROADMAP.html','utf8');const d=JSON.parse(h.match(/id=\"roadmap-data\">([\s\S]*?)<\/script>/)[1]);console.log('OK',d.length,'records')"`

5. **Spot-check the render** (optional but cheap): serve on :5188 (launch config `roadmap`) and
   confirm the record appears with the right group/glyph; flip **✓ Show shipped** for completed
   ones.
6. **Commit** ROADMAP.html with the change that motivated it (a record update is part of
   landing work, not a separate chore) — see `land-a-change`.

## Marking work shipped

When a feature/fix lands, update its record IN PLACE (don't add a duplicate):

- `status` → `"completed"`, add `"when":"YYYY-MM-DD"`.
- Prefix `title` with `✓`.
- Rewrite `summary` to start `SHIPPED:` and state what actually shipped (verified behavior,
  key decisions), past-tense. Keep `detail` for architecture + decisions made along the way.
- If the work had no prior record, add a completed one directly.

Real completed records to model: `wk-tab-v1`, `jlpt-tab-v1`, `grammar-n3-system` (all
`2026-07-01/02`) — each has a `SHIPPED:`-led summary, a decision-rich `detail`, `example`, and
`src`. Read one before writing yours:

```bash
python3 -c "import json,re; d=json.loads(re.search(r'id=\"roadmap-data\">(.*?)</script>',open('ROADMAP.html').read(),re.S).group(1)); print(json.dumps(next(r for r in d if r['id']=='wk-tab-v1'),ensure_ascii=False,indent=2))"
```

## Record quality bar

The reader is a cold session (a junior engineer or a smaller model) with no maintainer context.
A good record survives that.

- **`summary` is self-contained.** Someone who never saw the conversation should understand the
  work from the summary alone — no "as discussed", no dangling pronouns.
- **Capture DECISIONS, not just tasks.** The best records freeze the design so a future session
  doesn't re-derive it. `jlpt-followups` is the exemplar: its `detail` records the SETTLED
  mock-log blob shape (`{id,date,level,scores,total,notes}`, union-merge by id, exempt from
  day-pruning) with an explicit "don't re-derive" — so whoever builds it later just builds it.
  Do this for anything you decided but deferred.
- **`src[]` points at the owning module(s)** so the code is findable (e.g.
  `study-app/src/features/jlpt/view.js`). Prefer directories/files over line ranges — some
  legacy records carry `path:line` in `src`; line numbers rot, so don't add new ones.
- **Honest status/prio.** Don't file speculation as `todo` (use `idea`); name the blocker on a
  `blocked` record; reserve `high` for exam-impacting or actively-breaking work.
- **One record per coherent unit of work.** Split unrelated ideas into separate records.

## Verify

- The validation one-liner prints `OK <n> records` (JSON still parses — the single most
  important check; a syntax error blanks the entire board silently).
- Your record shows up under the expected surface group with the right status glyph when the
  board is served (and, for completed records, under **✓ Show shipped**).
- `grep` your new `id` returns exactly one hit (no accidental duplicate).

## Traps

- **A broken JSON block blanks the whole page**, not just your record — the render is one
  `JSON.parse`. ALWAYS run the validate one-liner after editing. Trailing commas and unescaped
  quotes inside a string are the usual culprits.
- **Never renumber or rename a shipped `id`.** Downstream context (other records' prose,
  external references, your own memory) points at ids; they are identity. Add a new record
  rather than repurposing an old id.
- **Don't create a competing backlog file.** No `NEXT_STEPS.md`, `TODO.md`, `STATUS.md`,
  `HANDOFF.md` — the 2026-06-19 consolidation deliberately removed those. New backlog thoughts
  → a record here. (Bugs you spot mid-task but won't fix now: a record, or the harness's
  session-task chip if offered.)
- **Cite live counts, not the frozen "102/51".** Those move as work lands; use the count
  one-liner above.
- **`surface:"jlpt"` records don't show in the default (group-by-surface) board** — as of
  2026-07 `SURFACE_ORDER` omits `jlpt` even though `SURFACES` defines it, so the group-by loop
  skips them. They DO appear when grouped by status/type/prio, or via search. If you file a
  `jlpt` record and it seems to vanish, this is why. (Fixing it = adding `"jlpt"` to
  `SURFACE_ORDER` in ROADMAP.html — outside this skill's scope, but worth a record.)
- **Google Fonts degrade offline** (cosmetic only); the board still renders and parses without
  network — don't "fix" a missing webfont.

## Ground truth (as of 2026-07)

This skill compresses:

- `ROADMAP.html` itself — the `<script id="roadmap-data">` array + the render JS
  (`STATUS_GLYPH`, `SURFACE_ORDER`, the `filter`/`sort` functions, the **✓ Show shipped**
  toggle). Re-verify field vocabularies and the surface order against the file; they are
  convention enforced by that JS, not a schema.
- The scratchpad recon report `roadmap-report.md` (structure + conventions), which was
  cross-checked against the file during authoring.
- `.claude/launch.json` (`roadmap` config, port 5188) and
  `study-app/src/features/cloud.js` (`updateDevRoadmapLink`, the dev-only topbar link).
- Consolidation history: the maintainer's memory records the 2026-06-19 hub build (branch
  `docs/roadmap-consolidation`) that deleted the scattered docs.

Related skills: `orient` (project map + iron rules), `content-gap-audit` (turn open records
into a prioritized exam-prep plan), `land-a-change` (the roadmap update is part of the
definition of done + commit discipline).
