// 歌/Songs — Add: paste lyrics + a YouTube link → full-auto analysis (server LLM) → review → save.
// Account-gated (pasted lyrics are stored privately). Part of the features/songs/ package; shared
// mutable state in ./state.js (S.add holds the in-flight draft). See REFACTOR_FOLLOWUPS.md "S".

import { api, account } from '../cloud-core.js';
import { escapeHtml, segmentsToRuby, parseYouTubeId, songWords } from '../../core/index.js';
import { S } from './state.js';
import { known, loadLibrary } from './library.js';
import { render } from './index.js';

export function addHtml() {
  if (!account) {
    return `<button class="st-back" data-act="back"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg> back</button>
      <div class="signup-banner sg-gate"><svg class="ic" style="font-size:22px"><use href="#i-user"/></svg>
      <div class="sb-text"><b>Sign in to add a song.</b> Your pasted lyrics are stored privately to your account. Reading the bundled starter songs needs no account.</div>
      <button class="btn srs" data-act="signin">Sign in</button></div>`;
  }
  const a = S.add.analysis;
  const steps = (n) => `<div class="steps">
    <span class="step ${n > 1 ? 'done' : 'on'}"><span class="sn">${n > 1 ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : '1'}</span> Paste</span>
    <span class="step ${n === 2 ? 'on' : ''}"><span class="sn">2</span> Review</span>
    <span class="step ${n === 3 ? 'on' : ''}"><span class="sn">3</span> Save</span></div>`;
  const back = `<button class="st-back" data-act="back"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg> back to library</button>`;

  if (!a) {
    return `${back}${steps(1)}
      <label class="field-lbl" for="sgLyrics">Lyrics — paste from anywhere</label>
      <textarea id="sgLyrics" class="ta jp" placeholder="一行ずつ歌詞を貼り付けてください…">${escapeHtml(S.add.lyrics)}</textarea>
      <label class="field-lbl" for="sgUrl">YouTube link</label>
      <input id="sgUrl" class="inp" placeholder="https://www.youtube.com/watch?v=…" value="${escapeHtml(S.add.url)}">
      <p class="add-note"><svg class="ic" aria-hidden="true"><use href="#i-music"/></svg> Title &amp; artist auto-fill from the video. The audio stays on YouTube — we embed its player, we don't re-host it.</p>
      <div class="add-foot">
        <p class="add-note"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> ${S.add.error ? `<span class="sg-err">${escapeHtml(S.add.error)}</span>` : 'Lyrics you paste are stored privately to your account.'}</p>
        <button class="chip primary" data-act="analyze"${S.add.busy ? ' disabled' : ''}><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> ${S.add.busy ? 'Analyzing…' : 'Analyze'}</button>
      </div>`;
  }
  // Review step. The analyze response lines are already flat (en/grammar/tokens/flags).
  const flagged = a.lines.filter((l) => l.flags.length).length;
  const k = known();
  const distinct = songWords([{ tokens: a.lines.flatMap((l) => l.tokens || []) }]);
  const newCount = distinct.filter((w) => !k.has(w.lemma)).length;
  const rows = a.lines.map((l) => {
    const ruby = l.furigana ? segmentsToRuby(l.furigana) : escapeHtml(l.text);
    const warn = l.flags.length
      ? `<div class="rev-warn"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> check this line (${l.flags.join(', ')})</div>` : '';
    return `<div class="rev-line${l.flags.length ? ' flag' : ''}"><div><div class="rev-jp jp">${ruby}</div><div class="rev-en">${escapeHtml(l.en)}</div>${warn}</div></div>`;
  }).join('');
  return `${back}${steps(2)}
    <div class="profile-chips">
      <span class="pchip plain"><svg class="ic" aria-hidden="true"><use href="#i-music"/></svg> ${escapeHtml(S.add.title || 'Untitled')}${S.add.artist ? ' · ' + escapeHtml(S.add.artist) : ''}</span>
      <span style="flex:1"></span>
      ${a.profile.jlpt ? `<span class="pchip info">${escapeHtml(a.profile.jlpt)}</span>` : ''}
      <span class="pchip info"><svg class="ic" aria-hidden="true"><use href="#i-tag"/></svg> ${a.profile.grammarCount} grammar point${a.profile.grammarCount === 1 ? '' : 's'}</span>
      <span class="pchip plain"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> ${newCount} new word${newCount === 1 ? '' : 's'}</span>
    </div>
    <div class="rev">${rows}</div>
    <div class="add-foot">
      <p class="add-note"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> Auto-generated${flagged ? ` — ${flagged} line${flagged === 1 ? '' : 's'} flagged to check` : ''}. Review, then it joins your library.</p>
      <span style="display:flex;gap:8px">
        <button class="btn ghost" data-act="reanalyze"${S.add.busy ? ' disabled' : ''}><svg class="ic" aria-hidden="true"><use href="#i-refresh"/></svg> Re-analyze</button>
        <button class="btn srs" data-act="save"${S.add.busy ? ' disabled' : ''}><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> ${S.add.busy ? 'Saving…' : 'Save to my library'}</button>
      </span>
    </div>`;
}

export async function runAnalyze() {
  // Capture the typed inputs BEFORE re-rendering (render() rebuilds the textarea from S.add.lyrics).
  const lyricsEl = document.getElementById('sgLyrics'); if (lyricsEl) S.add.lyrics = lyricsEl.value;
  const urlEl = document.getElementById('sgUrl'); if (urlEl) S.add.url = urlEl.value;
  S.add.busy = true; S.add.error = ''; render();
  S.add.youtubeId = parseYouTubeId(S.add.url);
  // oEmbed title/artist auto-fill (best-effort) before analysis.
  if (S.add.youtubeId && !S.add.title) {
    try { const oe = await api('/v1/songs/oembed?url=' + encodeURIComponent(S.add.url)); if (oe) { S.add.title = oe.title || ''; S.add.artist = oe.author || ''; } } catch (e) { /* */ }
  }
  try {
    const r = await api('/v1/songs/analyze', { method: 'POST', body: { lyrics: S.add.lyrics, title: S.add.title || undefined, artist: S.add.artist || undefined } });
    S.add.analysis = r; S.add.busy = false; render();
  } catch (err) {
    S.add.busy = false;
    S.add.error = err.status === 503
      ? 'Lyrics analysis isn’t available on this server yet. (Try again once it’s enabled.)'
      : (err.status === 400 ? 'Paste some lyrics first.' : 'Analysis failed — please try again.');
    render();
  }
}

export async function saveSong() {
  if (!S.add.analysis) return;
  S.add.busy = true; render();
  const id = 'usr-' + crypto.randomUUID();
  const lines = S.add.analysis.lines.map((l) => ({
    text: l.text, furigana: l.furigana, en: l.en || null, grammar: l.grammar || [],
    tokens: (l.tokens && l.tokens.length) ? l.tokens : null,
  }));
  try {
    const r = await api('/v1/songs', { method: 'POST', body: { id, title: S.add.title || 'Untitled', artist: S.add.artist || null, youtubeId: S.add.youtubeId || null, lines }, retry: true });
    await loadLibrary();
    if (r && r.song) { S.openSong = r.song; S.view = 'song'; S.mode = 'read'; }
    else S.view = 'library';
    S.add = { lyrics: '', url: '', title: '', artist: '', analysis: null, busy: false, error: '' };
    render();
  } catch (err) {
    S.add.busy = false; S.add.error = 'Save failed — please try again.'; render();
  }
}
