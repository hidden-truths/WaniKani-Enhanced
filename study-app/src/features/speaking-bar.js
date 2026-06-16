// The navbar "Practice speaking" bar — ONE controller for the #navExtra toggle + mic picker +
// speed/bias controls, shared by every record-and-compare surface (みんなの日本語, 独り言 Self-Talk,
// 歌 Songs/Shadow). Each surface previously hand-rolled this exact lifecycle — build the bar, wire the
// toggle (enter/leave speaking mode + re-render), lazily fetch its take cache on first enter, wire the
// mic picker, and clear/release on leave — as three near-identical copies (clearNavSpeaking was
// byte-for-byte identical in all three). That made adding a fourth surface a copy-paste and let the
// copies drift (an Open/Closed smell). A surface now declares only what differs as config; the wiring
// lives here once.
//
// DEAD-ENDS preserved (see study-app/CLAUDE.md "Record-and-compare" + "Speaking mode"):
//   • The bar lives in the navbar #navExtra slot, SEPARATE from the per-item record controls in the
//     view body — two delegate roots, never merged.
//   • wireSpeakingControls (speed chips + bias slider) attaches ONCE to the stable slot; the toggle +
//     mic <select> are recreated every mount (the innerHTML swap), so their listeners can't stack.
//   • Entering speaking mode opens ONE persistent mic stream; a surface's take cache is fetched once
//     per session (the recordingsLoaded guard), NOT per take.
//   • exit is idempotent, so overlapping leave hooks across surfaces are safe.
import {
  isSpeakingMode, enterSpeakingMode, exitSpeakingMode,
  speakingBarHtml, wireSpeakingControls, initMicSelector, loadRecordings,
} from './record-compare.js';

const SLOT_ID = 'navExtra';
const slot = () => document.getElementById(SLOT_ID);

// Empty the navbar speaking-bar slot (on tab-leave / when a surface isn't showing the bar). The
// attach-once wireSpeakingControls delegate stays bound to the stable slot — only its content clears.
export function clearSpeakingBar() {
  const nav = slot();
  if (nav) nav.innerHTML = '';
}

// Build a speaking-bar controller for one surface. Call mount() each time the surface renders.
//   shouldShow()            — when false (signed out / recording unsupported / wrong mode) mount()
//                             CLEARS the slot instead of drawing the bar. Omit → always show (the
//                             みんなの日本語 case: the bar is only mounted once a lesson renders, which
//                             already implies signed-in).
//   render()                — re-render the surface after a toggle so its per-item record controls AND
//                             the bar reflect the new speaking state. render() is expected to re-mount
//                             this bar too, exactly as the hand-written versions did.
//   scope                   — the surface's reserved recordings partition; when set, the toggle lazily
//                             loads that partition's take cache the first time speaking mode is entered.
//   isLoaded()/markLoaded() — the once-per-session guard for that lazy load (a module/`S` flag).
//                             みんなの日本語 omits all three (it loads takes per-lesson-render, not on toggle).
export function createSpeakingBar({ shouldShow, render, scope = null, isLoaded, markLoaded }) {
  async function onToggle() {
    if (isSpeakingMode()) { exitSpeakingMode(); render(); return; }
    if (!(await enterSpeakingMode())) return;   // mic blocked / unsupported — enterSpeakingMode already reported it
    if (scope != null && (!isLoaded || !isLoaded())) {
      await loadRecordings(scope);
      if (markLoaded) markLoaded();
    }
    render();
  }
  function mount() {
    const nav = slot();
    if (!nav) return;
    if (shouldShow && !shouldShow()) { nav.innerHTML = ''; return; }
    nav.innerHTML = speakingBarHtml();
    wireSpeakingControls(nav);   // speed chips + bias slider (attach-once on the slot)
    const tog = nav.querySelector('[data-speaking-toggle]');
    if (tog) tog.addEventListener('click', onToggle);
    initMicSelector(nav, () => { if (isSpeakingMode()) enterSpeakingMode(); });
  }
  return { mount, onToggle };
}

// Release the persistent mic when the BROWSER tab is hidden while speaking (the in-app tab-leave
// hooks don't fire on a browser-tab change / minimize). `isActive` guards on the surface's panel
// being the active one so overlapping handlers across surfaces don't fight (exit is idempotent, but
// a backgrounded surface shouldn't re-render); omit it for the "primary" surface that has no guard
// (みんなの日本語). Returns true if it released the mic, so the caller re-renders to the freed state.
export function releaseMicIfHidden(isActive) {
  if (!document.hidden || !isSpeakingMode()) return false;
  if (isActive && !isActive()) return false;
  exitSpeakingMode();
  return true;
}
