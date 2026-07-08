// 合格 JLPT tab — the 文法形式判断 wave-2 MCQ drill, split out of view.js (refactor-jlpt-view-split,
// step 4). The cloze card asks you to PRODUCE a pattern; the exam asks you to RECOGNISE the right one
// out of four you almost know — a different skill, so its own bank (data/grammar-n3-mcq.js) and its own
// drill, keyed on the same durable point ids. The drill lives INSIDE the grammar lens (view.js's
// grammarLensHtml imports mcqHtml/mcqBadge/mcqWeakIds); this owns the run, the render, and the mcq-*
// delegated ACTIONS (merged into view.js's ACTIONS table).
//
// The RUN isn't persisted, but each ANSWER is: mcq-pick writes through to the per-point score trail on
// the synced `jlpt` blob (store.mcq), which is what the lens badges and the 苦手 drill read.
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import {
  escapeHtml, buildMcqQuiz, splitStem, scoreMcq, weakPoints,
  mcqPointIds, applyMcqResult, mcqStat, weakestMcqPoints,
} from '../../core/index.js';
import { S, closeMcq, MCQ_QUIZ_LEN, MCQ_WEAK } from './state.js';
import { grammarPoints, grammarMcq, ensureGrammarMcq } from '../grammar/index.js';
import { saveJlpt } from './store.js';
import { renderJlpt } from './view.js';   // runtime-only cycle (the mcq-* actions re-render), precedented

/* ---- 文法形式判断: the wave-2 MCQ drill ---------------------------------------------
   The cloze card asks you to PRODUCE a pattern; the exam asks you to RECOGNISE the right one out of
   four you almost know. Different skill, so it gets its own bank (data/grammar-n3-mcq.js, a lazy
   sibling chunk) and its own drill — keyed on the same durable point ids, so a point's cloze card
   and its MCQ questions always refer to one thing.

   The drill lives INSIDE the grammar lens rather than in the flashcard session: it isn't SRS (no
   scheduling, no leech math), it's a recognition sitting you take on demand. The RUN isn't
   persisted, but each ANSWER is: `mcq-pick` writes through to the per-point score trail on the
   synced `jlpt` blob (store.mcq), which is what the lens badges and the 苦手 drill read. */

// The points the 苦手 drill would draw from: weak by the trail AND actually banked (a pattern with no
// questions can't be drilled, however badly you know it).
export function mcqWeakIds() {
  const bank = grammarMcq();
  if (!bank) return [];
  return weakestMcqPoints((state.jlptStore || {}).mcq, mcqPointIds(bank), MCQ_WEAK);
}

// A point's lifetime MCQ record as a compact badge — omitted entirely for a point never drilled, so
// the lens doesn't sprout 81 "0/0"s.
//
// `.weak` re-derives the threshold instead of intersecting with mcqWeakIds(), and that is deliberate:
// a trail entry can only EXIST for a banked point (`mcq-pick` keys the trail on `q.pointId`, which
// buildMcqQuiz takes from the bank), so "weak by the trail" already implies "banked" — and gating on
// grammarMcq() here would blank every badge until the lazy bank chunk lands. The one case where the
// badge and the 苦手 drill can disagree is a point DROPPED from the bank after you drilled it: it
// keeps a stale `.weak` tint with no drill that can clear it. Acceptable while the bank only grows
// (10/81 points today). If points ever start leaving the bank, intersect here.
//
// The threshold itself (an ACCURACY floor, never `wrong > 0`) is a documented dead-end — see the MCQ
// entry in study-app/CLAUDE.md. Lifetime counters mean "ever missed" would pin a point forever.
export function mcqBadge(trail, id) {
  const s = mcqStat(trail, id);
  if (!s) return '';
  const weak = s.seen >= MCQ_WEAK.minSeen && s.wrong > 0 && s.pct < MCQ_WEAK.maxPct;
  return `<span class="jl-gp-mcq${weak ? ' weak' : ''}" title="文法形式判断: ${s.right} of ${s.seen} correct${s.last ? ` · last ${s.last}` : ''}">${s.right}<i>/${s.seen}</i></span>`;
}

