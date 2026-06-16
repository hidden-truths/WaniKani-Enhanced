# song-align — offline line-timing for the 歌 / Songs tab

Forced-aligns the **curated song lyrics** (`wk-enhanced-api/data/songs/<slug>.json`) to each song's
YouTube audio and writes a per-line **timing sidecar** (`wk-enhanced-api/data/song-timing/<slug>.json`)
that the server seed merges into each line's `clip_start_ms`. That timing is what unlocks the synced
highlight, per-line replay, dictation-by-slice, and by-ear shadowing — all of which are inert until a
song is timed.

This is the **timing analog of [`../sentence-nlp/`](../sentence-nlp/)**: it runs **locally only** (there
is no Python on the prod droplet), and it produces a small committed JSON artifact, not a service.

## Copyright / data posture

- The video's audio is downloaded to a **temp dir, aligned, and discarded** on exit. We never re-host
  or store the master — the embedded YouTube player remains the only audio at runtime.
- The committed artifact is **timing only** — line ordinals + millisecond offsets. **No lyric text** is
  in the sidecar (the lyrics live in `data/songs/`, supplied by the maintainer).
- `yt-dlp` audio extraction is against YouTube's ToS; this is a local, personal-study derivation step,
  done on the maintainer's machine, not on the deployed service.

## Install

```bash
brew install ffmpeg                     # system dep (also used by yt-dlp + demucs)
cd song-align
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt         # torch is large; Apple Silicon uses the MPS backend
```

## Use

```bash
python3 align.py --song dry-flower-yuuri          # one song
python3 align.py --all                            # every data/songs/*.json with a youtubeId
python3 align.py --song saikai-vaundy --no-vocals # skip demucs (faster; weaker on dense mixes)
python3 align.py --song mouichido-taniyuuki --model medium   # smaller/faster model
```

Then, in `wk-enhanced-api/`:

```bash
bun scripts/seed-songs.ts     # merges every data/song-timing/*.json → clip_start_ms (logs "N timed")
```

To time the **production** library, re-run the seed against the prod DB (point `DATABASE_FILE` at it /
run on the droplet), same pattern as the rest of the seed step. The sidecars are git-tracked, so the
prod re-seed picks them up.

## Workflow

1. `align.py` → writes the sidecar(s).
2. **Spot-check** against the video — open the song in the app (or read the sidecar) and confirm a few
   lines land on the right beats. Alignment is model-generated; sung vocals, long held notes, and
   English lines are where it drifts.
3. If a song is off, re-run it (`--model large-v3`, toggle `--vocals`) or hand-nudge the `startMs` in
   the sidecar.
4. Re-seed. Commit the sidecars.

## How it works

`yt-dlp` (audio) → `demucs --two-stems=vocals` (isolate the voice so the backing track doesn't fight
the aligner; `--no-vocals` skips it) → **stable-ts** (`model.align(audio, lyrics, language='ja',
original_split=True)`): because we already KNOW the lyric text, this is true **forced alignment** (not
transcription), and `original_split=True` keeps one segment per lyric line so segment *i* == line
ordinal *i*. We emit each segment's start (and end, advisory — the app infers a line's end from the
next line's start).

## Accuracy notes & alternatives

- **Vocal isolation matters.** `--vocals` (demucs, default on) markedly improves alignment on dense
  mixes; `--no-vocals` is faster and needs no demucs install but is rougher.
- **English / mixed lines** (BANDAGE, CLASSIC, Blinded Eyes, FIESTA hooks) align less reliably under a
  `ja` model — eyeball those.
- **`endMs` is advisory.** The runtime only needs `startMs`; end is inferred from the next line.
- **Other aligners** if stable-ts misbehaves on a track: [`aeneas`](https://github.com/readbeyond/aeneas)
  (CPU, espeak TTS + DTW — purpose-built for text→audio fragment sync, but a finicky C install) or
  [WhisperX](https://github.com/m-bain/whisperX) / Montreal Forced Aligner (heavier). The sidecar
  contract (`{lines:[{ordinal,startMs,endMs}]}`) is aligner-agnostic — swap the `align()` body and keep
  the output shape and the seed ingests it unchanged.
