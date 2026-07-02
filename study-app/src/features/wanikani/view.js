// 鰐蟹 WaniKani tab — render dispatcher + the attach-once delegated wiring (the songs
// ACTIONS-table pattern). #wkHead carries the marker/page-head + sub-nav + sync line;
// #wkBody swaps between the connect gate and the three views (dashboard / leeches /
// browse); #wkModal is the subject detail overlay (in-modal family navigation via a
// breadcrumb stack in S.detailStack).
import { state } from '../../state.js';
import { S } from './state.js';
import { wkEscape } from '../../core/index.js';
import { connectWanikani, disconnectWanikani, maybeSyncWk } from './index.js';
import { dashboardHtml } from './dashboard.js';
import { leechesHtml, leechList, leechClusters, expandLeeches, expandClusters, focusLeeches, filteredLeeches, leechRowsHtml } from './leeches.js';
import { browseHtml, browseResultsHtml } from './browse.js';
import { detailHtml } from './detail.js';
import { activateWkVocab } from './activate.js';
import { studyWkCards } from '../deck.js';
import { setSyncStatus } from '../cloud-core.js';

export const panelActive = () => {
  const p = document.getElementById('panel-wanikani');
  return !!(p && p.classList.contains('active'));
};

/* ---- render --------------------------------------------------------------- */

export function renderWanikani() {
  const head = document.getElementById('wkHead');
  const body = document.getElementById('wkBody');
  if (!head || !body) return;
  const token = state.wanikaniStore.token;

  head.innerHTML = headHtml(token);
  if (!token) { body.innerHTML = gateHtml(); return; }
  if (!S.loaded) { body.innerHTML = loadingHtml(); return; }

  if (S.view === 'leeches') body.innerHTML = leechesHtml();
  else if (S.view === 'browse') body.innerHTML = browseHtml();
  else body.innerHTML = dashboardHtml();
}

// Repaint ONLY the sync status line (cheap, called per sync-progress tick). While the
// first sync runs on an empty cache the body shows the big progress card instead.
export function renderWkStatus() {
  const line = document.getElementById('wkSyncMsg');
  if (line) line.textContent = S.syncMsg || '';
  const big = document.getElementById('wkFirstSyncMsg');
  if (big) big.textContent = S.syncMsg || 'starting…';
}

function headHtml(token) {
  const marker = `<div class="marker"><div class="idx">08<span class="slash"> / 08</span></div><div class="ttl jp-min">鰐蟹</div><div class="en">WaniKani</div><div class="rule"></div></div>`;
  if (!token || !S.loaded) {
    return `${marker}<section class="page-head"><div><h1 class="page-title">WaniKani companion</h1></div></section>`;
  }
  const u = S.user || {};
  const leechCount = leechList().length;
  const sub = u.subscription && u.subscription.type === 'lifetime' ? '∞ lifetime' : '';
  const synced = S.syncing ? '' : (S.lastSyncAt ? 'synced ' + timeUntilAgo(S.lastSyncAt) : '');
  return `${marker}
  <section class="page-head">
    <div>
      <h1 class="page-title">Level ${u.level || '—'} <span class="wk-title-jp jp-min">の旅</span></h1>
      <div class="wk-whoami">${wkEscape(u.username || '')}${sub ? ' <span class="wk-sub-badge">' + sub + '</span>' : ''}</div>
    </div>
    <div class="page-counts">
      <button class="wk-tabchip${S.view === 'dashboard' ? ' active' : ''}" data-wk-act="view" data-view="dashboard"><span class="jp">概観</span> Overview</button>
      <button class="wk-tabchip${S.view === 'leeches' ? ' active' : ''}" data-wk-act="view" data-view="leeches"><span class="jp">苦手</span> Leeches${leechCount ? ` <b class="wk-tabcount">${leechCount}</b>` : ''}</button>
      <button class="wk-tabchip${S.view === 'browse' ? ' active' : ''}" data-wk-act="view" data-view="browse"><span class="jp">一覧</span> Browse</button>
    </div>
  </section>
  <div class="wk-syncline">
    <span class="wk-syncmsg" id="wkSyncMsg">${wkEscape(S.syncMsg)}</span>
    ${S.syncErr ? `<span class="wk-syncerr">${wkEscape(S.syncErr)}</span>` : ''}
    <span class="wk-synced">${synced}</span>
    <button class="tool-btn" data-wk-act="sync" title="Refresh from WaniKani" aria-label="Refresh from WaniKani"${S.syncing ? ' disabled' : ''}><svg class="ic" aria-hidden="true"><use href="#i-refresh"/></svg></button>
    <button class="tool-btn wk-disconnect" data-wk-act="disconnect" title="Disconnect WaniKani" aria-label="Disconnect WaniKani"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>
  </div>`;
}

