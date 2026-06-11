// EXPORT / IMPORT — the no-account bridge for moving progress between browsers/devices.
// Export downloads the whole state.store as pretty JSON via a temporary object-URL anchor.
// Import validates loosely (must be an object with a `cards` key), confirms before
// overwriting, then rebuilds the derived UI. The file input is reset in `finally` so
// re-importing the same file re-fires the change event.
import { state } from '../state.js';
import { localDay } from '../config.js';
import { save } from '../persistence/store.js';
import { updateDeckCount, updateDueBanner } from './deck.js';
import { renderBrowse } from './browse.js';
import { renderStats } from './stats.js';

export function initExportImport() {
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'japanese-verbs-progress-' + localDay() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (typeof data !== 'object' || !data.cards) { throw new Error('Not a valid progress file'); }
        if (!confirm('Replace your current progress with the imported data? This overwrites existing stats.')) return;
        state.store = { cards: data.cards || {}, sessions: data.sessions || [], daily: data.daily || {} };
        save();
        updateDeckCount(); updateDueBanner(); renderBrowse();
        if (document.getElementById('panel-stats').classList.contains('active')) renderStats();
        alert('Progress imported.');
      } catch (err) { alert('Import failed: ' + err.message); }
      finally { e.target.value = ''; }
    };
    reader.readAsText(file);
  });
}
