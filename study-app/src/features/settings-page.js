// SETTINGS PAGE (modal). Each control writes `settings` + saveSettings() (which persists,
// applies furigana, and schedules a cloud push). renderSettings() paints the active chips
// from `settings` and is also called after a cloud pull.
import { settings, saveSettings } from '../settings-store.js';
import { clampKeep } from '../core/index.js';
import { paintPrefChips } from './deck.js';
import { session, renderExample } from './flashcard.js';
import { account } from './cloud-core.js';

export function renderSettings() {
  const seg = (sel, attr, val) => document.querySelectorAll(sel).forEach(b => b.classList.toggle('active', b.dataset[attr] === val));
  seg('.setlv', 'setlv', settings.exampleLevel);
  seg('.setfg', 'setfg', settings.furigana ? 'on' : 'off');
  seg('.setin', 'setin', settings.input);
  seg('.setau', 'setau', settings.audio);
  seg('.setfr', 'setfr', settings.freeReviewDue ? 'on' : 'off');
  const keep = document.getElementById('setRecKeep'); if (keep) keep.value = clampKeep(settings.recordingsKeep);
  const foot = document.getElementById('settingsFoot');
  if (foot) foot.textContent = account ? ('Synced to ' + account.email) : 'Sign in to sync these across your devices.';
}
function openSettings() { renderSettings(); document.getElementById('settingsModal').classList.add('show'); }
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
}
