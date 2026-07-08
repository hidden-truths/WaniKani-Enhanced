// 合格 JLPT tab — the daily training checklist, split out of view.js (refactor-jlpt-view-split,
// step 6): buildTasks (the task model), persistDone (write auto-done states through to the day
// record so the heatmap is plain data), and checklistHtml (the rows + the 14-day heat strip).
import { state } from '../../state.js';
import { checklistHeat } from '../../core/index.js';
import { saveJlpt } from './store.js';

/* ---- the daily checklist ------------------------------------------------------- */

// Task model: { id, jp, title, sub, done, auto, checkable, act?, actLabel?, href? }.
// AUTO tasks read a live signal (done can't be un-ticked — the signal owns it); MANUAL
// tasks toggle a per-day flag in the synced blob. Auto-done states are written THROUGH
// to the day record (persistDone) so the heatmap history is a plain record.
export function buildTasks(sig, dayRec) {
  const t = [];
  if (sig.wkConnected) {
    const n = sig.wkReviewsNow;
    t.push({
      id: 'wkrev', jp: '亀', title: 'Clear WaniKani reviews', auto: true,
      done: n === 0,
      sub: n == null ? 'checking your WaniKani queue…' : (n === 0 ? 'queue clear — nothing waiting' : `${n} waiting${sig.wkLessons ? ` · ${sig.wkLessons} lessons ready` : ''}`),
      href: n ? 'https://www.wanikani.com/subjects/review' : null, actLabel: 'Review on WK',
    });
  } else {
    t.push({
      id: 'wkrev', jp: '亀', title: 'Clear WaniKani reviews', auto: true, done: false, unavailable: true,
      sub: 'connect your WaniKani account to track this automatically',
      act: 'go-wanikani', actLabel: 'Connect',
    });
  }
  t.push({
    id: 'due', jp: '復', title: 'Review due flashcards', auto: true,
    done: sig.due === 0,
    sub: sig.due === 0
      ? `all caught up${sig.reviewedToday ? ` · ${sig.reviewedToday} reviewed today` : ''}`
      : `${sig.due} due in your deck${sig.reviewedToday ? ` · ${sig.reviewedToday} done today` : ''}`,
    act: sig.due ? 'go-due' : null, actLabel: 'Start review',
  });
  // AUTO — the quota row's live signal is the `added` day-stamps on the cards (a real, re-readable
  // signal, unlike listening); write-through via persistDone like the others. Every vocab source
  // stamps it, so adding N3 words from 鰐蟹 / 歌 / みんなの日本語 fills the quota just as gap-fill does.
  {
    const uncov = sig.gap ? sig.gap.uncovered.length : null;
    const target = sig.targets.wordsPerDay;
    t.push({
      id: 'vocab', jp: '語', title: `Add new ${sig.level} words`, auto: true,
      done: uncov === 0 || sig.pace.today >= target,
      sub: uncov == null ? `loading the ${sig.level} word list…`
        : uncov === 0 ? 'the whole list is covered — nothing left to add'
          : `${sig.pace.today}/${target} added today · ${uncov.toLocaleString()} uncovered`,
      act: uncov ? 'gap-add' : null, actLabel: 'Add words',
    });
  }
  t.push({
    id: 'leech', jp: '虫', title: 'Drill your leeches', auto: sig.appLeeches === 0,
    done: sig.appLeeches === 0 ? true : !!dayRec.leech,
    checkable: sig.appLeeches > 0,
    sub: sig.appLeeches === 0
      ? 'no active leeches — clean slate'
      : `${sig.appLeeches} in the deck${sig.wkLeeches ? ` · ${sig.wkLeeches} on WaniKani` : ''} — a short worst-first round`,
    act: sig.appLeeches ? 'go-leeches' : (sig.wkLeeches ? 'go-wanikani' : null), actLabel: sig.appLeeches ? 'Drill now' : 'WK leeches',
  });
  t.push({
    id: 'speak', jp: '声', title: 'Speak out loud (独り言)', auto: true,
    done: sig.spokeToday,
    sub: sig.spokeToday
      ? `practiced today${sig.speakStreak > 1 ? ` · day ${sig.speakStreak} streak` : ''}`
      : (sig.speakStreak ? `day ${sig.speakStreak} streak on the line — a few phrases keep it` : 'a few phrases, out loud — output is what the exam can\'t test but N3 conversation needs'),
    act: 'go-selftalk', actLabel: 'Practice',
  });
  t.push({
    id: 'listen', jp: '聴', title: 'Listening reps (歌)', auto: false,
    done: !!dayRec.listen, checkable: true,
    sub: 'one song — dictate a few lines in Listen, or shadow them',
    act: 'go-songs', actLabel: 'Open 歌',
  });
  // CONDITIONALLY AUTO (the leech-row precedent): once grammar cloze cards are in the deck
  // there IS a live signal (a grammar card graded today — the `last` stamp), so the row
  // tracks itself; before that it stays a manual tick with a nudge toward the lens.
  if (sig.hasGrammarCards) {
    const g = sig.gcov;
    t.push({
      id: 'grammar', jp: '法', title: 'One grammar point', auto: true,
      done: sig.grammarToday,
      sub: sig.grammarToday
        ? 'grammar drilled today'
        : `a cloze round keeps the ${sig.targets.grammarPerWeek}/week pace${g ? ` · ${g.inDeck}/${g.total} points in the deck` : ''}`,
      act: 'go-grammar-drill', actLabel: 'Drill',
    });
  } else {
    t.push({
      id: 'grammar', jp: '法', title: 'One grammar point', auto: false,
      done: !!dayRec.grammar, checkable: true,
      sub: 'add N3 grammar points below to drill them here — this row then tracks itself',
      act: 'gp-add-all', actLabel: 'Add grammar',
    });
  }
  t.push({
    id: 'text', jp: '本', title: 'Textbook time (教科書)', auto: false,
    done: !!dayRec.text, checkable: true,
    sub: sig.lastLesson ? `continue みんなの日本語 L${sig.lastLesson}` : 'a lesson chunk of みんなの日本語 — grammar + reading in one',
    act: 'go-minna', actLabel: 'Open 教科書',
  });
  return t;
}

