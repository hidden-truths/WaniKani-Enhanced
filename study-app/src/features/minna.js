// みんなの日本語 DASHBOARD — account-gated Minna no Nihongo lesson view. Content
// (vocab/grammar/examples/conversation + native audio) is fetched at runtime from
// /v1/minna/* (signed-in only), so the copyrighted textbook material never ships to
// anonymous visitors. renderMinna() runs lazily on tab activation.
//
// Vocab "activation" REUSES the custom-card system: each word becomes a tagged custom card
// (or, if it matches a built-in, a provenance OVERLAY), so it joins the deck/SRS/Browse/
// Stats and syncs under the existing 'custom-verbs' blob. The only NEW synced blob is
// per-lesson NOTES + the overlays (app key 'minna').
import { state } from '../state.js';
import { API_BASE } from '../config.js';
import { escapeHtml, rubyHtml, plainText, ttsText, CAT_LABEL, minnaBuiltinRank, minnaCardContent, minnaMutablePatch, minnaSig, convItemKey, resolveClip, clipLabel, validClip, mergeMinna } from '../core/index.js';
import { speak, TTS_OK } from './tts.js';
import { playItem, cycleMod } from './audio.js';
import { copyBtnHtml, copyText, speakBtnHtml } from './render-helpers.js';
import { account, api, setSyncStatus } from './cloud-core.js';
import { createSyncedBlob } from './synced-blob.js';
import { openAuth } from './cloud.js';
import { loadCustom, saveCustom } from '../persistence/custom.js';
import { rebuildData, refreshAfterVerbChange } from './custom-cards.js';
import { loadRecordings, recordControlHtml, wireRecordCompare, paintCompareWaveforms, isSpeakingMode, exitSpeakingMode, newestTakeIdForItem } from './record-compare.js';
import { createSpeakingBar, clearSpeakingBar, releaseMicIfHidden } from './speaking-bar.js';

const MINNA_APP_KEY = 'minna';
const MINNA_KEY = 'jpverbs_minna';
// `overlays` = { <built-in rank>: {tags,italki,minnaLesson,minnaKey,accent?,tts?} } — the
// dedup record: Minna words that map onto a baked-in verb live here, not as custom cards.
// `clips` = { <lesson>: { <lineIdx>: [startSec, endSec] } } — per-user conversation-line
// clip ranges set via the in-app marker (record-and-compare). Synced under the same key.
const MINNA_DEFAULT = { notes: {}, lastLesson: 23, overlays: {}, clips: {} };
function loadMinnaStore() { try { const o = JSON.parse(localStorage.getItem(MINNA_KEY)); if (o && typeof o === 'object') return Object.assign({}, MINNA_DEFAULT, o, { notes: o.notes || {}, overlays: o.overlays || {}, clips: o.clips || {} }); } catch (e) {} return Object.assign({}, MINNA_DEFAULT, { notes: {}, overlays: {}, clips: {} }); }
function saveMinnaLocal() { try { localStorage.setItem(MINNA_KEY, JSON.stringify(state.minnaStore)); } catch (e) {} }
function saveMinna() { saveMinnaLocal(); scheduleMinnaSync(); }

// --- Notes/overlays/clips sync — folded into the shared SyncedBlob abstraction (app key 'minna').
//     Same server-wins-on-login + fresh-account-seed model as the other blobs; the schedule/pull
//     names are kept (saveMinna + cloud.js's pullCloud call them). ---
export const minnaBlob = createSyncedBlob({
  appKey: MINNA_APP_KEY,
  read: () => state.minnaStore,
  apply: (data) => {
    if (data && typeof data === 'object') {
      state.minnaStore = Object.assign({}, MINNA_DEFAULT, data, { notes: data.notes || {}, overlays: data.overlays || {}, clips: data.clips || {} });
      saveMinnaLocal();
      return true;
    }
    return false;   // fall through to the fresh-account seed
  },
  shouldSeed: () => !!(Object.keys(state.minnaStore.notes || {}).length || Object.keys(state.minnaStore.overlays || {}).length || Object.keys(state.minnaStore.clips || {}).length),
  merge: mergeMinna,   // E1: union notes/overlays/clips on a 409 (local wins per key) instead of dropping local
});
function scheduleMinnaSync() { minnaBlob.schedule(); }
export const pullMinnaCloud = minnaBlob.pull;

// Conversation-line clip ranges (per-user, synced). Read by the compare player to
// slice the whole-conversation MP3 to one line; written by the in-app clip marker.
export function getLineClip(lesson, idx) { const c = state.minnaStore.clips; return (c && c[lesson] && c[lesson][idx]) || null; }
export function setLineClip(lesson, idx, clip) {
  const clips = state.minnaStore.clips = state.minnaStore.clips || {};
  const forLesson = clips[lesson] = clips[lesson] || {};
  if (clip) forLesson[idx] = clip; else delete forLesson[idx];
  saveMinna();
}

