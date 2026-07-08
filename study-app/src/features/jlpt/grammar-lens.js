// 合格 JLPT tab — the grammar-readiness lens, split out of view.js (refactor-jlpt-view-split,
// step 7c): catalog coverage bars + the per-point list (status pip · pattern · gloss · Add/Read)
// behind a disclosure, with the Add-all / cloze-Drill / 文法形式判断-MCQ / 苦手 CTAs. While a drill
// runs the card BECOMES the drill (mcqHtml, from mcq.js); the two badges per row are the cloze-card
// status pip and the MCQ trail badge (mcqBadge) — two skills over one point, shown side by side.
import { state } from '../../state.js';
import { escapeHtml, mcqQuestionCount } from '../../core/index.js';
import { grammarPoints, grammarDeckCount, grammarMcq } from '../grammar/index.js';
import { S, MCQ_QUIZ_LEN } from './state.js';
import { mcqWeakIds, mcqBadge, mcqHtml } from './mcq.js';

// The grammar-readiness lens: catalog coverage bars + the per-point list (status pip ·
// pattern · gloss · Add/Read) behind a disclosure, with Add-all + Drill CTAs. The catalog
// is N3 content (the exam's zero-coverage paper); it renders regardless of target level.
export function grammarLensHtml(store, sig) {
  const points = grammarPoints();
  // While a drill runs the card BECOMES the drill: its title/sub describe the MCQ, and the lens CTAs
  // (Add-all / cloze Drill) are withheld — they'd re-render the deck out from under a live question.
  const head = (extra, title, sub) => `<section class="jl-card jl-grammar" id="jlGrammarLens">
    <div class="jl-card-head"><div><h2 class="title">${title || 'N3 grammar'}</h2>
      <div class="sub">${sub || 'the pattern catalog, drilled as cloze cards in your deck'}</div></div>${extra || ''}</div>`;
  if (!points) return `${head()}<div class="jl-empty">loading the grammar catalog…</div></section>`;
  const cov = sig.gcov;
  const byId = new Map(points.map((p) => [p.id, p]));
  const remaining = cov.total - cov.inDeck;
  const gcount = grammarDeckCount();
  // The MCQ CTA is offered whenever a bank exists for at least one point — it drills RECOGNITION and
  // needs no deck cards, unlike the cloze "Drill grammar" path which needs activated cards.
  const bank = grammarMcq();
  const nq = bank ? mcqQuestionCount(bank) : 0;
  // The 苦手 CTA only appears once the trail actually knows something — it draws from the points
  // you've drilled and keep missing, not from the whole bank.
  const weakIds = mcqWeakIds();
  const ctas = `<div class="jl-gp-ctas">
    ${remaining ? `<button class="chip primary jl-go" data-jl-act="gp-add-all">Add all ${remaining}</button>` : ''}
    ${gcount.n ? `<button class="chip jl-go" data-jl-act="go-grammar-drill">Drill grammar${gcount.due ? ` · ${gcount.due} due` : ''}</button>` : ''}
    ${nq && !S.mcq ? `<button class="chip jl-go" data-jl-act="mcq-start" title="Fill-the-blank, four choices — the exam's grammar question">文法形式判断 · ${Math.min(nq, MCQ_QUIZ_LEN)} Q</button>` : ''}
    ${weakIds.length && !S.mcq ? `<button class="chip jl-go jl-weak" data-jl-act="mcq-weak" title="Only the patterns you keep getting wrong">苦手 · ${weakIds.length}</button>` : ''}
  </div>`;
  const pct = cov.total ? Math.round((100 * cov.inDeck) / cov.total) : 0;
  const solidPct = cov.total ? Math.round((100 * cov.solid) / cov.total) : 0;
  const bar = `<div class="jl-covrow"><span class="jl-cov-label">In your deck</span>
    <span class="jl-covtrack"><span class="jl-covfill hi" style="width:${solidPct}%"></span><span class="jl-covfill" style="width:${pct}%"></span></span>
    <b class="jl-covval">${cov.inDeck}</b></div>
    <div class="jl-covsub">${cov.solid} solid (box 4+) · ${cov.learning} learning · of ${cov.total} points</div>`;
  const trail = (state.jlptStore || {}).mcq || {};
  const rows = cov.points.map((p) => {
    const pt = byId.get(p.id);
    if (!pt) return '';
    const act = p.rank == null
      ? `<button class="chip jl-go sm" data-jl-act="gp-add" data-point="${escapeHtml(p.id)}">Add</button>`
      : `<button class="chip jl-go sm" data-jl-act="gp-detail" data-rank="${p.rank}">Read</button>`;
    // The pip is the CLOZE-card status (deck/SRS); the badge is the MCQ trail (recognition). Two
    // different skills over one point — deliberately shown side by side, never merged.
    return `<div class="jl-gp-row"><span class="jl-gp-pip ${p.status}" title="${p.status}"></span>
      <span class="jl-gp-label jp">${escapeHtml(pt.label)}</span><span class="jl-gp-mean">${escapeHtml(pt.mean)}</span>${mcqBadge(trail, p.id)}${act}</div>`;
  }).join('');
  if (S.mcq) {                                               // a live drill owns the card
    return `${head('', '<span class="jp-min">文法形式判断</span> · Grammar MCQ',
      S.mcq.weak
        ? 'drawn from the patterns you keep getting wrong'
        : "fill the blank — four patterns you almost know, the shape the exam actually asks")}${mcqHtml()}</section>`;
  }
  return `${head(ctas)}${bar}
    <details class="jl-gp-list"><summary>All ${cov.total} points</summary><div class="jl-gp-rows">${rows}</div></details>
  </section>`;
}
