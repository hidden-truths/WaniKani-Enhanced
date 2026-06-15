# Workstream C — `record-compare.js` decomposition (execution guide)

> Doc-of-record: [REFACTOR_FOLLOWUPS.md](../REFACTOR_FOLLOWUPS.md) (this is the detailed C
> appendix it points at). Dead-ends: [study-app/CLAUDE.md](../study-app/CLAUDE.md). C is the
> **last + optional + HIGH-risk** workstream of the SOLID/quality refactor — D and B shipped.

## Honest framing (read before deciding to do this)

[study-app/src/features/record-compare.js](../study-app/src/features/record-compare.js) is **853
lines**, but **its pure logic is already extracted** into
[core/recordings.js](../study-app/src/core/recordings.js) (`findTrimBounds`, `waveformPeaks`,
`rmsLevel`, `normGains`, `clampSpeed`, `clampKeep`, `validClip`, `resolveClip`, `formatDuration`,
`COMPARE_SPEEDS`, …) and [core/audio.js](../study-app/src/core/audio.js) (`resolveVariant`,
`variantOrder`, `contextPrefs`, …). So the remaining lines are **irreducible browser-API glue**:
MediaRecorder capture, Web-Audio decode, `<canvas>`, `<audio>`, DOM. The SRP win is real but
**modest**, there are **no feature tests** today, and there are several load-bearing dead-ends.

**Recommendation: do the cheap, high-value half (Phase C0 — extract + test the *remaining* pure
helpers) and seriously consider STOPPING there.** Full file-splitting (C1+) is mostly moving
stateful singletons between files for limited gain — only worth it if the file's size is actively
slowing work. The plan below covers the full split, but C0 is the part that pays for itself.

## The contract that must not change

The module's **13 public exports** are imported by two consumers — keep them all working
(an `index.js` re-export barrel preserves them after any internal split):

`RECORD_SUPPORTED`, `isSpeakingMode`, `enterSpeakingMode`, `exitSpeakingMode`, `speakingBarHtml`,
`initMicSelector`, `loadRecordings`, `newestTakeIdForItem`, `paintCompareWaveforms`,
`recordControlHtml`, `setOnTakeSaved`, `wireSpeakingControls`, `wireRecordCompare`.

