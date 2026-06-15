// Characterization tests for the record-compare PURE helpers extracted to core in Workstream C0:
//   core/recordings.js — chooseMime / RECORD_MIME_CANDIDATES / encodeWav / biasNative / biasTake
//   core/refs.js       — parseControlCtx, the reference-variant selection (nativePlayable /
//                        refAvailable / referenceVariants / defaultRef / refVariantId / refVariantById /
//                        refShortLabel / currentRef), and the audio-URL shapes (nativeUrl / takeUrl /
//                        refUrl / refClip)
//
// These PIN today's behavior: features/record-compare.js now delegates to them through thin same-named
// wrappers (binding API_BASE / HTTP_SERVED / settings.audioPrefs), so a regression here is a real
// behavior change in the live compare player. Imported from the barrel to also smoke-test the wiring.
import { test, expect, describe } from 'vitest';
import {
  chooseMime, RECORD_MIME_CANDIDATES, encodeWav, biasNative, biasTake,
  parseControlCtx, nativePlayable, refAvailable, referenceVariants, defaultRef,
  refVariantId, refVariantById, refShortLabel, currentRef,
  nativeUrl, takeUrl, refUrl, refClip,
} from '../src/core/index.js';

// ---------- chooseMime (the pure core of pickMime) ----------
describe('chooseMime', () => {
  test('returns the first candidate the predicate accepts (first-wins)', () => {
    expect(chooseMime(['a', 'b', 'c'], (c) => c === 'b')).toBe('b');
    expect(chooseMime(['a', 'b', 'c'], () => true)).toBe('a');
  });
  test("returns '' when nothing is supported (let MediaRecorder default)", () => {
    expect(chooseMime(['a', 'b'], () => false)).toBe('');
    expect(chooseMime([], () => true)).toBe('');
  });
  test('RECORD_MIME_CANDIDATES prefers opus-in-webm, then falls back (Safari → mp4)', () => {
    expect(RECORD_MIME_CANDIDATES[0]).toBe('audio/webm;codecs=opus');
    expect(chooseMime(RECORD_MIME_CANDIDATES, (c) => c === 'audio/mp4')).toBe('audio/mp4');
  });
});

// ---------- encodeWav (Float32 → 16-bit mono PCM WAV Blob) ----------
describe('encodeWav', () => {
  test('writes a valid RIFF/WAVE/fmt /data header + the samples', async () => {
    const samples = new Float32Array([0, 1, -1, 0.5]);
    const sampleRate = 8000;
    const blob = encodeWav(samples, sampleRate);
    expect(blob.type).toBe('audio/wav');
    const buf = await blob.arrayBuffer();
    expect(buf.byteLength).toBe(44 + samples.length * 2);   // 44-byte header + 2 bytes/sample
    const dv = new DataView(buf);
    const ascii = (off, len) => String.fromCharCode(...new Uint8Array(buf, off, len));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');
    expect(dv.getUint32(4, true)).toBe(36 + samples.length * 2);   // RIFF chunk size
    expect(dv.getUint16(16, true)).toBe(16);   // fmt chunk length
    expect(dv.getUint16(20, true)).toBe(1);    // PCM
    expect(dv.getUint16(22, true)).toBe(1);    // mono
    expect(dv.getUint32(24, true)).toBe(sampleRate);
    expect(dv.getUint32(28, true)).toBe(sampleRate * 2);   // byte rate (mono, 16-bit)
    expect(dv.getUint16(32, true)).toBe(2);    // block align
    expect(dv.getUint16(34, true)).toBe(16);   // bits per sample
    expect(dv.getUint32(40, true)).toBe(samples.length * 2);   // data size
    // sample scaling: 0→0, +1→0x7fff, −1→−0x8000, 0.5→trunc(0.5*0x7fff)
    expect(dv.getInt16(44, true)).toBe(0);
    expect(dv.getInt16(46, true)).toBe(0x7fff);
    expect(dv.getInt16(48, true)).toBe(-0x8000);
    expect(dv.getInt16(50, true)).toBe(Math.trunc(0.5 * 0x7fff));   // 16383
  });
  test('clamps out-of-range samples to the int16 rails', async () => {
    const dv = new DataView(await encodeWav(new Float32Array([2, -2]), 8000).arrayBuffer());
    expect(dv.getInt16(44, true)).toBe(0x7fff);    // +2 clamps to +1 → max
    expect(dv.getInt16(46, true)).toBe(-0x8000);   // −2 clamps to −1 → min
  });
});

