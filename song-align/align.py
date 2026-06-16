#!/usr/bin/env python3
"""
song-align — OFFLINE forced-alignment of curated song lyrics to their YouTube audio, producing the
per-line timing sidecars the 歌 / Songs tab consumes (synced highlight, per-line replay, and — once
built — dictation-by-slice + by-ear shadowing).

This is the timing analog of ../sentence-nlp/ (the offline GiNZA batch): it runs LOCALLY ONLY — there
is no Python on the prod droplet — and emits a small committed JSON artifact that the server seed
ingests. It never re-hosts or stores audio: the master is downloaded to a temp dir, aligned, and
discarded on exit; only the timestamps (line ordinals + milliseconds, NO lyric text) are written.

Pipeline, per song:
  1. read the curated lyrics from wk-enhanced-api/data/songs/<slug>.json   (youtubeId + ordered lines)
  2. yt-dlp     → download the video's audio into a temp dir
  3. demucs     → (default; --no-vocals to skip) isolate the vocal stem so the backing track doesn't
                  fight the aligner
  4. stable-ts  → force-align OUR known lyric lines to the audio. original_split=True keeps one segment
                  per lyric line, so segment i == line ordinal i (we KNOW the text, so this is true
                  forced alignment, not transcription).
  5. write wk-enhanced-api/data/song-timing/<slug>.json:
        { extId, videoId, model, alignedAt, lines:[ {ordinal, startMs, endMs}, … ] }

Then, in wk-enhanced-api/:   bun scripts/seed-songs.ts     (merges the sidecar → each line's clip_start_ms)

Usage:
  python3 align.py --song dry-flower-yuuri              # one song
  python3 align.py --all                                # every data/songs/*.json with a youtubeId
  python3 align.py --song saikai-vaundy --no-vocals     # skip demucs (faster; weaker on dense mixes)
  python3 align.py --song mouichido-taniyuuki --model medium   # smaller/faster Whisper model
  python3 align.py --all --cookies-from-browser safari # pass browser cookies past YouTube's bot check

If yt-dlp errors "Sign in to confirm you're not a bot", YouTube is gating the download — re-run with
--cookies-from-browser <safari|chrome|firefox|edge|brave> (a browser logged into YouTube) or
--cookies <cookies.txt>. Keep yt-dlp current too (`pip install -U yt-dlp`) — bot countermeasures shift.

Install + the copyright posture + accuracy notes: see README.md.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SONGS_DIR = REPO / "wk-enhanced-api" / "data" / "songs"
TIMING_DIR = REPO / "wk-enhanced-api" / "data" / "song-timing"

_RT = re.compile(r"<rt>.*?</rt>", re.S)
_RUBY = re.compile(r"</?ruby>")


def plain_text(jp: str) -> str:
    """Strip <ruby> furigana to the base line text — matches study-app core/text.js plainText."""
    return _RUBY.sub("", _RT.sub("", jp))


def load_song(slug: str):
    path = SONGS_DIR / f"{slug}.json"
    if not path.exists():
        sys.exit(f"no song file: {path}")
    song = json.loads(path.read_text(encoding="utf-8"))
    lines = [plain_text(ln["jp"]) for ln in song.get("lines", [])]
    return song, lines


def download_audio(video_id: str, workdir: Path, cookies_browser=None, cookies_file=None) -> Path:
    """yt-dlp → a .wav in workdir (transient — discarded with the temp dir).

    YouTube now gates many videos behind a bot check ("Sign in to confirm you're not a bot"); pass
    cookies from a logged-in browser (--cookies-from-browser) or a cookies.txt (--cookies) to clear it.
    """
    cmd = ["yt-dlp", "-x", "--audio-format", "wav", "--audio-quality", "0",
           "-o", str(workdir / "audio.%(ext)s")]
    if cookies_browser:
        cmd += ["--cookies-from-browser", cookies_browser]
    elif cookies_file:
        cmd += ["--cookies", cookies_file]
    cmd.append(f"https://www.youtube.com/watch?v={video_id}")
    subprocess.run(cmd, check=True)
    got = sorted(workdir.glob("audio.*"))
    if not got:
        sys.exit("yt-dlp produced no audio file")
    return got[0]


def isolate_vocals(audio: Path, workdir: Path) -> Path:
    """demucs --two-stems=vocals → the vocal stem (falls back to the full mix if it fails)."""
    subprocess.run(["demucs", "--two-stems=vocals", "-o", str(workdir), str(audio)], check=True)
    stems = sorted(workdir.glob("*/*/vocals.wav"))
    if not stems:
        print("  ! no demucs vocal stem produced; using the full mix", file=sys.stderr)
        return audio
    return stems[0]


def align(audio: Path, lines: list, model_name: str, device):
    import stable_whisper  # imported lazily so --help works without the heavy deps installed

    model = stable_whisper.load_model(model_name, device=device) if device else stable_whisper.load_model(model_name)
    # original_split=True → preserve our line breaks as segment boundaries (segment i == lyric line i).
    result = model.align(str(audio), "\n".join(lines), language="ja", original_split=True)
    segs = list(result.segments)
    if len(segs) != len(lines):
        print(f"  ! aligner returned {len(segs)} segments for {len(lines)} lines — mapping by index",
              file=sys.stderr)
    out = []
    for i, seg in enumerate(segs[: len(lines)]):
        out.append({"ordinal": i, "startMs": round(seg.start * 1000), "endMs": round(seg.end * 1000)})
    return out


def run(slug: str, args) -> None:
    song, lines = load_song(slug)
    vid = song.get("youtubeId")
    if not vid:
        print(f"skip {slug}: no youtubeId")
        return
    if not lines:
        print(f"skip {slug}: no lines")
        return
    print(f"aligning {slug} — {len(lines)} lines, video {vid}{' (vocals)' if args.vocals else ''} …")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        audio = download_audio(vid, work, args.cookies_from_browser, args.cookies)
        if args.vocals:
            audio = isolate_vocals(audio, work)
        timed = align(audio, lines, args.model, args.device)
    TIMING_DIR.mkdir(parents=True, exist_ok=True)
    sidecar = {
        "extId": song.get("extId"),
        "videoId": vid,
        "model": args.model,
        "vocals": args.vocals,
        "alignedAt": datetime.now(timezone.utc).isoformat(),
        "lines": timed,
    }
    out = TIMING_DIR / f"{slug}.json"
    out.write_text(json.dumps(sidecar, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  → {out.relative_to(REPO)} ({len(timed)} lines). Spot-check against the video, then re-seed.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Forced-align curated song lyrics to their YouTube audio.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--song", help="slug, e.g. dry-flower-yuuri")
    g.add_argument("--all", action="store_true", help="every data/songs/*.json that has a youtubeId")
    ap.add_argument("--model", default="large-v3", help="Whisper model (default: large-v3)")
    ap.add_argument("--device", default=None, help="cpu / cuda / mps (default: stable-ts auto-detect)")
    ap.add_argument("--vocals", dest="vocals", action="store_true", default=True,
                    help="isolate vocals with demucs first (default on — best quality)")
    ap.add_argument("--no-vocals", dest="vocals", action="store_false",
                    help="skip demucs (faster, no demucs install; weaker on dense mixes)")
    ap.add_argument("--cookies-from-browser", dest="cookies_from_browser", default=None,
                    metavar="BROWSER",
                    help="read YouTube cookies from a logged-in browser (safari/chrome/firefox/edge/brave) "
                         "— needed when yt-dlp hits 'Sign in to confirm you're not a bot'")
    ap.add_argument("--cookies", dest="cookies", default=None, metavar="FILE",
                    help="path to a Netscape cookies.txt (alternative to --cookies-from-browser)")
    args = ap.parse_args()

    slugs = sorted(p.stem for p in SONGS_DIR.glob("*.json")) if args.all else [args.song]
    for slug in slugs:
        try:
            run(slug, args)
        except subprocess.CalledProcessError as e:
            print(f"  ! {slug}: external command failed ({e})", file=sys.stderr)
        except Exception as e:  # keep --all going past one bad song
            print(f"  ! {slug}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