// --- Audio playback now goes through the shared player (features/audio.js playItem), which
//     resolves each item to a tagged voice VARIANT per the user's 'minna' priority and routes
//     gated native/take bytes through a credentialed <audio> while synth uses the public one. A
//     button carries its item on data-* (data-native / data-text / data-itemkey); the unified
//     handler in wireMinnaLesson reads them. The .playing class lights the active button (toggle).
//
// The CONVERSATION whole-dialogue audio is native-only (no synth equivalent for a whole
// conversation): data-native alone → resolves to the native recording.
const mnAudioBtn = (src) => src ? speakBtnHtml({ data: { 'audio-item': true, native: src }, label: 'Play native audio' }) : '';
// A VOCAB WORD button offers the full catalog: the native recording (if any), a synthesized voice
// (ttsText → the same kanji-for-accent text the deck uses), and the user's own newest take. Which
// one plays is the user's 'minna' priority (default: native first). Rendered whenever any audio
// path exists; itemKey ties it to the take cache.
const mnWordAudioBtn = (v) => {
  if (!TTS_OK && !v.audio) return '';
  const text = ttsText({ jp: v.dict || v.kanji || v.kana, read: v.dictRead || v.kana, tts: v.tts });
  return speakBtnHtml({ data: { 'audio-item': true, text, native: v.audio || null, itemkey: v.key }, label: 'Play' });
};

// --- Vocab → deck activation (via the custom-card store). ---
// Build a deck card from a Minna vocab item, using the DICTIONARY form as the headword. The
// lesson-derived content comes from core's minnaCardContent — the SAME source the re-activation
// patch (minnaMutablePatch) and the "Update N words" signature (minnaSig) read, so they can't drift;
// minnaCard only adds the structural custom/minna flags (a genuinely-new word also gets a `rank` in
// activateMinnaVocab).
function minnaCard(item, lesson) {
  return { ...minnaCardContent(item, lesson), custom: true, minna: true };
}
// The overlay payload for a built-in match: provenance only (the built-in keeps its content).
function minnaOverlay(item, lesson) {
  const tags = ['みんなの日本語', 'mnn-l' + lesson]; if (item.italki) tags.push('iTalki');
  const o = { tags, italki: !!item.italki, minnaLesson: lesson, minnaKey: item.key };
  if (item.accent != null) o.accent = item.accent; if (item.tts) o.tts = item.tts;
  if (item.audio) o.audio = item.audio;   // native src → merged onto the built-in by applyMinnaOverlays
  return o;
}
const overlaySig = o => (o.tags || []).join('|') + '·i' + (o.italki ? 1 : 0) + '·a' + (o.accent ?? '') + '·au' + (o.audio || '');
// A word is in the deck if it's a custom card OR an overlay on a built-in.
function minnaInDeck(key) {
  if (loadCustom().verbs.some(v => v.minnaKey === key)) return true;
  const ov = (state.minnaStore && state.minnaStore.overlays) || {};
  return Object.keys(ov).some(r => ov[r].minnaKey === key);
}
// Non-mutating preview of what "Add all vocab to deck" would do.
function minnaActivationStatus(lesson, vocab) {
  const cs = loadCustom(); const ov = (state.minnaStore && state.minnaStore.overlays) || {};
  let inDeck = 0, toAdd = 0, toUpdate = 0;
  vocab.forEach(item => {
    const br = minnaBuiltinRank(item);
    if (br) {
      const cur = ov[br];
      if (!cur) { toAdd++; return; }
      inDeck++;
      if (overlaySig(cur) !== overlaySig(minnaOverlay(item, lesson))) toUpdate++;
      return;
    }
    const existing = cs.verbs.find(v => v.minnaKey === item.key);
    if (!existing) { toAdd++; return; }
    inDeck++;
    if (minnaSig(existing) !== minnaSig(minnaCard(item, lesson))) toUpdate++;
  });
  return { inDeck, total: vocab.length, toAdd, toUpdate };
}
// Activate a lesson's vocab. Built-in matches REUSE the built-in via an overlay; new words
// become custom cards. Re-activation patches metadata in place (preserving rank → progress).
function activateMinnaVocab(lesson, vocab) {
  const cs = loadCustom(); const ov = state.minnaStore.overlays = state.minnaStore.overlays || {};
  let added = 0, updated = 0, custChanged = false, ovChanged = false;
  vocab.forEach(item => {
    const br = minnaBuiltinRank(item);
    if (br) {
      const fresh = minnaOverlay(item, lesson), cur = ov[br];
      if (!cur) { ov[br] = fresh; added++; ovChanged = true; }
      else if (overlaySig(cur) !== overlaySig(fresh)) { ov[br] = Object.assign({}, cur, fresh); updated++; ovChanged = true; }
      const di = cs.verbs.findIndex(v => v.minnaKey === item.key);
      if (di >= 0) { cs.verbs.splice(di, 1); custChanged = true; }
      return;
    }
    const fresh = minnaCard(item, lesson);
    const existing = cs.verbs.find(v => v.minnaKey === item.key);
    if (existing) {
      // Patch ALL lesson-derived content (minnaMutablePatch projects exactly the fields minnaCard
      // builds + minnaSig signs — so a changed jlpt/minnaLesson/ex/tts/… can't be silently dropped
      // the way the old hand-listed assign did), keeping only the card's rank → SRS progress. No-op
      // when nothing changed (the button is only enabled when some word is add/update-able anyway).
      if (minnaSig(existing) !== minnaSig(fresh)) {
        Object.assign(existing, minnaMutablePatch(fresh));
        updated++; custChanged = true;
      }
      return;
    }
    cs.seq = (cs.seq || 100) + 1; fresh.rank = cs.seq; cs.verbs.push(fresh); added++; custChanged = true;
  });
  if (custChanged) saveCustom(cs);
  if (ovChanged) saveMinna();
  if (custChanged || ovChanged) { rebuildData(); refreshAfterVerbChange(); }
  return { added, updated };
}
// One-time cleanup of pre-dedup duplicates → overlays. Idempotent; runs on boot + after a
// cloud pull, syncs only on change.
export function migrateMinnaDupes() {
  const cs = loadCustom(); const ov = state.minnaStore.overlays = state.minnaStore.overlays || {};
  let cChanged = false, oChanged = false;
  for (let i = cs.verbs.length - 1; i >= 0; i--) {
    const v = cs.verbs[i]; if (!v.minna) continue;
    const br = state.BUILTIN_RANK_BY_JP[v.jp]; if (!br) continue;
    if (!ov[br]) { ov[br] = { tags: [...(v.tags || [])], italki: !!v.italki, minnaLesson: v.minnaLesson, minnaKey: v.minnaKey }; if (v.accent != null) ov[br].accent = v.accent; oChanged = true; }
    cs.verbs.splice(i, 1); cChanged = true;
  }
  if (cChanged) saveCustom(cs);
  if (oChanged) saveMinna();
  return cChanged || oChanged;
}

