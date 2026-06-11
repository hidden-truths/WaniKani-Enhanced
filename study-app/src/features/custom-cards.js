// CUSTOM CARDS — add / edit / delete (the #verbModal CRUD) + rebuildData (the live-deck
// rebuild). A custom card gets a rank from a monotonic `seq` (never reused, so progress in
// state.store.cards is stable across deletes) and custom:true. rebuildData() rebuilds
// state.DATA, extends state.MAXRANK + the rank-range UI, and re-runs the chip annotations.
import { state, attachLevels } from '../state.js';
import { VERBS } from '../data/verbs.js';
import { applyMinnaOverlays } from '../core/index.js';
import { loadCustom, saveCustom } from '../persistence/custom.js';
import { save } from '../persistence/store.js';
import { annotateJlptChips, annotateCatChips, annotateSourceChips } from './a11y.js';
import { cfg, updateDeckCount, updateDueBanner } from './deck.js';
import { bcfg, renderBrowse } from './browse.js';
import { renderStats } from './stats.js';

let editingRank = null;   // null = adding a new card; otherwise the rank being edited

// Rebuild state.DATA = built-ins (with Minna overlays merged) + custom cards. applyMinnaOverlays
// merges Minna provenance onto COPIES of matching built-ins (keeping examples/mnemonic/progress).
export function rebuildData() {
  const prevMax = state.MAXRANK;
  state.DATA = applyMinnaOverlays(VERBS.filter(v => !v.skip)).concat(loadCustom().verbs);
  state.MAXRANK = state.DATA.reduce((m, v) => Math.max(m, v.rank), 0) || 100;
  attachLevels();
  ['rmin', 'rmax', 'brmin', 'brmax'].forEach(id => { const el = document.getElementById(id); if (el) el.max = state.MAXRANK; });
  // If a range's max was at the old ceiling ("show everything"), extend it so a freshly-added
  // custom card is included by default; otherwise respect narrowing.
  if (cfg.rmax >= prevMax) { cfg.rmax = state.MAXRANK; const e = document.getElementById('rmax'); if (e) e.value = state.MAXRANK; }
  if (bcfg.rmax >= prevMax) { bcfg.rmax = state.MAXRANK; const e = document.getElementById('brmax'); if (e) e.value = state.MAXRANK; }
  annotateJlptChips(); annotateCatChips(); annotateSourceChips();
}
export function renderCustomCount() {
  const all = loadCustom().verbs;
  const n = all.filter(v => !v.minna).length, m = all.filter(v => v.minna).length;
  const parts = [];
  if (n) parts.push(`<b>${n}</b> custom card${n === 1 ? '' : 's'}`);
  if (m) parts.push(`<b>${m}</b> みんなの日本語`);
  document.getElementById('customCount').innerHTML = parts.join(' · ');
}
// Per-category option lists for the modal's Type select. Verbs use the conjugation classes;
// adjectives reuse the field for the い/な split; nouns/adverbs/phrases have no subtype.
const VF_TYPE_OPTS = {
  verb: [['godan', 'Godan (う-verb)'], ['ichidan', 'Ichidan (る-verb)'], ['irregular', 'Irregular']],
  adjective: [['i-adj', 'い-adjective'], ['na-adj', 'な-adjective']],
};
function setTypeOptions(cat) {
  const sel = document.getElementById('vfType'), cur = sel.value;
  const opts = VF_TYPE_OPTS[cat] || [];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  if (opts.some(o => o[0] === cur)) sel.value = cur;
}
// Show the verb/adjective-only fields (Type, Transitivity) only when they apply.
function syncVerbFields() {
  const cat = document.getElementById('vfCat').value;
  setTypeOptions(cat);
  document.getElementById('vfTypeCell').style.display = VF_TYPE_OPTS[cat] ? '' : 'none';
  document.getElementById('vfTransCell').style.display = cat === 'verb' ? '' : 'none';
}
export function openVerbModal(verb) {
  editingRank = verb ? verb.rank : null;
  document.getElementById('verbTitle').textContent = verb ? 'Edit card' : 'Add a card';
  document.getElementById('verbSubmit').textContent = verb ? 'Save changes' : 'Save card';
  document.getElementById('verbDelete').hidden = !verb;
  document.getElementById('verbErr').textContent = '';
  const g = id => document.getElementById(id);
  g('vfJp').value = verb ? verb.jp : ''; g('vfRead').value = verb ? verb.read : ''; g('vfMean').value = verb ? verb.mean : '';
  g('vfCat').value = verb ? (verb.cat || 'verb') : 'verb';
  syncVerbFields();                                   // rebuild Type options + show/hide before setting values
  g('vfType').value = verb && verb.type ? verb.type : (g('vfType').value);
  g('vfJlpt').value = verb ? verb.jlpt : 'N4';
  g('vfTrans').value = verb ? (verb.trans || '') : '';
  g('vfTags').value = verb ? (verb.tags || []).filter(t => t !== 'custom').join(', ') : '';
  g('vfMnem').value = verb ? (verb.mnem || '') : ''; g('vfTip').value = verb ? (verb.tip || '') : '';
  g('vfExJp').value = verb && verb.ex && verb.ex[0] ? verb.ex[0][0] : '';
  g('vfExEn').value = verb && verb.ex && verb.ex[0] ? verb.ex[0][1] : '';
  document.getElementById('verbModal').classList.add('show');
  setTimeout(() => g('vfJp').focus(), 0);
}
function closeVerbModal() { document.getElementById('verbModal').classList.remove('show'); }
// Re-render every derived view after a custom-card change.
export function refreshAfterVerbChange() {
  renderCustomCount(); renderBrowse(); updateDeckCount(); updateDueBanner();
  if (document.getElementById('panel-stats').classList.contains('active')) renderStats();
}
function saveVerb(e) {
  e.preventDefault();
  const val = id => document.getElementById(id).value.trim();
  const jp = val('vfJp'), read = val('vfRead'), mean = val('vfMean');
  if (!jp || !read || !mean) { document.getElementById('verbErr').textContent = 'Japanese, reading, and meaning are all required.'; return; }
  const tags = val('vfTags').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!tags.includes('custom')) tags.push('custom');
  const exJp = val('vfExJp');
  const cat = val('vfCat');
  // Only verbs+adjectives carry a `type`; only verbs carry transitivity. Store '' for the
  // hidden-field categories so a stale value can't linger.
  const verb = { jp, read, mean, cat, type: VF_TYPE_OPTS[cat] ? val('vfType') : '', jlpt: val('vfJlpt'),
    trans: cat === 'verb' ? val('vfTrans') : '',
    tags, mnem: val('vfMnem'), tip: val('vfTip'), ex: exJp ? [[exJp, val('vfExEn')]] : [], custom: true };
  const cs = loadCustom();
  const existing = editingRank != null ? cs.verbs.findIndex(v => v.rank === editingRank) : -1;
  if (existing >= 0) { verb.rank = editingRank; cs.verbs[existing] = verb; }      // edit in place (keep rank → keep progress)
  else { cs.seq = (cs.seq || 100) + 1; verb.rank = cs.seq; cs.verbs.push(verb); } // new monotonic rank
  saveCustom(cs);
  rebuildData(); closeVerbModal(); refreshAfterVerbChange();
}
export function deleteVerb(rank) {
  const cs = loadCustom();
  cs.verbs = cs.verbs.filter(v => v.rank !== rank);
  saveCustom(cs);
  if (state.store.cards[rank]) { delete state.store.cards[rank]; save(); }   // drop the orphaned progress
  rebuildData(); closeVerbModal(); refreshAfterVerbChange();
}
export function initCustomUI() {
  document.getElementById('addVerbBtn').addEventListener('click', () => openVerbModal(null));
  document.getElementById('verbClose').addEventListener('click', closeVerbModal);
  document.getElementById('vfCat').addEventListener('change', syncVerbFields);   // category drives which fields show
  document.getElementById('verbForm').addEventListener('submit', saveVerb);
  document.getElementById('verbDelete').addEventListener('click', () => { if (editingRank != null && confirm('Delete this custom card? Its progress is also removed.')) deleteVerb(editingRank); });
  document.getElementById('verbModal').addEventListener('click', e => { if (e.target.id === 'verbModal') closeVerbModal(); }); // backdrop
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('verbModal').classList.contains('show')) closeVerbModal(); });
}
