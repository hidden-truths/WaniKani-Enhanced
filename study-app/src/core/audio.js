// Audio variant model + the per-context voice-priority resolver (audio-unify Phase 2).
//
// A playable item (a word reading, an example sentence, a conversation line) can have several
// tagged voice VARIANTS: synthesized voices (Siri male/female, Google), the textbook NATIVE
// recording, and the USER's own takes. The user picks, PER CONTEXT (reviews / browsing /
// textbook), an ordered priority of either SPECIFIC voices ('siri:female') OR KINDS of voice
// ('kind:native', 'kind:tts', 'kind:user'); the resolver walks that list and returns the first
// one actually available for the item, falling back across kinds.
//
// This module is PURE / DOM-free (the test imports it under happy-dom): it deals in variant
// descriptors + priority tokens only. The feature layer (features/audio.js) builds the actual
// playback URLs (it knows API_BASE) and owns the <audio> elements.

// The contexts a play button can belong to. 'reviews' = the flashcard deck; 'browse' = the
// Browse grid/modal; 'minna' = the みんなの日本語 textbook view; 'selftalk' = the 独り言 Self-Talk
// speaking-practice tab; 'songs' = the 歌 song viewer/shadow modes.
export const AUDIO_CONTEXTS = ['reviews', 'browse', 'minna', 'selftalk', 'songs'];

// The KIND axis users can prioritize without naming a specific voice.
export const AUDIO_KINDS = ['native', 'tts', 'user'];
export const AUDIO_KIND_LABELS = { native: 'Native recording', tts: 'Synthesized (any)', user: 'My voice' };
export const AUDIO_CONTEXT_LABELS = { reviews: 'Reviews', browse: 'Browsing', minna: 'Textbook study', selftalk: 'Self-talk', songs: 'Songs' };

// Specific synth voices offered in the picker palette. (Native + user are offered as KIND tokens —
// there's no per-source identity to name.) Server-side, an un-generated voice falls through to the
// default clip, so listing siri:* is always safe even before those clips are pre-generated.
export const AUDIO_VOICES = [
  { id: 'siri:female', provider: 'siri', kind: 'tts', gender: 'female', label: 'Siri · Female' },
  { id: 'siri:male', provider: 'siri', kind: 'tts', gender: 'male', label: 'Siri · Male' },
  { id: 'google', provider: 'google', kind: 'tts', gender: null, label: 'Google' },
];

export function voiceProvider(voiceId) { return String(voiceId || '').split(':')[0]; }
export function isSynthVoice(voiceId) { const p = voiceProvider(voiceId); return p === 'siri' || p === 'google'; }
export function voiceLabel(voiceId) { const v = AUDIO_VOICES.find((x) => x.id === voiceId); return v ? v.label : voiceId; }

// A priority token is either 'kind:<k>' (or the bare aliases 'native'/'user'/'tts') or a specific
// voice id ('siri:female', 'google'). Returns { type:'kind', kind } | { type:'voice', voice } | null.
export function parseAudioToken(token) {
  if (typeof token !== 'string' || !token) return null;
  if (token.startsWith('kind:')) return { type: 'kind', kind: token.slice(5) };
  if (token === 'native' || token === 'user' || token === 'tts') return { type: 'kind', kind: token };
  return { type: 'voice', voice: token };
}

// Is `token` a token the current palette understands — a known kind alias or a listed voice id?
// resolveVariant already ignores unknowns at play time; this is for pruning a stale synced prefs
// blob (token hygiene, follow-up ⑦) so an old/foreign token can't linger in the saved list + editor.
export function isKnownAudioToken(token) {
  const t = parseAudioToken(token);
  if (!t) return false;
  if (t.type === 'kind') return AUDIO_KINDS.includes(t.kind);
  return AUDIO_VOICES.some((v) => v.id === t.voice);
}
// Prune unknown tokens from a per-context audioPrefs map: drops unknown tokens, and drops a context
// that empties out (so it falls back to DEFAULT_AUDIO_PREFS). Pure — returns a new object; passes a
// non-object through untouched.
export function pruneAudioPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return prefs;
  const out = {};
  for (const ctx of Object.keys(prefs)) {
    const list = Array.isArray(prefs[ctx]) ? prefs[ctx].filter(isKnownAudioToken) : [];
    if (list.length) out[ctx] = list;
  }
  return out;
}

