// Tests for the shared speaking-bar controller (src/features/speaking-bar.js) — the #navExtra
// "Practice speaking" lifecycle that みんなの日本語, 独り言 Self-Talk and 歌 Songs/Shadow all drive.
// The record-and-compare engine is mocked (its real speaking primitives touch getUserMedia, which
// headless can't exercise) so we can drive every wiring branch: mount/clear, the toggle's
// enter→load-once→render and exit→render paths, the mic-blocked bail, and the visibilitychange
// mic-release guard. The actual mic/record/compare flow is a manual browser pass (per REFACTOR plan).
import { test, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.mock factories are hoisted above imports — share the mutable engine state via vi.hoisted().
const ctx = vi.hoisted(() => ({ speaking: false, enterResult: true }));
vi.mock('../src/features/record-compare.js', () => ({
  isSpeakingMode: vi.fn(() => ctx.speaking),
  enterSpeakingMode: vi.fn(async () => { if (ctx.enterResult) ctx.speaking = true; return ctx.enterResult; }),
  exitSpeakingMode: vi.fn(() => { ctx.speaking = false; }),
  speakingBarHtml: vi.fn(() => '<button class="speaking-toggle" data-speaking-toggle></button>'),
  wireSpeakingControls: vi.fn(),
  initMicSelector: vi.fn(),
  loadRecordings: vi.fn(async () => {}),
}));

import * as rc from '../src/features/record-compare.js';
import { createSpeakingBar, clearSpeakingBar, releaseMicIfHidden } from '../src/features/speaking-bar.js';

const nav = () => document.getElementById('navExtra');
function setHidden(v) { Object.defineProperty(document, 'hidden', { configurable: true, get: () => v }); }

beforeEach(() => {
  ctx.speaking = false; ctx.enterResult = true;
  document.body.innerHTML = '<div id="navExtra"></div>';
  setHidden(false);
  vi.clearAllMocks();   // clears call history; keeps the ctx-backed implementations
});
afterEach(() => { setHidden(false); });

// ---- mount() ----
test('mount() draws the bar + wires controls (shouldShow omitted = always show)', () => {
  createSpeakingBar({ render: vi.fn() }).mount();
  expect(rc.speakingBarHtml).toHaveBeenCalled();
  expect(nav().querySelector('[data-speaking-toggle]')).toBeTruthy();
  expect(rc.wireSpeakingControls).toHaveBeenCalledWith(nav());
  expect(rc.initMicSelector).toHaveBeenCalled();
});

test('mount() clears the slot (and skips drawing) when shouldShow() is false', () => {
  nav().innerHTML = '<span>stale</span>';
  createSpeakingBar({ shouldShow: () => false, render: vi.fn() }).mount();
  expect(nav().innerHTML).toBe('');
  expect(rc.speakingBarHtml).not.toHaveBeenCalled();
});

test('mount() is a no-op when the #navExtra slot is absent', () => {
  document.body.innerHTML = '';   // no slot
  expect(() => createSpeakingBar({ render: vi.fn() }).mount()).not.toThrow();
  expect(rc.speakingBarHtml).not.toHaveBeenCalled();
});

test('clicking the wired toggle invokes the handler (enters speaking mode)', async () => {
  const render = vi.fn();
  createSpeakingBar({ render }).mount();
  nav().querySelector('[data-speaking-toggle]').click();
  await vi.waitFor(() => expect(rc.enterSpeakingMode).toHaveBeenCalled());
});

// ---- onToggle() branches ----
test('toggle while NOT speaking → enter, load the scope cache ONCE, then render', async () => {
  const render = vi.fn();
  let loaded = false;
  const bar = createSpeakingBar({ render, scope: 90000, isLoaded: () => loaded, markLoaded: () => { loaded = true; } });
  await bar.onToggle();
  expect(rc.enterSpeakingMode).toHaveBeenCalled();
  expect(rc.loadRecordings).toHaveBeenCalledWith(90000);
  expect(render).toHaveBeenCalledTimes(1);
  // a second enter (after a later exit) does NOT reload — the once-per-session guard held
  ctx.speaking = false;
  await bar.onToggle();
  expect(rc.loadRecordings).toHaveBeenCalledTimes(1);
});

test('toggle while NOT speaking, already loaded → enter + render, NO reload', async () => {
  const render = vi.fn();
  const bar = createSpeakingBar({ render, scope: 90000, isLoaded: () => true, markLoaded: vi.fn() });
  await bar.onToggle();
  expect(rc.loadRecordings).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledTimes(1);
});

test('toggle with no scope (みんなの日本語) never loads the cache on enter', async () => {
  const render = vi.fn();
  await createSpeakingBar({ render }).onToggle();
  expect(rc.enterSpeakingMode).toHaveBeenCalled();
  expect(rc.loadRecordings).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledTimes(1);
});

test('toggle while speaking → exit + render, no enter/load', async () => {
  ctx.speaking = true;
  const render = vi.fn();
  await createSpeakingBar({ render, scope: 90000, isLoaded: () => false, markLoaded: vi.fn() }).onToggle();
  expect(rc.exitSpeakingMode).toHaveBeenCalled();
  expect(rc.enterSpeakingMode).not.toHaveBeenCalled();
  expect(rc.loadRecordings).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledTimes(1);
});

test('toggle bails when enterSpeakingMode fails (mic blocked) → no load, no render', async () => {
  ctx.enterResult = false;
  const render = vi.fn();
  await createSpeakingBar({ render, scope: 90000, isLoaded: () => false, markLoaded: vi.fn() }).onToggle();
  expect(rc.enterSpeakingMode).toHaveBeenCalled();
  expect(rc.loadRecordings).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});

// ---- clearSpeakingBar() ----
test('clearSpeakingBar empties the slot', () => {
  nav().innerHTML = '<span>bar</span>';
  clearSpeakingBar();
  expect(nav().innerHTML).toBe('');
});

test('clearSpeakingBar is a no-op when the slot is absent', () => {
  document.body.innerHTML = '';
  expect(() => clearSpeakingBar()).not.toThrow();
});

// ---- releaseMicIfHidden() ----
test('releaseMicIfHidden: hidden + speaking + active → exits, returns true', () => {
  ctx.speaking = true; setHidden(true);
  expect(releaseMicIfHidden(() => true)).toBe(true);
  expect(rc.exitSpeakingMode).toHaveBeenCalled();
});

test('releaseMicIfHidden: not hidden → false, no exit', () => {
  ctx.speaking = true; setHidden(false);
  expect(releaseMicIfHidden(() => true)).toBe(false);
  expect(rc.exitSpeakingMode).not.toHaveBeenCalled();
});

test('releaseMicIfHidden: hidden but not speaking → false, no exit', () => {
  ctx.speaking = false; setHidden(true);
  expect(releaseMicIfHidden(() => true)).toBe(false);
  expect(rc.exitSpeakingMode).not.toHaveBeenCalled();
});

test('releaseMicIfHidden: hidden + speaking but panel inactive → false, no exit (does not fight the active surface)', () => {
  ctx.speaking = true; setHidden(true);
  expect(releaseMicIfHidden(() => false)).toBe(false);
  expect(rc.exitSpeakingMode).not.toHaveBeenCalled();
});

test('releaseMicIfHidden: no isActive guard (みんなの日本語 primary) → exits when hidden + speaking', () => {
  ctx.speaking = true; setHidden(true);
  expect(releaseMicIfHidden()).toBe(true);
  expect(rc.exitSpeakingMode).toHaveBeenCalled();
});
