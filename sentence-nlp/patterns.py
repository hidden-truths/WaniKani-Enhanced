#!/usr/bin/env python3
"""Curated N5/N4 grammar-point catalog for the sentence store (Phase-4 commit 2).

Each entry = {id, label, jlpt, detect(doc)->bool}. `detect` runs over the GiNZA Doc (lemma /
pos / UniDic tag / inflection), so it has more to work with than the serialized tokens. The ids
are the searchable vocabulary written to sentence_tag(kind='grammar'); they REUSE the existing
study-app `SELFTALK_GRAMMAR` ids (te-iru / te-oku / tai / volitional / sou / nakya) so
GiNZA-detected tags on example sentences unify with hand-authored Self-Talk tags in one filter.

Detection is deliberately conservative: a curated pattern list matched off the parse, NOT raw POS
n-grams. Tuned + validated against the real corpus in test_patterns.py. Scope is N5/N4 (the
maintainer's priority); Tier-2 points (keigo, benefactives, te-aru/iku/kuru, toki/mae-ni, …) are
deliberately omitted for now.

Ambiguities handled per the design decisions:
  • passive vs potential: れる/られる are ONE morpheme in GiNZA — can't be split. `passive` tags
    れる/られる; `potential` tags only the unambiguous periphrastic forms (ことができる / 見える /
    聞こえる / できる). A ことができる sentence gets both `potential` and `koto-ga-dekiru` (correct:
    it IS a potential expressed via ことができる).
  • particle senses (から reason vs source, と conditional vs case, が contrastive vs subject) split
    on the UniDic tag (接続助詞 vs 格助詞) — confirmed reliable on the corpus.
  • そう is kept UNIFIED (matches the existing `sou` id); 様態/伝聞 are not split.
"""
# `ginza` is imported LAZILY inside _inflection (its only user) so this module can be imported for
# its CATALOG metadata — e.g. the `--dump` catalog export at the bottom — WITHOUT the heavy
# spaCy/GiNZA venv. Real parses still get ginza on first detector use.


# ---- token helpers over the Doc ----

def _inflection(tok) -> str:
    """GiNZA conjugation string, e.g. '五段-カ行,意志推量形' (empty when unavailable)."""
    try:
        import ginza
        return ginza.inflection(tok) or ""
    except Exception:
        return ""


def _is(tok, *, lemma=None, orth=None, tag=None, pos=None) -> bool:
    """Null-safe single-token predicate: True iff `tok` exists and matches EVERY supplied facet.
    `lemma`/`orth` take a string OR a set (membership test); `tag` is a substring of the UniDic
    tag (e.g. '接続助詞'); `pos` is an exact UPOS match. Returns False for a None token, so it
    doubles as the neighbour check — e.g. `_is(_token_at(toks, i + 1), lemma="も")`."""
    if tok is None:
        return False

    def _in(val, field):
        return field in (val if isinstance(val, (set, list, tuple, frozenset)) else {val})

    if lemma is not None and not _in(lemma, tok.lemma_):
        return False
    if orth is not None and not _in(orth, tok.orth_):
        return False
    if tag is not None and tag not in tok.tag_:
        return False
    if pos is not None and tok.pos_ != pos:
        return False
    return True


def _has_lemma(doc, lemmas, pos=None, tag_sub=None) -> bool:
    return any(_is(t, lemma=lemmas, pos=pos, tag=tag_sub) for t in doc)


def _is_te(tok) -> bool:
    """The て-form connective — て OR its voiced form で (読ん+で+いる), both 接続助詞.
    Distinct from で〔格助詞〕(at/in/by) and で〔ので〕(準体助詞+で)."""
    return _is(tok, lemma={"て", "で"}, tag="接続助詞")


def _te_then(doc, lemmas) -> bool:
    """A て/で〔接続助詞〕 immediately followed by one of `lemmas` (the て-compound shape)."""
    toks = list(doc)
    for i, t in enumerate(toks):
        if _is_te(t) and i + 1 < len(toks) and toks[i + 1].lemma_ in lemmas:
            return True
    return False


def _seq(doc, *groups) -> bool:
    """Consecutive tokens whose lemma ∈ each group (each group a set/str)."""
    toks = list(doc)
    norm = [g if isinstance(g, (set, list, tuple)) else {g} for g in groups]
    for i in range(len(toks) - len(norm) + 1):
        if all(toks[i + k].lemma_ in norm[k] for k in range(len(norm))):
            return True
    return False


def _token_at(toks, i):
    return toks[i] if 0 <= i < len(toks) else None


# ---- individual detectors ----
# (each takes the Doc and returns bool; kept small + named so test_patterns.py can pin them)