/* ---- connect gate ----------------------------------------------------------- */

function gateHtml() {
  return `<section class="wk-gate">
    <div class="wk-gate-card">
      <div class="wk-gate-seal" aria-hidden="true"><span class="jp">鰐蟹</span></div>
      <h2>Connect your WaniKani account</h2>
      <p class="wk-gate-sub">Your reviews, SRS stages, leeches and same-kanji families — rendered here as a
        study companion. Data loads straight from <b>api.wanikani.com</b> with a read-only
        <a href="https://www.wanikani.com/settings/personal_access_tokens" target="_blank" rel="noopener">personal access token</a>
        and is cached on this device${''/* the token itself syncs with your account */}.</p>
      <div class="wk-gate-row">
        <input type="password" id="wkTokenInput" class="wk-token-input" placeholder="wanikani api token…"
          autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="WaniKani API token"${S.verifying ? ' disabled' : ''}>
        <button class="chip primary" data-wk-act="connect"${S.verifying ? ' disabled' : ''}>
          <svg class="ic" aria-hidden="true"><use href="#i-cloud-check"/></svg>${S.verifying ? 'Checking…' : 'Connect'}</button>
      </div>
      ${S.gateErr ? `<div class="wk-gate-err" role="alert">${wkEscape(S.gateErr)}</div>` : ''}
      <div class="wk-gate-note">A default read-only token is all this needs — nothing is ever written to your WaniKani account.</div>
    </div>
  </section>`;
}

function loadingHtml() {
  return `<section class="wk-gate"><div class="wk-gate-card wk-firstsync">
    <div class="wk-gate-seal syncing" aria-hidden="true"><span class="jp">鰐蟹</span></div>
    <h2>Fetching your WaniKani data</h2>
    <p class="wk-gate-sub">First sync pulls the whole dataset (about 30 requests) — a minute at most.
      After this, updates are incremental and near-instant.</p>
    <div class="wk-firstsync-msg" id="wkFirstSyncMsg">${wkEscape(S.syncMsg || 'starting…')}</div>
  </div></section>`;
}

/* ---- delegated wiring (attach once) ------------------------------------------ */

let audioEl = null;
function playWkAudio(url) {
  if (!url) return;
  if (!audioEl) audioEl = new Audio();
  audioEl.src = url;
  audioEl.play().catch(() => {});
}

function openDetail(id, push) {
  if (push && S.detailId) S.detailStack.push(S.detailId);
  else if (!push) S.detailStack = [];
  S.detailId = id;
  const modal = document.getElementById('wkModal');
  document.getElementById('wkModalBody').innerHTML = detailHtml(id);
  modal.classList.add('show');
  modal.querySelector('.modal').scrollTop = 0;
}

function closeDetail() {
  S.detailId = null; S.detailStack = [];
  document.getElementById('wkModal').classList.remove('show');
}

