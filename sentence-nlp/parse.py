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

from patterns import detect_grammar


# ---- UTF-16 offset helpers (the contract) ----

def utf16_len(s: str) -> int:
    """Length of `s` in UTF-16 code units == a JS string's `.length`."""
    return len(s.encode("utf-16-le")) // 2


def cp_to_utf16(s: str, cp: int) -> int:
    """Convert a codepoint offset into `s` (what spaCy/GiNZA reports) to a UTF-16 code-unit
    offset (what JS String indexing uses). The whole offset contract lives in this one call."""
    return utf16_len(s[:cp])


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
    return f"{model} ginza/{pkg_version('ginza')} splitC+merge"


# ---- merge pass: coalesce a content word + its trailing function morphemes into one tap unit ----
#
# Split mode C is "longest *morpheme*", which still fragments the unit a learner taps as ONE word:
# サ変 する-verbs split (勉強 + する), conjugations break into stem + an aux chain (食べ+させ+られ+た),
# and a て-form auxiliary splits off (読ん+で+いる). So after tokenizing we MERGE each content word
# with the contiguous run of trailing bound morphemes that inflect it. The morphology is unambiguous
# (confirmed empirically against ja_ginza_electra): the trailing pieces are UPOS=AUX (the する of a
# サ変 verb + the whole conjugation chain させ/られ/た/ます/たい/だ/です/ない…), or `fixed` MWE
# components (the auxiliary verb of 〜ている/〜ておく/〜てください), bridged by the 接続助詞 て/で.
# Case/binding particles (は/を/が/に, case-で — UPOS ADP, tag 助詞-格助詞/係助詞) are NOT bound
# morphemes, so they break the unit and stay their own (gap) tokens.
#
# The offset contract survives a merge for free: a group is contiguous by construction, so the merged
# surface is exactly text[anchor.start:last.end] — `js_slice === surface` still holds and the seed-side
# re-assert carries over. Merging only ever makes tokens COARSER; it can't move an offset off a
# code-unit boundary.

# UPOS tags that may ANCHOR a merge — a contentful head whose inflection the trailing morphemes belong
# to. Pure function words (ADP/SCONJ/PART/PUNCT/AUX-alone…) never anchor, so a stray aux after a
# particle stays its own token instead of swallowing the particle.
_ANCHOR_POS = {"VERB", "ADJ", "NOUN", "PROPN", "PRON", "ADV", "NUM", "INTJ"}


def _is_tail_morpheme(prev, cur) -> bool:
    """True when `cur` is a bound trailing morpheme of the word ending at `prev` — so it merges LEFT
    into the same tap unit. Requires CONTIGUITY (no space/gap between them; offsets are codepoint
    indices, consistent on both sides) plus one of:
      • UPOS AUX — the する of a サ変-verb + the inflection chain (させ/られ/た/ます/たい/だ/です/ない…);
      • dep == 'fixed' — a multiword auxiliary component: 〜ている/〜ておく/〜てくる's verb, 〜てください;
      • the 接続助詞 て/で itself — so it bridges a content verb to its auxiliary (読ん+で+いる) and a
        bare て-form (食べて) merges into one unit too."""
    if cur.idx != prev.idx + len(prev.text):
        return False  # a gap (particle/space) sits between them → the unit ends at `prev`
    if cur.pos_ == "AUX":
        return True
    if cur.dep_ == "fixed":
        return True
    if cur.tag_ == "助詞-接続助詞" and cur.text in ("て", "で"):
        return True
    return False


def merge_groups(doc):
    """Group `doc`'s non-space tokens into tap units: each content anchor absorbs its contiguous run
    of trailing bound morphemes (`_is_tail_morpheme`). Returns a list of groups, each a non-empty,
    contiguous list of spaCy tokens. A function word — or any token nothing attaches to — is a
    singleton group (identical to the raw split-C tokenization)."""
    toks = [t for t in doc if not t.is_space]
    groups = []
    i, n = 0, len(toks)
    while i < n:
        group = [toks[i]]
        if toks[i].pos_ in _ANCHOR_POS:
            k = i + 1
            while k < n and _is_tail_morpheme(toks[k - 1], toks[k]):
                group.append(toks[k])
                k += 1
            i = k
        else:
            i += 1
        groups.append(group)
    return groups


def annotate(nlp, text: str):
    """Return (tokens, bunsetsu, grammar, problems) for one sentence. Tokens are the MERGED tap units
    (see merge_groups). `grammar` is the list of curated grammar-point ids detected (patterns.py).
    `problems` is a list of offset-contract violations (empty == clean); callers MUST treat non-empty
    as fatal."""
    doc = nlp(text)
    groups = merge_groups(doc)
    # original doc-token index → its group index, so a merged token's `head` still points at a real
    # (post-merge) token. Spaces are excluded from groups and never head a dependency.
    group_of = {t.i: gi for gi, g in enumerate(groups) for t in g}
    tokens = []
    problems = []
    for gi, g in enumerate(groups):
        anchor, last = g[0], g[-1]
        start = cp_to_utf16(text, anchor.idx)
        end = cp_to_utf16(text, last.idx + len(last.text))
        surface = "".join(t.text for t in g)
        recon = js_slice(text, start, end)
        if recon != surface:
            problems.append(f"group {gi} {surface!r}: js_slice→{recon!r} at [{start},{end}]")
        # Lemma = the anchor's lemma, which IS the dictionary form for verbs/adjectives (食べ→食べる,
        # 高く→高い). GiNZA gives a サ変 noun the bare-noun lemma even when it's the verbal head
        # (pos==VERB), so append する to recover the dictionary form (勉強 → 勉強する).
        lemma = anchor.lemma_
        if anchor.pos_ == "VERB" and "サ変可能" in anchor.tag_:
            lemma = anchor.lemma_ + "する"
        reading = "".join(reading_of(t) for t in g)  # full-unit reading (タベサセラレタ for 食べさせられた)
        tokens.append({
            "i": gi,
            "start": start,
            "end": end,
            "surface": surface,
            "lemma": lemma,
            "pos": anchor.pos_,
            "tag": anchor.tag_,
            "reading": reading,
            "dep": anchor.dep_,
            "head": group_of.get(anchor.head.i, gi),
        })
    bunsetsu = []
    try:
        for span in ginza.bunsetu_spans(doc):
            bunsetsu.append({
                "start": cp_to_utf16(text, span.start_char),
                "end": cp_to_utf16(text, span.end_char),
            })
    except Exception as e:  # pragma: no cover
        print(f"warning: bunsetu_spans failed for {text!r}: {e}", file=sys.stderr)
    grammar = detect_grammar(doc)
    return tokens, bunsetsu, grammar, problems


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
        tokens, bunsetsu, grammar, problems = annotate(nlp, text)
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
        print(f"  grammar:  {grammar}")
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
    # Songs are RUNTIME LLM-annotated (parser='llm', carrying jlpt/gloss the Mine UI needs) and live
    # OUTSIDE the offline GiNZA corpus — re-seeding GiNZA tokens over an LLM song row would drop those
    # fields. Exclude them here so the artifact only covers GiNZA-owned public rows (example / selftalk
    # / realized template combos). The seed resolves by hash, so an excluded row is simply never matched.
    sql = "SELECT id, ext_id, hash, text FROM public_sentence WHERE source <> 'song' ORDER BY id"
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = con.execute(sql).fetchall()
    con.close()

    annotations = []
    total_problems = 0
    whitespace_hits = 0
    for r in rows:
        text = r["text"]
        tokens, bunsetsu, grammar, problems = annotate(nlp, text)
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
            "grammar": grammar,
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
