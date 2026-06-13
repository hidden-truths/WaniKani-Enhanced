#!/usr/bin/env python3
"""Validation battery for patterns.py — one+ positive sentence per grammar id (the slug MUST
fire) plus negative cases (a confusable sentence the slug must NOT fire on). Loads the model once.
Run: .venv/bin/python test_patterns.py  (exits non-zero on any miss).

This is the quality gate for the curated catalog: if a detector is too loose or too strict, a row
here turns red. Sentences are hand-written to isolate one grammar point.
"""
import sys
import spacy
import ginza
from patterns import CATALOG, detect_grammar

POSITIVES = {
    "te-iru":         ["今、本を読んでいる。", "彼は走っている。"],
    "te-oku":         ["旅行の前に切符を買っておく。"],
    "te-shimau":      ["宿題を全部やってしまった。"],
    "te-miru":        ["この服を着てみる。"],
    "te-kudasai":     ["ここに名前を書いてください。"],
    "te-mo-ii":       ["ここに座ってもいいですか。"],
    "te-wa-ikenai":   ["ここで写真を撮ってはいけない。"],
    "passive":        ["先生に褒められた。"],
    "causative":      ["子供に野菜を食べさせる。"],
    "potential":      ["富士山が見える。", "漢字を読むことができる。"],
    "tai":            ["寿司が食べたい。"],
    "volitional":     ["一緒に行こう。", "早く寝よう。"],
    "sugiru":         ["食べ過ぎた。"],
    "hoshii":         ["新しい車がほしい。"],
    "nakya":          ["もう行かなきゃ。", "薬を飲まなければならない。"],
    "hou-ga-ii":      ["早く寝たほうがいい。"],
    "ta-koto-ga-aru": ["日本に行ったことがある。"],
    "koto-ga-dekiru": ["日本語を話すことができる。"],
    "tsumori":        ["来年留学するつもりだ。"],
    "cond-ba":        ["安ければ買います。"],
    "cond-tara":      ["駅に着いたら電話して。"],
    "cond-to":        ["ボタンを押すと、ドアが開く。"],
    "cond-nara":      ["君が行くなら、僕も行く。"],
    "sou":            ["雨が降りそうだ。", "彼は元気だそうだ。"],
    "you-da":         ["誰か来たようだ。"],
    "rashii":         ["明日は雨らしい。"],
    "hazu":           ["彼はもう着いたはずだ。"],
    "kamoshirenai":   ["明日は雨かもしれない。"],
    "to-omou":        ["彼は来ると思う。"],
    "kara-reason":    ["寒いから、窓を閉めた。"],
    "node":           ["忙しいので、行けません。"],
    "noni":           ["勉強したのに、試験に落ちた。"],
    "nagara":         ["音楽を聞きながら勉強する。"],
    "tari":           ["本を読んだり、映画を見たりする。"],
    "shi":            ["安いし、おいしいし、この店が好きだ。"],
    "counter":        ["りんごを三つ買った。"],
    "shika-nai":      ["千円しかない。"],
    "dake":           ["水だけ飲んだ。"],
}

# (sentence, id-that-must-NOT-fire) — confusable cases the catalog must resist.
NEGATIVES = [
    ("駅から歩いて帰った。", "kara-reason"),   # から = source (格助詞), not reason
    ("友達と映画を見た。", "cond-to"),         # と = case (格助詞), not conditional
    ("日本に来てほしい。", "hoshii"),          # てほしい (benefactive) ≠ がほしい
    ("薬を飲まなければならない。", "cond-ba"),  # なければ is obligation (nakya), not cond-ba
    ("子供らしい絵だ。", "rashii"),            # らしい = 接尾辞 'typical', not 助動詞 推量
    ("明日は雨だろう。", "volitional"),        # だろう = presumptive copula, not volitional
    ("そうでしょう。", "volitional"),          # でしょう = presumptive, not volitional
    ("子供のような顔だ。", "you-da"),          # ような = noun-modifier, not ようだ 'seems'
    ("毎朝走るようにしている。", "you-da"),     # ように = 'so that' (に is lemma だ), not ようだ
    ("泳げるようになった。", "you-da"),         # ようになる, not ようだ
]


def main() -> int:
    print("loading ja_ginza_electra …", file=sys.stderr)
    nlp = spacy.load("ja_ginza_electra")
    try:
        ginza.set_split_mode(nlp, "C")
    except Exception:
        pass

    fails = []
    # positives: every listed id must fire on each of its sentences
    for entry in CATALOG:
        gid = entry["id"]
        sents = POSITIVES.get(gid)
        if not sents:
            fails.append(f"NO TEST for id {gid}")
            continue
        for s in sents:
            got = detect_grammar(nlp(s))
            mark = "✓" if gid in got else "✗ MISS"
            if gid not in got:
                fails.append(f"{gid}: did NOT fire on {s!r} (got {got})")
            print(f"  {mark:7} {gid:16} {s}")
    # negatives
    print("\nnegatives (must NOT fire):")
    for s, gid in NEGATIVES:
        got = detect_grammar(nlp(s))
        ok = gid not in got
        print(f"  {'✓' if ok else '✗ LEAK':7} {gid:16} {s}  (got {got})")
        if not ok:
            fails.append(f"NEGATIVE {gid}: wrongly fired on {s!r} (got {got})")

    print()
    if fails:
        print(f"FAILED ({len(fails)}):")
        for f in fails:
            print(f"  - {f}")
        return 1
    print(f"OK: all {len(CATALOG)} detectors fire on their positives and resist the negatives")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
