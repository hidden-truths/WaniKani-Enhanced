// FLASHCARD SESSION.
//
// Lifecycle: startSession() builds a deck and shows the first card → showCard() renders the
// prompt → reveal()/submitTyped() expose the answer → grade() records the result (stats +
// SRS + persist) and advances → endSession() logs the session/daily totals and shows the
// score. `session` holds only ephemeral run state; durable data goes into state.store via
// cardStat()/scheduleCard().
import { state } from '../state.js';
import { localDay } from '../config.js';
import {
  availableTiers, exampleForLevel, JLPT_TIERS, colorClass, cardStamp, pitchHtml,
  normKana, romajiToKana, escapeHtml, plainText, cardStat, scheduleCard, isDue, overlayTokens,
} from '../core/index.js';
import { settings, saveSettings } from '../settings-store.js';
import { save } from '../persistence/store.js';
import { speakWord, speak, TTS_OK } from './tts.js';
import { cycleMod } from './audio.js';
import { jishoUrl, copyText } from './render-helpers.js';
import { wireWordTaps } from './word-lookup.js';
import { cfg, buildDeck, updateDeckCount, updateDueBanner, updateStartLabel, startDueSession } from './deck.js';

// `export let` — only this module reassigns it (session=null / session={...}); the settings
// page reads it (renderExample(session.deck[session.i])) via the live binding.
export let session = null;

// Cloud hooks (durable session log + the post-session sign-up nudge) live in cloud.js;
// injected to avoid importing the still-separate cloud layer. logSession reads account/api
// + cfg.mode there; maybeShowSignup no-ops when signed in / dismissed. Registered at boot.
let logSession = () => {};
let maybeShowSignup = () => {};
export function registerSessionHooks(h) {
  if (h.logSession) logSession = h.logSession;
  if (h.maybeShowSignup) maybeShowSignup = h.maybeShowSignup;
}

// playReading reads the current card's reading aloud (server TTS via speakWord). `e` is the click
// event when triggered by the speaker button — Alt/Shift-click cycles voices (③); auto-play passes none.
function playReading(e) { if (session) speakWord(session.deck[session.i], 'reviews', document.getElementById('speakBtn'), { cycle: cycleMod(e) }); }

export function startSession() {
  const deck = buildDeck();
  if (!deck.length) { alert(cfg.kind === 'srs' ? 'Nothing is due in that deck right now — switch to Free study to practice anyway.' : 'No cards in that deck yet.'); return; }
  session = { deck, i: 0, revealed: false, results: [], kind: cfg.kind };
  document.getElementById('fcSetup').style.display = 'none';
  document.getElementById('fcDone').classList.remove('active');
  document.getElementById('fcStage').classList.add('active');
  showCard();
}

// ---- Leveled-example UI (answer side) ----
// The chosen tier is the synced setting settings.exampleLevel. Disabled tiers (no sentence)
// can't be picked; falls back to the card's own JLPT level, then the easiest available.
export function renderExample(v) {
  const block = document.getElementById('exampleBlock'), seg = document.getElementById('exLevels');
  const tiers = availableTiers(v);
  if (tiers.length) {
    seg.style.display = '';
    seg.innerHTML = JLPT_TIERS.map(t => `<button class="chip exlv" type="button" data-exlv="${t}"${tiers.includes(t) ? '' : ' disabled'}>${t}</button>`).join('');
  } else { seg.style.display = 'none'; seg.innerHTML = ''; }
  let lvl = settings.exampleLevel;
  if (tiers.length && !tiers.includes(lvl)) lvl = tiers.includes(v.jlpt) ? v.jlpt : tiers[0];
  [...seg.querySelectorAll('.exlv')].forEach(b => b.classList.toggle('active', b.dataset.exlv === lvl && !b.disabled));
  const ex = exampleForLevel(v, lvl);
  const speakBtn = document.getElementById('exSpeak'), copyBtn = document.getElementById('exCopy');
  if (ex) {
    // Overlay tappable word spans when the example carries a GiNZA annotation (ex[2].tokens, from
    // ?annotate=1); otherwise the plain ruby (ex[0]). #exSpeak/#exCopy read plainText off this node,
    // and plainText strips spans+ruby alike, so they keep working either way.
    const meta = ex[2];
    const exJp = document.getElementById('exJp');
    exJp.innerHTML = meta && meta.tokens && meta.furigana ? overlayTokens(meta.furigana, meta.tokens) : ex[0];
    wireWordTaps(exJp);
    document.getElementById('exEn').textContent = ex[1]; block.hidden = false;
    if (speakBtn) speakBtn.hidden = !TTS_OK;   // plays the currently-shown tier (read at click time)
    if (copyBtn) copyBtn.hidden = false;       // copy works regardless of audio availability
  } else { block.hidden = true; if (speakBtn) speakBtn.hidden = true; if (copyBtn) copyBtn.hidden = true; }
}

