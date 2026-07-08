// 合格 JLPT tab — the live-signal read, split out of view.js (refactor-jlpt-view-split, step 5).
// collectSignals is ONE read over the app's stores → everything the checklist + readiness cards
// show. deriveGapContext is the wkIdx→jlptGap→jlptTargets→weeklyAddPace pipeline that BOTH the
// readiness render and the gap-add action need: it is deliberately RE-DERIVED fresh at each call
// site (the render's copy can be minutes stale by the time the user clicks Add), so this shares the
// CODE, not the RESULT — don't "optimize" gap-add to reuse collectSignals' gap.
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import {
  dueCards, leeches, studyStreak, practiceStreak,
  examCountdown, shiftDay, wkForecast,
  jlptTargets, deckWordSet, wkVocabIndex, jlptGap, weeklyAddPace, pacePlan,
  grammarCoverage, grammarReviewedToday,
} from '../../core/index.js';
import { jlptMap, cardJlptLevel } from './data.js';
import { grammarPoints } from '../grammar/index.js';
import { S as WK } from '../wanikani/state.js';
import { leechList } from '../wanikani/leeches.js';

// The gap/pace context the readiness lens + the gap-add action share. `map` is passed in (the caller
// owns whether the lazy word-list chunk has landed); `today` is the local day. gap is null when the
// chunk isn't loaded yet. Reads the live stores each call — that freshness is the point.
export function deriveGapContext(level, map, today) {
  const wkLoaded = !!state.wanikaniStore.token && WK.loaded;
  const wkIdx = wkLoaded ? wkVocabIndex(WK.subjects, WK.assignments) : null;
  const wkLevel = wkLoaded && WK.user ? WK.user.level : null;
  const gap = map ? jlptGap(map, level, deckWordSet(state.DATA), wkIdx) : null;
  const targets = jlptTargets(state.jlptStore);
  const pace = weeklyAddPace(state.DATA, today, level, { levelOf: cardJlptLevel });
  return { wkLoaded, wkIdx, wkLevel, gap, targets, pace };
}

// One read over the app's stores → everything the checklist + readiness cards show.
// WK numbers are null when no token / dataset not yet in memory (ensureWkData is kicked
// on tab open; onWkData re-renders when it lands).
export function collectSignals() {
  const today = localDay();
  const store = state.jlptStore;
  const daily = state.store.daily || {};
  let week = 0;
  for (let i = 0; i < 7; i++) { const d = daily[shiftDay(today, -i)]; if (d) week += d.tot || 0; }
  const wkConnected = !!state.wanikaniStore.token;
  const wkLoaded = wkConnected && WK.loaded;
  const map = jlptMap();
  // Pacing coach inputs (gap / deck-add pace / user targets), the grammar catalog coverage, and the
  // pace plan — all fed to the pure pacePlan. gap/plan are null until the word-list chunk lands.
  const { wkIdx, wkLevel, gap, targets, pace } = deriveGapContext(store.level, map, today);
  const points = grammarPoints();
  const gcov = points ? grammarCoverage(points, state.DATA, state.store.cards) : null;
  const cd = examCountdown(store.examDate, Date.now());
  const plan = gap && cd && !cd.past
    ? pacePlan({ daysLeft: cd.days, gap, targets, grammar: gcov ? { studied: gcov.inDeck, total: gcov.total } : null })
    : null;
  return {
    today,
    level: store.level,
    due: dueCards().length,
    reviewedToday: (daily[today] && daily[today].tot) || 0,
    weekReviews: week,
    streak: studyStreak(daily, today),
    appLeeches: leeches().length,
    speakStreak: practiceStreak(state.selftalkStore.practice, today),
    spokeToday: (state.selftalkStore.practice || {}).lastDay === today,
    lastLesson: state.minnaStore.lastLesson,
    wkConnected, wkLoaded, wkIdx,
    wkReviewsNow: wkLoaded ? wkForecast([...WK.assignments.values()], Date.now()).availableNow : null,
    wkLessons: wkLoaded && WK.summary ? WK.summary.lessons : null,
    wkLeeches: wkLoaded ? leechList().length : null,
    wkLevel,
    gap, targets, pace, gcov, plan,
    grammarToday: grammarReviewedToday(state.DATA, state.store.cards, new Date(today + 'T00:00').getTime()),
    hasGrammarCards: state.DATA.some((v) => v && v.grammar),
  };
}
