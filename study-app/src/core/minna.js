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

// A genuinely-new Minna word becomes a tagged custom card: lesson-derived content (the shared
// minnaCardContent) + the structural flags. The `rank` is assigned by the apply step, not here, so
// the build stays pure and a re-activation can preserve the existing card's rank → SRS progress.
export function buildMinnaCard(item, lesson) {
  return { ...minnaCardContent(item, lesson), custom: true, minna: true };
}

// The overlay payload for a Minna word that maps onto a BUILT-IN verb: provenance only (tags,
// iTalki, lesson, key) + the few content fields a built-in can't supply (a Minna-specific pitch
// accent / tts override / native audio src, merged onto the built-in by applyMinnaOverlays). The
// built-in keeps its own content, so no duplicate card is created.
export function buildMinnaOverlay(item, lesson) {
  const tags = ['みんなの日本語', 'mnn-l' + lesson]; if (item.italki) tags.push('iTalki');
  const o = { tags, italki: !!item.italki, minnaLesson: lesson, minnaKey: item.key };
  if (item.accent != null) o.accent = item.accent; if (item.tts) o.tts = item.tts;
  if (item.audio) o.audio = item.audio;   // native src → merged onto the built-in by applyMinnaOverlays
  return o;
}

// Overlay signature — the overlay analog of minnaSig: equal iff the overlay's provenance + the
// content it injects (tags, iTalki, accent, native audio) match, so a re-activation only re-writes a
// built-in's overlay when something actually changed. Cheaper than minnaSig because an overlay
// carries far fewer fields.
export const minnaOverlaySig = o => (o.tags || []).join('|') + '·i' + (o.italki ? 1 : 0) + '·a' + (o.accent ?? '') + '·au' + (o.audio || '');

// Normalize a raw (loaded-from-localStorage or pulled-from-cloud) Minna store onto the defaults,
// forcing the three sub-maps to objects. ONE source of truth for the shape so the boot load and the
// cloud-pull apply can't drift (both used to inline the same Object.assign). Pure: a non-object
// `raw` (null / corrupt JSON) degrades to a fresh store on the given defaults.
export function normalizeMinnaStore(raw, defaults) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  return Object.assign({}, defaults, o, { notes: o.notes || {}, overlays: o.overlays || {}, clips: o.clips || {} });
}

// Lesson/seal number → kanji numeral (7 → 七, 23 → 二十三) for the hanko lesson seal. Pure; covers
// 0–99 explicitly and passes ≥100 straight through (no lesson reaches it).
const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export function kanjiNum(n) {
  if (n < 10) return KANJI_DIGITS[n] || String(n);
  if (n < 20) return '十' + (n % 10 ? KANJI_DIGITS[n % 10] : '');
  if (n < 100) return KANJI_DIGITS[Math.floor(n / 10)] + '十' + (n % 10 ? KANJI_DIGITS[n % 10] : '');
  return String(n);
}

// ── Activation planner — the pure DECISION behind "Add all vocab to deck". ────────────────────────
// Both the non-mutating preview (the button's add/update/in-deck counts) and the store-mutating
// apply used to walk the vocab and re-derive the same per-word verdict, so the two could drift. This
// computes the verdict ONCE: for each word, decide whether it's a built-in overlay (add / update /
// unchanged) or a new/existing custom card (add / update / unchanged), and emit the operations the
// apply step replays plus the counts the preview reads. Pure given (vocab, the current customVerbs
// array, the current overlays map) — it reads the built-in dictionary via minnaBuiltinRank(item) but
// mutates nothing; the caller owns saving + the rank/seq assignment (kept out so this stays testable).
//
// Op kinds (replayed in vocab order so new-card ranks are assigned in the same order as before):
//   { kind: 'overlay-add',    rank, overlay }                 — first time this built-in is tagged
//   { kind: 'overlay-update', rank, overlay }                 — overlay content changed (merge onto cur)
//   { kind: 'card-remove',    minnaKey }                      — a stale custom card now matches a built-in (dedup)
//   { kind: 'card-add',       card }                          — a genuinely-new word (caller assigns rank)
//   { kind: 'card-update',    minnaKey, card }                — an existing custom card's lesson content changed
export function planMinnaActivation(lesson, vocab, customVerbs, overlays) {
  const ops = [];
  let inDeck = 0, toAdd = 0, toUpdate = 0;
  for (const item of vocab) {
    const br = minnaBuiltinRank(item);
    if (br) {
      const fresh = buildMinnaOverlay(item, lesson), cur = overlays[br];
      if (!cur) { ops.push({ kind: 'overlay-add', rank: br, overlay: fresh }); toAdd++; }
      else { inDeck++; if (minnaOverlaySig(cur) !== minnaOverlaySig(fresh)) { ops.push({ kind: 'overlay-update', rank: br, overlay: fresh }); toUpdate++; } }
      // Independent of the overlay verdict: if this word was previously activated as a custom card,
      // it's now a built-in match → drop the duplicate (the original spliced it unconditionally).
      if (customVerbs.some(v => v.minnaKey === item.key)) ops.push({ kind: 'card-remove', minnaKey: item.key });
      continue;
    }
    const fresh = buildMinnaCard(item, lesson);
    const existing = customVerbs.find(v => v.minnaKey === item.key);
    if (!existing) { ops.push({ kind: 'card-add', card: fresh }); toAdd++; }
    else { inDeck++; if (minnaSig(existing) !== minnaSig(fresh)) { ops.push({ kind: 'card-update', minnaKey: item.key, card: fresh }); toUpdate++; } }
  }
  return { ops, counts: { inDeck, total: vocab.length, toAdd, toUpdate } };
}
