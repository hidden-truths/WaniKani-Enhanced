// SRS — Leitner scheduling + leech logic. Reads the shared progress (state.store) and
// the live deck (state.DATA); no DOM. Pure w.r.t. those inputs, so it's unit-tested by
// setting state.store and asserting. Chosen over SM-2 for transparency: the interval is
// a pure function of the box, so a learner can see exactly why a card is due.
import { state } from '../state.js';

export const BOX_DAYS = [0, 1, 2, 4, 8, 16];   // index = box number; value = days until due
export const DAY_MS = 86400000;
// Box maturity palette, index 0=New … 5=mastered. Shared by the Stats box histogram and
// the per-card SRS indicator (Browse detail) so the colors stay in lock-step.
export const BOX_COLORS = ['var(--muted)', 'var(--godan)', '#d98a3d', '#c9b037', '#7fae54', 'var(--good)'];

// Lazily create a card's stat record. Also soft-migrates pre-SRS saves missing box/due.
export function cardStat(rank) {
  if (!state.store.cards[rank]) state.store.cards[rank] = { attempts: [], right: 0, wrong: 0, box: 0, due: 0 };
  const c = state.store.cards[rank];
  if (c.box === undefined) c.box = 0;
  if (c.due === undefined) c.due = 0;
  return c;
}
// Apply one review result to a card's schedule. Caller persists via save().
export function scheduleCard(c, correct) {
  if (correct) { c.box = Math.min(5, (c.box || 0) + 1); }
  else { c.box = 1; } // lapse → box 1 (back to a 1-day interval, not box 0)
  c.due = Date.now() + BOX_DAYS[c.box] * DAY_MS;
}
// A card is "due" if never seen, still new (box 0), or its due time has passed.
export function isDue(rank) {
  const c = state.store.cards[rank];
  if (!c) return true;
  if (!c.box) return true;
  return (c.due || 0) <= Date.now();
}
export function dueCards() { return state.DATA.filter(v => isDue(v.rank)); }
// Human-readable "next review" string for the Browse card detail.
export function nextDueLabel(rank) {
  const c = state.store.cards[rank];
  if (!c || !c.box) return 'new';
  const days = Math.ceil(((c.due || 0) - Date.now()) / DAY_MS);
  if (days <= 0) return 'due now';
  if (days === 1) return '1 day';
  return days + ' days';
}
// Rolling accuracy over the last n attempts (default 8). null = never drilled.
export function rollingAcc(rank, n = 8) {
  const c = state.store.cards[rank]; if (!c || !c.attempts.length) return null;
  const a = c.attempts.slice(-n); return a.reduce((s, x) => s + x, 0) / a.length;
}
// LEECH = a card you keep failing: over its last 8 attempts, ≥4 attempts AND under 60%.
export function isLeech(rank) {
  const c = state.store.cards[rank]; if (!c) return false;
  const a = c.attempts.slice(-8);
  return a.length >= 4 && (a.reduce((s, x) => s + x, 0) / a.length) < 0.6;
}
export function leeches() { return state.DATA.filter(v => isLeech(v.rank)); }
