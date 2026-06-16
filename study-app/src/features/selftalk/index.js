// 独り言 SELF-TALK tab — package orchestrator. Narrate your day out loud. Owns the lifecycle
// (initSelftalk) — the once-attached delegated click/pointer/keydown handlers on #panel-selftalk +
// the authoring-modal wiring + the boot hydrate/refresh — and re-exports the package's public API.
// Each concern lives in its own sibling module behind this barrel; shared mutable view-state is the
// `S` object in ./state.js (mutated in place — the record-compare/songs pattern). features/selftalk.js
// is a thin re-export of this file, so main.js + cloud.js import unchanged. The modules form
// runtime-only import cycles (view⇄speaking re-import renderSelftalk), fine like cloud⇄minna.
//
// Self-Talk is ANON-READABLE (built-in phrases are public sentence-store rows fetched at runtime, NOT
// shipped in the bundle); authoring AND recording need an account. Reuses the record-and-compare
// engine via a reserved numeric SELFTALK_SCOPE + synth-only references. See SELFTALK.md.
import { cyclePick } from '../../core/index.js';
import { playItem, cycleMod } from '../audio.js';
import { loadSelftalk } from '../../persistence/selftalk.js';
import { setOnTakeSaved } from '../record-compare.js';
import { S, SELFTALK_SCOPE } from './state.js';
import { warmPhrasesFromCache, refreshPhrases, maybeMaterialize } from './store.js';
import { renderSelftalk, drillTopic, toggleGrammar, repaintTemplateCard, closeSlotMenus, openSlotMenu } from './view.js';
import { markPracticed, reflectPracticed } from './practice.js';
import { openPhraseModal, closePhraseModal, savePhrase, deletePhrase } from './authoring.js';
import { handleBrowserTabHidden } from './speaking.js';

export function initSelftalk() {
  loadSelftalk();
  warmPhrasesFromCache();   // warm from the last good fetch so the first paint isn't blank
  // Background refresh at boot so the cache is fresh; re-render if the tab is already showing.
  refreshPhrases().then((changed) => {
    const panel = document.getElementById('panel-selftalk');
    if (changed && panel && panel.classList.contains('active')) renderSelftalk();
  });
  // Record a practice mark when a Self-Talk take is saved (engine host hook; ignores Minna takes).
  // Also materialize the recorded template combo (no-op for a plain phrase) — recording is the
  // strongest "I used this combo" signal, and it's already account-gated.
  setOnTakeSaved((scope, itemKey) => { if (scope === SELFTALK_SCOPE) { markPracticed(itemKey); reflectPracticed(itemKey); maybeMaterialize(itemKey); } });
  document.addEventListener('visibilitychange', handleBrowserTabHidden);

  const panel = document.getElementById('panel-selftalk');
  if (panel && !panel.dataset.stWired) {
    panel.dataset.stWired = '1';
    panel.addEventListener('click', (e) => {
      const play = e.target.closest('[data-play]');
      if (play) {
        playItem({ text: play.dataset.text || '' }, 'selftalk', play, { cycle: cycleMod(e) });
        const card = play.closest('.st-phrase');
        if (card) maybeMaterialize(card.dataset.id);   // template combo → materialize on first play (no-op for phrases)
        return;
      }
      const mark = e.target.closest('[data-stdone]');
      if (mark) { const card = mark.closest('.st-phrase'); if (card) { markPracticed(card.dataset.id); reflectPracticed(card.dataset.id); } return; }
      const ed = e.target.closest('[data-stedit]');
      if (ed) { const card = ed.closest('.st-phrase'); if (card) openPhraseModal(card.dataset.id); return; }
      const add = e.target.closest('[data-stadd]');
      if (add) { openPhraseModal(null); return; }
      const signin = e.target.closest('[data-stsignin]');
      if (signin) { document.getElementById('accountBtn').click(); return; }   // anon → open the sign-in modal
      const gram = e.target.closest('[data-stgram]');
      if (gram) { toggleGrammar(gram.dataset.stgram); return; }
      const topicCell = e.target.closest('[data-st-topic]');
      if (topicCell) { drillTopic(topicCell.dataset.stTopic); return; }
      const back = e.target.closest('[data-st-back]');
      if (back) { drillTopic(null); return; }
      // ---- slot-swap templates: pick from the menu / cycle / open menu / shuffle ----
      const pick = e.target.closest('[data-st-pick]');
      if (pick) {
        const card = pick.closest('.st-template'); if (!card) return;
        S.tplPicks[card.dataset.id] = { ...(S.tplPicks[card.dataset.id] || {}), [pick.dataset.stPick]: Number(pick.dataset.fill) || 0 };
        closeSlotMenus(card); repaintTemplateCard(card); return;
      }
      const slot = e.target.closest('[data-st-slot]');
      if (slot) {
        if (S.lpFired) { S.lpFired = false; return; }      // long-press already opened the menu
        const card = slot.closest('.st-template'); if (!card) return;
        const tpl = S.storeTemplates.find((t) => t.id === card.dataset.id); if (!tpl) return;
        if (cycleMod(e)) { openSlotMenu(slot); return; }   // ⌥/⇧-click → all options
        S.tplPicks[tpl.id] = cyclePick(tpl, S.tplPicks[tpl.id] || {}, slot.dataset.stSlot);
        closeSlotMenus(card); repaintTemplateCard(card); return;
      }
      const shuffle = e.target.closest('[data-st-shuffle]');
      if (shuffle) {
        const card = shuffle.closest('.st-template'); if (!card) return;
        const tpl = S.storeTemplates.find((t) => t.id === card.dataset.id); if (!tpl) return;
        const next = {};
        for (const s of tpl.slots || []) next[s.id] = Math.floor(Math.random() * ((s.fillers || []).length || 1));
        S.tplPicks[tpl.id] = next; closeSlotMenus(card); repaintTemplateCard(card); return;
      }
    });
    // Long-press a slot chip = the touch equivalent of ⌥-click (opens its filler menu); the ensuing
    // click is suppressed via S.lpFired so it doesn't also cycle.
    let lpTimer = null;
    const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
    panel.addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.st-slot'); if (!chip) return;
      S.lpFired = false;
      lpTimer = setTimeout(() => { S.lpFired = true; openSlotMenu(chip); }, 450);
    });
    panel.addEventListener('pointerup', clearLp);
    panel.addEventListener('pointercancel', clearLp);
    panel.addEventListener('pointerleave', clearLp);
    // Click outside an open filler menu (and not on a chip) closes it.
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('.st-slot-menu') || e.target.closest('.st-slot')) return;
      closeSlotMenus(document);
    });
  }
  // Authoring modal (#stPhraseModal): close / backdrop / Escape / submit / delete — wired once.
  const modal = document.getElementById('stPhraseModal');
  if (modal && !modal.dataset.stWired) {
    modal.dataset.stWired = '1';
    document.getElementById('stPhClose').addEventListener('click', closePhraseModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closePhraseModal(); });
    document.getElementById('stPhForm').addEventListener('submit', savePhrase);
    document.getElementById('stPhDelete').addEventListener('click', deletePhrase);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('show')) closePhraseModal(); });
  }
}

// ---- public API (the names main.js + cloud.js import via the features/selftalk.js re-export) ----
export { renderSelftalk, showSelftalk } from './view.js';
export { refreshPhrases, refreshTemplates } from './store.js';
export { onSelftalkHidden } from './speaking.js';