// Default priority per context (used until the user customizes a context). Reviews/browse lead with
// a Siri voice then any synth; textbook leads with the native recording, then Siri, then any synth,
// then the user's own take.
export const DEFAULT_AUDIO_PREFS = {
  reviews: ['siri:female', 'kind:tts'],
  browse: ['siri:female', 'kind:tts'],
  minna: ['kind:native', 'siri:female', 'kind:tts', 'kind:user'],
  // Self-talk phrases have no native recording (model-authored); lead with a synth voice as the
  // reference, then any synth, then your own take as a self-compare.
  selftalk: ['siri:female', 'kind:tts', 'kind:user'],
  // Song lines have no per-line native clip (the master is the embedded YouTube video, which can't
  // be decoded); a synth voice is the per-line reference + Shadow target, then your own take.
  songs: ['siri:female', 'kind:tts', 'kind:user'],
};

// The ordered token list for a context — the user's saved list if non-empty, else the default.
export function contextPrefs(prefs, context) {
  const p = prefs && prefs[context];
  return Array.isArray(p) && p.length ? p : (DEFAULT_AUDIO_PREFS[context] || DEFAULT_AUDIO_PREFS.reviews);
}

// The ordered list of CONCRETE variants an item can play, for the per-item "try another voice"
// cycle (modifier-click on a play button, audio-unify follow-up ③). Native first, then each
// specific synth voice (Siri female/male, Google), then the user's take — filtered to what the item
// actually offers via `available` ({ tts, native, user } booleans). Each entry is { kind, voice?,
// label }. Pure: the player (features/audio.js) walks this with a per-item cursor.
export function variantOrder(available) {
  const av = available || {};
  const out = [];
  if (av.native) out.push({ kind: 'native', label: AUDIO_KIND_LABELS.native });
  if (av.tts) for (const v of AUDIO_VOICES) out.push({ kind: 'tts', voice: v.id, label: v.label });
  if (av.user) out.push({ kind: 'user', label: AUDIO_KIND_LABELS.user });
  return out;
}

// Index of a resolved { kind, voice } within a variantOrder() list, or -1. Synth matches on the
// specific voice id; native/user match on kind alone. Used to seed the cycle cursor at the default.
export function variantIndex(list, chosen) {
  if (!chosen || !Array.isArray(list)) return -1;
  return list.findIndex((x) => x.kind === chosen.kind && (x.kind !== 'tts' || x.voice === chosen.voice));
}

// Resolve which variant to play for an item in a context. `available` declares what the item can
// actually offer: { tts:boolean, native:boolean, user:boolean }. Returns { kind, voice } — `voice`
// is the specific synth voice id for kind 'tts' — or null when nothing is available.
export function resolveVariant(context, available, prefs) {
  const av = available || {};
  const tokens = contextPrefs(prefs, context);
  // A 'kind:tts' ("any synth") token resolves to the first SPECIFIC synth voice the user listed for
  // this context, else the DEFAULT voice ('default' → the server's smart Apple-first cascade). NOT
  // 'google': picking "Synthesized (any)" is not an explicit Google choice, so it must not force the
  // gtx voice — only an explicitly-listed 'google' voice does that (handled by the t.type==='voice'
  // branch below). This keeps explicit picks authoritative while the generic default stays smart.
  const synthVoiceFor = () => {
    for (const tk of tokens) { const t = parseAudioToken(tk); if (t && t.type === 'voice' && isSynthVoice(t.voice)) return t.voice; }
    return 'default';
  };
  for (const tk of tokens) {
    const t = parseAudioToken(tk);
    if (!t) continue;
    if (t.type === 'voice') {
      if (isSynthVoice(t.voice)) { if (av.tts) return { kind: 'tts', voice: t.voice }; }
      else if (t.voice === 'native') { if (av.native) return { kind: 'native' }; }
      else if (t.voice === 'user') { if (av.user) return { kind: 'user' }; }
    } else {
      if (t.kind === 'tts' && av.tts) return { kind: 'tts', voice: synthVoiceFor() };
      if (t.kind === 'native' && av.native) return { kind: 'native' };
      if (t.kind === 'user' && av.user) return { kind: 'user' };
    }
  }
  // Nothing in the priority list matched what's available → fall back tts → native → user.
  if (av.tts) return { kind: 'tts', voice: synthVoiceFor() };
  if (av.native) return { kind: 'native' };
  if (av.user) return { kind: 'user' };
  return null;
}