// ---- hanko + class-pill helpers (the editorial card's seal + tags) ----
const CLASS_JP = { godan: '五段', ichidan: '一段', irregular: '不規則', 'i-adj': 'い形', 'na-adj': 'な形' };
// reading mode shows the JP as the ANSWER, so the hanko can't spell the word — use a class seal.
const CLASS_SEAL = { godan: '五', ichidan: '一', irregular: '不', 'i-adj': '形', 'na-adj': '形', verb: '動', adjective: '形', noun: '名', adverb: '副', phrase: '句' };
const firstKanji = jp => (String(jp || '').match(/[㐀-鿿]/) || [String(jp || '？')[0]])[0];
// The class pill ("GODAN · 五段"), tinted by colorClass via the CSS .tag.cls.<class>.
function classPill(v) {
  const cls = colorClass(v), jp = CLASS_JP[cls];
  return `<span class="tag cls ${cls}">${cardStamp(v).label}${jp ? ' · <span class="jp">' + jp + '</span>' : ''}</span>`;
}

// Render session.deck[session.i] into the prompt FACE (the answer face is filled too but stays
// hidden until reveal). The two test directions swap which side is the prompt; reading mode hides
// the word's kanji (it's the answer) behind a class-seal hanko. JP uses innerHTML (v.jp may carry
// markup / pitchHtml); plain strings use textContent.
function showCard() {
  const v = session.deck[session.i];
  session.revealed = false;
  // session chrome: position, running recall %, progress bar.
  const pos = session.i + 1, total = session.deck.length;
  document.getElementById('fcProgress').innerHTML = `${pos} <i>/ ${total}</i>`;
  const done = session.results.length, got = session.results.reduce((s, x) => s + x, 0);
  document.getElementById('sessAcc').textContent = done ? Math.round(100 * got / done) + '%' : '—';
  document.getElementById('sessFill').style.width = (pos / total * 100) + '%';
  // card spine color + hanko tint + card-advance entrance.
  const fc = document.getElementById('flashcard');
  fc.className = 'flashcard ' + colorClass(v);
  void fc.offsetWidth; fc.classList.add('card-in');
  document.getElementById('cardHanko').className = 'hanko ' + colorClass(v);
  const pw = document.getElementById('promptWord'), aw = document.getElementById('answerWord');
  if (cfg.mode === 'meaning') {            // JP shown → recall meaning + reading
    document.getElementById('promptLabel').textContent = 'Read & recall · meaning + reading';
    pw.className = 'prompt-word jp'; pw.innerHTML = v.jp;
    aw.className = 'answer-word jp'; aw.innerHTML = v.jp;
    document.getElementById('hankoGlyph').textContent = firstKanji(v.jp);
    document.getElementById('aMean').textContent = v.mean;
    document.getElementById('veilLabelA').textContent = 'Reading';
    document.getElementById('veilLabelB').textContent = 'Meaning';
  } else {                               // meaning shown → recall reading + kanji
    document.getElementById('promptLabel').textContent = 'Recall · reading + kanji';
    pw.className = 'prompt-word'; pw.textContent = v.mean;     // English prompt (display font)
    aw.className = 'answer-word jp'; aw.innerHTML = v.jp;
    document.getElementById('hankoGlyph').textContent = CLASS_SEAL[colorClass(v)] || '語';
    document.getElementById('aMean').textContent = '';        // meaning IS the prompt
    document.getElementById('veilLabelA').textContent = 'Reading';
    document.getElementById('veilLabelB').textContent = 'Japanese';
  }
  document.getElementById('aRead').innerHTML = pitchHtml(v.read, v.accent);
  const acc = document.getElementById('aAccent');
  if (v.accent != null && v.accent !== '') { acc.hidden = false; acc.textContent = 'accent ［' + v.accent + '］'; }
  else acc.hidden = true;
  // tags: prompt side = class + level (no Jisho — it would spoil); answer side adds Jisho.
  const lvl = v.jlpt ? `<span class="tag level">${v.jlpt}</span>` : '';
  document.getElementById('promptTags').innerHTML = classPill(v) + lvl;
  document.getElementById('aTags').innerHTML = classPill(v) + lvl
    + `<a class="tag link" href="${jishoUrl(v.jp)}" target="_blank" rel="noopener noreferrer">View on Jisho <svg class="ic" aria-hidden="true"><use href="#i-external"/></svg></a>`;
  // mnemonic + trap as two note-cards (the mock's 2-up grid).
  document.getElementById('aNote').innerHTML =
    (v.mnem ? `<div class="note mnemonic"><div class="note-label"><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg>Mnemonic</div><div class="note-body">${v.mnem}</div></div>` : '')
    + (v.tip ? `<div class="note trap"><div class="note-label"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg>Trap / tip</div><div class="note-body">${v.tip}</div></div>` : '');
  renderExample(v);                                   // leveled example (shown once revealed)
  // reset to the PROMPT face; the answer face + grade row stay hidden until reveal().
  document.getElementById('promptFace').style.display = '';
  document.getElementById('answer').classList.remove('show');
  document.getElementById('gradeRow').style.display = 'none';
  document.getElementById('wrongBtn').classList.remove('suggested');
  document.getElementById('rightBtn').classList.remove('suggested');
  document.getElementById('typedVerdict').hidden = true;
  session.suggested = undefined;
  const typed = cfg.input === 'type';
  document.getElementById('revealRow').style.display = typed ? 'none' : 'flex';
  document.getElementById('inputRow').style.display = typed ? 'flex' : 'none';
  const inp = document.getElementById('answerInput');
  inp.value = ''; inp.disabled = false;
  if (typed) setTimeout(() => inp.focus(), 0);
}
// Flip the card: hide the prompt face (which holds the reveal/input rows), show the answer face
// + the grade row. Shared by self-graded Reveal and typed Check. Autoplays the reading when
// Audio=Auto. Sets session.revealed so grading is permitted.
function revealAnswer() {
  session.revealed = true;
  document.getElementById('promptFace').style.display = 'none';
  document.getElementById('answer').classList.add('show');
  document.getElementById('gradeRow').style.display = 'grid';
  if (cfg.audio === 'auto') playReading();
}
// Self-graded path: flip to the answer + grade buttons.
function reveal() { revealAnswer(); }
// Typed path: grade the typed kana against v.read, reveal + a verdict, then surface the
// grade buttons with the auto-judged one emphasized. The verdict is ADVISORY — 1/2 or a
// click still overrides (typo forgiveness); session.suggested drives the Enter-accepts path.
function submitTyped() {
  const inp = document.getElementById('answerInput');
  if (inp.disabled) return;                          // guard double-submit
  const v = session.deck[session.i];
  const correct = normKana(romajiToKana(inp.value)) === normKana(v.read);
  session.suggested = correct;
  inp.disabled = true;
  revealAnswer();
  const verdict = document.getElementById('typedVerdict');
  verdict.hidden = false;
  verdict.className = 'verdict ' + (correct ? 'ok' : 'bad');
  verdict.innerHTML = correct
    ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>Correct'
    : '<svg class="ic" aria-hidden="true"><use href="#i-x"/></svg>You typed “' + escapeHtml(inp.value.trim() || '—') + '”';
  document.getElementById('wrongBtn').classList.toggle('suggested', !correct);
  document.getElementById('rightBtn').classList.toggle('suggested', correct);
}
// Record one result: append to attempts + accuracy counters (BOTH study kinds — free study
// still feeds accuracy/leech stats), then persist NOW (mid-session crash safety). The SRS
// SCHEDULE only advances for a card that's actually DUE, and only in an SRS session OR (in
// free study) when freeReviewDue is on — so reviewing a NOT-due card early never bumps it.
function grade(correct) {
  const v = session.deck[session.i];
  const c = cardStat(v.rank);
  c.attempts.push(correct ? 1 : 0);
  if (correct) c.right++; else c.wrong++;
  if (isDue(v.rank) && (session.kind === 'srs' || settings.freeReviewDue)) scheduleCard(c, correct);
  session.results.push(correct ? 1 : 0);
  save();
  session.i++;
  if (session.i >= session.deck.length) { endSession(); }
  else { showCard(); }
}
// Local sessions kept for the Stats charts. Capped (the blob is synced whole); the DURABLE
// record is the server-side study_sessions log (logSession) — so even past this cap, no
// session history is ever lost for a signed-in user.
const SESSIONS_LOCAL_CAP = 1000;
function endSession() {
  document.getElementById('fcStage').classList.remove('active');
  // Ended with nothing graded (e.g. immediate "End session") → don't show an empty score
  // card; just return to the picker.
  if (!session || !session.results.length) {
    document.getElementById('fcDone').classList.remove('active');
    document.getElementById('fcSetup').style.display = 'block';
    updateDeckCount(); updateDueBanner(); updateStartLabel();
    return;
  }
  const right = session.results.reduce((s, x) => s + x, 0), tot = session.results.length;
  state.store.sessions.push({ t: Date.now(), right, tot, kind: session.kind });
  if (state.store.sessions.length > SESSIONS_LOCAL_CAP) state.store.sessions = state.store.sessions.slice(-SESSIONS_LOCAL_CAP);
  const day = localDay();
  if (!state.store.daily[day]) state.store.daily[day] = { right: 0, tot: 0 };
  state.store.daily[day].right += right; state.store.daily[day].tot += tot;
  save();                            // localStorage + debounced progress-blob push
  logSession(right, tot, session.kind); // durable append-only server log (never pruned)
  document.getElementById('doneScore').textContent = Math.round(100 * right / tot) + '%';
  document.getElementById('doneDetail').textContent = `${right} of ${tot} correct`;
  maybeShowSignup();   // nudge after first real session (no-ops when signed in / dismissed)
  document.getElementById('fcDone').classList.add('active');
}

