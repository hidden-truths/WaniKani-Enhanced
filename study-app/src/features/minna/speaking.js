// The navbar speaking-bar dock + the browser-tab mic release for みんなの日本語. Minna is the
// "primary" speaking surface (Self-Talk/Songs guard against fighting it), so its visibilitychange
// release is unguarded. renderMinnaLesson is re-imported from view.js at runtime (the speaking⇄view
// cycle, fine — the references only fire inside callbacks).
import { state } from '../../state.js';
import { isSpeakingMode, exitSpeakingMode } from '../record-compare.js';
import { createSpeakingBar, clearSpeakingBar, releaseMicIfHidden } from '../speaking-bar.js';
import { renderMinnaLesson } from './view.js';

// Fill the navbar #navExtra dock with the speaking/compare controls via the shared controller (the
// same one Self-Talk + Songs use). Re-mounted per lesson render; the toggle re-renders the lesson
// (which repaints the body's record controls AND this dock). Unlike Self-Talk/Songs, Minna loads its
// take cache per-lesson-render (loadRecordings(n) in renderMinnaLesson), so the controller takes no
// scope/load guard; and it always shows (renderMinnaGate clears the dock when signed out, so this is
// only reached for a signed-in, rendered lesson). The dock shows ONLY while speaking (the mock: an
// idle dock is empty → hidden via .nav-extra:empty); the chapter-strip "Speaking practice" button is
// the entry. Returns the controller so that button can toggle it.
export function renderNavSpeaking(n, body) {
  const bar = createSpeakingBar({ shouldShow: () => isSpeakingMode(), render: () => renderMinnaLesson(n, body) });
  bar.mount();
  return bar;
}

// Called when the みんなの日本語 tab is deactivated (wired through chrome's initTabs). Releases the
// persistent speaking-mode mic stream so the recording indicator doesn't linger on another tab;
// coming back re-renders fresh (speaking-off). Safe when not speaking (exitSpeakingMode is idempotent).
export function onMinnaHidden() { exitSpeakingMode(); clearSpeakingBar(); }

// Release the mic when the BROWSER tab is hidden (switching browser tabs / minimizing). In-app
// tab/lesson switches are covered by onMinnaHidden + the chapter handler, but a browser-tab change
// fires neither — so we listen for visibilitychange. We also re-render the lesson here because,
// unlike an in-app tab activation, returning to the browser tab does NOT re-run renderMinna(), so
// without this the controls + toggle would show a stale "speaking" state while the mic was actually
// released. Speaking mode is only ever on while the みんなの日本語 tab is the active in-app tab, so
// #mnBody at lastLesson is the right thing to re-render.
export function handleBrowserTabHidden() {
  // Minna is the "primary" surface — no active-panel guard (Self-Talk/Songs guard against fighting it).
  if (!releaseMicIfHidden()) return;
  const body = document.getElementById('mnBody');
  if (body) renderMinnaLesson(state.minnaStore.lastLesson, body);
}
