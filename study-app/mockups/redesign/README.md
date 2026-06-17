# Redesign explorations — 日常日本語 (Japanese Trainer)

> **Status (latest):** all six main surfaces + the secondary surfaces (Settings / sign-in /
> add-card modals, the pre-reveal flashcard prompt, banners & empty states) done in both themes,
> mobile-passed (≤640px), and through a 2nd critique sweep — **~9.3/10 with light↔dark depth
> parity. Picking up this work? Read [HANDOFF.md](HANDOFF.md) first** — it has the
> full journey, the decisions and why, the design-system reference, the screenshot runbook, the
> dead-ends, and what's next. This README is the catalog; HANDOFF is the status.

Visual-design exploration for the study app. **Mocks only — no production code.** Each
file is a self-contained HTML page (own fonts via Google Fonts, own palette + atmosphere)
rendering the *same* content so the directions are directly comparable: the **study home**
and the **core revealed flashcard** for 払う (はらう, "to pay").

Open the gallery: [`index.html`](index.html) — or any mock directly — on a static
server (e.g. the Vite dev server already running): `http://localhost:5173/mockups/redesign/<file>`.
Full-res screenshots are in [`screens/`](screens/) (retina, captured with headless Chrome at 1280px wide).

## Why this exploration

The current app is **coherent and tasteful but austere** — it reads like a well-made
*technical document / CLI* rather than a modern consumer app. The goal here is to keep what's
genuinely good and fix what makes it feel flat.

**Keep:** the warm-paper identity; the *functional* color system (vermilion=godan,
indigo=ichidan, …) which is pedagogically meaningful; the distinctive motifs (hanko stamp,
pitch-accent overline); the comfortable mobile card.

**Fix:** everything is tiny (9–13px uppercase mono everywhere → a permanent squint); desktop
is mostly empty (a small card marooned in a sea of cream, no hero); flat to the point of
looking like a wireframe (hairline borders, ~2px radius, no depth/atmosphere/texture);
monospace overload pushing it toward "terminal tool"; no real Latin display typeface (system
Georgia + SF Mono carry nothing — the JP fonts do all the work).

## The directions

| # | Direction | File | Feel |
|---|-----------|------|------|
| A | **Sumi & Vermilion** | [`a-sumi-vermilion.html`](a-sumi-vermilion.html) · [png](screens/a-sumi-vermilion.png) | Warm premium **editorial** — elevates the existing washi/ink DNA. Fraunces display, a round 払 hanko seal, paper grain, liftable warm shadows, a floating forecast card. Shines in the default light theme. |
| B | **Neo / Transit** | [`b-neo-transit.html`](b-neo-transit.html) · [png](screens/b-neo-transit.png) | Bold **Tokyo transit-signage** graphic energy. Giant Anton "100" bleeding off a departures board, station-code chips, heavy black 払う on a hatched panel, signal red/blue grade blocks. Most distinctive; loudest for daily use. |
| C | **Yoru / Quiet Luxe** | [`c-yoru-luxe.html`](c-yoru-luxe.html) · [png](screens/c-yoru-luxe.png) | Soft **dark-first, modern-premium** calm (Linear / Apple Music night). Atmospheric glows, frosted-glass cards, a coral jewel accent, the meaning set in Instrument Serif inside a sleek dark UI. Ideal for evening study + Songs. |
| ★ | **Hybrid — Day / Night** | [`hybrid-day-night.html`](hybrid-day-night.html) · [png](screens/hybrid-day-night.png) | **Chosen lane.** One coherent system, two themes: A's warm editorial as the daily **light** theme + a genuinely atmospheric **warm dark** mode borrowing C's depth & glow ("candle-lit washi at night"). Has a working ☼/☾ toggle. |

## Hybrid — the full site (serif-free, all-sans)

The chosen Day/Night system, **serif removed** (all-sans now), applied across every surface.
All surfaces share **[`system.css`](system.css)** + **[`system.js`](system.js)** (tokens for both
themes, the topbar/nav, cards, chips, buttons, hanko, pitch-accent, atmosphere, the ☼/☾ toggle +
`?theme=` param) — so the look is consistent and the font choice is a **one-file change**.