// --- Render ---
const minnaLessonCache = {};               // n -> lesson JSON (avoids refetch on re-render)
async function fetchMinnaLesson(n) {
  if (minnaLessonCache[n]) return minnaLessonCache[n];
  const r = await api('/v1/minna/lessons/' + n);
  minnaLessonCache[n] = r; return r;
}
// Section = a collapsible card with the mock's numbered .sec-head (a numbered badge + title +
// an optional JP sub-label, count on the right). opts: {num, jp, unit}.
function mnSection(title, count, bodyHtml, open, opts = {}) {
  const { num, jp, unit } = opts;
  const left = `<span class="sec-title">${num ? `<span class="num">${num}</span>` : ''}<span class="sec-h2">${title}</span>${jp ? `<span class="jp-sub jp">${jp}</span>` : ''}</span>`;
  const right = count != null ? `<span class="sec-count">${count}${unit ? ' ' + unit : ''}</span>` : '';
  return `<details class="mn-section"${open ? ' open' : ''}><summary class="sec-head">${left}${right}</summary><div class="mn-sec-body">${bodyHtml}</div></details>`;
}
// Two gate states: signed-OUT shows a sign-in invite; signed-in-but-DENIED (a 401 from the
// owner allowlist, MINNA_OWNER_EMAILS) shows a "not on your account" note WITHOUT a Sign-in
// button — telling an already-signed-in user to "Sign in" was a misleading dead-end.
function renderMinnaGate(noAccess = false) {
  clearSpeakingBar();   // no speaking controls on the gate
  document.getElementById('mnHead').innerHTML = '';
  document.getElementById('mnBody').innerHTML = '';
  const g = document.getElementById('mnGate'); g.hidden = false;
  if (noAccess) {
    g.innerHTML = `<svg class="ic gate-ic" aria-hidden="true"><use href="#i-book"/></svg>
      <h2>みんなの日本語</h2>
      <p>This Minna no Nihongo workbook is private to its owner's account, so it isn't available here. Everything else in the app works normally.</p>`;
    return;
  }
  g.innerHTML = `<svg class="ic gate-ic" aria-hidden="true"><use href="#i-book"/></svg>
    <h2>みんなの日本語</h2>
    <p>Your private Minna no Nihongo workbook — vocabulary with native audio, grammar, example sentences and conversation, lesson by lesson. Sign in to open it.</p>
    <button class="chip primary" id="mnSignin"><svg class="ic" aria-hidden="true"><use href="#i-user"/></svg>Sign in</button>`;
  const b = document.getElementById('mnSignin'); if (b) b.addEventListener('click', () => openAuth('login'));
}
export async function renderMinna() {
  if (!account) { renderMinnaGate(); return; }
  document.getElementById('mnGate').hidden = true;
  const head = document.getElementById('mnHead'), body = document.getElementById('mnBody');
  let lessons = [];
  try { const r = await api('/v1/minna/lessons'); lessons = (r && r.lessons) || []; }
  catch (e) { if (e.status === 401) { renderMinnaGate(true); return; } body.innerHTML = '<div class="mn-error">Could not reach the server.</div>'; return; }
  if (!lessons.length) { head.innerHTML = ''; body.innerHTML = '<div class="mn-error">No lessons have been added yet.</div>'; return; }
  const cur = lessons.includes(state.minnaStore.lastLesson) ? state.minnaStore.lastLesson : lessons[0];
  state.minnaStore.lastLesson = cur;
  head.innerHTML = `<div class="page-kicker"><span class="jp">みんなの日本語</span> · Textbook</div>
    <div class="frow"><span class="filter-label">Chapter</span><div class="chips" id="mnChapters" aria-label="Chapter">
      ${lessons.map(n => `<button class="chip mnch${n === cur ? ' active' : ''}" type="button" data-lesson="${n}">L${n}</button>`).join('')}
    </div></div>`;
  // Switching chapters leaves the current speaking context — release the persistent mic so it
  // doesn't stay open across the navigation (the next lesson re-renders speaking-off).
  head.querySelectorAll('.mnch').forEach(b => b.addEventListener('click', () => { exitSpeakingMode(); state.minnaStore.lastLesson = Number(b.dataset.lesson); saveMinna(); renderMinna(); }));
  await renderMinnaLesson(cur, body);
}
// Lesson number → kanji (7→七, 23→二十三) for the hanko lesson seal.
const KNUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function kanjiNum(n) {
  if (n < 10) return KNUM[n] || String(n);
  if (n < 20) return '十' + (n % 10 ? KNUM[n % 10] : '');
  if (n < 100) return KNUM[Math.floor(n / 10)] + '十' + (n % 10 ? KNUM[n % 10] : '');
  return String(n);
}
async function renderMinnaLesson(n, body) {
  body.innerHTML = '<div class="mn-loading">Loading lesson ' + n + '…</div>';
  let L;
  try { L = await fetchMinnaLesson(n); }
  catch (e) { body.innerHTML = '<div class="mn-error">Could not load lesson ' + n + (e && e.status ? (' (' + e.status + ')') : '') + '.</div>'; return; }
  await loadRecordings(n);   // populate the record-and-compare take cache before render
  // Cross-lesson practice history (recording counts). Fails open: offline / error → no section.
  let practice = null;
  try { practice = await api('/v1/minna/practice'); } catch (e) {}
  const st = minnaActivationStatus(n, L.vocab || []);
  const btn = st.toAdd ? { ic: 'plus', label: 'Add all vocab to deck', dis: '' }
    : st.toUpdate ? { ic: 'refresh', label: 'Update ' + st.toUpdate + ' word' + (st.toUpdate === 1 ? '' : 's'), dis: '' }
      : { ic: 'check', label: 'All vocab in your deck', dis: ' disabled' };
  const vocabN = (L.vocab || []).length, gramN = (L.grammar || []).length;
  const pct = st.total ? Math.round(100 * st.inDeck / st.total) : 0;
  // The seal holds the lesson number in kanji; multi-char numbers (二十三) must shrink to
  // stay on one line inside the 118px tile — the mock's 54px is sized for a single glyph.
  const ka = kanjiNum(n), kaFs = ka.length >= 3 ? 30 : ka.length === 2 ? 40 : 54;
  body.innerHTML = `
    <section class="lesson-head" style="margin-top:14px">
      <div class="lesson-seal" title="Lesson ${n} seal"><span class="ring"></span><span class="ka jp" style="font-size:${kaFs}px">${ka}</span><span class="romaji">dai ${n} ka</span></div>
      <div class="lesson-info">
        <h1 class="lesson-no">第${n}課</h1>
        <div class="lesson-sub">Lesson&nbsp;${n}${L.theme ? ` · <span class="accent">${escapeHtml(L.theme)}</span>` : ''}</div>
        <div class="lesson-progress">
          <span class="prog-stat">vocab <b>${vocabN}</b></span>
          <span class="prog-stat">grammar <b>${gramN}</b></span>
          <div class="prog-meter"><div class="prog-fill" style="width:${pct}%"></div></div>
          <span class="prog-pct">${pct}% in deck</span>
        </div>
      </div>
      <div class="lesson-actions">
        <button class="btn btn-primary" id="mnAddDeck"${btn.dis}><svg class="ic" aria-hidden="true"><use href="#i-${btn.ic}"/></svg>${btn.label}</button>
        <span class="v-in" id="mnDeckCount">${st.inDeck}/${st.total} in your SRS deck</span>
      </div>
    </section>
    ${minnaVocabSection(L)}
    ${minnaGrammarSection(L)}
    ${minnaExamplesSection(L)}
    ${minnaConversationSection(L)}
    ${practiceHistorySection(practice, n)}
    ${minnaNotesSection(n)}`;
  wireMinnaLesson(n, L, body);
}
function minnaVocabSection(L) {
  if (!L.vocab || !L.vocab.length) return '';
  const speaking = isSpeakingMode();
  const rows = L.vocab.map(v => `<tr>
      <td class="v-audio">${mnWordAudioBtn(v)}</td>
      <td><div class="mn-kanji jp">${escapeHtml(v.kanji || v.kana)}</div><div class="mn-kana jp">${escapeHtml(v.kana)}${v.context ? ` <span class="mn-ctx">${escapeHtml(v.context)}</span>` : ''}</div></td>
      <td class="mn-mean">${escapeHtml(v.mean)}<span class="mn-pos">${escapeHtml(CAT_LABEL[v.cat] || v.cat || '')}</span>${v.italki ? '<span class="mn-italki" title="Covered in your iTalki lesson">iTalki</span>' : ''}</td>
      <td style="text-align:right">${minnaInDeck(v.key) ? '<span class="v-in">✓</span>' : ''}</td>
    </tr>${speaking ? `
    <tr class="mn-rec-row"><td></td><td colspan="3">${recordControlHtml(L.lesson, v.key, v.audio, null, false, ttsText({ jp: v.dict || v.kanji || v.kana, read: v.dictRead || v.kana, tts: v.tts }))}</td></tr>` : ''}`).join('');
  return mnSection('Vocabulary', L.vocab.length, `<table class="mn-vocab"><tbody>${rows}</tbody></table>`, true, { num: 1, jp: 'ことば', unit: 'words' });
}
// A small inline TTS button for a sentence that has no native audio (grammar / lesson
// examples). Carries the ruby-stripped plain text in data-tts (the exact string /v1/tts
// wants); wired delegated-per-render in wireMinnaLesson. Gated on TTS_OK.
const ttsSentenceBtn = (jp) => TTS_OK
  ? ` ${speakBtnHtml({ cls: 'sm', data: { tts: plainText(jp) }, label: 'Play sentence' })}`
  : '';
