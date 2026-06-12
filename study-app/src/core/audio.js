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
// Browse grid/modal; 'minna' = the みんなの日本語 textbook view.
export const AUDIO_CONTEXTS = ['reviews', 'browse', 'minna'];

// The KIND axis users can prioritize without naming a specific voice.
export const AUDIO_KINDS = ['native', 'tts', 'user'];
export const AUDIO_KIND_LABELS = { native: 'Native recording', tts: 'Synthesized (any)', user: 'My voice' };
export const AUDIO_CONTEXT_LABELS = { reviews: 'Reviews', browse: 'Browsing', minna: 'Textbook study' };

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

// Default priority per context (used until the user customizes a context). Reviews/browse lead with
// a Siri voice then any synth; textbook leads with the native recording, then Siri, then any synth,
// then the user's own take.
export const DEFAULT_AUDIO_PREFS = {
  reviews: ['siri:female', 'kind:tts'],
  browse: ['siri:female', 'kind:tts'],
  minna: ['kind:native', 'siri:female', 'kind:tts', 'kind:user'],
};

// The ordered token list for a context — the user's saved list if non-empty, else the default.
export function contextPrefs(prefs, context) {
  const p = prefs && prefs[context];
  return Array.isArray(p) && p.length ? p : (DEFAULT_AUDIO_PREFS[context] || DEFAULT_AUDIO_PREFS.reviews);
}

// Resolve which variant to play for an item in a context. `available` declares what the item can
// actually offer: { tts:boolean, native:boolean, user:boolean }. Returns { kind, voice } — `voice`
// is the specific synth voice id for kind 'tts' — or null when nothing is available.
export function resolveVariant(context, available, prefs) {
  const av = available || {};
  const tokens = contextPrefs(prefs, context);
  // A 'kind:tts' token resolves to the first SPECIFIC synth voice the user listed for this context,
  // else Google (the universal synth fallback).
  const synthVoiceFor = () => {
    for (const tk of tokens) { const t = parseAudioToken(tk); if (t && t.type === 'voice' && isSynthVoice(t.voice)) return t.voice; }
    return 'google';
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
