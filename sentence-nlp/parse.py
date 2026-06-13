#!/usr/bin/env python3
"""Offline GiNZA parser for the unified sentence store (Phase 4).

Reads the public sentence corpus (the `public_sentence` VIEW — public rows only, so this
batch can never touch a private user sentence) and emits one annotation per row, keyed by
the row's content `hash`, into a JSON artifact that `wk-enhanced-api/scripts/seed-annotations.ts`
loads into the `sentence_annotation` table.

THE LOAD-BEARING CONTRACT — token offsets:
    `tokens[].{start,end}` index into `sentence.text` and the study-app slices `text` with them
    *in JavaScript* (UTF-16 code units). spaCy/GiNZA report codepoint offsets. They agree for
    every BMP character (all kana, kana punctuation, 常用漢字) but diverge by +1 per non-BMP
    codepoint (rare CJK-Ext-B kanji). So we emit UTF-16 offsets and self-check every token by
    slicing the UTF-16-LE bytes (an exact emulation of JS String.prototype.slice) — the artifact
    can't be written unless every offset reconstructs its token surface under JS indexing.

Run `parse.py --verify` to see the contract checked on a kanji+kana+punctuation (+ non-BMP)
sample without touching the DB. See README.md.
"""
import argparse
import json
import sqlite3
import sys
from importlib.metadata import version as pkg_version

import spacy
import ginza


# ---- UTF-16 offset helpers (the contract) ----

def utf16_len(s: str) -> int:
    """Length of `s` in UTF-16 code units == a JS string's `.length`."""
    return len(s.encode("utf-16-le")) // 2


def js_slice(s: str, start16: int, end16: int) -> str:
    """Exact emulation of JS `s.slice(start16, end16)` (UTF-16 code-unit indexed)."""
    b = s.encode("utf-16-le")
    return b[start16 * 2 : end16 * 2].decode("utf-16-le")


def reading_of(token) -> str:
    """GiNZA katakana reading, best-effort (empty string when unavailable)."""
    try:
        r = ginza.reading_form(token)
        if r:
            return r
    except Exception:
        pass
    return token.morph.get("Reading")[0] if token.morph.get("Reading") else ""


# ---- the parse ----

def load_nlp():
    nlp = spacy.load("ja_ginza_electra")
    try:
        ginza.set_split_mode(nlp, "C")  # longest units → dictionary-headword-like tokens
    except Exception as e:  # pragma: no cover — surfaced so a version drift is visible
        print(f"warning: could not set split mode C: {e}", file=sys.stderr)
    return nlp


def parser_provenance(nlp) -> str:
    m = nlp.meta
    model = f"{m.get('lang', 'ja')}_{m.get('name', 'ginza_electra')}/{m.get('version', '?')}"
    return f"{model} ginza/{pkg_version('ginza')} splitC"


def annotate(nlp, text: str):
    """Return (tokens, bunsetsu, problems) for one sentence. `problems` is a list of
    offset-contract violations (empty == clean); callers MUST treat non-empty as fatal."""
    doc = nlp(text)
    tokens = []
    problems = []
    for t in doc:
        if t.is_space:
            continue  # whitespace is never a tap target; keep `i` honest for head refs
        cp_start = t.idx
        cp_end = t.idx + len(t.text)
        start = utf16_len(text[:cp_start])
        end = utf16_len(text[:cp_end])
        recon = js_slice(text, start, end)
        if recon != t.text:
            problems.append(f"token {t.i} {t.text!r}: js_slice→{recon!r} at [{start},{end}]")
        tokens.append({
            "i": t.i,
            "start": start,
            "end": end,
            "surface": t.text,
            "lemma": t.lemma_,
            "pos": t.pos_,
            "tag": t.tag_,
            "reading": reading_of(t),
            "dep": t.dep_,
            "head": t.head.i,
        })
    bunsetsu = []
    try:
        for span in ginza.bunsetu_spans(doc):
            bunsetsu.append({
                "start": utf16_len(text[: span.start_char]),
                "end": utf16_len(text[: span.end_char]),
            })
    except Exception as e:  # pragma: no cover
        print(f"warning: bunsetu_spans failed for {text!r}: {e}", file=sys.stderr)
    return tokens, bunsetsu, problems


# ---- --verify: prove the contract on a hand-picked sample, no DB ----

VERIFY_SAMPLES = [
    "母は毎日料理します。",                       # kanji + kana + 。
    "まだ眠い、二度寝しそう。",                   # 、 mid-sentence
    "本当に？じゃあ、行こう！",                   # ？ ！ fullwidth punctuation
    "コーヒーを 飲む",                            # an ASCII space (whitespace-token path)
    "𠮟られた。",                                 # NON-BMP kanji U+20B9F (surrogate pair in JS)
]


