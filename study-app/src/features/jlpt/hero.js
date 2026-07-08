// 合格 JLPT tab — the head (title + level segment) and the countdown hero (days-to-exam, the
// daily-tasks ring, the streak/mock pills, and the pacing strip), split out of view.js
// (refactor-jlpt-view-split, step 7a). paceHtml is internal — only the hero uses it.
import { examCountdown, JLPT_LEVEL_ORDER } from '../../core/index.js';
import { mockPillHtml } from './mocks.js';

export function headHtml(store) {
  const chips = JLPT_LEVEL_ORDER.map((l) =>   // easy → hard, matching every other JLPT segment in the app
    `<button class="jl-levelchip${l === store.level ? ' active' : ''}" data-jl-act="level" data-level="${l}">${l}</button>`).join('');
  return `<div class="marker"><div class="idx">04<span class="slash"> / 08</span></div><div class="ttl jp-min">合格</div><div class="en">JLPT</div><div class="rule"></div></div>
  <section class="page-head">
    <div>
      <h1 class="page-title">Road to ${store.level} <span class="jl-title-jp jp-min">合格</span></h1>
      <div class="jl-sub">the whole app, pointed at one date — do the list, trust the reps</div>
    </div>
    <div class="page-counts"><span class="jl-levelseg" role="group" aria-label="Target JLPT level">${chips}</span></div>
  </section>`;
}

export function heroHtml(store, sig, tasks) {
  const cd = examCountdown(store.examDate, Date.now());
  const counted = tasks.filter((t) => !t.unavailable);
  const done = counted.filter((t) => t.done).length;
  const pct = counted.length ? done / counted.length : 0;
  const R = 34, C = 2 * Math.PI * R;
  const examLabel = cd ? new Date(store.examDate + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const big = !cd ? '—' : (cd.past ? '済' : cd.days);
  const subline = !cd ? 'set your exam date' : cd.past
    ? 'that exam day has passed — set the next sitting'
    : `${cd.weeks} week${cd.weeks === 1 ? '' : 's'}${cd.restDays ? ` and ${cd.restDays} day${cd.restDays === 1 ? '' : 's'}` : ''} to go — steady beats cramming`;
  return `<section class="jl-hero">
    <div class="jl-hero-left">
      <div class="jl-count"><b class="jl-days">${big}</b><span class="jl-days-label">day${cd && cd.days === 1 ? '' : 's'} <em>until the ${store.level}</em></span></div>
      <div class="jl-hero-meta">
        <span class="jl-examdate">${examLabel}</span>
        <label class="jl-dateedit" title="Change the exam date"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg><input type="date" id="jlptDate" value="${store.examDate}" aria-label="Exam date"></label>
      </div>
      <div class="jl-hero-sub">${subline}</div>
      ${paceHtml(store, sig)}
      <div class="jl-hero-pills">
        ${sig.streak ? `<span class="pill"><span class="dot"></span><b>Day ${sig.streak}</b>&nbsp;review streak</span>` : ''}
        ${sig.speakStreak ? `<span class="pill"><span class="dot speak"></span><b>Day ${sig.speakStreak}</b>&nbsp;speaking</span>` : ''}
        ${sig.wkLevel ? `<span class="pill"><span class="dot wk"></span>WK&nbsp;<b>level ${sig.wkLevel}</b></span>` : ''}
        ${mockPillHtml(store)}
      </div>
    </div>
    <div class="jl-hero-ring" role="img" aria-label="${done} of ${counted.length} daily tasks done">
      <svg viewBox="0 0 84 84">
        <circle class="jl-ring-track" cx="42" cy="42" r="${R}"/>
        <circle class="jl-ring-fill${pct >= 1 ? ' full' : ''}" cx="42" cy="42" r="${R}"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/>
      </svg>
      <div class="jl-ring-center"><b>${done}<span>/${counted.length}</span></b><em>today</em></div>
    </div>
  </section>`;
}

// The pacing strip: what closing the vocab gap by the exam date actually requires, vs the
// user's editable daily target and their real add-pace this week. Grammar mirrors it weekly.
// Hidden until the word-list chunk lands (plan is null) or when no exam date is set.
function paceHtml(store, sig) {
  const plan = sig.plan;
  if (!plan) return '';
  const verdict = plan.verdict === 'behind'
    ? { cls: 'warn', label: `≈${Math.abs(plan.slackWeeks)} wk behind` }
    : plan.verdict === 'ahead' ? { cls: 'good', label: `≈${plan.slackWeeks} wk of slack` }
      : plan.verdict === 'done' ? { cls: 'good', label: 'vocab gap closed' }
        : { cls: 'good', label: 'on track' };
  const g = plan.grammar;
  return `<div class="jl-pace">
    <div class="jl-pace-row">
      <span class="jl-pace-verdict ${verdict.cls}">${verdict.label}</span>
      <span class="jl-pace-line">≈<b>${plan.neededPerDay}</b> new words/day closes the ${plan.uncovered.toLocaleString()}-word ${store.level} gap by exam day (2-week review buffer) · added <b>${sig.pace.week}</b> this week</span>
      <label class="jl-pace-target">target <input type="number" id="jlptTargetWords" min="1" max="99" value="${sig.targets.wordsPerDay}" aria-label="New words per day target">/day</label>
    </div>
    ${g ? `<div class="jl-pace-row">
      <span class="jl-pace-verdict ${g.verdict === 'behind' ? 'warn' : 'good'}">${g.verdict === 'done' ? 'grammar covered' : g.verdict === 'behind' ? 'grammar behind' : 'grammar on pace'}</span>
      <span class="jl-pace-line">grammar: <b>${g.remaining}</b> point${g.remaining === 1 ? '' : 's'} left · ≈${g.neededPerWeek}/week needed</span>
      <label class="jl-pace-target">target <input type="number" id="jlptTargetGrammar" min="1" max="99" value="${sig.targets.grammarPerWeek}" aria-label="Grammar points per week target">/wk</label>
    </div>` : ''}
  </div>`;
}
