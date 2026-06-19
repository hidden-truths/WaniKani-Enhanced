// Integration test for the みんなの日本語 dashboard render path (src/features/minna/*). The package
// decomposition centralizes the module-level view-state (the lessons list + lesson cache) into a
// shared `S` and splits the render/wiring across modules — a MISSED cross-module reference is a
// runtime ReferenceError that `bun run build` can't catch (esbuild treats a bare identifier as a
// global) and the pure-core tests don't exercise the glue. So this test imports the real package and
// DRIVES renderMinna (→ renderMinnaLesson → every section builder + wireMinnaLesson) under happy-dom
// with the engine / audio / network / persistence mocked, plus the signed-out gate, the
// speaking-mode rec/clip path, and the add-deck + notes handlers — turning "build can't catch it"
// into "a test catches it". The live mic/record/compare + cookie-gated audio flow stays a manual
// browser pass (headless blocks getUserMedia + the credentialed <audio>).
import { test, expect, beforeEach, afterEach, vi } from 'vitest';

// --- shared, hoisted control surface for the mocks (account, speaking-mode flag, server payloads) ---
const ctx = vi.hoisted(() => ({
  account: null,
  speaking: false,
  lessons: [23],
  lesson: null,
  practice: null,
}));

// --- mock the side-effecting collaborators (engine, audio, tts, network, persistence, cloud) ---
vi.mock('../src/features/record-compare.js', () => ({
  loadRecordings: vi.fn(async () => {}),
  recordControlHtml: (lesson, key, audio) => `<div class="rec-control" data-lesson="${lesson}" data-native="${audio || ''}"></div>`,
  wireRecordCompare: () => {},
  paintCompareWaveforms: () => {},
  isSpeakingMode: () => ctx.speaking,
  enterSpeakingMode: vi.fn(async () => false),
  exitSpeakingMode: () => {},
  newestTakeIdForItem: () => null,
}));
vi.mock('../src/features/speaking-bar.js', () => ({
  createSpeakingBar: () => ({ mount: () => {}, onToggle: () => {} }),
  clearSpeakingBar: vi.fn(),
  releaseMicIfHidden: () => false,
}));
vi.mock('../src/features/audio.js', () => ({ playItem: () => {}, cycleMod: () => false }));
vi.mock('../src/features/tts.js', () => ({ speak: () => {}, TTS_OK: true }));
vi.mock('../src/features/cloud.js', () => ({ openAuth: vi.fn() }));
vi.mock('../src/features/custom-cards.js', () => ({ rebuildData: vi.fn(), refreshAfterVerbChange: vi.fn() }));
vi.mock('../src/persistence/custom.js', () => ({
  loadCustom: () => ({ seq: 100, verbs: [] }),   // fresh per call → no built-in/overlap; every word is "new"
  saveCustom: vi.fn(),
}));
// The Minna synced blob is created at module-eval (store.js) — stub it so the test doesn't drag in
// the transport / sync-queue stack; the render path never pushes anyway.
vi.mock('../src/features/synced-blob.js', () => ({
  createSyncedBlob: () => ({ schedule: () => {}, push: async () => {}, pull: async () => {}, queueKey: 'progress:minna' }),
}));
vi.mock('../src/features/cloud-core.js', () => ({
  get account() { return ctx.account; },
  api: vi.fn(async (path) => {
    if (path === '/v1/minna/lessons') return { lessons: ctx.lessons };
    if (path.startsWith('/v1/minna/lessons/')) return ctx.lesson;
    if (path === '/v1/minna/practice') return ctx.practice;
    return {};
  }),
  setSyncStatus: vi.fn(),
}));

import { state } from '../src/state.js';
import { setSyncStatus } from '../src/features/cloud-core.js';
import { saveCustom } from '../src/persistence/custom.js';
import { initMinna, renderMinna } from '../src/features/minna.js';
import * as pkg from '../src/features/minna.js';

const html = (id) => document.getElementById(id).innerHTML;
const LESSON = {
  lesson: 23, theme: 'At the station',
  vocab: [
    { key: 'mnn:23:0', kanji: '駅', kana: 'えき', dict: '駅', dictRead: 'えき', mean: 'station', cat: 'noun', context: '〜で' },
    { key: 'mnn:23:1', kanji: '聞く', kana: 'きく', dict: '聞く', dictRead: 'きく', mean: 'to ask', cat: 'verb', italki: true },
  ],
  grammar: [{ label: 'Topic', pattern: '〜は〜です', structure: 'N は N です', explain: 'X is Y', examples: [{ jp: 'これは駅です', en: 'This is a station' }] }],
  examples: [{ jp: '駅はどこですか', en: 'Where is the station?' }],
  conversation: { title: '会話', audio: '/Audio/conv23.mp3', lines: [{ role: 'A', jp: 'すみません', en: 'Excuse me' }, { role: 'B', jp: 'はい', en: 'Yes' }] },
};

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
  });
  document.body.innerHTML = `<div id="mnHead"></div><div id="mnGate" hidden></div><div id="mnBody"></div><div id="navExtra"></div>`;
  ctx.account = { email: 'owner@example.com' };
  ctx.speaking = false;
  ctx.lessons = [23];
  ctx.lesson = JSON.parse(JSON.stringify(LESSON));   // fresh copy per test
  ctx.practice = { totalTakes: 2, totalItems: 1, lessons: [{ lesson: 23, items: 1, takes: 2, lastCreatedAt: 1718000000000 }] };
  state.minnaStore = { notes: {}, lastLesson: 23, overlays: {}, clips: {} };
  state.BUILTIN_RANK_BY_JP = {};   // no overlaps → every vocab word is treated as new
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); });

