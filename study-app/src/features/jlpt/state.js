// 合格 JLPT tab — view-only (NON-synced) state + two tiny DOM helpers, split out of view.js
// (refactor-jlpt-view-split, step 1). The synced blob is store.js; THIS is the ephemeral
// form/drill state that renderJlpt()'s full-innerHTML rebuild must survive, plus the
// panel-active / tab-jump helpers the sibling render modules share.
//
// `mockDraft` mirrors the mock-form fields on every keystroke so an async re-render (the WK
// dataset landing, a lazy chunk resolving) can't silently eat a half-typed sitting — a
// half-typed form is not data, so it deliberately stays out of the synced blob.
// `mcq` holds an in-flight 文法形式判断 run: assembled questions, cursor, the picked choice for the
// current question (null until answered), and per-question results. The RUN is ephemeral; what IS
// durable is each ANSWER, written through to the synced per-point score trail (store.mcq) at pick time.
export const S = { mockForm: false, mockEdit: null, mockDraft: null, mcq: null };
export const closeMockForm = () => { S.mockForm = false; S.mockEdit = null; S.mockDraft = null; };
export const closeMcq = () => { S.mcq = null; };

export const MCQ_QUIZ_LEN = 10;   // one sitting; the seed bank holds 30 questions across 10 points
// What counts as 苦手: below this lifetime accuracy, over at least this many sightings. The floor
// keeps one unlucky tap from branding a pattern; the percentage (rather than "ever missed") is what
// lets a point drain off the list once you can actually do it.
export const MCQ_WEAK = { minSeen: 2, maxPct: 75 };

// Is the 合格 panel the active tab (guards the async lazy-chunk re-render from firing off-tab).
export const panelActive = () => { const p = document.getElementById('panel-jlpt'); return !!(p && p.classList.contains('active')); };
// Jump to another tab by clicking its underline-tab link (the ACTIONS go-* handlers).
export const goTab = (tab) => { const t = document.querySelector(`.tab[data-tab="${tab}"]`); if (t) t.click(); };