def d_te_iru(doc):       return _te_then(doc, {"いる"})
def d_te_oku(doc):       return _te_then(doc, {"おく"})
def d_te_shimau(doc):    return _te_then(doc, {"しまう", "仕舞う"})
def d_te_miru(doc):      return _te_then(doc, {"みる", "見る"})
def d_te_kudasai(doc):   return _te_then(doc, {"くださる", "下さる"})


def d_te_mo_ii(doc):
    toks = list(doc)
    for i, t in enumerate(toks):
        if _is_te(t):
            if _is(_token_at(toks, i + 1), lemma="も") and _is(_token_at(toks, i + 2), lemma={"いい", "良い", "よい"}):
                return True
    return False


def d_te_wa_ikenai(doc):
    toks = list(doc)
    for i, t in enumerate(toks):
        if _is_te(t):
            if _is(_token_at(toks, i + 1), lemma="は") and _is(_token_at(toks, i + 2), lemma={"いける", "行ける", "なる", "成る", "だめ", "駄目", "ならない"}):
                return True
    return False


def d_passive(doc):      return _has_lemma(doc, {"れる", "られる"}, pos="AUX")
def d_causative(doc):    return _has_lemma(doc, {"せる", "させる"}, pos="AUX")


def d_potential(doc):
    # Periphrastic / lexical potential only (れる・られる go to `passive` — can't be split).
    return _has_lemma(doc, {"見える", "聞こえる"}) or _has_lemma(doc, {"できる", "出来る"})


def d_tai(doc):          return _has_lemma(doc, {"たい"}, pos="AUX")


def d_sugiru(doc):
    # 〜すぎる fuses into a compound verb under split mode C (食べ過ぎ → lemma 食べ過ぎる),
    # tagged 非自立可能 (the bound usage) — which excludes the standalone 過ぎる "to pass".
    return any((t.lemma_.endswith("過ぎる") or t.lemma_.endswith("すぎる")) and "非自立可能" in t.tag_ for t in doc)


def d_volitional(doc):
    # Volitional surfaces three ways: the よう AUX (食べよう / しよう), the う AUX (polite 〜ましょう),
    # or a single godan verb fused into 意志推量形 (行こう — the morph path, why we run in Python).
    # EXCLUDE the presumptive copula だろう/でしょう, which share the う AUX / 意志推量形 form but are
    # NOT volitional (lemma だ/です).
    toks = list(doc)
    for i, t in enumerate(toks):
        if _is(t, pos="AUX", lemma="よう"):
            return True
        if _is(t, pos="AUX", lemma="う"):
            if not _is(_token_at(toks, i - 1), lemma={"だ", "です"}):
                return True
        if "意志推量形" in _inflection(t) and t.lemma_ not in {"だ", "です"}:
            return True
    return False


def d_hoshii(doc):
    # 〜がほしい (want a thing). Exclude 〜てほしい (benefactive, Tier-2): require the prev token ≠ て.
    toks = list(doc)
    for i, t in enumerate(toks):
        if _is(t, lemma={"欲しい", "ほしい"}):
            if not _is(_token_at(toks, i - 1), lemma="て"):
                return True
    return False


def d_nakya(doc):
    # Obligation family: なきゃ / なくちゃ / なければ(ならない・いけない) / ないと.
    for t in doc:
        if _is(t, orth={"なきゃ", "なくちゃ"}):
            return True
    if _seq(doc, {"ない"}, {"ば"}):            # なけれ+ば
        return True
    if _seq(doc, {"ない"}, {"と"}):            # ないと
        return True
    return False


def d_hou_ga_ii(doc):    return _seq(doc, {"方", "ほう"}, {"が"}, {"いい", "良い", "よい"})
def d_ta_koto_ga_aru(doc): return _seq(doc, {"た"}, {"こと", "事"}, {"が"}, {"ある"})
def d_koto_ga_dekiru(doc): return _seq(doc, {"こと", "事"}, {"が"}, {"できる", "出来る"})
def d_tsumori(doc):      return _has_lemma(doc, {"つもり", "積もり"})


def d_cond_ba(doc):
    # ば〔接続助詞〕, but NOT the なければ obligation (that's `nakya`).
    toks = list(doc)
    for i, t in enumerate(toks):
        if _is(t, lemma="ば", tag="接続助詞"):
            if not _is(_token_at(toks, i - 1), lemma="ない"):
                return True
    return False


def d_cond_tara(doc):
    # たら/だら tokenizes as a single 助動詞 token (surface たら, lemma た).
    return any(_is(t, orth={"たら", "だら"}, lemma="た") for t in doc)


