// 独り言 Self-Talk — speaking-mode lifecycle: the navbar #navExtra bar (via the shared
// createSpeakingBar controller, the same one Minna + Songs drive) + the tab-leave / browser-tab-hidden
// mic release. Recording is account-gated (takes are private/per-user) + capability-gated; the take
// cache for the reserved SELFTALK_SCOPE is fetched once per session on first enter (S.recordingsLoaded).
import { RECORD_SUPPORTED, exitSpeakingMode } from '../record-compare.js';
import { createSpeakingBar, clearSpeakingBar, releaseMicIfHidden } from '../speaking-bar.js';
import { account } from '../cloud-core.js';
import { S, SELFTALK_SCOPE } from './state.js';
import { renderSelftalk } from './view.js';

export function renderNavSpeaking() {
  createSpeakingBar({
    shouldShow: () => RECORD_SUPPORTED && !!account,
    render: () => renderSelftalk(),   // re-render so the per-phrase record controls + bar appear
    scope: SELFTALK_SCOPE,
    isLoaded: () => S.recordingsLoaded,
    markLoaded: () => { S.recordingsLoaded = true; },
  }).mount();
}

// Auto-exit when navigating away from the tab (chrome.js leaveSelftalk → main.js), so the mic
// never lingers. Mirrors minna.js onMinnaHidden.
export function onSelftalkHidden() { exitSpeakingMode(); clearSpeakingBar(); S.stTopic = null; }

// Release the mic when the BROWSER tab is hidden while speaking — but only if Self-Talk is the
// active panel (don't fight Minna's own visibilitychange handler; releaseMicIfHidden's exit is idempotent).
export function handleBrowserTabHidden() {
  const active = () => { const p = document.getElementById('panel-selftalk'); return !!p && p.classList.contains('active'); };
  if (releaseMicIfHidden(active)) renderSelftalk();   // repaint the toggle/controls to the released state
}
