# Vocab cards — data model + how to author a COMPLETE card

The single reference for **what a vocab card is** and **how to create a complete one**.
Cards are the atom of the study app: the flashcard deck, Browse grid, SRS schedule, and
Stats all operate on the unified `DATA` array. This doc is the source of truth for the
card schema; the layer docs ([CLAUDE.md](CLAUDE.md), [MINNA.md](MINNA.md)) point here.

## Where cards come from (seven sources, one shape)

Every source produces the **same card object**; they differ only in where the data lives,
which activation path builds it, and how much of it is filled in. Everything except the
built-ins lives in `localStorage["jpverbs_custom"]` (synced as `custom-verbs`).

| Source | Built by | Authored via | Completeness |
|---|---|---|---|
| **Built-in** (the 100 frequent verbs) | `verbs.js` (`VERBS` + `ACCENTS`) + `examples.js` (`EXAMPLES` seed) | edit the static data files | **complete** |
| **みんなの日本語** lesson vocab | `minnaCard()` from `../data/minna/lesson-<n>.json` (server) | scrape → curate → content workflow | **complete** |
| **User custom** | the "Add card" modal | UI ([Recipe C](#c-a-user-custom-card-the-add-card-modal) — authors `levels`+`accent` too) | **complete** |
| **歌 / Songs** mined vocab | `buildSongCard` (core/songs.js) | Mine mode's per-word / bulk add | headword-level (jp/read/mean/JLPT + provenance) |
| **鰐蟹 / WaniKani** activation | `buildWkCard` (core/wanikani.js) | leech / confusion-family / subject add | headword-level + WK meanings; JLPT stamped from the bundled list |
| **合格 / JLPT** gap-fill | `buildJlptCard` (core/jlpt.js) | "Add today's N" on the JLPT tab | headword-level, JMdict-glossed |
| **Grammar** (N3 catalog) | `buildGrammarCard` (core/grammar.js) | JLPT-tab grammar lens "add as cloze" | **display snapshot** — content renders live BY `grammarId` lookup, so catalog fixes reach existing cards |

`DATA = VERBS (minus skip) ⊕ overlays ⊕ loadCustom().verbs`, rebuilt by `rebuildData()`;
`attachLevels()` then backfills `levels` (from `EXAMPLES[rank]`) and `accent` (from
`ACCENTS[rank]`) onto built-ins. See the dead-ends in [CLAUDE.md](CLAUDE.md).

## The complete field schema

A card is a plain object. `✓` = required for the card to function; the rest make it
*complete* (full study value).

| Field | Type | Req | What it is / drives |
|---|---|:--:|---|
| `rank` | number | ✓ | Unique id. Built-ins 1–100; custom/Minna get `++seq` (starts at 100). **Keys SRS progress in `store.cards[rank]`** — never reuse a rank. |
| `jp` | string | ✓ | Headword / dictionary form (kanji). The flashcard prompt, the Jisho link, and **what's sent to TTS** (`ttsText` sends the kanji for correct pitch). |
| `read` | string | ✓ | Kana reading. The answer being tested; pitch marks render on it. |
| `mean` | string | ✓ | English meaning. |
| `cat` | string | ✓ | Category: `verb` / `adjective` / `noun` / `adverb` / `phrase` / `grammar` (the sixth, for cloze-drilled grammar-point cards). Paints the spine + hanko stamp; the **Category** facet. Defaults to `verb` if absent. |
| `type` | string | — | Sub-class: verbs `godan`/`ichidan`/`irregular`; adjectives `i-adj`/`na-adj`; else `''`. The **Type** facet + stamp label. |
| `trans` | string | — | Transitivity (verbs only): `t` (transitive) / `i` (intransitive) / `''`. The **Transitivity** facet. |
| `jlpt` | string | — | `N5`…`N1`. The **JLPT** facet. Minna default `N4`. |
| `tags` | string[] | — | Semantic/topic tokens (`motion`, `daily`, …) + specials (`suru`, `fake`) + provenance (`custom`, `みんなの日本語`, `mnn-l<n>`, `iTalki`, `歌`/`song-<id>`, `鰐蟹`/`wk-l<n>`). Drive the **Topic** + **Source** facets and the Browse tag chips. |
| `mnem` | string (HTML) | — | Mnemonic / memory hook. Rendered via `innerHTML` (so `<b>`/`<br>` are allowed — author-controlled, keep it safe). |
| `tip` | string (HTML) | — | Trap / usage note (similar words, nuance, conjugation gotcha). Rendered via `innerHTML`. |
| `ex` | `[[jp,en]]` | — | A single fallback example. Used only when `levels` is absent. |
| `levels` | `{N5..N1:[jp,en]}` \| null | — | **The five JLPT-tiered example sentences** — the headline content. See [format](#example-sentences-levels). Built-ins source these from `EXAMPLES[rank]`. |
| `accent` | number | — | **Tokyo-dialect pitch accent** (0 = heiban, 1 = atamadaka, k = drop after the kth mora). Drives `pitchHtml`. Built-ins source from `ACCENTS[rank]`. |
| `tts` | string | — | Optional TTS-text override for an ambiguous single kanji Google misreads (e.g. `角` → set `"かど"`). Defaults to the kanji headword. |
| `custom` | bool | — | Marks a user/Minna card (CUSTOM badge, Edit/Delete). |
| `minna`, `italki`, `minnaKey`, `minnaLesson` | — | Minna provenance (see [MINNA.md](MINNA.md)). |
| `wanikani`, `wkId` | — | 鰐蟹/WaniKani provenance (leech→deck activation): `wanikani:true` feeds the **Source** facet, `wkId` is the WK subject id (the dedup key against re-adds). Built by `buildWkCard` (core/wanikani.js). |
| `song`, `songKey`, `songId` | — | 歌/Songs provenance (Mine-mode activation): `song:true` feeds the **Source** facet (with the per-song `song-<extId>` tag); `songKey` is the idempotency key. Built by `buildSongCard` (core/songs.js). |
| `jlptfill`, `added` | — | JLPT gap-fill provenance: `jlptfill:true` feeds the **Source** facet; `added:'YYYY-MM-DD'` is the day-stamp the JLPT checklist's quota signal reads. Built by `buildJlptCard` (core/jlpt.js). |
| `grammar`, `grammarId` | — | Grammar-card provenance: `grammar:true` + the durable `grammarId` into the N3 catalog. The card is a display snapshot — the flashcard cloze + Browse detail render the point's content by `grammarId` lookup (`grammarPointOf`). Built by `buildGrammarCard` (core/grammar.js). |
| `skip` | bool | — | Built-in only: exclude from the deck. |

All the machine-set provenance fields above survive a modal edit via `saveVerb`'s explicit
carry-through list (see the dead-end in [CLAUDE.md](CLAUDE.md)) — add any NEW machine-set
field to that list or editing orphans the card from its source.

## Format conventions (get these right)

### Example sentences (`levels`)

`levels` is `{ N5:[jp,en], N4:[jp,en], N3:[jp,en], N2:[jp,en], N1:[jp,en] }`. Rules:

1. **The headword appears in EVERY sentence** (conjugated naturally for verbs/adjectives).
2. **Difficulty escalates N5 → N1.** Rough grammar ladder: N5 basic (です/ます, を/に/へ);
   N4 て-form, 〜たい, 〜から, 〜とき; N3 〜ようにする, 〜たら/〜と, passive/causative; N2 〜わけ,
   〜ものの, 〜ざるを得ない-class; N1 advanced/idiomatic/formal.
3. **Every kanji carries ruby furigana in EXACTLY this shape:** `<ruby>漢字<rt>かんじ</rt></ruby>`.
   Kana stays plain. The app renders `levels` via `innerHTML`, so the ruby shows; a global
   `data-furigana` flip hides `<rt>` when the user turns furigana off. Example:
   `<ruby>橋<rt>はし</rt></ruby>を<ruby>渡<rt>わた</rt></ruby>る。`
4. English is an accurate, natural translation.

### Pitch accent (`accent`)

A single integer — the **drop position**: `0` heiban (no drop in the word), `1` atamadaka
(drop after mora 1), `k` nakadaka/odaka (drop after the kth mora). Mora-counted, so small
kana (きょ) and ん/っ/ー count per `splitMora`. `pitchHtml` draws an overline over the high
morae + a step-down at the drop. Get the value from a pitch dictionary (OJAD, NHK) when you
can — model guesses need a proofread.

### Mnemonics (`mnem`)

Aim for **sound-accurate first**: the English hook should actually resemble the Japanese
reading. Fall back to a kanji-based hook only when no honest sound link exists (e.g.
待つ → 松 "pine"). A fake sound-pun is worse than an honest "this is just the kanji" — a
mnemonic the reader can't trust is anti-useful.

### Categories, type, transitivity, tags

- `cat` ∈ `verb/adjective/noun/adverb/phrase/grammar`. `type` only for verbs (`godan`/
  `ichidan`/`irregular`) + adjectives (`i-adj`/`na-adj`); `trans` only for verbs (`t`/`i`).
  `grammar` cards are machine-built only (`buildGrammarCard` — tags `['文法']`, drilled as
  cloze, always self-graded); don't author one by hand in the modal.
- `tags` are lowercase; topics come from the known set wired in the markup (motion, transit,
  wearing, speaking, communication, giving, emotion, cognition, perception, existence,
  change, ability, onoff, daily, body, work, study, food, money). `suru`/`fake` are special
  Type tokens. Provenance tags (`custom`, `みんなの日本語`, `mnn-l<n>`, `iTalki`) are added by
  the activation/save paths — don't hand-set them on built-ins.

## The COMPLETE-card checklist

A card is **complete** when it has:

- [ ] `jp`, `read`, `mean`
- [ ] `cat` (+ `type` for verbs/adjectives, + `trans` for verbs)
- [ ] `jlpt`
- [ ] at least one **topic** tag (so it's reachable via the Topic facet)
- [ ] `mnem` — a memory hook
- [ ] `tip` — a trap / usage note
- [ ] `levels` — all **5 tiers**, ruby furigana on every kanji, headword in each, escalating
- [ ] `accent` — a pitch number from a reliable source

## Recipes

### A. A みんなの日本語 lesson word (richest, fully-supported path)

1. **Scrape**: `bun scripts/scrape-minna.ts <n>` → `data/minna/lesson-<n>.draft.json`.
2. **Curate** into `data/minna/lesson-<n>.json`: fix scrape errors, split `[context]` off
   headwords, set `dict`/`dictRead` (dictionary form — becomes the card), `cat`/`type`/`trans`,
   `mean`, `audio`. Flag tutored words with `"italki": true`.
3. **Generate content** per word (the part that makes them complete): `levels` (5 tiers,
   ruby), `mnem`, `tip`, `accent`. Use a per-word agent workflow (see the `minna-content-gen`
   pattern) and **validate** (next section), then write the fields into the vocab entry.
   Words that already exist as a built-in verb need **only `accent`** — they reuse the
   built-in's examples/mnemonic via the dedup overlay.
4. **Ship**: static data in the image → normal redeploy. The user re-activates the lesson
   ("Update N words") to pull the content onto already-added cards. Full doc: [MINNA.md](MINNA.md).

### B. A built-in dataset verb

Edit the static data files (no UI):

1. `verbs.js` — add a `VERBS` entry: `{rank, jp, read, mean, type, jlpt, trans, tags, mnem, tip, ex}`.
2. `examples.js` — add `EXAMPLES[rank] = { N5:[…], …, N1:[…] }` (the 5 tiers).
3. `verbs.js` — add `ACCENTS[rank] = <pitch number>`.

`attachLevels` wires `levels`/`accent` onto the card by `rank`. Keep `test/core.test.ts`
green (it asserts every built-in has 5 well-formed tiers + a numeric accent).

> **Ranking source note.** Built-in ranks are BCCWJ corpus frequency. する vs 言う for #1 is
> genuinely ambiguous — it depends on whether 〜する compounds count as する or split out as
> separate lemmas. We put する at #1 (the count a learner *feels*, meeting it constantly via
> compounds) and note the near-tie on both cards' `tip`. Don't "fix" #1 without reading that tip.

### C. A user custom card (the "Add card" modal)

Browse → **Add card** authors a **complete** card from the UI — `jp`, `read`, `mean`, `cat`,
`type`, `jlpt`, `trans`, `tags`, `mnem`, `tip`, a single `ex` pair, **and** (behind the
"Pitch accent & leveled examples" disclosure) the `accent` pitch number + the five JLPT-tiered
`levels` sentences. The card syncs under `custom-verbs`.

- **Pitch accent** is one whole number (0–12); a live preview renders the overline/drop notation
  (`pitchHtml`) as you type, so the value is verifiable. Blank = no pitch marks.
- **Leveled examples** are optional and per-tier — fill any subset of N5→N1 (the deck's nearest-tier
  fallback covers gaps), each JP carrying `<ruby>漢字<rt>かな</rt></ruby>` furigana. When present they
  take precedence over the single `ex`. Each tier's JP is validated as **clean ruby** (`isCleanRuby`)
  before saving — it's `innerHTML`-rendered, so any non-ruby markup is rejected (no broken furigana,
  no injection). The save-time validators are the pure `parseAccent` / `buildLevels` / `isCleanRuby`,
  and `attachLevels` preserves the stored `levels`/`accent` through every rebuild (custom ranks have
  no server-store entry to override them — the `|| v.levels` / `accent`-wins fallback).

So a UI-authored card now reaches the same completeness as a built-in. Furigana is still hand-typed as
ruby markup; an "AI-generate" button that drafts the tiers + accent server-side is a possible future
add — see [ROADMAP.html](../ROADMAP.html) (cards: AI-generate tiers + accent).

**Storage (Phase 2.5).** The example text (the single `ex` + the `levels` tiers) is **dual-written to the
server sentence store** as PRIVATE rows when you're signed in (`PUT /v1/sentences/card/{rank}` →
`db.replaceUserCardExamples`), so a signed-in card renders its examples **from the store** like a built-in
(`attachLevels` prefers `state.exampleLevels[rank]`; the localStorage `custom-verbs` blob is the
offline/anon fallback). The card DEFINITION (every other field) still lives in the synced `custom-verbs`
blob. See the sentence-store phases in [../SENTENCE_STORE_NLP.md](../SENTENCE_STORE_NLP.md).

## Validation (run before shipping generated content)

For any authored `levels`, assert: **balanced `<ruby>`/`<rt>` tags**; the **headword's kanji
stem appears** in each stripped sentence; **all 5 tiers present + non-empty**; `accent` is an
integer in `[0,12]`. (This is exactly what the Minna content apply-step checks — mirror it
for any new batch.) Generated Japanese is solid-but-not-perfect — a human proofread of
grammar, furigana, and especially pitch accent is the last step.

## Where each field renders (quick map)

- **Flashcard prompt**: `jp` (meaning mode) or `mean` (reading mode) + `cardStamp`.
- **Flashcard answer**: `read` with `pitchHtml(read, accent)`, `mean`, `mnem`+`tip` (`aNote`),
  the Jisho link, and the leveled example (`renderExample` → `exampleForLevel(v, tier)`).
- **Browse card**: `jp`, `read`+pitch, `mean`, stamp, JLPT pill, provenance badge, tag chips.
- **Browse detail modal**: all of the above + the SRS Leitner track + collapsible
  Mnemonic / Trap-tip / level-filtered Examples.
- **Audio**: `ttsText(v)` → `/v1/tts` (kanji for accent; `tts` override). The server now also
  exposes a unified, **voice-tagged** audio surface (`/v1/audio/tts?voice=`, `/v1/audio/variants`)
  so a text can resolve to several voices (Siri male/female, Google, native, your own takes); the
  client adopts it (a per-context voice picker) in audio-unify Phase 2 — see
  [ROADMAP.html](../ROADMAP.html) (audio-unify — shipped). `/v1/tts` stays as the default-voice alias.