def d_cond_to(doc):      return _has_lemma(doc, {"と"}, tag_sub="接続助詞")


def d_cond_nara(doc):
    # なら is the copula だ in its conditional form (surface なら, lemma だ).
    return any(_is(t, orth="なら", lemma="だ") for t in doc)


def d_sou(doc):
    # Unified 〜そう (様態 + 伝聞). The auxiliary そう (NOT そう adverb 'so').
    return any(t.lemma_ == "そう" and (t.pos_ == "AUX" or "助動詞" in t.tag_ or "形状詞" in t.tag_) for t in doc)


def d_you_da(doc):
    # ようだ/ようです/ようだった 'seems' — require よう + the copula だ as a PREDICATE. CRUCIAL: the
    # に in ように and the な in ような are BOTH lemma だ (連用形 / 連体形), so matching lemma だ alone
    # mis-fires on ようにする / ようになる / ような (different grammar). Exclude orth な + に → only the
    # terminal/past だ・です・だった predicate remains.
    toks = list(doc)
    for i, t in enumerate(toks):
        if _is(t, lemma="よう", tag="形状詞"):
            nxt = _token_at(toks, i + 1)
            if _is(nxt, lemma={"だ", "です"}) and nxt.orth_ not in {"な", "に"}:
                return True
    return False


def d_rashii(doc):       return _has_lemma(doc, {"らしい"}, tag_sub="助動詞")
def d_hazu(doc):         return _seq(doc, {"はず", "筈"}, {"だ", "です"})
def d_kamoshirenai(doc): return _seq(doc, {"か"}, {"も"}, {"知れる", "しれる"})
def d_to_omou(doc):      return _seq(doc, {"と"}, {"思う"})

def d_nagara(doc):       return _has_lemma(doc, {"ながら"}, tag_sub="接続助詞")
def d_shi(doc):          return _has_lemma(doc, {"し"}, tag_sub="接続助詞")
def d_kara_reason(doc):  return _has_lemma(doc, {"から"}, tag_sub="接続助詞")
def d_dake(doc):         return _has_lemma(doc, {"だけ"}, tag_sub="副助詞")


def _no_juntai_then(doc, nxt_orth) -> bool:
    """の〔準体助詞〕immediately followed by `nxt_orth` — the shape of both ので and のに."""
    toks = list(doc)
    for i, t in enumerate(toks):
        if _is(t, orth="の", tag="準体助詞"):
            if _is(_token_at(toks, i + 1), orth=nxt_orth):
                return True
    return False


def d_node(doc):  return _has_lemma(doc, {"ので"}) or _no_juntai_then(doc, "で")
# のに spans both contrastive ("although") and the rarer purpose ("to do X") — same tokens; we
# tag both as `noni` (contrastive dominates the N4 corpus).
def d_noni(doc):  return _has_lemma(doc, {"のに"}) or _no_juntai_then(doc, "に")
def d_tari(doc):  return _has_lemma(doc, {"たり", "だり"})  # たり/だり〔副助詞〕(voiced after ん-stems)


def d_counter(doc):
    toks = list(doc)
    for i, t in enumerate(toks):
        is_num = t.pos_ == "NUM" or "数詞" in t.tag_
        if is_num and _is(_token_at(toks, i + 1), tag="助数詞"):
            return True
    return False


def d_shika_nai(doc):
    # しか … ない (the negative is later in the clause).
    toks = list(doc)
    for i, t in enumerate(toks):
        if _is(t, lemma="しか"):
            if any(_is(u, lemma="ない") for u in toks[i + 1:]):
                return True
    return False


# ---- the catalog (order = display order; ids are the sentence_tag values) ----

