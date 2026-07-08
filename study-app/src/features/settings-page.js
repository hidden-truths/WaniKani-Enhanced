// SETTINGS PAGE (modal). Each control writes `settings` + saveSettings() (which persists,
// applies furigana, and schedules a cloud push). renderSettings() paints the active chips
// from `settings` and is also called after a cloud pull.
import { settings, saveSettings } from '../settings-store.js';
import { clampKeep, escapeHtml, AUDIO_CONTEXTS, AUDIO_CONTEXT_LABELS, AUDIO_KIND_LABELS, DEFAULT_AUDIO_PREFS, parseAudioToken, voiceLabel, isSynthVoice, resolveVariant } from '../core/index.js';
import { previewVoice, PREVIEW_SAMPLE, fetchAvailableVoices } from './audio.js';
import { paintPrefChips } from './deck.js';
import { session, renderExample } from './flashcard.js';
import { account } from './cloud-core.js';

// ---------- per-context voice-priority editor (audio-unify Phase 2) ----------
// For each context (Reviews / Browsing / Textbook study / Self-talk / Songs) the user orders the voices to try; the shared
// player (features/audio.js) picks the first one available per item. Tokens are specific voices
// or kinds (see core/audio.js). Stored in settings.audioPrefs[context]; a context with no saved
// list shows (and edits from) its DEFAULT_AUDIO_PREFS.
const VOICE_TOKENS = ['kind:native', 'siri:female', 'siri:male', 'google', 'kind:tts', 'kind:user'];
function tokenLabel(token) {
  const t = parseAudioToken(token);
  if (!t) return token;
  return t.type === 'kind' ? (AUDIO_KIND_LABELS[t.kind] || t.kind) : voiceLabel(t.voice);
}
function listFor(ctx) { const p = settings.audioPrefs && settings.audioPrefs[ctx]; return Array.isArray(p) && p.length ? p.slice() : DEFAULT_AUDIO_PREFS[ctx].slice(); }
// Availability hinting (④): the set of synth voice ids the server has pre-generated, loaded once and
// cached. null = not loaded / unknown (fail open: no dimming). A specific synth voice token absent
// from the set is annotated "not generated yet" — it would fall through to the Google clip.
let availVoices = null, availTried = false;
function ensureAvailVoices() {
  if (availTried) return;
  availTried = true;
  fetchAvailableVoices().then((set) => { if (set) { availVoices = set; renderVoicePrefs(); } });
}
// True when `token` names a specific synth voice that the server hasn't pre-generated yet.
function isUngenerated(token) {
  if (!availVoices) return false;   // unknown → don't dim
  const t = parseAudioToken(token);
  return !!(t && t.type === 'voice' && isSynthVoice(t.voice) && !availVoices.has(t.voice));
}
// Which concrete synth voice a row's ▶ should audition, or null when the row has no sample (native /
// user — those depend on a specific recorded word, not the sample). A specific synth voice previews
// itself; 'kind:tts' (Synthesized-any) previews the synth voice this context actually resolves to.
function previewVoiceFor(ctx, token) {
  const t = parseAudioToken(token);
  if (!t) return null;
  if (t.type === 'voice') return isSynthVoice(t.voice) ? t.voice : null;
  if (t.kind === 'tts') { const r = resolveVariant(ctx, { tts: true }, settings.audioPrefs); return (r && r.voice) || 'google'; }
  return null;
}
function setList(ctx, list) { settings.audioPrefs = settings.audioPrefs || {}; settings.audioPrefs[ctx] = list; saveSettings(); }
function resetCtx(ctx) { if (settings.audioPrefs) delete settings.audioPrefs[ctx]; saveSettings(); }

function renderVoicePrefs() {
  const root = document.getElementById('setVoices');
  if (!root) return;
  ensureAvailVoices();
  root.innerHTML = AUDIO_CONTEXTS.map((ctx) => {
    const list = listFor(ctx);
    const custom = !!(settings.audioPrefs && settings.audioPrefs[ctx]);
    const items = list.map((tok, i) => {
      const pv = previewVoiceFor(ctx, tok);
      const preview = pv
        ? `<button class="voice-op voice-preview" type="button" data-prev="${pv}" aria-label="Preview ${escapeHtml(tokenLabel(tok))}" title="Preview ${escapeHtml(tokenLabel(tok))} (${escapeHtml(PREVIEW_SAMPLE)})">▶</button>`
        : `<button class="voice-op voice-preview" type="button" disabled aria-label="No sample to preview" title="No sample for this kind — it depends on the specific word">▶</button>`;
      const ungen = isUngenerated(tok);
      const note = ungen ? `<span class="voice-note" title="Not pre-generated yet — plays the Google fallback until generated">· not generated</span>` : '';
      return `<li class="voice-item${ungen ? ' voice-ungen' : ''}">
        <span class="voice-left">${preview}<span class="voice-tok">${escapeHtml(tokenLabel(tok))}</span>${note}</span>
        <span class="voice-ops">
          <button class="voice-op" type="button" data-op="up" data-ctx="${ctx}" data-i="${i}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>▲</button>
          <button class="voice-op" type="button" data-op="down" data-ctx="${ctx}" data-i="${i}" aria-label="Move down"${i === list.length - 1 ? ' disabled' : ''}>▼</button>
          <button class="voice-op voice-del" type="button" data-op="del" data-ctx="${ctx}" data-i="${i}" aria-label="Remove">×</button>
        </span></li>`;
    }).join('');
    const remaining = VOICE_TOKENS.filter((t) => !list.includes(t));
    const addSel = remaining.length ? `<select class="voice-add" data-ctx="${ctx}" aria-label="Add a voice to ${AUDIO_CONTEXT_LABELS[ctx]}">
        <option value="">+ add a voice…</option>
        ${remaining.map((t) => `<option value="${t}">${escapeHtml(tokenLabel(t))}${isUngenerated(t) ? ' — not generated' : ''}</option>`).join('')}
      </select>` : '';
    return `<div class="voice-ctx" data-ctx="${ctx}">
        <div class="voice-ctx-head"><span class="voice-ctx-name">${escapeHtml(AUDIO_CONTEXT_LABELS[ctx])}</span>${custom ? `<button class="voice-reset" type="button" data-reset="${ctx}">Reset</button>` : ''}</div>
        <ol class="voice-list">${items}</ol>${addSel}</div>`;
  }).join('');
}

