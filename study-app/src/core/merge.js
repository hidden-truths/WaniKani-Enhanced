// Per-blob conflict mergers for the cloud sync layer (E1). When a debounced PUT /v1/progress/{app}
// loses an optimistic-concurrency race (HTTP 409 — another device wrote since our base), the old
// behavior was server-WINS: adopt the server copy and DROP this device's unsynced change. These pure
// functions instead UNION the two copies so neither side's offline work is lost; createSyncedBlob
// (features/synced-blob.js) calls the registered merge() on a 409, applies the union, and re-pushes.
//
// Design rules, applied throughout:
//   • No data loss: every key/card/session present on either side survives.
//   • No inflation: where a value could double-count a shared base across REPEATED reconciles
//     (lifetime counts, daily tallies) we take max(), not sum() — a 409 can recur, and summing each
//     time would runaway. The cost is a slight under-count on a genuine concurrent split, which is
//     the safe direction for a study-stats number.
//   • Pure + DOM-free (the test imports them directly); tolerant of null/partial input (reconcile
//     may pass either side as null/{}), always returning a well-formed blob.
//
// "local" is THIS device's current copy (read()); "server" is the other device's copy carried on the
// 409 body. On a true per-key edit conflict (no timestamp to order them) LOCAL wins — the device
// actively syncing is acting on the user's most recent intent.

const keysOf = (o) => Object.keys(o || {});
const union = (a, b) => new Set([...keysOf(a), ...keysOf(b)]);

// progress ('verbs'): { cards:{<rank>:{attempts,right,wrong,box,due}}, sessions:[{t,right,tot}], daily:{<day>:{right,tot}} }
// Per card keep the furthest SRS progress (max box + the later due) and the higher lifetime counts;
// keep the longer rolling-attempts window. Sessions concat + dedup by `t` (cap 1000, newest, matching
// the live store). Daily takes the per-day max.
export function mergeProgress(local, server) {
  const a = local || {}, b = server || {};
  const cards = {};
  for (const rank of union(a.cards, b.cards)) {
    const x = (a.cards || {})[rank], y = (b.cards || {})[rank];
    if (!x || !y) { cards[rank] = x || y; continue; }
    const xa = Array.isArray(x.attempts) ? x.attempts : [];
    const ya = Array.isArray(y.attempts) ? y.attempts : [];
    cards[rank] = {
      attempts: xa.length >= ya.length ? xa : ya,    // the longer rolling history (drives accuracy/leech)
      right: Math.max(x.right || 0, y.right || 0),
      wrong: Math.max(x.wrong || 0, y.wrong || 0),
      box: Math.max(x.box || 0, y.box || 0),          // furthest SRS progress
      due: Math.max(x.due || 0, y.due || 0),          // later due (consistent with the higher box)
    };
    // `last` (most-recent grade, epoch ms — the 法 checklist row's signal) merges with max;
    // this field list is explicit, so omitting it here would silently drop it on every 409.
    const last = Math.max(x.last || 0, y.last || 0);
    if (last) cards[rank].last = last;
  }
  const seen = new Set();
  const sessions = [];
  for (const s of [...(a.sessions || []), ...(b.sessions || [])]) {
    if (!s || seen.has(s.t)) continue;
    seen.add(s.t);
    sessions.push(s);
  }
  sessions.sort((p, q) => (p.t || 0) - (q.t || 0));
  const daily = {};
  for (const day of union(a.daily, b.daily)) {
    const x = (a.daily || {})[day] || {}, y = (b.daily || {})[day] || {};
    daily[day] = { right: Math.max(x.right || 0, y.right || 0), tot: Math.max(x.tot || 0, y.tot || 0) };
  }
  return { cards, sessions: sessions.slice(-1000), daily };
}

// custom-verbs: { seq:<monotonic rank counter>, verbs:[<card + {rank}>] }
// Union the cards by rank (local wins a same-rank edit); seq is the max so the monotonic counter
// never goes backward — a rank is never reused (the load-bearing custom-verb invariant).
export function mergeCustomVerbs(local, server) {
  const a = local || {}, b = server || {};
  const byRank = new Map();
  for (const v of (b.verbs || [])) if (v && v.rank != null) byRank.set(v.rank, v);   // server base
  for (const v of (a.verbs || [])) if (v && v.rank != null) byRank.set(v.rank, v);   // local wins on conflict
  return {
    seq: Math.max(a.seq || 100, b.seq || 100),
    verbs: [...byRank.values()].sort((x, y) => (x.rank || 0) - (y.rank || 0)),
  };
}

// minna: { notes:{<lesson>:string}, lastLesson:<n>, overlays:{<rank>:{…}}, clips:{<lesson>:{<idx>:[s,e]}} }
// Shallow key-union for notes + overlays (local wins per key); clips union nested per lesson→line.
// lastLesson is a view-cursor → keep this device's.
export function mergeMinna(local, server) {
  const a = local || {}, b = server || {};
  const clips = {};
  for (const lesson of union(a.clips, b.clips)) {
    clips[lesson] = { ...((b.clips || {})[lesson] || {}), ...((a.clips || {})[lesson] || {}) };
  }
  return {
    notes: { ...(b.notes || {}), ...(a.notes || {}) },
    overlays: { ...(b.overlays || {}), ...(a.overlays || {}) },
    clips,
    lastLesson: a.lastLesson != null ? a.lastLesson : b.lastLesson,
  };
}

// selftalk: { practice:{ lastDay:'YYYY-MM-DD'|null, streak:int, doneToday:[id…] } }
// Keep the longer streak and the later day; union doneToday only when both sides are on that day.
export function mergeSelftalkPractice(local, server) {
  const a = (local && local.practice) || {}, b = (server && server.practice) || {};
  const lastDay = a.lastDay && b.lastDay ? (a.lastDay >= b.lastDay ? a.lastDay : b.lastDay) : (a.lastDay || b.lastDay || null);
  let doneToday;
  if (a.lastDay && a.lastDay === b.lastDay) doneToday = [...new Set([...(a.doneToday || []), ...(b.doneToday || [])])];
  else doneToday = ((lastDay === a.lastDay ? a.doneToday : b.doneToday) || []).slice();
  return { practice: { lastDay, streak: Math.max(a.streak || 0, b.streak || 0), doneToday } };
}

// songs: { progress:{ "<extId>":{ starred:[ord…], shadowed:[ord…], lastMode? } } }
// starred/shadowed are monotonic "I did this line" SETS — union them (no inflation risk: a repeated
// reconcile re-unions the same ordinals idempotently, unlike a count). lastMode is a view cursor →
// keep this device's (local wins), matching mergeMinna's lastLesson. Sorted for deterministic output.
export function mergeSongs(local, server) {
  const a = (local && local.progress) || {}, b = (server && server.progress) || {};
  const progress = {};
  for (const id of union(a, b)) {
    const x = a[id] || {}, y = b[id] || {};
    const ords = (p, q) => [...new Set([...(p || []), ...(q || [])])].sort((m, n) => m - n);
    const entry = { starred: ords(x.starred, y.starred), shadowed: ords(x.shadowed, y.shadowed) };
    const lastMode = x.lastMode != null ? x.lastMode : y.lastMode;   // local cursor wins
    if (lastMode != null) entry.lastMode = lastMode;
    progress[id] = entry;
  }
  return { progress };
}