CATALOG = [
    # て-form compounds
    {"id": "te-iru",        "label": "〜ている",            "jlpt": "N5", "fn": d_te_iru},
    {"id": "te-oku",        "label": "〜ておく",            "jlpt": "N4", "fn": d_te_oku},
    {"id": "te-shimau",     "label": "〜てしまう",          "jlpt": "N4", "fn": d_te_shimau},
    {"id": "te-miru",       "label": "〜てみる",            "jlpt": "N4", "fn": d_te_miru},
    {"id": "te-kudasai",    "label": "〜てください",        "jlpt": "N5", "fn": d_te_kudasai},
    {"id": "te-mo-ii",      "label": "〜てもいい",          "jlpt": "N5", "fn": d_te_mo_ii},
    {"id": "te-wa-ikenai",  "label": "〜てはいけない",      "jlpt": "N5", "fn": d_te_wa_ikenai},
    # voice / auxiliary
    {"id": "passive",       "label": "〜れる・られる",      "jlpt": "N4", "fn": d_passive},
    {"id": "causative",     "label": "〜せる・させる",      "jlpt": "N4", "fn": d_causative},
    {"id": "potential",     "label": "可能 (できる・見える)", "jlpt": "N4", "fn": d_potential},
    {"id": "tai",           "label": "〜たい",              "jlpt": "N5", "fn": d_tai},
    {"id": "volitional",    "label": "volitional 〜よう",   "jlpt": "N4", "fn": d_volitional},
    {"id": "sugiru",        "label": "〜すぎる",            "jlpt": "N5", "fn": d_sugiru},
    # desire / obligation / ability / experience
    {"id": "hoshii",        "label": "〜がほしい",          "jlpt": "N4", "fn": d_hoshii},
    {"id": "nakya",         "label": "〜なきゃ / なければ",  "jlpt": "N4", "fn": d_nakya},
    {"id": "hou-ga-ii",     "label": "〜ほうがいい",        "jlpt": "N5", "fn": d_hou_ga_ii},
    {"id": "ta-koto-ga-aru","label": "〜たことがある",      "jlpt": "N5", "fn": d_ta_koto_ga_aru},
    {"id": "koto-ga-dekiru","label": "〜ことができる",      "jlpt": "N4", "fn": d_koto_ga_dekiru},
    {"id": "tsumori",       "label": "〜つもり",            "jlpt": "N5", "fn": d_tsumori},
    # conditionals
    {"id": "cond-ba",       "label": "〜ば",                "jlpt": "N4", "fn": d_cond_ba},
    {"id": "cond-tara",     "label": "〜たら",              "jlpt": "N4", "fn": d_cond_tara},
    {"id": "cond-to",       "label": "〜と (conditional)",  "jlpt": "N4", "fn": d_cond_to},
    {"id": "cond-nara",     "label": "〜なら",              "jlpt": "N4", "fn": d_cond_nara},
    # evidential / modal
    {"id": "sou",           "label": "〜そう",              "jlpt": "N4", "fn": d_sou},
    {"id": "you-da",        "label": "〜ようだ",            "jlpt": "N4", "fn": d_you_da},
    {"id": "rashii",        "label": "〜らしい",            "jlpt": "N4", "fn": d_rashii},
    {"id": "hazu",          "label": "〜はずだ",            "jlpt": "N4", "fn": d_hazu},
    {"id": "kamoshirenai",  "label": "〜かもしれない",      "jlpt": "N4", "fn": d_kamoshirenai},
    {"id": "to-omou",       "label": "〜と思う",            "jlpt": "N4", "fn": d_to_omou},
    # connectives / scope
    {"id": "kara-reason",   "label": "〜から (reason)",     "jlpt": "N5", "fn": d_kara_reason},
    {"id": "node",          "label": "〜ので",              "jlpt": "N5", "fn": d_node},
    {"id": "noni",          "label": "〜のに",              "jlpt": "N4", "fn": d_noni},
    {"id": "nagara",        "label": "〜ながら",            "jlpt": "N4", "fn": d_nagara},
    {"id": "tari",          "label": "〜たり",              "jlpt": "N5", "fn": d_tari},
    {"id": "shi",           "label": "〜し",                "jlpt": "N4", "fn": d_shi},
    {"id": "counter",       "label": "数 + 助数詞",         "jlpt": "N5", "fn": d_counter},
    {"id": "shika-nai",     "label": "〜しか〜ない",        "jlpt": "N4", "fn": d_shika_nai},
    {"id": "dake",          "label": "〜だけ",              "jlpt": "N5", "fn": d_dake},
]

# Sanity: ids are unique.
assert len({e["id"] for e in CATALOG}) == len(CATALOG), "duplicate grammar id in CATALOG"


def detect_grammar(doc) -> list[str]:
    """All grammar ids that match this Doc, in catalog (display) order."""
    return [e["id"] for e in CATALOG if e["fn"](doc)]


# ---- catalog export (the study-app's grammar registry) ----
# The id→label→jlpt metadata (NO detectors) is the single source of truth for the study-app's
# grammar-filter labels — committed as study-app/src/data/grammar.json so the client list can't drift
# from the detectors here. Regenerate after any CATALOG change: `python3 patterns.py` (no venv needed).

def dump_catalog(path) -> list[dict]:
    import json
    import os
    data = [{"id": e["id"], "label": e["label"], "jlpt": e["jlpt"]} for e in CATALOG]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return data


if __name__ == "__main__":
    import sys
    from pathlib import Path
    default = Path(__file__).resolve().parent.parent / "study-app" / "src" / "data" / "grammar.json"
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    written = dump_catalog(str(out))
    print(f"wrote {len(written)} grammar points → {out}")