// Wire all the session controls + keyboard shortcuts.
export function initFlashcardUI() {
  document.getElementById('startBtn').addEventListener('click', () => startSession());
  document.getElementById('dueBtn').addEventListener('click', startDueSession);
  // Hero "Free study" quick-start: flip study type to free, reflect it on the picker chips +
  // Start label, then start over the current deck (the picker below is for a customized run).
  const heroFree = document.getElementById('heroFreeBtn');
  if (heroFree) heroFree.addEventListener('click', () => {
    cfg.kind = 'free';
    document.querySelectorAll('.chip.skind').forEach(x => x.classList.toggle('active', x.dataset.skind === 'free'));
    updateStartLabel(); updateDeckCount();
    startSession();
  });
  document.getElementById('revealBtn').addEventListener('click', reveal);
  document.getElementById('checkBtn').addEventListener('click', submitTyped);
  document.getElementById('speakBtn').addEventListener('click', playReading);
  // Play the example sentence — read the rendered JP at click time (so it follows the
  // chosen tier) and strip ruby to the plain text /v1/tts wants.
  const exSpeak = document.getElementById('exSpeak');
  if (exSpeak) exSpeak.addEventListener('click', (e) => speak(plainText(document.getElementById('exJp').innerHTML), 'reviews', exSpeak, { cycle: cycleMod(e) }));
  const exCopy = document.getElementById('exCopy');
  if (exCopy) exCopy.addEventListener('click', () => copyText(plainText(document.getElementById('exJp').innerHTML), exCopy));
  // Pick a tier → remember it (synced setting) → re-render the current card's example.
  document.getElementById('exLevels').addEventListener('click', e => {
    const b = e.target.closest('.exlv'); if (!b || b.disabled) return;
    settings.exampleLevel = b.dataset.exlv; saveSettings();
    if (session) renderExample(session.deck[session.i]);
  });
  // Enter inside the kana field submits the typed answer (the global handler skips keys
  // while the field is focused, so this is the one place Enter→submit lives).
  document.getElementById('answerInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitTyped(); }
  });
  document.getElementById('wrongBtn').addEventListener('click', () => grade(false));
  document.getElementById('rightBtn').addEventListener('click', () => grade(true));
  document.getElementById('endBtn').addEventListener('click', endSession);
  // "Study again" returns to the picker and refreshes the live counts/banner.
  document.getElementById('againBtn').addEventListener('click', () => {
    document.getElementById('fcDone').classList.remove('active');
    document.getElementById('fcSetup').style.display = 'block';
    updateDeckCount(); updateDueBanner(); updateStartLabel();
  });
  // Keyboard shortcuts (only while a card is on screen, and not while typing in the kana
  // field). Before reveal: Space/Enter flips (typed mode: Enter submits). After reveal:
  // Space / Enter / 2 → CORRECT ; X / 1 → WRONG.
  document.addEventListener('keydown', e => {
    if (!document.getElementById('fcStage').classList.contains('active')) return;
    if (e.target === document.getElementById('answerInput')) return;   // field owns its keys
    const k = e.key, isSpace = e.code === 'Space', isEnter = k === 'Enter';
    if (!session.revealed) {
      if (cfg.input === 'type') { if (isEnter) { e.preventDefault(); submitTyped(); } }   // typed: Enter submits
      else if (isSpace || isEnter) { e.preventDefault(); reveal(); }                       // self: flip
      return;
    }
    // Revealed → grade. Space/Enter/2 mark correct; X/1 mark wrong.
    if (isSpace || isEnter || k === '2') { e.preventDefault(); grade(true); }
    else if (k === '1' || k === 'x' || k === 'X') { e.preventDefault(); grade(false); }
  });
}