// ---------- bias crossfader curve (▶ both balance) ----------
describe('bias crossfader curve', () => {
  test('center (0): both sides full', () => { expect(biasNative(0)).toBe(1); expect(biasTake(0)).toBe(1); });
  test('+1 (all reference): you faded out', () => { expect(biasNative(1)).toBe(1); expect(biasTake(1)).toBe(0); });
  test('−1 (all you): reference faded out', () => { expect(biasNative(-1)).toBe(0); expect(biasTake(-1)).toBe(1); });
  test('+0.5: you to half, reference stays full', () => { expect(biasNative(0.5)).toBe(1); expect(biasTake(0.5)).toBe(0.5); });
  test('−0.5: reference to half, you stays full', () => { expect(biasNative(-0.5)).toBe(0.5); expect(biasTake(-0.5)).toBe(1); });
});

// ---------- parseControlCtx (dataset bag → compare context) ----------
describe('parseControlCtx', () => {
  test('parses a full dataset bag', () => {
    expect(parseControlCtx({ native: 'lessons/3.mp3', clip: '1.2,3.4', needsclip: '1', text: '食べる', audioctx: 'selftalk' }))
      .toEqual({ nativeSrc: 'lessons/3.mp3', clip: [1.2, 3.4], needsClip: true, text: '食べる', audioCtx: 'selftalk' });
  });
  test('defaults: empty / undefined → minna context, no clip', () => {
    const expected = { nativeSrc: '', clip: null, needsClip: false, text: '', audioCtx: 'minna' };
    expect(parseControlCtx({})).toEqual(expected);
    expect(parseControlCtx(undefined)).toEqual(expected);
  });
  test('an invalid clip string → null', () => {
    expect(parseControlCtx({ clip: '5,2' }).clip).toBeNull();   // end ≤ start
    expect(parseControlCtx({ clip: 'x,y' }).clip).toBeNull();   // non-numeric
  });
});

// ---------- nativePlayable ----------
describe('nativePlayable', () => {
  test('a whole-file native clip is playable', () => {
    expect(nativePlayable({ nativeSrc: 'a.mp3', needsClip: false, clip: null })).toBe(true);
  });
  test('a conversation line needs its clip first', () => {
    expect(nativePlayable({ nativeSrc: 'a.mp3', needsClip: true, clip: null })).toBe(false);
    expect(nativePlayable({ nativeSrc: 'a.mp3', needsClip: true, clip: [1, 2] })).toBe(true);
  });
  test('no native source → not playable', () => {
    expect(nativePlayable({ nativeSrc: '', needsClip: false, clip: null })).toBe(false);
  });
});

// ---------- refAvailable ----------
describe('refAvailable', () => {
  test('native from nativePlayable; tts from text + httpServed; user always false', () => {
    expect(refAvailable({ nativeSrc: 'a.mp3', needsClip: false, clip: null, text: '食べる' }, true))
      .toEqual({ native: true, tts: true, user: false });
  });
  test('tts requires an http(s) origin (httpServed)', () => {
    expect(refAvailable({ nativeSrc: '', text: '食べる' }, false)).toEqual({ native: false, tts: false, user: false });
  });
  test('no synth text → no tts', () => {
    expect(refAvailable({ nativeSrc: 'a.mp3', needsClip: false, clip: null, text: '' }, true))
      .toEqual({ native: true, tts: false, user: false });
  });
});

// ---------- referenceVariants (the cycle list) ----------
describe('referenceVariants', () => {
  test('native + tts → native then each synth voice (the you-side is never a reference)', () => {
    const ctx = { nativeSrc: 'a.mp3', needsClip: false, clip: null, text: '食べる' };
    expect(referenceVariants(ctx, true).map(refVariantId)).toEqual(['native', 'siri:female', 'siri:male', 'google']);
  });
  test('referenceless item (no native, no http) → empty list (only ▶ you)', () => {
    expect(referenceVariants({ nativeSrc: '', text: 'x' }, false)).toEqual([]);
  });
});

// ---------- defaultRef (per-context resolver default) ----------
describe('defaultRef', () => {
  test('minna leads with the native recording (DEFAULT_AUDIO_PREFS.minna)', () => {
    const ctx = { nativeSrc: 'a.mp3', needsClip: false, clip: null, text: '食べる', audioCtx: 'minna' };
    expect(defaultRef(ctx, true, {})).toEqual({ kind: 'native' });
  });
  test('selftalk (no native) leads with Siri female', () => {
    const ctx = { nativeSrc: '', text: '今日はいい天気ですね', audioCtx: 'selftalk' };
    expect(defaultRef(ctx, true, {})).toEqual({ kind: 'tts', voice: 'siri:female' });
  });
  test('honors a user voice-priority override', () => {
    const ctx = { nativeSrc: 'a.mp3', needsClip: false, clip: null, text: 'x', audioCtx: 'minna' };
    expect(defaultRef(ctx, true, { minna: ['google'] })).toEqual({ kind: 'tts', voice: 'google' });
  });
});

