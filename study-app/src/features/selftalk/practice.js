// 独り言 Self-Talk — practice signal (the streak + "said today" mark). This is the only persisted
// Self-Talk state (state.selftalkStore.practice, synced under the 'selftalk' app key); reps, not SRS.
// Marking is fired from the ✓ button AND from a saved record-compare take (the take-saved hook in
// index.js) — recording a phrase counts as saying it.
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import { applyPractice } from '../../core/index.js';
import { saveSelftalk } from '../../persistence/selftalk.js';
import { renderHead, doneSlotHtml } from './view.js';

export function markPracticed(id) {
  state.selftalkStore.practice = applyPractice(state.selftalkStore.practice, id, localDay());
  saveSelftalk();
}

// Light in-place UI update after a practice mark — refresh the streak chip + flip the one card's
// ✓, WITHOUT a body re-render (which would tear down an in-flight record control / compare).
export function reflectPracticed(id) {
  renderHead();
  const card = [...document.querySelectorAll('.st-phrase')].find((c) => c.dataset.id === id);
  if (card) {
    card.classList.add('practiced');
    const slot = card.querySelector('.st-done-slot');
    if (slot) slot.innerHTML = doneSlotHtml(true);
  }
}
