// みんなの日本語 DASHBOARD render path — account-gated Minna no Nihongo lesson view. Content
// (vocab/grammar/examples/conversation + native audio) is fetched at runtime from /v1/minna/*
// (signed-in only), so the copyrighted textbook material never ships to anonymous visitors.
// renderMinna() runs lazily on tab activation. This module owns the head/gate/lesson render + the
// section builders + the audio-button builders + wireMinnaLesson (the per-render event wiring).
// renderMinnaLesson is exported because the clips + speaking siblings re-render through it (runtime
// import cycles, fine like cloud⇄minna).
import { state } from '../../state.js';
import { escapeHtml, rubyHtml, foldFurigana, plainText, ttsText, CAT_LABEL, convItemKey, resolveClip, kanjiNum } from '../../core/index.js';
import { speak, TTS_OK } from '../tts.js';
import { playItem, cycleMod } from '../audio.js';
import { copyBtnHtml, copyText, speakBtnHtml } from '../render-helpers.js';
import { account, api, setSyncStatus } from '../cloud-core.js';
import { openAuth } from '../cloud.js';
import { loadRecordings, recordControlHtml, wireRecordCompare, paintCompareWaveforms, isSpeakingMode, enterSpeakingMode, exitSpeakingMode, newestTakeIdForItem } from '../record-compare.js';
import { clearSpeakingBar } from '../speaking-bar.js';
import { S } from './state.js';
import { saveMinna, getLineClip } from './store.js';
import { minnaInDeck, minnaActivationStatus, activateMinnaVocab } from './activate.js';
import { clipAffordanceHtml, wireMinnaClips } from './clips.js';
import { renderNavSpeaking } from './speaking.js';

// --- Audio buttons. Playback goes through the shared player (features/audio.js playItem), which
//     resolves each item to a tagged voice VARIANT per the user's 'minna' priority and routes gated
//     native/take bytes through a credentialed <audio> while synth uses the public one. A button
//     carries its item on data-* (data-native / data-text / data-itemkey); the unified handler in
//     wireMinnaLesson reads them. The CONVERSATION whole-dialogue audio is native-only.
const mnAudioBtn = (src) => src ? speakBtnHtml({ data: { 'audio-item': true, native: src }, label: 'Play native audio' }) : '';
// A VOCAB WORD button offers the full catalog: the native recording (if any), a synthesized voice
// (ttsText → the same kanji-for-accent text the deck uses), and the user's own newest take. Which
// one plays is the user's 'minna' priority (default: native first). Rendered whenever any audio path
// exists; itemKey ties it to the take cache.
const mnWordAudioBtn = (v) => {
  if (!TTS_OK && !v.audio) return '';
  const text = ttsText({ jp: v.dict || v.kanji || v.kana, read: v.dictRead || v.kana, tts: v.tts });
  return speakBtnHtml({ data: { 'audio-item': true, text, native: v.audio || null, itemkey: v.key }, label: 'Play' });
};