// ---------- refVariantId / refVariantById / refShortLabel ----------
describe('refVariantId', () => {
  test('native → "native", synth → voice id, null → ""', () => {
    expect(refVariantId({ kind: 'native' })).toBe('native');
    expect(refVariantId({ kind: 'tts', voice: 'siri:male' })).toBe('siri:male');
    expect(refVariantId(null)).toBe('');
  });
});

describe('refVariantById', () => {
  const ctx = { nativeSrc: 'a.mp3', needsClip: false, clip: null, text: 'x' };
  test('finds an available variant by id', () => {
    expect(refVariantById(ctx, 'native', true)).toMatchObject({ kind: 'native' });
    expect(refVariantById(ctx, 'siri:male', true)).toMatchObject({ kind: 'tts', voice: 'siri:male' });
  });
  test('unknown / unavailable id → null', () => {
    expect(refVariantById(ctx, 'nope', true)).toBeNull();
    expect(refVariantById({ nativeSrc: '', text: '' }, 'native', false)).toBeNull();
  });
});

describe('refShortLabel', () => {
  test('maps each voice to a short caption; unknown → raw; null → "ref"', () => {
    expect(refShortLabel({ kind: 'native' })).toBe('native');
    expect(refShortLabel({ kind: 'tts', voice: 'siri:female' })).toBe('Siri F');
    expect(refShortLabel({ kind: 'tts', voice: 'siri:male' })).toBe('Siri M');
    expect(refShortLabel({ kind: 'tts', voice: 'google' })).toBe('Google');
    expect(refShortLabel({ kind: 'tts', voice: 'mystery' })).toBe('mystery');
    expect(refShortLabel(null)).toBe('ref');
  });
});

// ---------- currentRef (saved data-ref vs default) ----------
describe('currentRef', () => {
  const ctx = { nativeSrc: 'a.mp3', needsClip: false, clip: null, text: 'x', audioCtx: 'minna' };
  test('no saved id → the resolver default', () => {
    expect(currentRef('', ctx, true, {})).toEqual({ kind: 'native' });
  });
  test('a saved, still-available id wins over the default', () => {
    expect(currentRef('google', ctx, true, {})).toMatchObject({ kind: 'tts', voice: 'google' });
  });
  test('a saved-but-unavailable id falls back to the default', () => {
    const noTts = { nativeSrc: 'a.mp3', needsClip: false, clip: null, text: '', audioCtx: 'minna' };
    expect(currentRef('google', noTts, true, {})).toEqual({ kind: 'native' });
  });
});

// ---------- audio URL shapes (base injected) ----------
describe('audio URL builders', () => {
  const BASE = 'https://api.example.test';
  test('nativeUrl encodes the src param', () => {
    expect(nativeUrl(BASE, 'lessons/3 conv.mp3')).toBe(BASE + '/v1/audio/native?src=lessons%2F3%20conv.mp3');
  });
  test('takeUrl appends the recording id', () => {
    expect(takeUrl(BASE, 42)).toBe(BASE + '/v1/audio/recordings/42');
  });
  test('refUrl: native → the gated native proxy', () => {
    expect(refUrl(BASE, { nativeSrc: 'a.mp3' }, { kind: 'native' })).toBe(BASE + '/v1/audio/native?src=a.mp3');
  });
  test('refUrl: synth → the tagged-TTS endpoint with encoded text + voice', () => {
    expect(refUrl(BASE, { text: '食べる' }, { kind: 'tts', voice: 'siri:female' }))
      .toBe(BASE + '/v1/audio/tts?text=' + encodeURIComponent('食べる') + '&voice=siri%3Afemale');
  });
  test('refUrl: no variant → empty', () => {
    expect(refUrl(BASE, { text: 'x' }, null)).toBe('');
  });
});

// ---------- refClip ----------
describe('refClip', () => {
  test('native plays over the line clip', () => {
    expect(refClip({ clip: [1, 2] }, { kind: 'native' })).toEqual([1, 2]);
    expect(refClip({ clip: null }, { kind: 'native' })).toBeNull();
  });
  test('a synth voice has no clip (windowFor trims its silence)', () => {
    expect(refClip({ clip: [1, 2] }, { kind: 'tts', voice: 'google' })).toBeNull();
  });
  test('no variant → null', () => {
    expect(refClip({ clip: [1, 2] }, null)).toBeNull();
  });
});