function minnaExampleRows(list) {
  // JP via rubyHtml so curated furigana (<ruby>/<rt>) renders and the data-furigana flip
  // toggles it; EN stays fully escaped. Plain (ruby-less) sentences round-trip unchanged. A
  // copy button (always shown) puts the plain sentence on the clipboard for dictionary lookup.
  return `<div class="mn-ex">${list.map(e => `<div><div class="e-jp jp">${rubyHtml(e.jp)}${ttsSentenceBtn(e.jp)}${copyBtnHtml(plainText(e.jp))}</div><div class="e-en">${escapeHtml(e.en)}</div></div>`).join('')}</div>`;
}
function minnaGrammarSection(L) {
  if (!L.grammar || !L.grammar.length) return '';
  // 3-up grammar card grid (mock): a tag + the JP pattern + the gloss + one specimen example.
  const cards = L.grammar.map(g => {
    const ex = g.examples && g.examples.length ? g.examples[0] : null;
    return `<article class="card gcard">
      <span class="g-tag"><span class="dot"></span>${escapeHtml(g.label || 'Pattern')}</span>
      <div class="g-pattern jp">${escapeHtml(g.pattern || '')}</div>
      ${g.structure ? `<div class="g-structure jp">${escapeHtml(g.structure)}</div>` : ''}
      ${g.explain ? `<p class="g-gloss">${escapeHtml(g.explain)}</p>` : ''}
      ${ex ? `<div class="g-ex"><p class="ex-jp jp">${rubyHtml(ex.jp)}</p><p class="ex-en">${escapeHtml(ex.en)}</p><div class="g-ex-foot"><span class="ex-mark">Example</span>${ttsSentenceBtn(ex.jp)}</div></div>` : ''}
    </article>`;
  }).join('');
  return mnSection('Grammar points', L.grammar.length, `<div class="grammar-grid">${cards}</div>`, true, { num: 2, jp: 'ぶんぽう', unit: 'patterns' });
}
function minnaExamplesSection(L) {
  if (!L.examples || !L.examples.length) return '';
  return mnSection('Example sentences', L.examples.length, minnaExampleRows(L.examples), false);
}
function minnaConversationSection(L) {
  const c = L.conversation; if (!c || !c.lines || !c.lines.length) return '';
  const head = c.title ? `<div class="convo-title jp">${escapeHtml(c.title)}</div>` : '';
  const audio = c.audio ? `<div class="mn-conv-audio">${mnAudioBtn(c.audio)}<span>Play the whole conversation</span></div>` : '';
  // Two-colour speaker BUBBLES (mock): the first distinct role speaks from the left (A / brand),
  // the second from the right (B / indigo, via .turn.is-b). roleMap assigns a stable speaker
  // index per role so the colours/sides stay consistent across the dialogue.
  const roleMap = {}; let nextSpk = 0;
  const lines = c.lines.map((ln, idx) => {
    const role = (ln.role || '').trim();
    if (!(role in roleMap)) roleMap[role] = nextSpk++;
    const isB = roleMap[role] % 2 === 1;
    const mark = role && role.length <= 2 ? escapeHtml(role) : (isB ? 'B' : 'A');
    // Each line is recordable; its native-compare target is a CLIP of the one whole-conversation
    // MP3 (c.audio). The clip comes from line.clip ∪ the synced store.
    const clip = c.audio ? resolveClip(ln.clip, getLineClip(L.lesson, idx)) : null;
    const rec = (c.audio && isSpeakingMode())
      ? `<div class="mn-line-rec">${recordControlHtml(L.lesson, convItemKey(L.lesson, idx), c.audio, clip, true, plainText(ln.jp))}${clipAffordanceHtml(idx, clip)}</div>`
      : '';
    return `<div class="turn${isB ? ' is-b' : ''}">
      <span class="spk ${isB ? 'b' : 'a'}">${mark}</span>
      <div class="turn-body"><p class="t-jp jp">${rubyHtml(ln.jp)}</p><p class="t-en">${escapeHtml(ln.en)}</p>${rec}</div>
    </div>`;
  }).join('');
  return mnSection('Model conversation', c.lines.length, `${head}${audio}<div class="convo">${lines}</div>`, true, { num: 3, jp: 'かいわ', unit: 'lines' });
}
// The clip affordance per conversation line: a current-clip readout + a Set/Edit button
// that opens the in-app marker (wired in wireMinnaClips). `idx` is the line index.
function clipAffordanceHtml(idx, clip) {
  return `<div class="clip-zone" data-cidx="${idx}">${clipZoneInner(idx, clip)}</div>`;
}
function clipZoneInner(idx, clip) {
  const label = clipLabel(clip);
  return `${label ? `<span class="clip-current" title="Native clip for this line">clip ${escapeHtml(label)}</span>` : ''}
    <button class="clip-edit" type="button" data-clip-edit="${idx}">${label ? 'Edit clip' : 'Set clip'}</button>`;
}
// The marker panel — a scrubbable native-audio player + Set start / Set end / Save. Writes
// to the synced clip store (setLineClip), so the same slice rides across devices. We use a
// real <audio controls crossorigin="use-credentials"> so the browser gives us scrubbing +
// currentTime for free (the cookie authorizes the gated cross-origin audio).
function markerHtml(idx, audioSrc, clip) {
  const v = validClip(clip);
  const fmt = t => (v == null && t == null) ? '–' : Number(t).toFixed(1) + 's';
  return `<div class="clip-marker" data-cidx="${idx}" data-start="${v ? v[0] : ''}" data-end="${v ? v[1] : ''}">
    <audio class="clip-audio" controls crossorigin="use-credentials" preload="metadata" src="${API_BASE}/v1/audio/native?src=${encodeURIComponent(audioSrc)}"></audio>
    <div class="clip-marker-row">
      <button class="chip" type="button" data-clip-setstart>Set start</button>
      <button class="chip" type="button" data-clip-setend>Set end</button>
      <span class="clip-readout">start <b class="cm-start">${v ? fmt(v[0]) : '–'}</b> · end <b class="cm-end">${v ? fmt(v[1]) : '–'}</b></span>
      <button class="chip clip-save" type="button" data-clip-save>Save</button>
      <button class="chip" type="button" data-clip-cancel>Cancel</button>
    </div>
    <div class="clip-tip">Play the conversation, then mark where this line starts and ends.</div>
  </div>`;
}
// Delegated wiring for the per-line clip marker. Attach-once (body persists across
// re-renders); all context — the lesson number and the conversation audio src — is read
// off the line's sibling rec-control dataset, so the handler needs no closure over L/n.
function wireMinnaClips(body) {
  if (body.dataset.clipWired) return;
  body.dataset.clipWired = '1';
  const lessonOf = el => { const rc = el.closest('.mn-line-rec') && el.closest('.mn-line-rec').querySelector('.rec-control'); return rc ? { lesson: Number(rc.dataset.lesson), audioSrc: rc.dataset.native } : null; };
  body.addEventListener('click', e => {
    const edit = e.target.closest('[data-clip-edit]');
    if (edit) {
      const ctx = lessonOf(edit); if (!ctx || !ctx.audioSrc) return;
      const idx = Number(edit.dataset.clipEdit);
      edit.closest('.clip-zone').innerHTML = markerHtml(idx, ctx.audioSrc, getLineClip(ctx.lesson, idx));
      return;
    }
    const marker = e.target.closest('.clip-marker');
    if (!marker) return;
    const ctx = lessonOf(marker); if (!ctx) return;
    const idx = Number(marker.dataset.cidx);
    const a = marker.querySelector('.clip-audio');
    if (e.target.closest('[data-clip-setstart]')) { marker.dataset.start = a.currentTime; marker.querySelector('.cm-start').textContent = a.currentTime.toFixed(1) + 's'; return; }
    if (e.target.closest('[data-clip-setend]')) { marker.dataset.end = a.currentTime; marker.querySelector('.cm-end').textContent = a.currentTime.toFixed(1) + 's'; return; }
    if (e.target.closest('[data-clip-cancel]')) { marker.closest('.clip-zone').innerHTML = clipZoneInner(idx, getLineClip(ctx.lesson, idx)); return; }
    if (e.target.closest('[data-clip-save]')) {
      const clip = validClip([Number(marker.dataset.start), Number(marker.dataset.end)]);
      if (!clip) { marker.querySelector('.clip-tip').textContent = 'Set a start, then an end after it, before saving.'; return; }
      setLineClip(ctx.lesson, idx, clip);
      setSyncStatus('✓ clip saved');
      renderMinnaLesson(ctx.lesson, body);   // re-render so the rec-control picks up the new clip
    }
  });
}
// Short local date for a practice-history "last practiced" cell. Adds the year only when it
// isn't the current one, so recent practice stays compact ("Jun 10") and older shows the year.
function fmtPracticeDate(ms) {
  const d = new Date(ms), opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
// "Practice history" overview — a cross-lesson roll-up of the user's saved takes (item + take
// counts + last-practiced per lesson, current lesson highlighted). Hidden until at least one
// recording exists. Reflects the server as of THIS render; a take saved afterward won't show
// until the next lesson render/switch (an upload only re-renders its own control, not the page).
function practiceHistorySection(practice, current) {
  if (!practice || !practice.lessons || !practice.lessons.length) return '';
  const rows = practice.lessons.map(l => `<tr${l.lesson === current ? ' class="mn-ph-cur"' : ''}>
      <td>L${l.lesson}</td>
      <td>${l.items} item${l.items === 1 ? '' : 's'}</td>
      <td>${l.takes} take${l.takes === 1 ? '' : 's'}</td>
      <td class="mn-ph-when">${escapeHtml(fmtPracticeDate(l.lastCreatedAt))}</td>
    </tr>`).join('');
  const total = `<div class="mn-ph-total">${practice.totalTakes} take${practice.totalTakes === 1 ? '' : 's'} · ${practice.totalItems} item${practice.totalItems === 1 ? '' : 's'} across ${practice.lessons.length} lesson${practice.lessons.length === 1 ? '' : 's'}</div>`;
  const table = `<table class="mn-ph"><thead><tr><th>Lesson</th><th>Items</th><th>Takes</th><th>Last</th></tr></thead><tbody>${rows}</tbody></table>`;
  return mnSection('Practice history', practice.totalTakes, total + table, false);
}
function minnaNotesSection(n) {
  const val = escapeHtml((state.minnaStore.notes && state.minnaStore.notes[n]) || '');
  return mnSection('My notes', null, `<div class="mn-notes"><textarea id="mnNotes" placeholder="Augment this lesson as you study with your tutor — grammar nuances, mistakes to avoid, anything. Synced to your account.">${val}</textarea><div class="mn-saved" id="mnNotesSaved"></div></div>`, false);
}
// Fill the navbar #navExtra slot with the speaking/compare controls via the shared controller (the
// same one Self-Talk + Songs use). The slot is a stable element in the navbar (so the controls float
// at the top while studying); minna.js re-mounts it per lesson render. The toggle re-renders the
// lesson — which repaints the body's record controls AND this navbar bar. Unlike Self-Talk/Songs,
// Minna loads its take cache per-lesson-render (loadRecordings(n) in renderMinnaLesson), so the
// controller takes no scope/load guard here; and it always shows (renderMinnaGate clears the slot
// when signed out, so this is only reached for a signed-in, rendered lesson).
function renderNavSpeaking(n, body) {
  createSpeakingBar({ render: () => renderMinnaLesson(n, body) }).mount();
}
function wireMinnaLesson(n, L, body) {
  // Unified audio buttons (vocab words + conversation): resolve native/synth/take per the 'minna'
  // voice priority. The newest user take (if any) makes the 'user' kind available for that item.
  body.querySelectorAll('[data-audio-item]').forEach(b => b.addEventListener('click', (e) => {
    const takeId = b.dataset.itemkey ? newestTakeIdForItem(n, b.dataset.itemkey) : null;
    playItem({ text: b.dataset.text || '', native: b.dataset.native || null, takeId }, 'minna', b, { cycle: cycleMod(e) });
  }));
  // Grammar / example SENTENCES are synth-only (no native clip) — synth in the 'minna' context.
  body.querySelectorAll('[data-tts]').forEach(b => b.addEventListener('click', (e) => speak(b.dataset.tts, 'minna', b, { cycle: cycleMod(e) })));
  // Copy an example sentence (plain text) to the clipboard for dictionary lookup.
  body.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copyText(b.dataset.copy, b)));
  wireRecordCompare(body);   // delegated record/play/delete/compare handlers (attach-once)
  wireMinnaClips(body);    // delegated conversation-line clip-marker handlers (attach-once)
  paintCompareWaveforms(body);   // decode + draw the you/native compare waveforms for this render
  renderNavSpeaking(n, body);    // dock the speaking/compare controls into the navbar
  const add = body.querySelector('#mnAddDeck');
  if (add) add.addEventListener('click', () => {
    const { added, updated } = activateMinnaVocab(n, L.vocab || []);
    renderMinnaLesson(n, body);
    const msg = added ? '✓ added ' + added + ' word' + (added === 1 ? '' : 's') + ' to your deck'
      : updated ? '✓ updated ' + updated + ' word' + (updated === 1 ? '' : 's')
        : 'already in your deck';
    setSyncStatus(msg);
  });
  const ta = body.querySelector('#mnNotes');
  if (ta) {
    let t = null;
    ta.addEventListener('input', () => {
      state.minnaStore.notes = state.minnaStore.notes || {}; state.minnaStore.notes[n] = ta.value;
      const s = body.querySelector('#mnNotesSaved'); if (s) s.textContent = 'saving…';
      if (t) clearTimeout(t);
      t = setTimeout(() => { saveMinna(); const e = body.querySelector('#mnNotesSaved'); if (e) e.textContent = account ? 'saved · synced' : 'saved on this device'; }, 500);
    });
  }
}

