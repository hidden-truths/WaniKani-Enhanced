# WKEnhanced project skill library

Sixteen skills that let a cold session — a new engineer or a smaller model — debug, extend,
validate, and advance this project at the standard it was built to. They were authored from
the maintainer-era context (docs + decisions + operational memory) and adversarially verified
against the repo in 2026-07.

## Map

Orientation & stewardship: `orient` (start here — routes any task), `roadmap` (the backlog),
`content-gap-audit` (what to build next for the exam mission), `land-a-change` (definition of
done), `deploy-prod` (production runbook), `troubleshoot` (symptom-indexed debugging).

Per-surface development: `userscript-dev`, `api-dev`, `study-app-dev`, `design-system`.

Recurring patterns: `add-study-tab`, `add-synced-blob`.

Content pipelines: `add-grammar-point`, `add-song`, `add-minna-lesson`, `jlpt-data`.

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
