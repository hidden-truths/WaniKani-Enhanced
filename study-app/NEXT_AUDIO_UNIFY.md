# Next session — unify voice-audio sourcing behind one tagged API

A self-contained brief for a fresh session. The goal: **unify all voice-audio sourcing
behind one tagged audio API**, so a given item (word reading / example sentence /
conversation line) resolves to MULTIPLE tagged voice VARIANTS the user can pick or cycle.

> ## STATUS — Phases 1 + 2 SHIPPED (`minna-audio-unify`); Phase 3 + follow-ups ②③④⑤ on `audio-followups`
>
> **Decisions locked** with the maintainer: **Google** = one neutral `gtx` variant (no paid
> Cloud TTS — gender diversity comes from Siri). Picker is **per-context** (reviews / browsing /
> textbook) where each context is an ordered priority of **specific voices OR kinds** (native /
> tts / user). Delivery is **phased**.
>
> **Phase 1 done (server-only, no UX change, existing playback intact):**
> - Tagged key scheme `audio/<provider>/<gender|'default'>/<sha256(text)>.<ext>` +
>   `ttsVariantKey`/`ttsTextHash` (`services/tts.ts`); the legacy `tts/<hash>` keys + ~960 clips
>   are untouched.
> - `audio_variants` manifest table (`db/`) — which specific voices exist for a text.
> - `resolveTts(text, voice?)` (the 3-tier cache, factored out of the inline `/v1/tts`).
> - **One `/v1/audio` route group**: `GET /variants?text=` (synth catalog), `GET /tts?text=&voice=`,
>   `GET /native?src=` (gated), `POST/GET/DELETE /recordings*` (gated). The native + recordings
>   handlers are shared functions ALSO mounted at the legacy `/v1/minna/{audio,recordings*}` +
>   `/v1/tts` paths, so the current client keeps working. `audio` added to the `STUDY_ROUTE`
>   credentialed-CORS allowlist.
> - `generate-tts.ts --variant <provider:gender>` for dual-gender Siri pre-gen (two passes,
>   flipping the macOS System Voice).
>
> **Phase 2 done (client):** `core/audio.js` (`resolveVariant(context, available, prefs)` +
> per-context `DEFAULT_AUDIO_PREFS`, pure + tested); a shared `playItem(item, context, btn)` player
> (`features/audio.js`) routing public-vs-credentialed by the variant's `gated` flag; `speak()`/
> `speakWord()`/Minna's word + conversation buttons all go through it (the old native-only `mnPlay`
> is gone); a per-context Voice-priority editor in Settings persisted as `settings.audioPrefs`
> (synced); flashcards (`reviews`), Browse (`browse`), Minna (`minna`) wired.
>
> **Phase 3 done (⑤):** the record-and-compare player's "▶ native" is now "▶ reference" against any
> voice. The reference variant resolves via `resolveVariant('minna', …)` (so the per-context priority
> picks the default), and Alt/Shift-click the ▶ reference button cycles the item's voices
> (native → Siri F/M → Google), reusing the existing windowing/normalization/waveform machinery — the
> reference URL is just native-clip-or-synth-`/v1/audio/tts`, played on the same credentialed element
> (the public TTS endpoint is under the study-app CORS allowlist). `seq`/`both`/`loop` compare against
> the selected reference; a word/line carries its synth `text` so even a clipless line can compare
> against Siri. `referenceVariants`/`currentRef`/`refUrl` in `features/minna-record.js`.
>
> **Follow-ups (branch `audio-followups`):** the ①–⑦ list lives in
> [NEXT_STEPS.md](NEXT_STEPS.md) "Audio-unify — follow-ups & ideas". Done so far: **② Preview
> voice** — each Voice-priority row has a ▶ auditioning 食べる through that exact variant
> (`previewVoice` in [src/features/audio.js](src/features/audio.js)); **③ Per-item voice cycle** —
> Alt/Shift-click any play button cycles that item's voices (`variantOrder`/`variantIndex` in
> [src/core/audio.js](src/core/audio.js); `cycleMod` + the cursor in `features/audio.js`);
> **④ Availability hinting** — the editor queries `/v1/audio/variants` and dims synth voices that
> aren't pre-generated yet (`fetchAvailableVoices`), so ① is visible in the UI; **⑤ Phase 3** —
> ▶ reference (see above). Remaining: ① (operator pre-gen the Siri clips) + ⑥/⑦ (stretch).
>
> The variant-descriptor shape, key schema, preference model, and verification steps are in the
> approved plan; the sections below are the original brief, kept for reference.

> ⚠️ **TEST ENV — DO NOT take down the running servers.** Vite dev on **:5173** and the API
> on **:3000** (started with `COOKIE_SECURE=false bun dev`); the maintainer tests in their own
> browser against them. No `preview_stop` / `pkill` / killing :5173 or :3000. Only (re)start if
> actually down (`curl -s localhost:5173`, `curl -s localhost:3000/v1/health`). Minna is
> owner-gated, so the API must run with `MINNA_OWNER_EMAILS` including the maintainer's account
> (dev `.env` already sets it). Local TTS generation runs on macOS via `say` (system voice).