// Called when the みんなの日本語 tab is deactivated (wired through chrome's initTabs). Releases
// the persistent speaking-mode mic stream so the recording indicator doesn't linger while the
// user is on another tab; coming back re-renders fresh (speaking-off). Safe to call when not
// speaking (exitSpeakingMode is idempotent). The stale speaking-mode DOM is never seen because
// returning to the tab triggers renderMinna().
export function onMinnaHidden() { exitSpeakingMode(); clearSpeakingBar(); }

// Release the mic when the BROWSER tab is hidden (switching browser tabs / minimizing the
// window). The in-app tab/lesson switches are covered by onMinnaHidden + the chapter handler,
// but a browser-tab change fires neither — so we listen for visibilitychange. We also re-render
// the lesson here because, unlike an in-app tab activation, returning to the browser tab does
// NOT re-run renderMinna(), so without this the controls + toggle would show a stale "speaking"
// state while the mic was actually released. Speaking mode is only ever on while the みんなの日本語
// tab is the active in-app tab (entering it elsewhere is impossible, and leaving exits it), so
// #mnBody at lastLesson is the right thing to re-render.
function handleBrowserTabHidden() {
  // Minna is the "primary" surface — no active-panel guard (Self-Talk/Songs guard against fighting it).
  if (!releaseMicIfHidden()) return;
  const body = document.getElementById('mnBody');
  if (body) renderMinnaLesson(state.minnaStore.lastLesson, body);
}

// Load the Minna store from localStorage. Called at boot AFTER the first custom-card
// rebuildData (so that rebuild sees the state.js default empty overlays — preserving the
// original order; the boot's migrateMinnaDupes + rebuildData then apply the real overlays).
export function initMinna() {
  state.minnaStore = loadMinnaStore();
  // One global listener (no-op unless speaking mode is on) — release the mic on browser-tab hide.
  document.addEventListener('visibilitychange', handleBrowserTabHidden);
}
