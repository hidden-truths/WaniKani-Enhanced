# Kickoff prompt — migrate the study app to the Day/Night redesign

> Paste the block below into a fresh Claude Code (Opus) session started in the repo root
> (`~/Development/WaniKani`). It's written to Anthropic's Claude Code prompting guidance:
> concrete goal, the exact files to read first, an explore→plan→implement→verify workflow,
> hard constraints, and a clear definition of done.

---

You are migrating the **production** 日常日本語 / Japanese Trainer study app to a finished visual
redesign (the "Day / Night" design system). The redesign already exists as approved, self-contained
HTML mocks; your job is to apply that look to the real app. This is real production code — work
carefully, in shippable phases, verifying as you go.

## Read first (in this order), before writing any code
1. `study-app/mockups/redesign/MIGRATION.md` — the authoritative migration plan: the strategy
   (reskin-in-place + token aliasing), the mocks-vs-production gap, the phased plan, the load-bearing
   constraints, and the open decisions. Follow it.
2. `study-app/mockups/redesign/system.css` — the visual source of truth (tokens, both themes,
   components, atmosphere). You translate this onto the app's existing classes; you do NOT ship it
   verbatim.
3. `study-app/mockups/redesign/HANDOFF.md` — mock status, design decisions, the dead-ends, and the
   headless-Chrome screenshot runbook.
4. `study-app/CLAUDE.md` — the production architecture, the **Design system** section, and the
   **"Things that look like bugs but aren't" dead-end warnings**. These are load-bearing — do not
   regress them.
5. Skim the current `study-app/src/styles.css` (~950 lines) + `study-app/index.html` +
   `study-app/src/features/chrome.js` (theme/font/tabs), and a couple of mock `hybrid-*.html` files
   next to their `screens/*.png` so you know the target for each surface.

## The goal
Make the running app look like the mocks — warm washi-paper light + candle-lit warm dark, all-sans
type (Bricolage Grotesque / Hanken Grotesk / Spline Sans Mono / Zen Kaku Gothic New), lifted
cards, the hanko/pitch-accent/furigana motifs, functional color preserved — in **both themes**,
across **all surfaces**, without breaking behavior.

## Approach (per MIGRATION.md — reskin-in-place)
- **Keep** the production markup, class names, and `data-*`; the feature JS is wired to them.
- **Token aliasing is the linchpin:** define the redesign palette in `src/styles.css`, then alias the
  names the code/SVG-charts already use (`--godan`/`--ichidan`/`--irregular`/`--paper`/`--paper-2`/
  `--ink`/`--muted`/`--line`/`--leech`/`--good`/`--jp-font`) onto the new values so charts and existing
  `var(--…)` references reskin for free.
- Restyle the existing classes (`.navbar`, `.tab`, `.chip`, `.frow/.chips`, `.card`, modals, …) to the
  redesign treatment, using `system.css` as the value reference.
- Add the fonts (Google Fonts `<link>`), the `.grain`/`.atmos` atmosphere layers + the `#stamp` SVG
  filter, and the ≤640px mobile layer.

## Work in phases (MIGRATION.md §6), one commit each
Phase 0 Foundation (tokens + fonts + atmosphere + base type) → 1 Chrome → 2 Flashcards →
3 Browse → 4 Stats → 5 Textbook/Self-talk/Songs → 6 Modals & forms → 7 Mobile + cross-browser + QA.
**Do Phase 0 first and pause for a look-check** — it carries most of the visual change at near-zero
structural risk and de-risks the rest.

## Before you start: make a plan, and confirm the open decisions
1. Enter **plan mode** (or otherwise produce a written plan) for **Phase 0** specifically — the exact
   token map (old name → new value, both themes + the `prefers-color-scheme` fallback), the font
   changes, and the atmosphere additions — and show it to me before editing.
2. Ask me to confirm the four **open decisions** in MIGRATION.md §9 (reskin-in-place vs class-rename;
   keep the JP font switcher; one `styles.css` vs split; this-session scope). Don't assume — a couple
   of these change the work.

## Hard constraints (do not violate)
- **Preserve every dead-end / contract** in CLAUDE.md and MIGRATION.md §7: chip wiring by class +
  `data-*`; the `.frow/.chips` layout; roving-tabindex ARIA radiogroups; the inline-SVG-sprite
  inline-style size hack; the `.mn-vocab` `0 solid transparent` Safari border rule; modals scroll-cap
  + sticky `×`; the `data-furigana` flip; the `#navExtra` dock.
- **No framework, no chart library, no CDN icon font.** Charts stay hand-rolled SVG; icons stay the
  inline sprite; Google Fonts is the only external dep and must degrade gracefully (offline → system
  fonts).
- **Preserve functional color meaning** (godan=vermilion, ichidan=indigo, irregular=gold/stone,
  leech=plum, good=jade) — only the hexes change.
- **Both themes, every change.** A fix that only works in light or dark isn't done. Keep the existing
  `data-theme` + `prefers-color-scheme` fallback + the manual toggle in `chrome.js`.
- **Keep `bun run test` and `bun run build` green** — run them each phase.
- **⚠️ Do NOT stop or restart the dev servers** on `:5173` (study-app) or `:3000` (API) — the
  maintainer has live test tabs against them. Drive the already-running preview for your own checks;
  only restart a server if it's actually down (`curl -s localhost:5173` / `localhost:3000/v1/health`).

## Verify each phase (don't ask me to check manually)
- `bun run test` + `bun run build` green.
- Screenshot the affected tab(s) in **both themes** (and at ~390/500px in the mobile phase) via the
  running preview, and compare against the matching `study-app/mockups/redesign/screens/*.png`. Read
  the PNGs yourself to confirm.
- Report what changed in prose (not just a diff), and commit (one logical phase → one commit, on a
  feature branch; stage explicit paths; end the message with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

## Definition of done (overall)
All surfaces match the mocks in both themes; tests + build green; no dead-end regressed; mobile holds
at ~390px; Safari checked for the table-border trap; `CLAUDE.md`'s "Design system" section updated to
describe the *shipped* system (and the mocks noted as the origin). The mocks in `mockups/redesign/`
stay as the reference — don't delete them.

If anything is ambiguous or a constraint seems to conflict with the look, stop and ask rather than
guessing.

---

*(Provenance: the mock phase — build, secondary surfaces, mobile pass, two critique sweeps — is in
the git log under `study-app: …` commits, and narrated in `mockups/redesign/HANDOFF.md` +
`MIGRATION.md`.)*