- [minna.js](../study-app/src/features/minna.js):21 imports 11 of them.
- [selftalk.js](../study-app/src/features/selftalk.js):27-31 imports 12 of them.
- The shared **speaking-mode singletons + `setOnTakeSaved` hook** are intentional: ONE engine,
  one live mic stream, one active recording, driven by Minna **and** Self-Talk (only one tab/panel
  active at a time; each panel's leave hook calls `exitSpeakingMode()`).

## The hard part: shared module-level singletons

Unlike `schemas`/`db` (D) or the sync trios (B), this file's functions are **coupled through
mutable module-level state**, which is exactly what makes a clean split hard:

| Singleton group | Vars |
|---|---|
| Speaking / capture | `speakingMode`, `liveStream`, `active` (the in-flight recording), `_audioCtx` |
| Mic selection | `selectedMicId`, `micDevices`, `MIC_KEY` |
| Take cache | `recCache` (per-scope take lists), `onTakeSaved` |
| Playback elements | `takeAudioEl`/`takePlayingBtn`/`takeStop`, `nativeAudioEl`/`nativeStop` |
| Decode caches | `bufferCache`, `resolvedBuffers`, `windowCache`, `levelCache` |
| Cursor | `cursorControl`, `cursorRaf`, `activeNativeWindow`, `activeTakeWindow` |
| Gains / bias | `activeNativeGain`, `activeTakeGain`, `compareBias`, `bothPlaying` |

**Splitting strategy:** introduce one `record-compare/state.js` holding these singletons (exported
mutable objects, mutated in place — the `state.js` pattern the study app already uses), and have
capture/takes/playback/waveform/view import from it. Do NOT try to make each module own "its"
singletons and cross-import — the playback + waveform + cursor share `nativeAudioEl`/`takeAudioEl`
and the windows, so they'd cross-import anyway. A single shared-state module is acyclic and honest.

## Phase C0 — characterization-test net FIRST (the high-value half)

> **✅ SHIPPED.** The remaining inline pure helpers are extracted + unit-tested, zero behavior change:
> - `core/recordings.js` gained `RECORD_MIME_CANDIDATES`, `chooseMime(candidates, isSupported)` (the pure
>   core of `pickMime`), `encodeWav` (moved byte-identical), and `biasNative`/`biasTake` (the crossfader curve).
> - New **`core/refs.js`** (DOM-free; `base`/`httpServed`/`prefs` **injected**): `parseControlCtx`,
>   `nativePlayable`, `refAvailable`, `referenceVariants`, `defaultRef`, `refVariantId`, `refVariantById`,
>   `refShortLabel`, `currentRef`, and the URL shapes `nativeUrl`/`takeUrl`/`refUrl`/`refClip`. Added to the
>   `core/index.js` barrel (collision-checked clean).
> - [record-compare.js](../study-app/src/features/record-compare.js) now **delegates** via thin same-named
>   wrappers that bind the feature-owned inputs (`API_BASE`, `HTTP_SERVED`, `settings.audioPrefs`,
>   `control.dataset`). Net **−25 lines**; the **13 public exports + both consumers
>   (minna.js/selftalk.js) are byte-for-byte unchanged**.
> - **`study-app/test/record-compare-core.test.js`** (+39 tests). `bun run test` → **180 pass**,
>   `bun run build` green. (Server untouched → its suite unaffected.)
> - **Deviations from the candidate list below:** `pickMime` stays a feature wrapper (it reads the global
>   `MediaRecorder` + the `RECORD_SUPPORTED` const) delegating to the injected pure `chooseMime`; likewise
>   `controlCtx`→`parseControlCtx(dataset)` and `currentRef(control,…)`→`currentRef(savedId,…)` keep the DOM
>   read in the wrapper. `nativeUrl`/`nativePlayable`/`refAvailable`/`refVariantById` had no remaining feature
>   caller (only other now-core helpers called them), so they live in core only — not imported by the feature.
>
> Steps below are the as-planned record.

Extract the **remaining inline pure helpers** into `core/` (or a new pure `core/refs.js`) and
unit-test them. This is the safety net before touching any stateful glue, and it's worth doing
**even if you stop here**.

Candidates (all currently inline in record-compare.js; all pure or trivially purifiable):
- `pickMime()` (L32) — MediaRecorder codec pick. Test by stubbing `MediaRecorder.isTypeSupported`.
- `encodeWav(samples, sampleRate)` (L99) — Float32 → 16-bit PCM WAV `Blob`. Test the RIFF/`fmt `/`data` header bytes + sample count for a tiny buffer.
- URL builders `nativeUrl`/`takeUrl`/`refUrl(ctx,v)`/`refClip(ctx,v)` (L330, L535) — pure given a base + ctx. Either pass `API_BASE` in, or test the path/query shape. Pin the `?text=…&voice=…` encoding + the native `?src=` encoding.
- Reference-variant helpers `refAvailable(ctx)`/`referenceVariants(ctx)`/`defaultRef(ctx)`/`refVariantId(v)`/`refVariantById(ctx,id)`/`refShortLabel(v)`/`currentRef` (L515-524) — the reference-voice selection logic (built on `variantOrder`/`resolveVariant`, already core). High value to pin: this is where "which voice does ▶ reference play / cycle to" lives. Move to `core/refs.js`, unit-test against fixture ctxs.
- `controlCtx(control)` (L500) — dataset → ctx parse. Testable with a `{ dataset: {...} }` stub.
- Bias math `biasNative`/`biasTake` (L718-719) — pure; pin the crossfader curve.

Add `study-app/test/record-compare-core.test.js`. Commit C0 on its own. **Decision point:** if the
remaining glue isn't slowing you down, STOP here — you've captured the testable logic and the file
is now thinner. Otherwise continue.

## Phase C1+ — split the glue into `features/record-compare/`

Create the directory + an `index.js` that re-exports the 13 public names so
`minna.js`/`selftalk.js` imports are byte-for-byte unchanged. Then move the glue across small,
**individually browser-verified** commits in this dependency order (later modules import earlier
ones + `state.js`):

1. **`state.js`** — the singletons table above (mutable exports). No logic.
2. **`capture.js`** — `RECORD_SUPPORTED`, mic pick (`enumerateMics`/`setSelectedMic`/`micConstraint`/`initMicSelector`/`micOptionsHtml`/`refreshMicSelectors`), speaking mode (`enterSpeakingMode`/`exitSpeakingMode`/`isSpeakingMode`/`stopLiveStream`), `MediaRecorder` lifecycle (`startRecording`/`stopRecording`/`active`), `maybeTrim` (→ core `findTrimBounds`/`encodeWav`), the review panel (`showReview`).
3. **`takes.js`** — `recCache`, `loadRecordings`/`takesFor`/`setTakes`/`newestTakeIdForItem`/`newestTakeId`, the credentialed upload (`uploadTake`) + `deleteTake` + `setOnTakeSaved`/`onTakeSaved`.
4. **`playback.js`** — `playRange` (windowed `<audio>`; **NOT** Media-Fragments `#t=`), the reused `<audio>` elements + `ensureTakeAudio`/`ensureNativeAudio`, `playTake`/`stopTake`/`playTakeOnce`, `playReference`/`stopNative`, `stopCompare`, `applySpeed`, the gains/bias (`setActiveGains`/`applyBothVolumes`/`setCompareBias`), `setCompareSpeed`.
5. **`waveform.js`** — `fetchAudioBuffer` (credentialed) + the decode caches, `bufferToMono`, `speechWindow`/`windowFor`/`levelFor`, `drawWave`/`paintWave`/`paintControlWaves`/`paintCompareWaveforms`/`setRefCaption`, `WAVE_W`/`WAVE_H`/`COMPARE_TRIM`, the cursor rAF (`tickCursors`/`startCursors`/`stopCursors`/`setCursor`/`progressIn`).
6. **`view.js`** — the HTML builders (`recordControlHtml`/`recordControlInner`/`takesHtml`/`compareHtml`/`waveWrapHtml`/`waveRowHtml`/`speakingBarHtml`/`speedControlHtml`/`biasControlHtml`), `resetControl`/`refreshRefUi`, and the delegated **attach-once** handlers (`wireRecordCompare`/`wireSpeakingControls`/`handleCompare`/`cycleReference`).
7. Delete the old `record-compare.js` once `index.js` + the modules cover every export; update nothing in the consumers (the barrel keeps the path the same — keep it `features/record-compare/index.js` so `'./record-compare.js'`… NOTE: imports use `./record-compare.js`; a directory `record-compare/` with `index.js` resolves only if you change the import to `./record-compare/index.js` OR keep a thin `record-compare.js` that re-exports `./record-compare/index.js`. Prefer the thin re-export file so the two consumers stay untouched.)

## Dead-ends to respect (all pinned in [study-app/CLAUDE.md](../study-app/CLAUDE.md))

- **AirPods HFP mic pin** — recording from an explicit non-AirPods `deviceId:{exact}` keeps AirPods in A2DP; the chosen id is DEVICE-LOCAL (`localStorage`, not synced). Don't "simplify" to `audio:true`.
- **Windowed playback alignment** — `playRange` + `COMPARE_TRIM` seek/stop via a `timeupdate` listener, NOT Media-Fragments `#t=` (unreliable on `<audio>`). The play window == the drawn waveform window (`windowFor`) so "what you see is what plays". Don't swap to `#t=`.
- **Canvas waveform decode-fails-safe** — any fetch/decode error just skips that waveform; the `<audio>` compare buttons are unaffected. Keep the try/catch in `fetchAudioBuffer`/`paintWave`.
- **Once-attached delegated handlers** — `wireRecordCompare(body)`/`wireSpeakingControls(navEl)` guard on a `dataset.*Wired` flag because the host re-renders the body each render; re-attaching per render stacks listeners. Keep the guards.
- **Speaking bar lives in the navbar `#navExtra`, record controls in the view body (`#mnBody`)** — two different delegate roots. Don't merge them.
- **Speaking mode keeps ONE mic stream open** for all takes (no getUserMedia per take — avoids the macOS renegotiation hitch + the AirPods flip). Keep the persistent `liveStream`.
- **Take/native playback uses a reused `<audio crossOrigin='use-credentials'>`** so the session cookie authorizes the gated cross-origin fetch. The public synth endpoint tolerates the credentialed request (study-app CORS allowlist). Keep `crossOrigin`.
- **The shared singleton + `setOnTakeSaved` hook semantics** — one engine shared by Minna AND Self-Talk; the `SELFTALK_SCOPE` take-saved filter; the `visibilitychange`/leave guard. Don't make per-consumer copies.

## Verification

- `cd study-app && bun run test && bun run build` green after **every** commit.
- **Browser pass (this is browser-observable — use the preview workflow, not just tests):** sign in;
  enter speaking mode; record a take; compare **▶ you / ▶ reference / →you / both / loop**; confirm
  both waveforms render + the cursor sweeps; **speed** (0.5/0.75/1×) + **bias** crossfader work; the
  **mic picker** lists inputs; delete a take; and confirm **both Self-Talk and Minna** still drive the
  one engine. `.claude/launch.json` has the `study-app` + `wk-enhanced-api` preview configs.