## Read first (in order)
1. [MINNA.md](MINNA.md) — the Minna feature + record-and-compare + roadmap
2. [CLAUDE.md](CLAUDE.md) — module map; the **TTS**, **audio-pitch**, and **record-and-compare** dead-ends
3. [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md) — `/v1/tts` (3-tier storage cache +
   `ttsKey`), the "Local TTS pre-generation" scripts, the Minna audio/recordings routes + tables
4. [CARDS.md](CARDS.md) — card / `ttsText` model

## Where audio comes from TODAY (three separate paths)
Each has its own route, key scheme, and client play path:

| Surface | Route | Storage key | Client | Notes |
|---|---|---|---|---|
| Synth TTS | `GET /v1/tts?text=` | `tts/<sha256(text)>.{m4a,mp3}` | `speak()` in `features/tts.js` | 3-tier: in-proc → storage → Google `gtx`. `.m4a` (Siri, from `say`) preferred over `.mp3`. Key = `ttsKey(text,ext)` in `services/tts.ts`. PUBLIC. |
| Minna native | `GET /v1/minna/audio?src=` | `keys.minnaAudio(path)` | `mnPlay()` in `features/minna.js` | Proxied+cached from vnjpclub. **PRIVATE**, gated. Prefetched by `scripts/prefetch-minna-audio.ts`. |
| User takes | `…/minna/recordings/*` | per-user, `minna_recordings` table | `features/minna-record.js` compare player | **PRIVATE**, per-user. |

**Pre-generation:** `scripts/generate-tts.ts` (`--engine say` [default, system voice = Siri] |
`jp-tts` [Kyoko/Otoya Enhanced]) renders + uploads to the `tts/` keys. **Siri voices are ONLY
reachable via `say` + the macOS System Voice** (not `AVSpeechSynthesizer`) — confirmed dead-end.

## The target — a tagged variant catalog
Each item carries a CATALOG of tagged variants. A variant = `(provider, voice/gender, role)` +
the audio bytes. Examples for one word:

- **Siri Male** — `provider=siri, gender=male` ← `say` with System Voice = JP Siri male
- **Siri Female** — `provider=siri, gender=female` ← `say` with System Voice = JP Siri female
- **Google Male** — `provider=google, gender=male` ← **NOTE:** free `gtx` is ONE voice; real
  male/female Google needs **Google Cloud TTS (paid)**. Decide whether to provision or drop.
- **User** — `provider=user` ← per-user recording, scoped to the signed-in account, **NOT a
  shared voice** (the odd one out — model deliberately).
- **Minna No Nihongo** — `provider=minna, role=word|line|dialogue` (maybe gender) ← textbook
  native audio; could be male / female / whole conversation.

The client picks a preferred variant (global synced setting) with per-item cycle/override, and
falls back across providers when a variant is missing.

## START IN PLAN MODE — design before coding
Resolve these in the plan:

- **Identity + key schema.** TTS keys by `sha256(text)`; Minna keys by vnjpclub PATH; user
  recordings by `(user,lesson,itemKey)`. How do we map all three to one "item identity" + a
  variant axis? (e.g. `audio/<provider>/<voiceTag>/<sha256(text)>.<ext>`, plus a way to attach a
  Minna native clip + user takes to the same item.)
- **Discovery.** How does the client learn which variants exist for an item without probing — a
  catalog/registry (DB table? generated manifest?) vs convention + HEAD checks. Lean toward a
  queryable endpoint returning the tagged variant list.
- **Generating both Siri genders.** `say` uses the SYSTEM voice (one at a time, can't `-v` a Siri
  voice), so male+female = two driver passes with the System Voice flipped, tagged via a
  `--variant` arg. Design that workflow.
- **ACL/gating per provider.** `tts`/google = public; Minna native + user takes = PRIVATE/gated.
  A unified resolver must keep gated providers gated (cross-origin credentialed path — see the
  cross-origin dead-end) and never hand Minna/user bytes to a shared cache.
- **Client unification.** Collapse `speak()` / `mnPlay()` / the recordings player behind one
  resolver + a voice-picker UI; a synced "preferred voice" setting; graceful fallback.
- **Migration.** Keep existing playback working at every step (backward-compatible keys); don't
  break the **960** already-generated `tts/` clips or the prefetched Minna audio.

## Conventions
One logical change → one commit, committed at the end of a unit without being asked; fix stale
nearby comments in the same commit; run `bun run test` + `bun run build` in `study-app` and
`bun test` + `bun run typecheck` in `wk-enhanced-api` before committing; keep `src/core/*`
DOM-free and add tests for new pure functions; `scripts/` is excluded from the server tsconfig.
Update MINNA.md / both CLAUDE.mds / NEXT_STEPS as you go. Don't merge to main unless asked.
Branch: `minna-phase2-record-compare`.

**Tell me your plan before implementing.**