test('the package barrel exports the public API main.js + cloud.js consume', () => {
  for (const name of ['initMinna', 'renderMinna', 'onMinnaHidden', 'migrateMinnaDupes', 'pullMinnaCloud']) {
    expect(typeof pkg[name], name).toBe('function');
  }
  expect(pkg.minnaBlob, 'minnaBlob').toBeTruthy();           // cloud.js registers it in the queue map
  expect(typeof pkg.minnaBlob.pull).toBe('function');
});

test('renderMinna (signed in) paints the head marker + every lesson section — no ReferenceError', async () => {
  await renderMinna();
  expect(document.getElementById('mnGate').hidden).toBe(true);
  expect(html('mnHead')).toContain('教科書');                 // blend NN/06 section marker (教科書 · Textbook)
  const body = html('mnBody');
  // lesson hero + seal (kanji numeral) + add-deck CTA
  expect(body).toContain('第23課');
  expect(body).toContain('二十三');                          // kanjiNum(23) on the seal
  expect(body).toContain('id="mnAddDeck"');
  expect(body).toContain('Add all vocab to deck');           // toAdd=2 (no built-in overlap)
  // vocab grid (grouped by POS) + the app-only columns the static mock omits
  expect(body).toContain('Nouns');
  expect(body).toContain('Verbs');
  expect(body).toContain('station');
  expect(body).toContain('to ask');
  expect(body).toContain('iTalki');                          // 聞く is flagged italki
  // grammar + examples + conversation sections
  expect(body).toContain('This is a station');               // grammar specimen example
  expect(body).toContain('Where is the station?');           // example sentence
  expect(body).toContain('会話');                            // conversation title
  expect(body).toContain('Excuse me');
  // practice-history roll-up (fmtPracticeDate exercised)
  expect(body).toContain('Practice history');
  expect(body).toContain('L23');
  // notes section (synced pill text reflects the signed-in account)
  expect(body).toContain('id="mnNotes"');
  expect(body).toContain('synced');
});

test('renderMinna (signed out) shows the sign-in gate and empties head/body', async () => {
  ctx.account = null;
  await renderMinna();
  const gate = document.getElementById('mnGate');
  expect(gate.hidden).toBe(false);
  expect(gate.innerHTML).toContain('Sign in');
  expect(gate.innerHTML).toContain('id="mnSignin"');
  expect(html('mnHead')).toBe('');
  expect(html('mnBody')).toBe('');
});

test('renderMinna surfaces the owner-allowlist 401 as the no-access note (not a sign-in prompt)', async () => {
  const { api } = await import('../src/features/cloud-core.js');
  api.mockImplementationOnce(async () => { const e = new Error('forbidden'); e.status = 401; throw e; });
  await renderMinna();
  const gate = document.getElementById('mnGate');
  expect(gate.hidden).toBe(false);
  expect(gate.innerHTML).toContain("isn't available here");
  expect(gate.innerHTML).not.toContain('id="mnSignin"');     // already signed-in → no misleading Sign-in button
});

test('speaking mode renders the per-line rec controls + clip zone; editing a clip mounts the marker', async () => {
  ctx.speaking = true;
  await renderMinna();
  const body = html('mnBody');
  expect(body).toContain('rec-control');                     // engine control rendered into each line (mocked)
  expect(body).toContain('clip-zone');
  expect(body).toContain('data-clip-edit');
  // Click "Set clip" → the attach-once delegated handler swaps in the credentialed marker panel.
  const edit = document.querySelector('[data-clip-edit]');
  expect(edit).toBeTruthy();
  const zone = edit.closest('.clip-zone');   // capture before the click — the handler replaces the zone's innerHTML (detaches `edit`)
  edit.click();
  expect(zone.innerHTML).toContain('clip-marker');
  expect(zone.innerHTML).toContain('crossorigin="use-credentials"');   // the cookie-gated native <audio>
  expect(zone.innerHTML).toContain('/v1/audio/native?src=');           // API_BASE-rebased src
});

test('the add-deck button activates the lesson vocab (planner apply) and reports it', async () => {
  await renderMinna();
  document.getElementById('mnAddDeck').click();
  expect(saveCustom).toHaveBeenCalled();                     // two new words → custom-card writes
  expect(setSyncStatus).toHaveBeenCalled();
  const msg = setSyncStatus.mock.calls.at(-1)[0];
  expect(msg).toContain('added');
});

test('typing in the notes textarea records the note without throwing (debounced save)', async () => {
  vi.useFakeTimers();
  try {
    await renderMinna();
    const ta = document.getElementById('mnNotes');
    ta.value = 'tutor said: watch the は/が contrast';
    ta.dispatchEvent(new Event('input'));
    expect(state.minnaStore.notes[23]).toContain('は/が');
    expect(document.getElementById('mnNotesSaved').textContent).toBe('saving…');
    vi.advanceTimersByTime(600);                             // debounce fires
    expect(document.getElementById('mnNotesSaved').textContent).toContain('synced');
  } finally { vi.useRealTimers(); }
});

test('initMinna boots the store + wires visibilitychange without throwing', () => {
  expect(() => initMinna()).not.toThrow();
  expect(state.minnaStore.lastLesson).toBe(23);             // normalized default from the empty localStorage
});
