# WKEnhanced project skill library

Sixteen skills that let a cold session — a new engineer or a smaller model — debug, extend,
validate, and advance this project at the standard it was built to. They were authored from
the maintainer-era context (docs + decisions + operational memory) and adversarially verified
against the repo in 2026-07.

Each skill is a directory holding a `SKILL.md` (some also carry helper files). Sessions pick
them up automatically from the frontmatter `description`; this README is the human-facing index.

## The sixteen skills

### Orientation & stewardship

| Skill | What it's for |
| --- | --- |
| `orient` | **Start here.** Routes any task or symptom to the right surface (userscript / wk-enhanced-api / study-app), the authoritative doc, and the right sibling skill; states the iron rules. Use first for anything non-trivial or cross-surface. |
| `roadmap` | Read/add/update/complete records in `ROADMAP.html`, the single source of truth for backlog + shipped work. Use it instead of ever writing a TODO / NEXT_STEPS / handoff `.md`. |
| `content-gap-audit` | Plan and prioritize content/feature work against the learner profile and the 2026-12-06 exam — "what should we work on next", gap-finding, content-fill sprints — then turn the plan into ROADMAP records. |
| `land-a-change` | The definition of done: per-surface validation commands, the stale-comment sweep, doc-ownership table, ROADMAP records, house commit style, prose change-summary. Run before **any** commit. |
| `deploy-prod` | Production runbook — DO droplet, the two Docker containers (api :3000 + web :8080), Cloudflare Tunnel, the ordered seed steps, verify-prod, rollback. Use for any ship-to-prod / droplet op. |
| `troubleshoot` | Symptom-indexed debugging across all three surfaces + prod (empty cards, login won't stick, 401 audio, blank tabs, sync loss, 502s, CORS-null-ETag, tunnel/container/seed incidents). Use whenever something is broken, before diving into code. |

### Per-surface development

| Skill | What it's for |
| --- | --- |
| `userscript-dev` | Edit/debug the Tampermonkey userscript (`wkenhanced.user.js`): version pairing, `@grant`/`@connect`, WKOF sandbox rules, reveal logic, fetch/cache semantics, console diagnostics. |
| `api-dev` | Develop on `wk-enhanced-api` (Bun + Hono + SQLite): endpoints, Zod schemas, DB repos, the warm pipeline, tests, structured-log debugging. Read before writing server code. |
| `study-app-dev` | Develop on the 日常日本語 study app (`study-app/` — Vite, no framework): dev loop, module map, sync/persistence rules, Vitest suite, browser verification. |
| `design-system` | Style study-app UI to the Day/Night design system: role tokens, cascade order, component contracts, both-themes + mobile verification, frame-first mock-matching. Use before editing any CSS there. |

### Recurring patterns

| Skill | What it's for |
| --- | --- |
| `add-study-tab` | Add a new top-level tab/panel to the study app via the established 8-tab pattern (shell + button + feature module + wiring + styles + state + tests + docs). The JLPT tab is the worked reference. |
| `add-synced-blob` | Add a new cloud-synced per-user data blob (`createSyncedBlob` + the `cloud.js` registry + `PUT /v1/progress/{app}`): client store, registry entry, 409 merge reconciler, server enum widen, rollout ordering. Also the fix path when a progress PUT 400s/409s. |

### Content pipelines

| Skill | What it's for |
| --- | --- |
| `add-grammar-point` | Author/edit N3 grammar content (`study-app/tools/grammar-n3` → generated cloze cards): points registry, per-id content, rebuild, sentence seeding, TTS coverage. |
| `add-song` | Add/curate songs in the 歌/Songs library: the curate → align-timing → seed pipeline, the in-app Add flow, per-line timing, prod seeding, copyright rails. |
| `add-minna-lesson` | Import/extend みんなの日本語 (教科書 tab) lessons: scrape → curate → furigana → audio → sentence-store seed, plus deck activation and iTalki tutor vocab tagging. |
| `jlpt-data` | Regenerate/extend the JLPT word-list data (the generated `jlpt.js` N5–N1 map + per-level gap-fill chunks). Vocab only — grammar is `add-grammar-point`. |

## Keeping the library healthy

These skills compress the architecture docs plus decisions that live nowhere else. Two rules:

1. **When a change alters something a skill asserts** (a path, command, enum, procedure,
   contract), update the affected skill in the same commit — the `land-a-change` skill's
   doc-ownership table includes this library.
2. **Each skill ends with a "Ground truth" section** naming its authoritative sources and an
   as-of date. When in doubt, the sources win; re-verify and refresh the skill rather than
   patching around it.

Skills are trusted more literally than prose docs — a stale skill misleads faster than a stale
README. Prune or fix aggressively.
