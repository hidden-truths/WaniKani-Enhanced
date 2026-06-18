// Upcoming-review forecast — buckets every SCHEDULED card (box>0) into time slots for a
// chosen window. Pure (state.DATA + state.store in, buckets out); the hand-rolled SVG draw
// (renderForecast) lives in features/deck.js. Leitner intervals top out at 16 days, so the month
// view captures the whole real schedule and the year view is mostly front-loaded — that's
// accurate, not a bug.
import { state } from '../state.js';
import { DAY_MS } from './srs.js';

const HOUR_MS = 3600000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Each window has a FIXED slot count: 24h→24 hourly, week→7 days, month→the month's day
// count (28–31), year→12 months. `tip` is the per-slot hover suffix; `lab(i)` the (sparse)
// x-axis label. base is now, used for weekday/month names.
export function forecastWindow(h, base) {
  if (h === '24h')  return { slots: 24, idxOf: ms => Math.floor(ms / HOUR_MS),       lab: i => i === 0 ? 'now' : (i % 6 === 0 ? '+' + i + 'h' : ''),     tip: i => i === 0 ? 'next hour' : 'in ' + i + 'h' };
  if (h === 'week') return { slots: 7,  idxOf: ms => Math.floor(ms / DAY_MS),        lab: i => i === 0 ? 'today' : WEEKDAYS[(base.getDay() + i) % 7],     tip: i => i === 0 ? 'today' : WEEKDAYS[(base.getDay() + i) % 7] };
  if (h === 'month') { const dim = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
                  return { slots: dim, idxOf: ms => Math.floor(ms / DAY_MS),         lab: i => i === 0 ? 'today' : (i % 5 === 0 ? '+' + i + 'd' : ''),    tip: i => i === 0 ? 'today' : 'in ' + i + 'd' }; }
  return                 { slots: 12, idxOf: ms => Math.floor(ms / (30 * DAY_MS)),   lab: i => MONTHS[(base.getMonth() + i) % 12],                       tip: i => i === 0 ? 'this month' : 'in ' + i + 'mo' };
}
export function reviewForecast(h) {
  const now = Date.now(), base = new Date(now);
  const w = forecastWindow(h, base);
  const bars = Array.from({ length: w.slots }, (_, i) => ({ label: w.lab(i), tip: w.tip(i), count: 0, now: i === 0 }));
  state.DATA.forEach(v => {
    const c = state.store.cards[v.rank];
    if (!c || !c.box) return;                         // new/unseen cards aren't scheduled yet
    const delta = (c.due || 0) - now;
    let idx = delta <= 0 ? 0 : w.idxOf(delta);        // overdue / due-now → first slot
    if (idx < 0) idx = 0;
    if (idx < w.slots) bars[idx].count++;             // beyond the window → not shown
  });
  return { bars, max: bars.reduce((m, b) => Math.max(m, b.count), 0) };
}

// Day streak from the daily-accuracy map — the count of consecutive days, ending today (or
// yesterday when today hasn't been studied yet), on which at least one card was reviewed.
// daily: { 'YYYY-MM-DD': {right,tot} } (state.store.daily); todayKey is localDay(). Pure +
// tested. A gap (a day with no reviews) breaks the run; today not-yet-studied keeps the streak
// "alive" iff yesterday counted, so the hero pill doesn't blink to 0 first thing in the morning.
export function studyStreak(daily, todayKey) {
  if (!daily || !todayKey) return 0;
  const studied = k => { const d = daily[k]; return !!(d && d.tot > 0); };
  let key = todayKey;
  if (!studied(key)) {                 // nothing yet today — anchor on yesterday if it counted
    key = addDays(todayKey, -1);
    if (!studied(key)) return 0;
  }
  let n = 0;
  while (studied(key)) { n++; key = addDays(key, -1); }
  return n;
}
// 'YYYY-MM-DD' + delta days, via a LOCAL Date (no UTC shift) so it round-trips localDay().
function addDays(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  const p = n => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}