def cmd_verify(nlp) -> int:
    print(f"parser: {parser_provenance(nlp)}\n")
    failed = 0
    for text in VERIFY_SAMPLES:
        tokens, bunsetsu, problems = annotate(nlp, text)
        js_len = utf16_len(text)
        print(f"text = {text!r}   (JS .length = {js_len}, codepoints = {len(text)})")
        print(f"  {'i':>2} {'start':>5} {'end':>3}  {'js_slice':<10} {'surface':<10} "
              f"{'lemma':<8} {'pos':<6} {'reading':<8} ok")
        for tok in tokens:
            sl = js_slice(text, tok["start"], tok["end"])
            ok = "✓" if sl == tok["surface"] else "✗ MISMATCH"
            print(f"  {tok['i']:>2} {tok['start']:>5} {tok['end']:>3}  "
                  f"{sl!r:<10} {tok['surface']!r:<10} {tok['lemma']:<8} {tok['pos']:<6} "
                  f"{tok['reading']:<8} {ok}")
        bun = ", ".join(f"[{b['start']},{b['end']})={js_slice(text, b['start'], b['end'])!r}"
                        for b in bunsetsu)
        print(f"  bunsetsu: {bun}")
        if problems:
            failed += 1
            for p in problems:
                print(f"  OFFSET PROBLEM: {p}")
        print()
    if failed:
        print(f"FAILED: {failed} sample(s) had offset problems")
        return 1
    print("OK: every token reconstructs its surface under JS UTF-16 slicing "
          "(BMP and non-BMP)")
    return 0


# ---- default: parse the whole public corpus → artifact ----

def cmd_parse(nlp, db_path: str, out_path: str, limit: int | None) -> int:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    sql = "SELECT id, ext_id, hash, text FROM public_sentence ORDER BY id"
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = con.execute(sql).fetchall()
    con.close()

    annotations = []
    total_problems = 0
    whitespace_hits = 0
    for r in rows:
        text = r["text"]
        tokens, bunsetsu, problems = annotate(nlp, text)
        if problems:
            total_problems += len(problems)
            print(f"OFFSET PROBLEM in id={r['id']} hash={r['hash'][:12]} text={text!r}:",
                  file=sys.stderr)
            for p in problems:
                print(f"  {p}", file=sys.stderr)
        if " " in text or "　" in text:
            whitespace_hits += 1
        annotations.append({
            "hash": r["hash"],
            "ext_id": r["ext_id"],
            "text": text,  # echoed so the seed loader can guard against a stale artifact
            "tokens": tokens,
            "bunsetsu": bunsetsu,
        })

    if total_problems:
        print(f"\nABORT: {total_problems} offset problem(s) across the corpus — artifact NOT "
              f"written (the contract must hold for every token).", file=sys.stderr)
        return 1

    # One annotation per line (compact internals): valid JSON, but a curator content change
    # shows up as a one-line diff instead of churning the whole file.
    parser = parser_provenance(nlp)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("{\n")
        f.write(f'"parser": {json.dumps(parser, ensure_ascii=False)},\n')
        f.write('"annotations": [\n')
        for i, a in enumerate(annotations):
            line = json.dumps(a, ensure_ascii=False, separators=(",", ":"))
            f.write(line + ("," if i < len(annotations) - 1 else "") + "\n")
        f.write("]}\n")
    tok_count = sum(len(a["tokens"]) for a in annotations)
    print(f"wrote {len(annotations)} annotations ({tok_count} tokens) → {out_path}")
    print(f"parser: {parser}")
    if whitespace_hits:
        print(f"note: {whitespace_hits} sentence(s) contain whitespace (skipped as tap targets)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Offline GiNZA parser for the sentence store")
    ap.add_argument("--db", default="../wk-enhanced-api/dev-data/wk-vocab.sqlite",
                    help="sqlite file to read public_sentence from")
    ap.add_argument("--out", default="../wk-enhanced-api/data/annotations.json",
                    help="artifact path the Bun seed step reads")
    ap.add_argument("--verify", action="store_true",
                    help="prove the offset contract on a built-in sample, no DB/artifact")
    ap.add_argument("--limit", type=int, default=None, help="parse only the first N rows")
    args = ap.parse_args()

    nlp = load_nlp()
    if args.verify:
        return cmd_verify(nlp)
    return cmd_parse(nlp, args.db, args.out, args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
