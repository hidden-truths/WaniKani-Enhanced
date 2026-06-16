// 独り言 Self-Talk — authoring (your own phrases). The #stPhraseModal CRUD: open (add / edit),
// close, and the optimistic save/delete against the sentence store. Authoring writes PRIVATE rows,
// so it requires an account (the Add affordance is account-gated; anon gets a sign-in nudge). The
// id being edited is S.editingId (null = adding a new phrase).
import { escapeHtml, phraseToSentence, sentenceToPhrase } from '../../core/index.js';
import { SELFTALK_TAXONOMY, SELFTALK_TOPICS, SELFTALK_GRAMMAR } from '../../data/selftalk.js';
import { account, api, setSyncStatus } from '../cloud-core.js';
import { S, $ } from './state.js';
import { allPhrases, upsertLocalPhrase, removeLocalPhrase } from './store.js';
import { renderSelftalk } from './view.js';

export function openPhraseModal(id) {
  S.editingId = id || null;
  const existing = id ? allPhrases().find((p) => p.id === id) : null;
  $('stPhScene').innerHTML = SELFTALK_TAXONOMY.map((c) =>
    `<optgroup label="${escapeHtml(c.label)}">${c.topics.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join('')}</optgroup>`).join('');
  const sel = new Set(existing ? (existing.grammar || []) : []);
  $('stPhGram').innerHTML = SELFTALK_GRAMMAR.map((g) =>
    `<label class="st-gram-check"><input type="checkbox" value="${escapeHtml(g.id)}"${sel.has(g.id) ? ' checked' : ''}> ${escapeHtml(g.label)}</label>`).join('');
  $('stPhJp').value = existing ? existing.jp : '';
  $('stPhRead').value = existing ? (existing.read || '') : '';
  $('stPhMean').value = existing ? existing.mean : '';
  if (existing) $('stPhScene').value = existing.topic;
  $('stPhTitle').textContent = existing ? 'Edit phrase' : 'Add a phrase';
  $('stPhSubmit').textContent = existing ? 'Save changes' : 'Save phrase';
  $('stPhDelete').hidden = !existing;
  $('stPhErr').textContent = '';
  $('stPhraseModal').classList.add('show');
  $('stPhJp').focus();
}
export function closePhraseModal() { $('stPhraseModal').classList.remove('show'); S.editingId = null; }

function newPhraseId() {
  return 'usr-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.floor(performance.now()).toString(36));
}

// Authoring writes PRIVATE rows to the sentence store via the API, OPTIMISTICALLY: the local set +
// cache update and the UI re-renders immediately, then the write confirms in the background (the
// usr-<uuid> id is final from birth → no reconciliation). A failed write surfaces "⚠ offline" but
// keeps the optimistic local copy. Requires an account (the Add affordance is account-gated).
export async function savePhrase(e) {
  e.preventDefault();
  if (!account) { $('stPhErr').textContent = 'Sign in to save your own phrases.'; return; }
  const jp = $('stPhJp').value.trim(), mean = $('stPhMean').value.trim();
  if (!jp || !mean) { $('stPhErr').textContent = 'Japanese and English are required.'; return; }
  const editing = S.editingId;
  const body = phraseToSentence({
    id: editing || newPhraseId(),
    jp, read: $('stPhRead').value.trim(), mean,
    topic: $('stPhScene').value || SELFTALK_TOPICS[0].id,
    grammar: [...document.querySelectorAll('#stPhGram input:checked')].map((c) => c.value),
  });
  upsertLocalPhrase(sentenceToPhrase({ ...body, custom: true }));   // optimistic
  closePhraseModal();
  renderSelftalk();
  try {
    if (editing) await api('/v1/sentences/' + encodeURIComponent(body.id), { method: 'PUT', body: omitId(body) });
    else await api('/v1/sentences', { method: 'POST', body, retry: true });   // idempotent by ext_id
    setSyncStatus('✓ saved');
  } catch (err) { setSyncStatus('⚠ offline'); }
}
function omitId({ id, ...rest }) { return rest; }   // PUT carries the id in the path, not the body

export async function deletePhrase() {
  if (!S.editingId) return;
  const id = S.editingId;
  removeLocalPhrase(id);   // optimistic
  closePhraseModal();
  renderSelftalk();
  try { await api('/v1/sentences/' + encodeURIComponent(id), { method: 'DELETE' }); setSyncStatus('✓ deleted'); }
  catch (err) { setSyncStatus('⚠ offline'); }
}
