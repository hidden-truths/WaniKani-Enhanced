// Reference-variant selection + audio-URL shapes for the record-and-compare engine. DOM-free:
// the feature layer (features/record-compare.js) owns API_BASE, the live HTTP_SERVED flag, the
// settings.audioPrefs, and the DOM datasets — it passes those IN, and this module decides WHICH
// reference voice an item offers / defaults to, and what URL each plays. Built on the pure variant
// machinery in ./audio.js (variantOrder/resolveVariant), so the per-context priority drives the
// compare target exactly like the play buttons do. Unit-tested against fixture ctxs.
//
// A "ctx" here is the compare context produced by parseControlCtx: { nativeSrc, clip, needsClip,
// text, audioCtx }. A "v" is a resolved variant { kind:'native' } | { kind:'tts', voice } (the
// USER's own take is never a reference — it's the "you" side).
import { variantOrder, resolveVariant } from './audio.js';
import { validClip } from './recordings.js';

// Parse a record-control's dataset bag (control.dataset) into the compare context the ref helpers
// consume. `text` is the item's synth text (a word's ttsText / a line or phrase's plain sentence) —
// enables a synth reference voice; `audioCtx` picks the per-context default reference voice. Pure —
// takes a plain {…} bag so it's testable with a `{ dataset:{...} }` stub.
export function parseControlCtx(dataset) {
  const d = dataset || {};
  const clip = d.clip ? validClip(d.clip.split(',').map(Number)) : null;
  return { nativeSrc: d.native || '', clip, needsClip: d.needsclip === '1', text: d.text || '', audioCtx: d.audioctx || 'minna' };
}

// Native compare is playable when there's a native source AND (it's a whole-file item OR a
// conversation line that has a clip).
export function nativePlayable(ctx) { return !!(ctx.nativeSrc && (!ctx.needsClip || ctx.clip)); }

// What reference KINDS an item can offer: native (a cached clip), tts (a synth voice rendered from
// the item's text — needs an http(s) origin, hence the injected `httpServed`), never user. The
// USER's own take is the "you" side, never a reference.
export function refAvailable(ctx, httpServed) {
  return { native: nativePlayable(ctx), tts: !!(ctx.text && httpServed), user: false };
}
// The ordered concrete reference variants for the cycle list (native → each synth voice).
export function referenceVariants(ctx, httpServed) { return variantOrder(refAvailable(ctx, httpServed)); }
// The DEFAULT reference voice for the item's context, via the same resolver the play buttons use.
export function defaultRef(ctx, httpServed, prefs) {
  return resolveVariant(ctx.audioCtx || 'minna', refAvailable(ctx, httpServed), prefs);
}

// Stable id for a reference variant: 'native' for the native clip, else the synth voice id.
export function refVariantId(v) { return v ? (v.kind === 'native' ? 'native' : v.voice) : ''; }
export function refVariantById(ctx, id, httpServed) {
  return referenceVariants(ctx, httpServed).find((v) => refVariantId(v) === id) || null;
}
// The item's currently-selected reference: the saved id (data-ref) if still available, else the
// resolver default. `savedId` is '' (falsy) when nothing's pinned.
export function currentRef(savedId, ctx, httpServed, prefs) {
  const saved = savedId ? refVariantById(ctx, savedId, httpServed) : null;
  return saved || defaultRef(ctx, httpServed, prefs);
}
// Short label for a reference voice (▶ button text + waveform caption).
export function refShortLabel(v) {
  if (!v) return 'ref';
  if (v.kind === 'native') return 'native';
  return { 'siri:female': 'Siri F', 'siri:male': 'Siri M', google: 'Google' }[v.voice] || v.voice;
}

// Playback URLs. `base` (API_BASE) is injected so core stays origin-agnostic (the feature owns
// API_BASE). native is the gated proxy (sliced by the line clip via refClip downstream); a synth
// voice is the public tagged-TTS endpoint.
export function nativeUrl(base, src) { return base + '/v1/audio/native?src=' + encodeURIComponent(src); }
export function takeUrl(base, id) { return base + '/v1/audio/recordings/' + id; }
export function refUrl(base, ctx, v) {
  if (!v) return '';
  if (v.kind === 'native') return nativeUrl(base, ctx.nativeSrc);
  return base + '/v1/audio/tts?text=' + encodeURIComponent(ctx.text) + '&voice=' + encodeURIComponent(v.voice);
}
// The clip a reference variant plays over: the line clip for native, null for a synth voice
// (windowFor trims its silence). Pure (no base).
export function refClip(ctx, v) { return v && v.kind === 'native' ? ctx.clip : null; }