// Assemble + open a run. `ids` empty/absent = draw from every banked point; pass weak ids for the
// 苦手 drill. Awaits the lazy bank chunk, so the first click after a cold boot still works.
async function startMcq(ids) {
  const bank = await ensureGrammarMcq().catch(() => null);
  if (!bank) return;
  const questions = buildMcqQuiz(bank, { ids, n: MCQ_QUIZ_LEN });
  if (!questions.length) return;
  S.mcq = { questions, i: 0, picked: null, results: [], weak: !!(ids && ids.length) };
  renderJlpt();
  const lens = document.getElementById('jlGrammarLens');
  if (lens) lens.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

export function mcqHtml() {
  const run = S.mcq;
  const q = run.questions[run.i];
  const total = run.questions.length;

  if (!q) {                                   // finished → the score card
    const sc = scoreMcq(run.results);
    const weak = weakPoints(sc.byPoint);
    const byId = new Map((grammarPoints() || []).map((p) => [p.id, p]));
    const trail = (state.jlptStore || {}).mcq || {};
    const label = (id) => escapeHtml((byId.get(id) || {}).label || id);
    // Each missed pattern carries its LIFETIME record, so a one-off slip reads differently from a
    // pattern you've now missed four times running.
    const weakList = weak.length
      ? `<div class="jl-covsub">missed this round: ${weak.map((id) => {
        const s = mcqStat(trail, id);
        return `<span class="jp">${label(id)}</span>${s ? `<i class="jl-mcq-life">${s.right}/${s.seen}</i>` : ''}`;
      }).join(' · ')}</div>`
      : '<div class="jl-covsub">nothing missed — take another round, or drill the cloze cards.</div>';
    return `<div class="jl-mcq jl-mcq-done">
      <div class="jl-mcq-score"><b>${sc.right}<em>/${sc.total}</em></b><span>${sc.pct}%</span></div>
      ${weakList}
      <div class="jl-gp-ctas">
        <button class="chip primary jl-go" data-jl-act="mcq-start">Another round</button>
        ${mcqWeakIds().length ? '<button class="chip jl-go" data-jl-act="mcq-weak">Drill my 苦手</button>' : ''}
        <button class="chip jl-go" data-jl-act="mcq-close">Done</button>
      </div>
    </div>`;
  }

  const answered = run.picked != null;
  // `before`/`after` are interpolated RAW while every sibling here escapes — the stem carries
  // <ruby> furigana markup by design ("stem (clean ruby, one ＿＿＿ gap)", data/grammar-n3-mcq.js),
  // so escaping it would print the tags instead of the reading. The bank is a GENERATED, in-repo
  // artifact, never user input. Choices and `why` are plain text, hence escapeHtml on those.
  const [before, after] = splitStem(q.stem);
  const gap = answered
    ? `<span class="jl-mcq-fill ${run.picked === q.answer ? 'ok' : 'bad'}">${escapeHtml(q.choices[run.picked])}</span>`
    : '<span class="jl-mcq-gap"></span>';

  const choices = q.choices.map((c, i) => {
    let cls = '';
    if (answered) cls = i === q.answer ? ' ok' : (i === run.picked ? ' bad' : ' dim');
    return `<button class="jl-mcq-choice${cls}" data-jl-act="mcq-pick" data-pick="${i}"${answered ? ' disabled' : ''}>`
      + `<span class="jl-mcq-num">${i + 1}</span><span class="jp">${escapeHtml(c)}</span></button>`;
  }).join('');

  const right = run.results.filter((r) => r.correct).length;
  const correct = run.picked === q.answer;
  return `<div class="jl-mcq">
    <div class="jl-mcq-head">
      <span class="jl-mcq-pos">${run.i + 1} <i>/ ${total}</i></span>
      <span class="jl-mcq-track"><span class="jl-mcq-fillbar" style="width:${Math.round((100 * run.i) / total)}%"></span></span>
      <span class="jl-mcq-acc">${run.results.length ? `${right}/${run.results.length}` : '—'}</span>
      <button class="chip jl-go sm" data-jl-act="mcq-close">End</button>
    </div>
    <div class="jl-mcq-stem jp">${before}${gap}${after}</div>
    <div class="jl-mcq-choices">${choices}</div>
    ${answered ? `<div class="jl-mcq-why ${correct ? 'ok' : 'bad'}">
        <b>${correct ? '正解' : '不正解'}</b><span>${escapeHtml(q.why)}</span>
      </div>
      <div class="jl-gp-ctas"><button class="chip primary jl-go" data-jl-act="mcq-next">${run.i + 1 === total ? 'See score' : 'Next question'}</button></div>` : ''}
  </div>`;
}

export const MCQ_ACTIONS = {
  // ---- 文法形式判断 MCQ drill ----
  // The quiz is assembled ONCE per run; Math.random is fine here (the feature layer, not core) and
  // buildMcqQuiz shuffles both the question order and each question's choices — the bank always
  // stores the answer at a fixed index, so an unshuffled drill would teach position, not grammar.
  'mcq-start': () => startMcq(),
  // Same drill, drawn only from the points the trail says you keep missing.
  'mcq-weak': () => startMcq(mcqWeakIds()),
  'mcq-pick': (el) => {
    const run = S.mcq;
    if (!run || run.picked != null) return;                 // guard a double-tap
    const q = run.questions[run.i];
    run.picked = Number(el.dataset.pick);
    const correct = run.picked === q.answer;
    run.results.push({ pointId: q.pointId, correct });
    // Write THROUGH to the durable trail on every answer, not at run end — ending a drill early
    // (or closing the tab mid-run) must not throw away the questions you actually answered.
    const store = state.jlptStore;
    if (store) {
      store.mcq = applyMcqResult(store.mcq, q.pointId, correct, localDay());
      saveJlpt();
    }
    renderJlpt();
  },
  'mcq-next': () => {
    const run = S.mcq;
    if (!run || run.picked == null) return;                 // can't skip an unanswered question
    run.i++; run.picked = null;
    renderJlpt();
  },
  'mcq-close': () => { closeMcq(); renderJlpt(); },
};
