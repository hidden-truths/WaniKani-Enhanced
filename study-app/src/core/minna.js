// みんなの日本語 pure helpers: detect when a Minna word already exists as a built-in
// (dedup target), merge the provenance overlay onto the matching built-in (no duplicate
// card), and the content signature that drives the "Update N words" button. Read the
// shared state (BUILTIN_RANK_BY_JP, minnaStore); the activation UI glue lives in features/minna.js.
import { state } from '../state.js';

// A Minna word maps onto a built-in verb iff its dictionary form is a built-in headword.
export function minnaBuiltinRank(item) {
  return state.BUILTIN_RANK_BY_JP[item.dict || item.kanji || item.kana] || null;
}

// Apply the Minna/iTalki provenance overlays onto the matching built-ins. Returns COPIES
// (not mutations of the shared VERBS objects) so removing an overlay reverts cleanly; a
// non-overlapped built-in is passed through by reference.
export function applyMinnaOverlays(builtins) {
  const ov = (state.minnaStore && state.minnaStore.overlays) || {};
  if (!Object.keys(ov).length) return builtins;
  return builtins.map(v => {
    const o = ov[v.rank]; if (!o) return v;
    const tags = [...(v.tags || [])]; (o.tags || []).forEach(t => { if (!tags.includes(t)) tags.push(t); });
    return Object.assign({}, v, { tags, minna: true, italki: !!o.italki, minnaKey: o.minnaKey, minnaLesson: o.minnaLesson },
      o.accent != null ? { accent: o.accent } : {}, o.tts ? { tts: o.tts } : {}, o.audio ? { audio: o.audio } : {});
  });
}

// The lesson-derived CONTENT fields of a Minna custom card — the SINGLE source of truth shared by
// the build (minnaCardContent), the re-activation patch (minnaMutablePatch), and the "Update N
// words" signature (minnaSig), so the three can't drift: add a field here + to minnaCardContent and
// it is automatically patched on re-activation AND detected as stale. Everything a Minna word
// carries is derived from its lesson JSON EXCEPT the structural flags (custom/minna, always true)
// and the rank — which re-activation must PRESERVE because the card's SRS progress hangs off it.
export const MINNA_MUTABLE_FIELDS = ['jp', 'read', 'mean', 'cat', 'type', 'jlpt', 'trans', 'tags', 'mnem', 'tip', 'levels', 'accent', 'tts', 'audio', 'ex', 'italki', 'minnaKey', 'minnaLesson'];

// Build the lesson-derived content of a Minna custom card (DOM-free, pure). features/minna.js's
// minnaCard wraps this with the custom/minna flags; a genuinely-new word also gets a rank there. The
// textbook-form line appended to `tip` lives here so the build and the signature agree on it. Keep
// the emitted keys === MINNA_MUTABLE_FIELDS (a test pins this).
export function minnaCardContent(item, lesson) {
  const tags = ['みんなの日本語', 'mnn-l' + lesson];
  if (item.italki) tags.push('iTalki');
  const tb = 'みんなの日本語 L' + lesson + ' · textbook form: ' + (item.kanji || item.kana) + (item.context ? ' ' + item.context : '');
  return {
    jp: item.dict || item.kanji || item.kana,
    read: item.dictRead || item.kana,
    mean: item.mean,
    cat: item.cat || 'noun',
    type: item.type || '',
    jlpt: item.jlpt || 'N4',
    trans: item.trans || '',
    tags,
    mnem: item.mnem || '',
    tip: item.tip ? (item.tip + '<br><br>' + tb) : tb,
    levels: item.levels || null,   // { N5:[jp,en], …, N1:[jp,en] } leveled examples
    accent: item.accent,           // pitch-accent number → the visual pitch marks
    tts: item.tts,                 // optional TTS-text override (ambiguous single kanji)
    audio: item.audio || null,     // native vnjpclub src → a 'native' audio variant in Browse/reviews
    ex: [],
    italki: !!item.italki,
    minnaKey: item.key,
    minnaLesson: lesson,
  };
}

// Project a card (freshly built, or an already-activated one) down to just its mutable content — the
// patch Object.assign'd onto an existing card on re-activation, so a changed jlpt / lesson / native
// audio / … applies WITHOUT touching the card's rank (→ SRS progress) or its custom/minna flags.
export function minnaMutablePatch(card) {
  const patch = {};
  for (const k of MINNA_MUTABLE_FIELDS) patch[k] = card[k];
  return patch;
}

// Content signature for the "Update N words" detector: equal iff every mutable field matches, so a
// freshly-built card whose lesson JSON changed (jlpt, native audio, leveled examples, …) reads as
// stale and the patch above is offered + applied. Derived from MINNA_MUTABLE_FIELDS so detection and
// patching can't disagree. JSON-encoded (not a delimited join) so a value containing the textbook-
// form ` · ` can't blur a field boundary. Not persisted — safe to change the encoding.
export const minnaSig = v => JSON.stringify(MINNA_MUTABLE_FIELDS.map(k => (v == null ? null : v[k]) ?? null));