// --- Render ---
async function fetchMinnaLesson(n) {
  if (S.lessonCache[n]) return S.lessonCache[n];
  const r = await api('/v1/minna/lessons/' + n);
  S.lessonCache[n] = r; return r;
}
// Section = a collapsible card with the mock's numbered .sec-head (a numbered badge + title + an
// optional JP sub-label, count on the right). opts: {num, jp, unit, bare}.
function mnSection(title, count, bodyHtml, open, opts = {}) {
  const { num, jp, unit, bare } = opts;
  const left = `<span class="sec-title">${num ? `<span class="num">${num}</span>` : ''}<span class="sec-h2">${title}</span>${jp ? `<span class="jp-sub jp">${jp}</span>` : ''}</span>`;
  const right = count != null ? `<span class="sec-count">${count}${unit ? ' ' + unit : ''}</span>` : '';
  // bare: render the body WITHOUT the lifted .mn-sec-body panel — used by Grammar, whose cards float
  // on the page individually (the mock), not nested inside a containing panel.
  const inner = bare ? `<div class="mn-sec-bare">${bodyHtml}</div>` : `<div class="mn-sec-body">${bodyHtml}</div>`;
  return `<details class="mn-section"${open ? ' open' : ''}><summary class="sec-head">${left}${right}</summary>${inner}</details>`;
}
// Two gate states: signed-OUT shows a sign-in invite; signed-in-but-DENIED (a 401 from the owner
// allowlist) shows a "not on your account" note WITHOUT a Sign-in button — telling an already-
// signed-in user to "Sign in" was a misleading dead-end.
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
  // Kicker only in the head; the chapter selector is relocated below the hero (the mock) — see
  // chapterStripHtml + wireMinnaLesson. S.lessons feeds that strip across re-renders.
  S.lessons = lessons;
  head.innerHTML = `<div class="marker"><div class="idx">04<span class="slash"> / 06</span></div><div class="ttl jp-min">教科書</div><div class="en">Textbook</div><div class="rule"></div></div>`;
  await renderMinnaLesson(cur, body);
}
// A quiet "this is account-gated material" footnote under the hero (the mock).
const GATED_NOTE = `<div class="gated-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Account-gated · textbook material</div>`;
// The mock's inline chapter strip (below the hero): a "Lesson" label, bare-numeral chips windowed
// around the current lesson with … gaps when there are many, and a right-aligned "Speaking practice"
// ghost button that enters speaking mode (wired to the nav speaking-bar controller in wireMinnaLesson).
function chapterStripHtml(n) {
  if (!S.lessons.length) return '';
  let shown = S.lessons, lead = false, trail = false;
  if (S.lessons.length > 9) {
    const i = S.lessons.indexOf(n), start = Math.max(0, i - 2), end = Math.min(S.lessons.length, i + 3);
    shown = S.lessons.slice(start, end); lead = start > 0; trail = end < S.lessons.length;
  }
  const chips = shown.map(m => `<button class="chip mnch${m === n ? ' active' : ''}" type="button" data-lesson="${m}">${m}</button>`).join('');
  const speaking = isSpeakingMode();
  return `<div class="chapter-strip">
    <span class="lbl">Lesson</span>
    ${lead ? '<span class="gap">…</span>' : ''}${chips}${trail ? '<span class="gap">…</span>' : ''}
    <button class="speaking-hint${speaking ? ' is-active' : ''}" type="button" data-mn-speak><svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg>${speaking ? 'Stop speaking' : 'Speaking practice'}</button>
  </div>`;
}
export async function renderMinnaLesson(n, body) {
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
  // The seal holds the lesson number in kanji; multi-char numbers (二十三) must shrink to stay on one
  // line inside the 118px tile — the mock's 54px is sized for a single glyph.
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
    ${GATED_NOTE}
    ${chapterStripHtml(n)}
    ${minnaVocabSection(L)}
    ${minnaGrammarSection(L)}
    ${minnaExamplesSection(L)}
    ${minnaConversationSection(L)}
    ${practiceHistorySection(practice, n)}
    ${minnaNotesSection(n)}`;
  wireMinnaLesson(n, L, body);
}
// Lesson vocab → the mock's labeled word-grid (was a <table>): rows grouped by part of speech under a
// .grp-label, each row = JP headword (with folded furigana) · usage · gloss · tags · play+record.
// Keeps the app data the static mock omits — the iTalki workflow marker, SRS deck-status, and the
// usage hint — each in its OWN column. The POS reads off the group label, so no per-row POS badge.
const GROUP_LABEL = { verb: 'Verbs', adjective: 'Adjectives', noun: 'Nouns', adverb: 'Adverbs', phrase: 'Phrases' };
function minnaVocabSection(L) {
  if (!L.vocab || !L.vocab.length) return '';
  const speaking = isSpeakingMode();
  // Bucket by POS, preserving first-seen order, so the grid reads as grouped word-lists.
  const order = [], byCat = {};
  L.vocab.forEach(v => { const c = v.cat || 'other'; if (!byCat[c]) { byCat[c] = []; order.push(c); } byCat[c].push(v); });
  const vrow = v => {
    const head = rubyHtml(foldFurigana(v.kanji || v.kana, v.kana));   // furigana ruby (plain for kana-only)
    const usage = v.context ? escapeHtml(v.context) : '';
    const italki = v.italki ? '<span class="v-italki" title="Covered in your iTalki lesson">iTalki</span>' : '';
    const inDeck = minnaInDeck(v.key) ? '<span class="v-in" title="In your SRS deck">✓</span>' : '';
    // Record affordance: out of speaking mode a rec-dot ENTERS it (mic-gated, wired in wireMinnaLesson);
    // in speaking mode the full record-and-compare control renders below the row (wiring unchanged).
    const recDot = speaking ? '' : '<button class="rec-dot" type="button" data-mn-rec aria-label="Record &amp; compare this word" title="Record &amp; compare"></button>';
    const recRow = speaking ? `<div class="vrow-rec">${recordControlHtml(L.lesson, v.key, v.audio, null, false, ttsText({ jp: v.dict || v.kanji || v.kana, read: v.dictRead || v.kana, tts: v.tts }))}</div>` : '';
    return `<div class="vrow">
      <span class="v-jp jp">${head}</span>
      <span class="v-usage jp">${usage}</span>
      <span class="v-en">${escapeHtml(v.mean)}</span>
      <span class="v-tags">${italki}</span>
      <span class="v-tools">${inDeck}${mnWordAudioBtn(v)}${recDot}</span>
    </div>${recRow}`;
  };
  const groups = order.map(c =>
    `<div class="grp-label">${escapeHtml(GROUP_LABEL[c] || CAT_LABEL[c] || c)}</div><div class="vocab-list">${byCat[c].map(vrow).join('')}</div>`
  ).join('');
  return mnSection('Vocabulary', L.vocab.length, `<div class="vocab-groups">${groups}</div>`, true, { num: 1, jp: 'ことば', unit: 'words' });
}
// A small inline TTS button for a sentence that has no native audio (grammar / lesson examples).
// Carries the ruby-stripped plain text in data-tts (the exact string /v1/tts wants); wired delegated-
// per-render in wireMinnaLesson. Gated on TTS_OK.
const ttsSentenceBtn = (jp) => TTS_OK
  ? ` ${speakBtnHtml({ cls: 'sm', data: { tts: plainText(jp) }, label: 'Play sentence' })}`
  : '';
function minnaExampleRows(list) {
  // JP via rubyHtml so curated furigana (<ruby>/<rt>) renders and the data-furigana flip toggles it;
  // EN stays fully escaped. Plain (ruby-less) sentences round-trip unchanged. A copy button (always
  // shown) puts the plain sentence on the clipboard for dictionary lookup.
  return `<div class="mn-ex">${list.map(e => `<div><div class="e-jp jp">${rubyHtml(e.jp)}${ttsSentenceBtn(e.jp)}${copyBtnHtml(plainText(e.jp))}</div><div class="e-en">${escapeHtml(e.en)}</div></div>`).join('')}</div>`;
}
function minnaGrammarSection(L) {
  if (!L.grammar || !L.grammar.length) return '';
  // 3-up grammar card grid (mock): a tag + the JP pattern + the gloss + one specimen example.
  const cards = L.grammar.map(g => {
    const ex = g.examples && g.examples.length ? g.examples[0] : null;
    return `<article class="gcard">
      <span class="g-tag"><span class="dot"></span>${escapeHtml(g.label || 'Pattern')}</span>
      <div class="g-pattern jp">${escapeHtml(g.pattern || '')}</div>
      ${g.structure ? `<div class="g-structure jp">${escapeHtml(g.structure)}</div>` : ''}
      ${g.explain ? `<p class="g-gloss">${escapeHtml(g.explain)}</p>` : ''}
      ${ex ? `<div class="g-ex"><p class="ex-jp jp">${rubyHtml(ex.jp)}</p><p class="ex-en">${escapeHtml(ex.en)}</p><div class="g-ex-foot"><span class="ex-mark">Example</span>${ttsSentenceBtn(ex.jp)}</div></div>` : ''}
    </article>`;
  }).join('');
  return mnSection('Grammar points', L.grammar.length, `<div class="grammar-grid">${cards}</div>`, true, { num: 2, jp: 'ぶんぽう', unit: 'patterns', bare: true });
}
function minnaExamplesSection(L) {
  if (!L.examples || !L.examples.length) return '';
  return mnSection('Example sentences', L.examples.length, minnaExampleRows(L.examples), false);
}
function minnaConversationSection(L) {
  const c = L.conversation; if (!c || !c.lines || !c.lines.length) return '';
  const head = c.title ? `<div class="convo-title jp">${escapeHtml(c.title)}</div>` : '';
  const audio = c.audio ? `<div class="mn-conv-audio">${mnAudioBtn(c.audio)}<span>Play the whole conversation</span></div>` : '';
  // Two-colour speaker BUBBLES (mock): the first distinct role speaks from the left (A / brand), the
  // second from the right (B / indigo, via .turn.is-b). roleMap assigns a stable speaker index per
  // role so the colours/sides stay consistent across the dialogue.
  const roleMap = {}; let nextSpk = 0;
  const lines = c.lines.map((ln, idx) => {
    const role = (ln.role || '').trim();
    if (!(role in roleMap)) roleMap[role] = nextSpk++;
    const isB = roleMap[role] % 2 === 1;
    const mark = role && role.length <= 2 ? escapeHtml(role) : (isB ? 'B' : 'A');
    // Each line is recordable; its native-compare target is a CLIP of the one whole-conversation MP3
    // (c.audio). The clip comes from line.clip ∪ the synced store.
    const clip = c.audio ? resolveClip(ln.clip, getLineClip(L.lesson, idx)) : null;
    const rec = (c.audio && isSpeakingMode())
      ? `<div class="mn-line-rec">${recordControlHtml(L.lesson, convItemKey(L.lesson, idx), c.audio, clip, true, plainText(ln.jp))}${clipAffordanceHtml(idx, clip)}</div>`
      : '';
    // Per-line play (TTS of the line, like the grammar/example sentences) — the mock's round play
    // button on every turn; wired via the shared [data-tts] handler in wireMinnaLesson.
    const play = TTS_OK ? speakBtnHtml({ cls: 'turn-play', data: { tts: plainText(ln.jp) }, label: 'Play line' }) : '';
    return `<div class="turn${isB ? ' is-b' : ''}">
      <span class="spk ${isB ? 'b' : 'a'}">${mark}</span>
      <div class="turn-body"><p class="t-jp jp">${rubyHtml(ln.jp)}</p><p class="t-en">${escapeHtml(ln.en)}</p>${rec}</div>
      ${play}
    </div>`;
  }).join('');
  return mnSection('Model conversation', c.lines.length, `${head}${audio}<div class="convo">${lines}</div>`, true, { num: 3, jp: 'かいわ', unit: 'lines' });
}
// Short local date for a practice-history "last practiced" cell. Adds the year only when it isn't the
// current one, so recent practice stays compact ("Jun 10") and older shows the year.
function fmtPracticeDate(ms) {
  const d = new Date(ms), opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
// "Practice history" overview — a cross-lesson roll-up of the user's saved takes (item + take counts
// + last-practiced per lesson, current lesson highlighted). Hidden until at least one recording
// exists. Reflects the server as of THIS render; a take saved afterward won't show until the next
// lesson render/switch (an upload only re-renders its own control, not the page).
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
  // The save/sync status rides as the mock's green "synced" pill in the section header; #mnNotesSaved
  // is the pill's text span, updated by the input handler below.
  const pill = `<span class="pill synced"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg><span id="mnNotesSaved">${account ? 'synced' : 'on this device'}</span></span>`;
  const body = `<div class="mn-notes"><textarea id="mnNotes" class="note-paper" placeholder="Augment this lesson as you study with your tutor — grammar nuances, mistakes to avoid, anything. Synced to your account.">${val}</textarea></div>`;
  return mnSection('My notes', pill, body, false, { jp: '第' + n + '課' });
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
  // A vocab rec-dot enters speaking mode (acquires the mic) and re-renders the lesson so the full
  // per-word record-and-compare controls appear. Mic-blocked is surfaced by enterSpeakingMode.
  body.querySelectorAll('[data-mn-rec]').forEach(b => b.addEventListener('click', async () => {
    if (isSpeakingMode()) return;
    if (await enterSpeakingMode()) renderMinnaLesson(n, body);
  }));
  wireRecordCompare(body);   // delegated record/play/delete/compare handlers (attach-once)
  wireMinnaClips(body);    // delegated conversation-line clip-marker handlers (attach-once)
  paintCompareWaveforms(body);   // decode + draw the you/native compare waveforms for this render
  const speakingBar = renderNavSpeaking(n, body);    // dock the speaking controls (shown only while speaking)
  // Chapter chips (relocated below the hero) — switching releases the mic so it can't stay open across
  // the navigation. The inline "Speaking practice" button is the speaking-mode entry (the dock is idle-empty).
  body.querySelectorAll('.mnch').forEach(b => b.addEventListener('click', () => { exitSpeakingMode(); state.minnaStore.lastLesson = Number(b.dataset.lesson); saveMinna(); renderMinna(); }));
  const speakBtn = body.querySelector('[data-mn-speak]');
  if (speakBtn) speakBtn.addEventListener('click', () => speakingBar.onToggle());
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