| Surface | File | Screens |
|---------|------|---------|
| Flashcards (hero) | [`hybrid-day-night.html`](hybrid-day-night.html) | [light](screens/hybrid-day-night.png) · [dark](screens/hybrid-dark.png) |
| Browse | [`hybrid-browse.html`](hybrid-browse.html) | [light](screens/hybrid-browse.png) · [dark](screens/hybrid-browse-dark.png) |
| Songs · Read | [`hybrid-songs.html`](hybrid-songs.html) | [light](screens/hybrid-songs.png) · [dark](screens/hybrid-songs-dark.png) |
| Stats | [`hybrid-stats.html`](hybrid-stats.html) | [light](screens/hybrid-stats.png) · [dark](screens/hybrid-stats-dark.png) |
| みんなの日本語 | [`hybrid-minna.html`](hybrid-minna.html) | [light](screens/hybrid-minna.png) · [dark](screens/hybrid-minna-dark.png) |
| 独り言 Self-talk | [`hybrid-selftalk.html`](hybrid-selftalk.html) | [light](screens/hybrid-selftalk.png) · [dark](screens/hybrid-selftalk-dark.png) |

## Secondary surfaces — modals, prompts & states

The moments *around* the cards, all built on a shared **modal / overlay / form** kit added once to
[`system.css`](system.css) (`.overlay`, `.modal` + `.narrow`/`.wide`, `.modal-head`/`-body`/`-foot`,
`.field`/`.field-row`, `.input`/`.textarea`/`.select`, `.switch`, `.set-group`/`.set-card`/`.set-row`).

| Surface | File | Screens |
|---------|------|---------|
| Settings | [`hybrid-settings.html`](hybrid-settings.html) | [light](screens/hybrid-settings.png) · [dark](screens/hybrid-settings-dark.png) |
| Sign in / register | [`hybrid-auth.html`](hybrid-auth.html) | [light](screens/hybrid-auth.png) · [dark](screens/hybrid-auth-dark.png) |
| Add a card | [`hybrid-addcard.html`](hybrid-addcard.html) | [light](screens/hybrid-addcard.png) · [dark](screens/hybrid-addcard-dark.png) |
| Flashcard prompt (pre-reveal) | [`hybrid-prompt.html`](hybrid-prompt.html) | [light](screens/hybrid-prompt.png) · [dark](screens/hybrid-prompt-dark.png) |
| Banners & empty states | [`hybrid-states.html`](hybrid-states.html) | [light](screens/hybrid-states.png) · [dark](screens/hybrid-states-dark.png) |

## Mobile / responsive

Every surface has a narrow-width (≤640px) treatment driven from a shared layer in
[`system.css`](system.css): the topbar collapses (CSS grid) to a compact brand + actions row over
a horizontally-scrollable tab strip, the display type scales down, and modals go full-width with
stacked field/settings rows. Surface grids stack (hero, notes, the Browse grid, Songs two-column,
Stats metrics, the Minna vocab table, the Self-talk rig, the states banner).

Reference shots (≈500px — the headless-Chrome min width): [Flashcards](screens/hybrid-day-night-mobile.png) ·
[Browse](screens/hybrid-browse-mobile.png) · [Settings](screens/hybrid-settings-mobile.png) ·
[States](screens/hybrid-states-mobile.png).

## Type & color, at a glance

**The shipping system (serif-free, all surfaces):**
- **Display / numerals / the revealed meaning:** `Bricolage Grotesque` (warm, characterful sans).
- **Body / UI:** `Hanken Grotesk`. **Micro-labels / codes:** `Spline Sans Mono` (sparing).
- **Japanese:** `Zen Kaku Gothic New` (gothic — no mincho).
- **Functional color preserved:** godan = vermilion `#CD4327` (light) / coral `#FF6B4A` (dark, glowing jewel); ichidan indigo, irregular stone, leech plum, "got it right" green→jade.

> The earlier exploration mocks (A/B/C) kept their original serif/grotesk type (Fraunces, Anton, Instrument Serif) — they're left as-is for the historical record. Only the **hybrid** line is the maintained, serif-free system.

## Next

All surfaces are built, mobile-passed (≤640px), and through a 2nd critique sweep (~9.3/10). The only
remaining step is the **production migration** — porting the look into the real `index.html` +
`src/styles.css` (reskin-in-place + token aliasing). Plan: **[MIGRATION.md](MIGRATION.md)** · kickoff:
[MIGRATION_PROMPT.md](MIGRATION_PROMPT.md).