// Write auto-done states through to today's record so history (heatmap) is plain data.
// Saves (debounced push) only when something actually flipped.
export function persistDone(tasks, today) {
  const days = state.jlptStore.days;
  const rec = days[today] || {};
  let changed = false;
  for (const task of tasks) {
    if (task.done && !task.unavailable && !rec[task.id]) { rec[task.id] = 1; changed = true; }
  }
  if (changed) { days[today] = rec; saveJlpt(); }
}

export function checklistHtml(store, sig, tasks) {
  const rows = tasks.map((t) => {
    const check = t.unavailable
      ? `<span class="jl-check off" aria-hidden="true"></span>`
      : t.checkable
        ? `<button class="jl-check${t.done ? ' on' : ''}" data-jl-act="task" data-task="${t.id}" role="checkbox" aria-checked="${t.done}" aria-label="${t.title}">${t.done ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : ''}</button>`
        : `<span class="jl-check auto${t.done ? ' on' : ''}" title="tracked automatically">${t.done ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : ''}</span>`;
    const action = t.href
      ? `<a class="chip jl-go" href="${t.href}" target="_blank" rel="noopener">${t.actLabel}<svg class="ic" aria-hidden="true"><use href="#i-external"/></svg></a>`
      : t.act
        ? `<button class="chip jl-go" data-jl-act="${t.act}">${t.actLabel}<svg class="ic" aria-hidden="true"><use href="#i-arrow-right"/></svg></button>`
        : '';
    return `<div class="jl-task${t.done ? ' done' : ''}${t.unavailable ? ' unavailable' : ''}">
      ${check}
      <span class="jl-task-jp jp-min" aria-hidden="true">${t.jp}</span>
      <div class="jl-task-main"><b>${t.title}</b><span class="jl-task-sub">${t.sub}</span></div>
      ${action}
    </div>`;
  }).join('');
  const heat = checklistHeat(store.days, sig.today, 14, tasks.filter((t) => !t.unavailable).length);
  const cells = heat.map((h) => {
    const lvl = h.done === 0 ? 0 : h.frac < 0.34 ? 1 : h.frac < 0.67 ? 2 : h.frac < 1 ? 3 : 4;
    const d = new Date(h.day + 'T12:00');
    return `<span class="jl-heatcell l${lvl}" title="${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${h.done} task${h.done === 1 ? '' : 's'}"></span>`;
  }).join('');
  return `<section class="jl-card jl-checklist">
    <div class="jl-card-head"><div><h2 class="title"><span class="jp-min">今日の稽古</span> · Today's training</h2>
      <div class="sub">auto rows track the app; tick the rest yourself — the record syncs</div></div></div>
    <div class="jl-tasks">${rows}</div>
    <div class="jl-heat"><span class="jl-heat-label">last 14 days</span>${cells}</div>
  </section>`;
}
