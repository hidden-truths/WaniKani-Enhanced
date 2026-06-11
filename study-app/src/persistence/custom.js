// CUSTOM-VERB storage (user-added cards; synced to the cloud when signed in).
//
// Shape: { seq:<monotonic rank counter, starts at 100>, verbs:[ <verb>, … ] }.
// Each custom verb has the same fields as a baked one plus custom:true, and a rank
// assigned from `seq` (101, 102, …) that is never reused — so progress keyed by rank
// in state.store.cards stays stable across deletes.
//   saveCustomLocal() = localStorage only (used by cloud-pull to avoid re-pushing).
//   saveCustom()      = localStorage + a debounced cloud push (the normal path).
import { sync } from '../sync-bus.js';

const CUSTOM_KEY = 'jpverbs_custom';

export function loadCustom() {
  try { const o = JSON.parse(localStorage.getItem(CUSTOM_KEY)); if (o && Array.isArray(o.verbs)) return o; } catch (e) {}
  return { seq: 100, verbs: [] };
}
export function saveCustomLocal(o) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(o)); } catch (e) {}
}
export function saveCustom(o) {
  saveCustomLocal(o);
  sync.custom();
}
