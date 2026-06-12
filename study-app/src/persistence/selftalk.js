// 独り言 SELF-TALK storage — the user's own authored phrases + a lightweight practice signal,
// in ONE localStorage blob, synced under the 'selftalk' app key. Kept SEPARATE from custom-verbs
// so Self-Talk lines (which are NOT SRS cards — no rank/box/due) never pollute the deck/Browse/
// Stats. Mirrors the persistence/store.js model: mutate state.selftalkStore in memory; saveLocal()
// persists instantly; save() additionally schedules a debounced cloud push via the sync bus.
//
//   state.selftalkStore = {
//     phrases: [{ id, jp, read, mean, scene, grammar:[…], custom:true }…],   // user-authored
//     practice: { lastDay:'YYYY-MM-DD'|null, streak:int, doneToday:[id…] },
//   }
import { state } from '../state.js';
import { sync } from '../sync-bus.js';
import { emptyPractice } from '../core/selftalk.js';

const KEY = 'jpverbs_selftalk';

export function emptySelftalk() { return { phrases: [], practice: emptyPractice() }; }

// Normalize an arbitrary parsed blob into the store shape (tolerant of partial / legacy / cloud
// data). Pure — returns a fresh object; keeps only well-formed phrases + a sane practice record.
export function normalizeSelftalk(o) {
  const base = emptySelftalk();
  if (!o || typeof o !== 'object') return base;
  const phrases = Array.isArray(o.phrases) ? o.phrases.filter((p) => p && p.id && p.jp) : [];
  const pr = o.practice && typeof o.practice === 'object' ? o.practice : {};
  return {
    phrases,
    practice: {
      lastDay: typeof pr.lastDay === 'string' ? pr.lastDay : null,
      streak: Number.isFinite(pr.streak) ? pr.streak : 0,
      doneToday: Array.isArray(pr.doneToday) ? pr.doneToday : [],
    },
  };
}

// Hydrate state.selftalkStore from localStorage. Call once at boot, before any reader.
export function loadSelftalk() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  state.selftalkStore = normalizeSelftalk(o);
  return state.selftalkStore;
}

// Persist to localStorage only (instant, offline-safe). save() additionally schedules the
// debounced cloud push when signed in (via the sync bus → cloud.js). Splitting them lets
// cloud-hydration write localStorage WITHOUT re-pushing the same bytes back.
export function saveSelftalkLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state.selftalkStore)); } catch (e) {}
}
export function saveSelftalk() {
  saveSelftalkLocal();
  sync.selftalk();
}

// True when there's anything worth seeding the cloud from on a fresh account.
export function hasLocalSelftalk() {
  const s = state.selftalkStore || {};
  return !!((s.phrases && s.phrases.length) || (s.practice && s.practice.lastDay));
}
