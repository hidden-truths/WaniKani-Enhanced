// 独り言 Self-Talk — DATA layer. Owns the read-through caches + server refresh for phrases AND
// slot-swap templates, the optimistic local-set mutators (authoring), the phrase/template-set
// accessors (raw → +legacy → grammar-filtered), the grammar-label lookup, and the lazy
// materialization of played/recorded template combos. Everything that reads or writes the live
// phrase/template sets lives here; view + authoring call these. State is the shared `S`.
import { state } from '../../state.js';
import { sentenceToPhrase, comboRole } from '../../core/index.js';
import { SELFTALK_GRAMMAR } from '../../data/selftalk.js';
import { account, api } from '../cloud-core.js';
import { createReadThroughCache } from '../../persistence/cache.js';
import { S } from './state.js';

// Phrases + templates come from the unified sentence store (GET /v1/sentences?ownerType=selftalk,
// GET /v1/templates): built-in public rows for everyone plus the signed-in user's own private rows.
// We keep the last good fetch in localStorage as a READ-THROUGH cache so the tab still renders if the
// fetch fails (offline / server down). The bundled data/selftalk.js + data/selftalk-templates.js are
// the seed sources for scripts/seed-sentences.ts, no longer read at runtime.
const phraseCache = createReadThroughCache({ key: 'jpverbs_selftalk_cache' });
const templateCache = createReadThroughCache({ key: 'jpverbs_selftalk_templates_cache' });

// Warm the in-memory sets from the last good fetch so the first paint isn't blank (boot / tab open).
export function warmPhrasesFromCache() { S.storePhrases = phraseCache.read(); }
export function warmTemplatesFromCache() { S.storeTemplates = templateCache.read(); }

// Refresh storePhrases from the store + update the cache. Degrades to the cache on failure so the
// tab never goes blank from a network hiccup. Returns true on a successful network refresh.
export async function refreshPhrases() {
  try {
    const r = await api('/v1/sentences?ownerType=selftalk&annotate=1');
    S.storePhrases = ((r && r.sentences) || []).map(sentenceToPhrase);
    phraseCache.write(S.storePhrases);
    return true;
  } catch (e) {
    if (!S.storePhrases.length) S.storePhrases = phraseCache.read();   // offline first load → fall back to cache
    return false;
  }
}

// Refresh storeTemplates from the store + update the cache. Degrades to the cache on failure so the
// slot-swap cards never vanish from a network hiccup. Returns true on a successful network refresh.
export async function refreshTemplates() {
  try {
    const r = await api('/v1/templates?source=selftalk');
    S.storeTemplates = (r && r.templates) || [];
    templateCache.write(S.storeTemplates);
    return true;
  } catch (e) {
    if (!S.storeTemplates.length) S.storeTemplates = templateCache.read();   // offline first load → fall back to cache
    return false;
  }
}

// Optimistic local-set mutators: authoring updates storePhrases + the cache immediately so the UI
// reflects the change before the API write confirms (the usr-<uuid> id is final from birth, so
// there's no temp-id reconciliation).
export function upsertLocalPhrase(phrase) {
  const i = S.storePhrases.findIndex((p) => p.id === phrase.id);
  if (i >= 0) S.storePhrases[i] = phrase; else S.storePhrases.push(phrase);
  phraseCache.write(S.storePhrases);
}
export function removeLocalPhrase(id) {
  S.storePhrases = S.storePhrases.filter((p) => p.id !== id);
  phraseCache.write(S.storePhrases);
}

// Templates for one topic id (the curated set is small, so a linear scan is fine).
export function templatesForTopic(topicId) {
  return S.storeTemplates.filter((t) => t.topic === topicId);
}

export const grammarLabel = (id) => (SELFTALK_GRAMMAR.find((g) => g.id === id) || {}).label || id;

// The phrase set to render: the store fetch/cache (built-ins + the user's own private rows). Until
// the legacy migration runs (on sign-in), any phrases still in the local `selftalk` blob are
// concatenated so a user's existing authored lines don't vanish — de-duped by id (the store wins).
export function allPhrases() {
  const legacy = (state.selftalkStore && state.selftalkStore.phrases) || [];
  if (!legacy.length) return S.storePhrases;
  const have = new Set(S.storePhrases.map((p) => p.id));
  return S.storePhrases.concat(legacy.filter((p) => !have.has(p.id)));
}
// The phrase set after the cross-cutting grammar filter (ANY selected token; empty = all). Both the
// grid and the drilled-in topic view start here; the today/topic narrowing happens per-view.
export function filteredPhrases() {
  const list = allPhrases();
  return S.stGrammar.length ? list.filter((p) => (p.grammar || []).some((g) => S.stGrammar.includes(g))) : list;
}
// The slot-swap templates passing the grammar filter (each carries `topic`/`thought`/`id`, so they
// count + group exactly like phrases). Used both for the grid tally and the drilled-in topic merge.
export function filteredTemplates() {
  return S.stGrammar.length ? S.storeTemplates.filter((t) => (t.grammar || []).some((g) => S.stGrammar.includes(g))) : S.storeTemplates;
}

// ---- lazy materialization of template combos (Slice 2) ----
// First time a signed-in user PLAYS or RECORDS a template combo, materialize it as a public
// `sentence` row server-side so the store tooling (NLP tap-to-lookup, TTS pre-gen, grammar search,
// export, de-dup) covers the combos people actually use. We send ONLY the picks — the server
// reconstructs the realized text/furigana/English from the stored skeleton (it's authoritative; the
// client can't materialize a row whose text doesn't match the curated template). Fire-and-forget,
// account-gated (it writes the PUBLIC corpus; anon just keeps playing via the lazy TTS path).
// Record-compare still keys on the SKELETON id — this never touches practice/takes. Deduped per
// session by the canonical combo key so cycling/replaying a combo POSTs at most once.
export function maybeMaterialize(id) {
  if (!account) return;                                   // public-corpus write → signed-in only
  const tpl = S.storeTemplates.find((t) => t.id === id);
  if (!tpl) return;                                       // a phrase, not a template — nothing to do
  // comboRole is the SAME string the server writes as sentence_link.role (pinned by the alignment
  // test), so this per-session dedup key matches the server's reuse-by-(owner, role) idempotency.
  const key = id + '|' + comboRole(tpl, S.tplPicks[id] || {});
  if (S.materializedCombos.has(key)) return;             // already sent this combo this session
  S.materializedCombos.add(key);
  api('/v1/templates/' + encodeURIComponent(id) + '/realize', { method: 'POST', body: { picks: S.tplPicks[id] || {} }, retry: true })   // idempotent by hash
    .catch(() => S.materializedCombos.delete(key));       // failed write → let it retry next time
}