// Declarative click-action table (the songs ACTIONS pattern) — every interactive
// element in head/body/modal carries data-wk-act (+ context data-*).
const ACTIONS = {
  connect: () => {
    const input = document.getElementById('wkTokenInput');
    const token = input && input.value.trim();
    if (token) connectWanikani(token);
  },
  view: (el) => { S.view = el.dataset.view; renderWanikani(); },
  sync: () => maybeSyncWk(true),
  disconnect: () => {
    if (confirm('Disconnect WaniKani? The token is forgotten and the cached data on this device is wiped.')) disconnectWanikani();
  },
  fmode: (el) => { S.forecastMode = el.dataset.mode; renderWanikani(); },
  open: (el) => openDetail(Number(el.dataset.id), false),
  jump: (el) => openDetail(Number(el.dataset.id), true),      // in-modal family navigation
  back: () => { const prev = S.detailStack.pop(); if (prev) { S.detailId = prev; document.getElementById('wkModalBody').innerHTML = detailHtml(prev); } },
  close: () => closeDetail(),
  audio: (el) => playWkAudio(el.dataset.url),
  btype: (el) => { toggleTok(S.browse.types, el.dataset.type); S.browseCap = 400; renderWanikani(); },
  bband: (el) => { toggleTok(S.browse.bands, el.dataset.band); S.browseCap = 400; renderWanikani(); },
  blevel: (el) => {
    const cur = S.browse.level ?? ((S.user && S.user.level) || 1);
    S.browse.level = Math.min(60, Math.max(1, cur + Number(el.dataset.step)));
    S.browseCap = 400; renderWanikani();
  },
  showmore: () => { S.browseCap += 400; renderWanikani(); },
  leechmore: () => { expandLeeches(); renderWanikani(); },
  clustermore: () => { expandClusters(); renderWanikani(); },

  // Leech-list view filters: the JLPT chip re-renders the view (chip active states live
  // in the card head); the search input is handled below (in-place row swap, keeps focus).
  ljlpt: (el) => { S.leechJlpt = el.dataset.level || ''; renderWanikani(); },

  // wk-leech-to-deck activation: a confusion family / the filtered leech list / the
  // target-JLPT slice / one subject becomes tagged Source:鰐蟹 flashcards (activate.js),
  // then the view repaints so buttons flip to in-deck state. The bulk add confirms
  // first — it can add hundreds; the focus add is the already-counted exam slice.
  addcluster: (el) => {
    const c = leechClusters().find((x) => x.kanji.id === Number(el.dataset.id));
    if (!c) return;
    flashAdded(activateWkVocab(c.members.map((m) => m.subject)));
    renderWanikani();
  },
  addleeches: () => {
    const leeches = filteredLeeches(leechList()).map((l) => l.subject);
    if (!confirm(`Add ${S.leechQ || S.leechJlpt ? 'the filtered' : 'every'} WaniKani vocab leech${leeches.length === 1 ? '' : 'es'} to your study deck as flashcards? They join the deck's own SRS (WaniKani is never written to).`)) return;
    flashAdded(activateWkVocab(leeches));
    renderWanikani();
  },
  addfocus: () => {
    flashAdded(activateWkVocab(focusLeeches().map((l) => l.subject)));
    renderWanikani();
  },
  addsubject: (el) => {
    const s = S.subjects.get(Number(el.dataset.id));
    if (!s) return;
    flashAdded(activateWkVocab([s]));
    if (S.detailId) document.getElementById('wkModalBody').innerHTML = detailHtml(S.detailId);
    renderWanikani();   // badges/buttons behind the modal repaint too
  },
  studywk: () => { closeDetail(); studyWkCards(); },
};

const flashAdded = (n) => setSyncStatus(n
  ? `鰐蟹 → deck: ${n} card${n === 1 ? '' : 's'} added`
  : 'already in your deck — nothing to add');

const toggleTok = (arr, tok) => { const i = arr.indexOf(tok); i >= 0 ? arr.splice(i, 1) : arr.push(tok); };

export function wireWanikani() {
  const panel = document.getElementById('panel-wanikani');
  const modal = document.getElementById('wkModal');
  if (!panel || panel.dataset.wkWired) return;
  panel.dataset.wkWired = '1';

  const dispatch = (e) => {
    const el = e.target.closest('[data-wk-act]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.wkAct];
    if (fn) fn(el, e);
  };
  panel.addEventListener('click', dispatch);
  modal.addEventListener('click', (e) => { if (e.target === modal) { closeDetail(); return; } dispatch(e); });
  document.getElementById('wkModalX').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('show')) closeDetail(); });

  // Enter in the token field submits the gate; typing in the browse search re-renders
  // the grid only (debounced a touch so kana composition doesn't thrash).
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'wkTokenInput') ACTIONS.connect();
  });
  let searchTimer = null;
  panel.addEventListener('input', (e) => {
    if (e.target.id !== 'wkSearch' && e.target.id !== 'wkLeechQ') return;
    const id = e.target.id, q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (id === 'wkSearch') {
        S.browse.q = q.trim(); S.browseCap = 400;
        const grid = document.getElementById('wkBrowseResults');
        if (grid) grid.outerHTML = browseResultsHtml();
      } else {
        S.leechQ = q.trim();
        const rows = document.getElementById('wkLeechRows');
        if (rows) rows.outerHTML = leechRowsHtml();   // rows only — the input keeps focus
      }
    }, 160);
  });
}

/* ---- misc -------------------------------------------------------------------- */

// "3m ago"-style stamp for the sync line (timeUntil covers the future side).
function timeUntilAgo(ms) {
  const d = Date.now() - ms;
  if (d < 90e3) return 'just now';
  if (d < 3600e3) return Math.round(d / 60e3) + 'm ago';
  if (d < 48 * 3600e3) return Math.round(d / 3600e3) + 'h ago';
  return Math.round(d / 864e5) + 'd ago';
}