function applyVoiceOp(ctx, op, i) {
  const list = listFor(ctx);
  if (op === 'up' && i > 0) { const t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; }
  else if (op === 'down' && i < list.length - 1) { const t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; }
  else if (op === 'del') { list.splice(i, 1); }
  else return;
  if (!list.length) resetCtx(ctx); else setList(ctx, list);   // emptied → fall back to the default
  renderVoicePrefs();
}

function wireVoicePrefs() {
  const root = document.getElementById('setVoices');
  if (!root || root.dataset.wired) return;
  root.dataset.wired = '1';
  root.addEventListener('click', (e) => {
    const prev = e.target.closest('.voice-preview');
    if (prev) { if (prev.dataset.prev) previewVoice(prev.dataset.prev, prev); return; }
    const op = e.target.closest('.voice-op');
    if (op) { applyVoiceOp(op.dataset.ctx, op.dataset.op, Number(op.dataset.i)); return; }
    const reset = e.target.closest('[data-reset]');
    if (reset) { resetCtx(reset.dataset.reset); renderVoicePrefs(); }
  });
  root.addEventListener('change', (e) => {
    const add = e.target.closest('.voice-add');
    if (add && add.value) { const ctx = add.dataset.ctx; const list = listFor(ctx); list.push(add.value); setList(ctx, list); renderVoicePrefs(); }
  });
}

export function renderSettings() {
  const seg = (sel, attr, val) => document.querySelectorAll(sel).forEach(b => b.classList.toggle('active', b.dataset[attr] === val));
  seg('.setlv', 'setlv', settings.exampleLevel);
  seg('.setfg', 'setfg', settings.furigana ? 'on' : 'off');
  seg('.setin', 'setin', settings.input);
  seg('.setau', 'setau', settings.audio);
  seg('.setfr', 'setfr', settings.freeReviewDue ? 'on' : 'off');
  seg('.settr', 'settr', settings.trimSilence ? 'on' : 'off');
  const keep = document.getElementById('setRecKeep'); if (keep) keep.value = clampKeep(settings.recordingsKeep);
  renderVoicePrefs();
  const foot = document.getElementById('settingsFoot');
  if (foot) foot.textContent = account ? ('Synced to ' + account.email) : 'Sign in to sync these across your devices.';
}
function openSettings() { availTried = false; renderSettings(); document.getElementById('settingsModal').classList.add('show'); }
function closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }

export function initSettingsPage() {
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('settingsClose').addEventListener('click', closeSettings);
  document.getElementById('settingsModal').addEventListener('click', e => { if (e.target.id === 'settingsModal') closeSettings(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('settingsModal').classList.contains('show')) closeSettings(); });
  document.getElementById('setLevel').addEventListener('click', e => { const b = e.target.closest('.setlv'); if (!b) return; settings.exampleLevel = b.dataset.setlv; saveSettings(); renderSettings(); if (session && document.getElementById('fcStage').classList.contains('active')) renderExample(session.deck[session.i]); });
  document.getElementById('setFuri').addEventListener('click', e => { const b = e.target.closest('.setfg'); if (!b) return; settings.furigana = b.dataset.setfg === 'on'; saveSettings(); renderSettings(); });
  document.getElementById('setInput').addEventListener('click', e => { const b = e.target.closest('.setin'); if (!b) return; settings.input = b.dataset.setin; saveSettings(); paintPrefChips(); renderSettings(); });
  document.getElementById('setAudio').addEventListener('click', e => { const b = e.target.closest('.setau'); if (!b) return; settings.audio = b.dataset.setau; saveSettings(); paintPrefChips(); renderSettings(); });
  document.getElementById('setFreeDue').addEventListener('click', e => { const b = e.target.closest('.setfr'); if (!b) return; settings.freeReviewDue = b.dataset.setfr === 'on'; saveSettings(); renderSettings(); });
  const keep = document.getElementById('setRecKeep');
  if (keep) keep.addEventListener('change', () => { settings.recordingsKeep = clampKeep(keep.value); saveSettings(); renderSettings(); });
  document.getElementById('setTrim').addEventListener('click', e => { const b = e.target.closest('.settr'); if (!b) return; settings.trimSilence = b.dataset.settr === 'on'; saveSettings(); renderSettings(); });
  // Self-service recovery for a stale/empty read-through cache: drop the server-content caches
  // (examples/songs/self-talk/grammar — all wiped-safe) and reload to re-fetch. Progress, custom
  // cards, settings and the account cookie live in other keys and are left alone.
  const clearBtn = document.getElementById('clearCacheBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (!confirm('Clear cached content and reload? Your progress and account are untouched — this only re-fetches example sentences, songs, self-talk and grammar from the server.')) return;
    ['jpverbs_examples_cache', 'jpverbs_selftalk_cache', 'jpverbs_selftalk_templates_cache', 'jpverbs_songs_cache', 'jpverbs_grammar_cache']
      .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    location.reload();
  });
  wireVoicePrefs();
}
