/* ============================================================================
   Japanese Verb Trainer — application logic.
   ----------------------------------------------------------------------------
   Split out of index.html. Loaded as a classic <script> AFTER verbs.js, so the
   global `VERBS` (the dataset) is already defined when this runs; both share one
   global scope. No bundler, no modules — see the architecture map + data model +
   design decisions in the top-of-file comment of index.html (the source of truth).

   Section banners below mirror the original single-file layout: DATA/STORAGE/SRS →
   TAB NAV → FONT/THEME → EXPORT/IMPORT → DECK BUILDING → FLASHCARD → BROWSE →
   STATS+CHARTS → CUSTOM VERBS → CLOUD ACCOUNTS + SYNC.
   ========================================================================== */
// Conjugation/word-class subtype labels (the `type` field). Verbs use
// godan/ichidan/irregular; adjectives reuse `type` for the い/な split. Nouns,
// adverbs and phrases have no subtype (type:'' → no entry here).
const TYPE_LABEL={godan:"GODAN",ichidan:"ICHIDAN",irregular:"IRREG","i-adj":"い-ADJ","na-adj":"な-ADJ"};
// Part-of-speech categories (the `cat` field). 'verb' is the historical default
// (still all 100 built-ins); the rest are addable via the add-card modal. CATS is
// the canonical order + the membership test used by the `cat` filter facet.
const CATS=['verb','adjective','noun','adverb','phrase'];
const CAT_LABEL={verb:'VERB',adjective:'ADJ',noun:'NOUN',adverb:'ADVERB',phrase:'PHRASE'};
// The color token a card paints with (spine / hanko stamp): its subtype if it has
// one (godan, i-adj, …), else its category (noun, adverb, …). Drives the CSS class.
const colorClass=v=>v.type||v.cat||'';
// The hanko stamp shown on Browse cards + the detail modal: the subtype label when
// present (GODAN / い-ADJ), else the bare category (NOUN / PHRASE). `cls` is the
// matching CSS color class.
function cardStamp(v){
  if(v.type&&TYPE_LABEL[v.type]) return {label:TYPE_LABEL[v.type],cls:v.type};
  return {label:CAT_LABEL[v.cat]||(v.cat||'').toUpperCase(),cls:v.cat||''};
}
// ---- CUSTOM VERBS storage (user-added; synced to the cloud when signed in) ----
// Shape: { seq:<monotonic rank counter, starts at 100>, verbs:[ <verb>, … ] }.
// Each custom verb has the same fields as a baked one plus custom:true, and a
// rank assigned from `seq` (101, 102, …) that is never reused — so progress keyed
// by rank in `store.cards` stays stable across deletes.
//   saveCustomLocal() = localStorage only (used by cloud-pull to avoid re-pushing).
//   saveCustom()      = localStorage + a debounced cloud push (the normal path).
const CUSTOM_KEY='jpverbs_custom';
function loadCustom(){ try{const o=JSON.parse(localStorage.getItem(CUSTOM_KEY));if(o&&Array.isArray(o.verbs))return o;}catch(e){} return {seq:100,verbs:[]}; }
function saveCustomLocal(o){ try{localStorage.setItem(CUSTOM_KEY,JSON.stringify(o));}catch(e){} }
function saveCustom(o){ saveCustomLocal(o); if(typeof scheduleCustomSync==='function')scheduleCustomSync(); }

// DATA is the live deck: the baked-in VERBS (minus any v.skip) plus the user's
// own custom verbs. It's a `let` rebuilt by rebuildData() so every reader
// (buildDeck/dueCards/leeches/renderBrowse/renderStats) picks up added/edited/
// deleted custom verbs without re-binding. MAXRANK tracks the highest rank present
// so the rank-range filter can extend past 100 to include custom verbs.
let DATA=VERBS.filter(v=>!v.skip).concat(loadCustom().verbs);
let MAXRANK=DATA.reduce((m,v)=>Math.max(m,v.rank),0)||100;

// Built-in headword (jp) → rank. Lets Minna activation detect when a word already
// exists as a baked-in verb, so it reuses that rich card (examples + mnemonic) via an
// overlay instead of adding a bare duplicate. See applyMinnaOverlays / activateMinnaVocab.
const BUILTIN_RANK_BY_JP={};
VERBS.filter(v=>!v.skip).forEach(v=>{ if(!(v.jp in BUILTIN_RANK_BY_JP))BUILTIN_RANK_BY_JP[v.jp]=v.rank; });

// ---- Leveled example sentences ----
// Each built-in verb gets `v.levels` = EXAMPLES[rank] = {N5:[jp,en],…,N1:[jp,en]}
// (from examples.js). attachLevels() runs after every DATA rebuild. Custom verbs
// have no entry (EXAMPLES is 1..100), so they keep `levels:null` and fall back to
// their single `ex`. JLPT_TIERS is the easy→hard order the UI selector uses.
const JLPT_TIERS=['N5','N4','N3','N2','N1'];
function attachLevels(){
  const E = typeof EXAMPLES!=='undefined' ? EXAMPLES : {};
  DATA.forEach(v=>{
    v.levels = E[v.rank] || null;
    // Part-of-speech category. Everything is currently a verb, but tagging it now
    // is the groundwork for broadening past verbs (adjectives / nouns / phrases):
    // future filters/labels can key off cat without backfilling the dataset.
    if(!v.cat) v.cat='verb';
  });
}
attachLevels();
// Which tiers does this verb actually have a sentence for? (drives the selector).
function availableTiers(v){ return v.levels ? JLPT_TIERS.filter(t=>v.levels[t]) : []; }
// Pick the [jp,en] example for a verb at a JLPT level, with graceful fallback:
// exact tier → nearest available tier (search outward) → the verb's single `ex`
// → null. Pure — unit-tested.
function exampleForLevel(v, level){
  const L=v.levels;
  if(L){
    if(L[level]) return L[level];
    const i=JLPT_TIERS.indexOf(level);
    for(let d=1; d<JLPT_TIERS.length; d++){
      const lo=i-d>=0?JLPT_TIERS[i-d]:null, hi=i+d<JLPT_TIERS.length?JLPT_TIERS[i+d]:null;
      if(lo&&L[lo]) return L[lo];
      if(hi&&L[hi]) return L[hi];
    }
  }
  if(v.ex&&v.ex.length) return v.ex[0];
  return null;
}

/* ============================================================================
   STORAGE + SRS
   ----------------------------------------------------------------------------
   All progress lives in ONE localStorage key as a single JSON blob (see the
   `store` shape in the file header). Persistence model:
     • Mutations happen in memory on the `store` object.
     • save() is called after every grade (so a tab-close mid-session doesn't
       lose progress) and after import/reset.
   save() and the initial read are wrapped in try/catch because localStorage
   can throw (private mode, quota, disabled). Failure degrades to in-memory-
   only — the app still runs, it just won't persist.

   SCHEMA VERSIONING: the key is suffixed "_v3". If the store shape changes
   incompatibly, bump to _v4 and (ideally) write a migration that reads the old
   key. Right now we do soft per-field migration in cardStat() instead.
   ========================================================================== */
const KEY="jpverbs_v3";
let store;
try{ store=JSON.parse(localStorage.getItem(KEY))||null; }catch(e){ store=null; }
if(!store) store={cards:{},sessions:[],daily:{}};
// Guards: tolerate older/partial saves missing a top-level collection.
if(!store.cards)store.cards={};
if(!store.sessions)store.sessions=[];
if(!store.daily)store.daily={};
// saveLocal() persists to localStorage only (instant, offline-safe). save()
// additionally schedules a debounced push to the cloud when signed in — see
// the CLOUD ACCOUNTS + SYNC section near the bottom of this script. Splitting
// them lets cloud-hydration write localStorage WITHOUT re-pushing the same
// bytes back to the server.
function saveLocal(){ try{localStorage.setItem(KEY,JSON.stringify(store));}catch(e){} }
function save(){ saveLocal(); if(typeof scheduleCloudSync==='function')scheduleCloudSync(); }

// Local-time YYYY-MM-DD. We deliberately AVOID toISOString() alone because it's
// UTC — an evening study session in a western timezone would otherwise count
// toward the next calendar day. Shifting by the tz offset fixes the bucket.
function localDay(d){
  d=d||new Date();
  const tz=d.getTimezoneOffset()*60000;
  return new Date(d-tz).toISOString().slice(0,10);
}

/* ---- Leitner spaced repetition ----
   Chosen over SM-2 for transparency: the interval is a pure function of the
   box, so a learner can see exactly why a card is due. box 0 = new/unseen;
   boxes 1..5 map to the day intervals below. Promote one box on a correct
   answer (capped at 5), reset to box 1 on a miss. To switch to ease-factor
   scheduling (SM-2), rewrite scheduleCard() — nothing else depends on the
   internal box mechanics except the box histogram in renderStats(). */
const BOX_DAYS=[0,1,2,4,8,16];   // index = box number; value = days until due
const DAY_MS=86400000;
// Box maturity palette, index 0=New … 5=mastered (New→stone, then a
// red→amber→gold→olive→green gradient as cards graduate to longer intervals).
// Shared by the Stats box histogram (renderStats) and the per-card SRS indicator
// in the Browse detail modal (detailMemoryLine) so the colors stay in lock-step.
const BOX_COLORS=['var(--muted)','var(--godan)','#d98a3d','#c9b037','#7fae54','var(--good)'];
// Lazily create a card's stat record. Also soft-migrates pre-SRS saves that
// have attempts/right/wrong but no box/due fields.
function cardStat(rank){
  if(!store.cards[rank]) store.cards[rank]={attempts:[],right:0,wrong:0,box:0,due:0};
  const c=store.cards[rank];
  if(c.box===undefined)c.box=0;
  if(c.due===undefined)c.due=0;
  return c;
}
// Apply one review result to a card's schedule. Caller persists via save().
function scheduleCard(c,correct){
  if(correct){ c.box=Math.min(5,(c.box||0)+1); }
  else { c.box=1; } // lapse → box 1 (back to a 1-day interval, not box 0)
  c.due=Date.now()+BOX_DAYS[c.box]*DAY_MS;
}
// A card is "due" if never seen, still new (box 0), or its due time has passed.
function isDue(rank){
  const c=store.cards[rank];
  if(!c)return true;
  if(!c.box)return true;
  return (c.due||0)<=Date.now();
}
function dueCards(){ return DATA.filter(v=>isDue(v.rank)); }
// Human-readable "next review" string for the Browse card detail.
function nextDueLabel(rank){
  const c=store.cards[rank];
  if(!c||!c.box)return "new";
  const days=Math.ceil(((c.due||0)-Date.now())/DAY_MS);
  if(days<=0)return "due now";
  if(days===1)return "1 day";
  return days+" days";
}

/* ---- Upcoming-review forecast ----
   Buckets every SCHEDULED card (box>0) into time slots for a chosen window so the
   learner can see the wave of reviews coming. Overdue + currently-due cards fold
   into the first ("now"/"today") slot; cards whose next review falls beyond the
   window aren't shown (it's a forecast of the window, not a full census). Note the
   Leitner intervals top out at 16 days (BOX_DAYS), so the month view captures the
   whole real schedule and the year view is mostly front-loaded — that's accurate,
   not a bug. reviewForecast() is pure (DATA + store in, buckets out); renderForecast()
   draws the hand-rolled vertical-bar SVG (no chart lib, per the no-build contract). */
const HOUR_MS=3600000;
const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let forecastHorizon='week';   // '24h' | 'week' | 'month' | 'year' — view-only, not synced
// Each window has a FIXED slot count so the breakdown reads cleanly: 24h→24 hourly
// slots, week→7 days, month→the current month's day count (28–31), year→12 months.
// `tip` is the per-slot hover/label suffix; `lab(i)` is the (possibly empty) x-axis
// label — sparse for the dense windows. base is now, used for weekday/month names.
function forecastWindow(h,base){
  if(h==='24h')  return {slots:24, idxOf:ms=>Math.floor(ms/HOUR_MS),       lab:i=>i===0?'now':(i%6===0?'+'+i+'h':''),                 tip:i=>i===0?'next hour':'in '+i+'h'};
  if(h==='week') return {slots:7,  idxOf:ms=>Math.floor(ms/DAY_MS),        lab:i=>i===0?'today':WEEKDAYS[(base.getDay()+i)%7],         tip:i=>i===0?'today':WEEKDAYS[(base.getDay()+i)%7]};
  if(h==='month'){const dim=new Date(base.getFullYear(),base.getMonth()+1,0).getDate();
                 return {slots:dim,idxOf:ms=>Math.floor(ms/DAY_MS),        lab:i=>i===0?'today':(i%5===0?'+'+i+'d':''),                tip:i=>i===0?'today':'in '+i+'d'};}
  return              {slots:12, idxOf:ms=>Math.floor(ms/(30*DAY_MS)),  lab:i=>MONTHS[(base.getMonth()+i)%12],                     tip:i=>i===0?'this month':'in '+i+'mo'};
}
function reviewForecast(h){
  const now=Date.now(), base=new Date(now);
  const w=forecastWindow(h,base);
  const bars=Array.from({length:w.slots},(_,i)=>({label:w.lab(i),tip:w.tip(i),count:0,now:i===0}));
  DATA.forEach(v=>{
    const c=store.cards[v.rank];
    if(!c||!c.box)return;                         // new/unseen cards aren't scheduled yet
    const delta=(c.due||0)-now;
    let idx=delta<=0?0:w.idxOf(delta);            // overdue / due-now → first slot
    if(idx<0)idx=0;
    if(idx<w.slots)bars[idx].count++;             // beyond the window → not shown
  });
  return {bars,max:bars.reduce((m,b)=>Math.max(m,b.count),0)};
}
function renderForecast(){
  const el=document.getElementById('forecastChart'); if(!el)return;
  const {bars,max}=reviewForecast(forecastHorizon);
  const total=bars.reduce((s,b)=>s+b.count,0);
  if(!total){ el.innerHTML='<div class="fcast-empty">No reviews scheduled in this window — drill some cards to start the clock.</div>'; return; }
  const n=bars.length, W=720, H=156, pad={l:8,r:8,t:18,b:22};
  const iw=W-pad.l-pad.r, ih=H-pad.t-pad.b, base=pad.t+ih;
  const bw=iw/n, gap=Math.min(6,bw*0.22);
  const yOf=c=>base-(max?c/max:0)*ih;
  let g=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Upcoming reviews over the next ${forecastHorizon}; ${total} scheduled">`;
  // Every slot gets a faint background box so the full time breakdown is visible
  // even where nothing is due (24 hours / 7 days / a month of days / 12 months).
  bars.forEach((b,i)=>{
    const x=(pad.l+i*bw+gap/2).toFixed(1), bwid=(bw-gap).toFixed(1), cx=(pad.l+i*bw+bw/2).toFixed(1);
    g+=`<rect x="${x}" y="${pad.t.toFixed(1)}" width="${bwid}" height="${ih.toFixed(1)}" rx="2" fill="var(--paper-2)" opacity="0.55"/>`;
    if(b.count){
      const y=yOf(b.count), col=b.now?'var(--godan)':'var(--ichidan)';
      g+=`<rect class="fbar" x="${x}" y="${y.toFixed(1)}" width="${bwid}" height="${(base-y).toFixed(1)}" rx="2" fill="${col}" opacity="0.92"><title>${b.tip}: ${b.count} card${b.count===1?'':'s'}</title></rect>`;
      g+=`<text x="${cx}" y="${(y-4).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)" font-family="monospace">${b.count}</text>`;
    }
    if(b.label)g+=`<text x="${cx}" y="${H-7}" text-anchor="middle" font-size="8" fill="var(--muted)" font-family="monospace">${b.label}</text>`;
  });
  g+=`<line x1="${pad.l}" y1="${base.toFixed(1)}" x2="${W-pad.r}" y2="${base.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
  g+='</svg>';
  el.innerHTML=g;
}

// Rolling accuracy over the last n attempts (default 8). null = never drilled.
// Used for the worst-first sort, the per-card bars, and leech detection.
function rollingAcc(rank,n=8){
  const c=store.cards[rank]; if(!c||!c.attempts.length)return null;
  const a=c.attempts.slice(-n); return a.reduce((s,x)=>s+x,0)/a.length;
}
// LEECH = a card you keep failing. Definition: over its last 8 attempts, at
// least 4 attempts AND under 60% correct. The "≥4" floor avoids flagging a
// card as a leech off one or two early misses. Tune the 0.6 / 4 / 8 here.
function isLeech(rank){
  const c=store.cards[rank]; if(!c)return false;
  const a=c.attempts.slice(-8);
  return a.length>=4 && (a.reduce((s,x)=>s+x,0)/a.length)<0.6;
}
function leeches(){ return DATA.filter(v=>isLeech(v.rank)); }

/* ============================================================================
   TAB NAV — show one panel, hide the rest. Stats/Browse re-render on show so
   they always reflect the latest store.
   ========================================================================== */
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('panel-'+t.dataset.tab).classList.add('active');
  if(t.dataset.tab==='stats')renderStats();
  if(t.dataset.tab==='browse')renderBrowse();
  if(t.dataset.tab==='minna')renderMinna();
}));

/* ============================================================================
   SETTINGS — DB-synced preferences (the Settings page edits these).
   ----------------------------------------------------------------------------
   One object in localStorage (jpverbs_settings), synced to the server under app
   'settings' when signed in (mirrors the progress/custom-verb sync). Holds the
   cross-cutting study defaults: example sentence level, furigana visibility,
   default answer mode, default audio. Migrates the older per-key prefs
   (jpverbs_exlevel/input/audio) on first load. saveSettings() writes localStorage,
   applies side-effects (furigana), and schedules a cloud push when signed in.
   (Theme + font keep their own keys — device-ish, not synced.)
   ========================================================================== */
const SETTINGS_KEY='jpverbs_settings';
// freeReviewDue: in FREE study, grading a card that's already DUE still advances its
// SRS schedule (a due card is fair game to count). Not-due cards are never touched in
// free study, and SRS-review sessions always reschedule due cards regardless. Default
// on — it's the behavior most learners expect; toggle off for pure no-stakes practice.
const DEFAULT_SETTINGS={exampleLevel:'N5', furigana:true, input:'self', audio:'off', freeReviewDue:true};
function loadSettings(){
  let s=null; try{ s=JSON.parse(localStorage.getItem(SETTINGS_KEY)); }catch(e){}
  if(s && typeof s==='object') return Object.assign({}, DEFAULT_SETTINGS, s);
  return Object.assign({}, DEFAULT_SETTINGS, {          // migrate legacy per-key prefs
    exampleLevel: localStorage.getItem('jpverbs_exlevel')||DEFAULT_SETTINGS.exampleLevel,
    input: localStorage.getItem('jpverbs_input')||DEFAULT_SETTINGS.input,
    audio: localStorage.getItem('jpverbs_audio')||DEFAULT_SETTINGS.audio,
  });
}
let settings=loadSettings();
// Furigana visibility is a single attribute flip on <html> (CSS hides <rt> when off).
function applyFurigana(){ document.documentElement.dataset.furigana = settings.furigana ? 'on' : 'off'; }
function saveSettingsLocal(){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){} }
function saveSettings(){ saveSettingsLocal(); applyFurigana(); if(typeof scheduleSettingsSync==='function')scheduleSettingsSync(); }
applyFurigana();

/* ============================================================================
   FONT SWITCH — swaps --jp-font (only Japanese .jp text is affected). The
   choice is persisted under its own localStorage key, separate from progress.
   ========================================================================== */
const fontSel=document.getElementById('fontSel');
const savedFont=localStorage.getItem('jpverbs_font');
if(savedFont){fontSel.value=savedFont;document.documentElement.style.setProperty('--jp-font',savedFont);}
fontSel.addEventListener('change',()=>{
  document.documentElement.style.setProperty('--jp-font',fontSel.value);
  localStorage.setItem('jpverbs_font',fontSel.value);
});

/* ============================================================================
   THEME — light/dark via a data-theme attribute on <html>. If the user has
   never toggled, no attribute is set and the prefers-color-scheme media query
   in the CSS decides. The toggle must therefore RESOLVE the current effective
   theme (reading the system preference when unset) before flipping, so the
   first click always does the visibly-right thing. Persisted separately.
   ========================================================================== */
const savedTheme=localStorage.getItem('jpverbs_theme');
if(savedTheme){document.documentElement.setAttribute('data-theme',savedTheme);}
document.getElementById('themeToggle').addEventListener('click',()=>{
  const cur=document.documentElement.getAttribute('data-theme');
  const sysDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective=cur||(sysDark?'dark':'light');
  const next=effective==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  localStorage.setItem('jpverbs_theme',next);
});

/* ============================================================================
   EXPORT / IMPORT — the only way to move progress between browsers/devices
   (there's no backend). Export downloads the whole `store` as pretty JSON via
   a temporary object-URL anchor. Import validates loosely (must be an object
   with a `cards` key), confirms before overwriting, then rebuilds derived UI.
   The file input is reset in `finally` so re-importing the same file re-fires
   the change event.
   ========================================================================== */
document.getElementById('exportBtn').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(store,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='japanese-verbs-progress-'+localDay()+'.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});
document.getElementById('importBtn').addEventListener('click',()=>document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change',(e)=>{
  const file=e.target.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      if(typeof data!=='object'||!data.cards){throw new Error('Not a valid progress file');}
      if(!confirm('Replace your current progress with the imported data? This overwrites existing stats.'))return;
      store={cards:data.cards||{},sessions:data.sessions||[],daily:data.daily||{}};
      save();
      updateDeckCount();updateDueBanner();renderBrowse();
      if(document.getElementById('panel-stats').classList.contains('active'))renderStats();
      alert('Progress imported.');
    }catch(err){ alert('Import failed: '+err.message); }
    finally{ e.target.value=''; }
  };
  reader.readAsText(file);
});

/* ============================================================================
   DECK BUILDING — the filter model
   ----------------------------------------------------------------------------
   THE MENTAL MODEL (read this before touching passes()):

     A verb is shown iff it satisfies ALL of:
        (Category/Semantic facet)  AND  (JLPT facet)  AND  (rank in range)

     Within a single facet, the selected tokens are OR'd; ACROSS facets they're
     AND'd, then intersected with the rank range. So:
        type=["godan"]  topic=["emotion"]   →  godan AND emotion (intersection)
        type=["godan","ichidan"]            →  godan OR ichidan  (within facet)
        jlpt=["N5","N4"]                    →  N5 OR N4
     An empty facet array = "no constraint for this facet" (facetMatch/facetAll).

   THE FACETS (formerly one shared OR'd `deck` pool — split per OUTSTANDING #2 so
   grammar AND semantics now intersect instead of union):
        type   – conjugation class: godan / ichidan / irregular / suru / fake
        trans  – transitivity:      trans / intrans / ti-pair
        topic  – semantic tags:     motion / emotion / … (the long tail)
        status – computed:          leech / due
        jlpt   – level (separate, AND'd) + the rank band.
   Each chip's facet is derived from its TOKEN via TOKEN_FACET (topic is the
   default), so the markup is unchanged — chips still carry class .deck/.bf +
   data-deck/data-filter. The single "All" chip clears ALL facets at once
   (master reset); it shows active when every facet is empty.

   Two independent filter states exist:
        cfg   – the flashcard deck picker   (chips: .deck/.jlpt/.ord/.mode)
        bcfg  – the Browse grid filter        (chips: .bf/.bjlpt)
   Both are evaluated by the SAME passes() predicate. Keeping them separate is
   intentional: browsing shouldn't disturb your queued study deck.
   ========================================================================== */

// Does verb v match a single group token d? ('all' matches everything;
// 'leech'/'due' are computed, not tags; class/trans are fields; else it's a tag.)
function oneGroup(v,d){
  if(d==='all')return true;
  if(d==='leech')return isLeech(v.rank);
  if(d==='due')return isDue(v.rank);
  if(d==='minna')return !!v.minna;                         // source facet: any みんなの日本語 card
  if(d==='italki')return !!v.italki;                       // source facet: covered in an iTalki lesson
  if(CATS.includes(d))return (v.cat||'verb')===d;          // part-of-speech facet
  if(['godan','ichidan','irregular'].includes(d))return v.type===d;
  if(d==='suru'||d==='fake')return v.tags.includes(d);
  if(d==='trans')return v.trans==='t';
  if(d==='intrans')return v.trans==='i';
  return v.tags.includes(d);
}
// A facet array imposes no constraint if it's empty or contains 'all'.
function facetAll(arr){ return !arr || arr.length===0 || arr.includes('all'); }
// One AND'd facet: no constraint if empty, else the verb must match one token (OR).
function facetMatch(v,arr){ return !arr || arr.length===0 || arr.some(d=>oneGroup(v,d)); }
// The single source of truth for "should this card appear?" (see model above).
// c = {cat:[],type:[],trans:[],topic:[],status:[], jlpt:[], rmin, rmax}. The five
// token facets AND together; jlpt and rank AND on top. Pure function — easy to
// unit-test. (A missing facet array = no constraint, so older callers still work.)
function passes(v,c){
  if(!facetMatch(v,c.cat))return false;
  if(!facetMatch(v,c.type))return false;
  if(!facetMatch(v,c.trans))return false;
  if(!facetMatch(v,c.topic))return false;
  if(!facetMatch(v,c.status))return false;
  if(!facetMatch(v,c.source))return false;
  if(!facetAll(c.jlpt) && !c.jlpt.includes(v.jlpt))return false;
  if(v.rank<c.rmin || v.rank>c.rmax)return false;                     // rank AND
  return true;
}

/* Generic multi-select chip group. Reused for both cfg and bcfg facets.
     selector – CSS selector for the chip buttons
     getArr/setArr – read/write the backing array in cfg or bcfg
     attr – which data-* attribute holds the token (e.g. 'deck','jlpt','filter')
     onChange – callback after a selection changes (re-render / recount)
   Behavior: 'all' is exclusive (selecting it empties the rest; selecting any
   specific token drops 'all'); deselecting the last specific token falls back
   to ['all'] so a facet is never truly empty in the UI. paint() syncs the
   .active classes to the array (including showing 'all' as active when empty). */
function makeMultiSelect(selector, getArr, setArr, attr, onChange){
  const btns=document.querySelectorAll(selector);
  function paint(){
    const arr=getArr();
    btns.forEach(b=>b.classList.toggle('active', arr.includes(b.dataset[attr]) || (facetAll(arr)&&b.dataset[attr]==='all')));
  }
  btns.forEach(b=>b.addEventListener('click',()=>{
    const val=b.dataset[attr];
    let arr=getArr().filter(x=>x!=='all'); // work on the set sans 'all'
    if(val==='all'){ arr=[]; }
    else if(arr.includes(val)){ arr=arr.filter(x=>x!==val); } // toggle off
    else { arr.push(val); }                                   // toggle on
    setArr(arr.length?arr:['all']);
    paint(); onChange();
  }));
  paint();
}

// ---- Token→facet routing + the AND'd-facet chip wiring ----
// Every category/semantic chip carries class .deck (study) / .bf (browse) + its
// token in data-deck / data-filter. We DERIVE which facet a token belongs to here
// (topic is the default), so the markup needs no per-chip facet attribute.
const DECK_FACETS=['cat','type','trans','topic','status','source'];
const TOKEN_FACET={verb:'cat',adjective:'cat',noun:'cat',adverb:'cat',phrase:'cat',
  godan:'type',ichidan:'type',irregular:'type',suru:'type',fake:'type',
  trans:'trans',intrans:'trans','ti-pair':'trans',leech:'status',due:'status',
  minna:'source',italki:'source'};
// Per-lesson source tokens (mnn-l23 …) route to the source facet too, without
// having to enumerate every lesson number here.
const tokenFacet=t=>TOKEN_FACET[t]||(/^mnn-l\d+$/.test(t)?'source':'topic');
const deckEmpty=c=>DECK_FACETS.every(f=>!c[f].length);
// Wire a chip group (.deck or .bf) to a config's facet arrays. Tokens toggle
// within their derived facet (OR); the lone "all" token clears every facet
// (master reset). Returns paint() so deep-links can resync the chips after
// mutating the config directly. The four facets AND together in passes().
function wireFacets(selector, c, onChange){
  const chips=[...document.querySelectorAll(selector)];
  const tokenOf=b=>b.dataset.deck||b.dataset.filter;
  function paint(){
    chips.forEach(b=>{const t=tokenOf(b);
      b.classList.toggle('active', t==='all'?deckEmpty(c):c[tokenFacet(t)].includes(t));});
  }
  chips.forEach(b=>b.addEventListener('click',()=>{
    const t=tokenOf(b);
    if(t==='all'){ DECK_FACETS.forEach(f=>c[f]=[]); }
    else { const arr=c[tokenFacet(t)], i=arr.indexOf(t); if(i>=0)arr.splice(i,1); else arr.push(t); }
    paint(); onChange();
  }));
  paint();
  return paint;
}

// ---- Flashcard deck config + its chip bindings ----
// mode = test direction; type/trans/topic/status/jlpt = AND'd facets; ord = sort;
// rmin/rmax = rank band. Facet arrays start empty (= no constraint → "All" active).
let cfg={mode:"meaning",input:"self",audio:"off",kind:"free",cat:[],type:[],trans:[],topic:[],status:[],source:[],ord:"shuffle",jlpt:["all"],rmin:1,rmax:MAXRANK};
document.querySelectorAll('.chip.mode').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.chip.mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');cfg.mode=b.dataset.mode;updateDeckCount();}));
// Study type (Free study vs SRS review). SRS restricts the deck to due cards
// (buildDeck) and is the only kind that reschedules (grade); free leaves dates
// untouched. Switching repaints the deck count + Start button label.
document.querySelectorAll('.chip.skind').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.chip.skind').forEach(x=>x.classList.remove('active'));b.classList.add('active');
  cfg.kind=b.dataset.skind; updateDeckCount(); updateStartLabel();}));
// Reflect cfg.kind on the Start button so it's clear which session you're about to run.
function updateStartLabel(){
  const el=document.getElementById('startBtn'); if(!el)return;
  el.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>'+(cfg.kind==='srs'?'Start SRS review':'Start free study');
}
// Input mode (self-graded vs type-the-reading) + audio autoplay. These are now
// backed by the synced `settings` object (the Settings page edits the same
// values); the setup chips just mirror + update settings. bindSingle = the
// single-select chip pattern. paintPrefChips() repaints the chips from settings
// (used at boot and when settings change externally — Settings page / cloud pull).
cfg.input=settings.input;
cfg.audio=settings.audio;
function bindSingle(selector,attr,onSet){
  document.querySelectorAll(selector).forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll(selector).forEach(x=>x.classList.remove('active'));
    b.classList.add('active');onSet(b.dataset[attr]);}));
}
bindSingle('.chip.imode','imode',v=>{cfg.input=v;settings.input=v;saveSettings();});
bindSingle('.chip.amode','amode',v=>{cfg.audio=v;settings.audio=v;saveSettings();});
function paintPrefChips(){
  cfg.input=settings.input; cfg.audio=settings.audio;
  document.querySelectorAll('.chip.imode').forEach(x=>x.classList.toggle('active',x.dataset.imode===settings.input));
  document.querySelectorAll('.chip.amode').forEach(x=>x.classList.toggle('active',x.dataset.amode===settings.audio));
}
paintPrefChips();
const repaintDeck=wireFacets('.chip.deck', cfg, updateDeckCount);
makeMultiSelect('.chip.jlpt', ()=>cfg.jlpt, a=>cfg.jlpt=a, 'jlpt', updateDeckCount);
document.querySelectorAll('.chip.ord').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.chip.ord').forEach(x=>x.classList.remove('active'));b.classList.add('active');cfg.ord=b.dataset.ord;}));
// Rank-range inputs. syncRange() clamps to 1..MAXRANK (MAXRANK extends past 100
// when custom verbs exist) and auto-swaps if lo>hi, so the user can type the
// bounds in either order. Presets just set both inputs.
const rminEl=document.getElementById('rmin'),rmaxEl=document.getElementById('rmax');
function syncRange(){
  let lo=parseInt(rminEl.value)||1, hi=parseInt(rmaxEl.value)||MAXRANK;
  lo=Math.max(1,Math.min(MAXRANK,lo)); hi=Math.max(1,Math.min(MAXRANK,hi));
  if(lo>hi){const t=lo;lo=hi;hi=t;}
  cfg.rmin=lo;cfg.rmax=hi;updateDeckCount();
}
rminEl.addEventListener('change',syncRange);
rmaxEl.addEventListener('change',syncRange);
document.querySelectorAll('.chip.rpreset').forEach(b=>b.addEventListener('click',()=>{
  rminEl.value=b.dataset.lo;rmaxEl.value=b.dataset.hi;syncRange();}));

// Build the ordered list of verbs for a session from the current cfg.
// Note: shuffle is in-place Fisher–Yates; worst-first treats never-drilled
// cards as 100% (??1) so they sort to the back behind genuinely weak cards.
function buildDeck(){
  let d=DATA.filter(v=>passes(v,cfg));
  if(cfg.kind==='srs') d=d.filter(v=>isDue(v.rank));   // SRS review = due cards only
  if(cfg.ord==='shuffle'){for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}}
  else if(cfg.ord==='freq'){d.sort((a,b)=>a.rank-b.rank);}
  else if(cfg.ord==='worst'){d.sort((a,b)=>{const ra=rollingAcc(a.rank)??1,rb=rollingAcc(b.rank)??1;return ra-rb;});}
  return d;
}
// Token → human label for the active-filter recap line. Shared by both panels
// (deck/bf tokens are identical). Drives filterSummary() below.
const DECK_LABEL={verb:'Verb',adjective:'Adjective',noun:'Noun',adverb:'Adverb',phrase:'Phrase',godan:'Godan',ichidan:'Ichidan',irregular:'Irregular',suru:'Suru',fake:'Fake-ichidan',trans:'Transitive',intrans:'Intransitive','ti-pair':'T/I pairs',leech:'Leeches',due:'Due cards',motion:'Motion',transit:'Transit',wearing:'Wearing',speaking:'Speaking',communication:'Communication',giving:'Giving/Recv',emotion:'Emotion',cognition:'Cognition',perception:'Perception',existence:'Existence',change:'Change',ability:'Ability',onoff:'On/Off',daily:'Daily',body:'Body',work:'Work',study:'Study',food:'Food',money:'Money',minna:'みんなの日本語',italki:'iTalki'};
// Token → recap label. Per-lesson source tokens (mnn-l23) render as "L23".
function deckLabel(t){ const m=/^mnn-l(\d+)$/.exec(t); return m?('L'+m[1]):(DECK_LABEL[t]||t); }
// Build the active-facet parts for a config (one part per non-empty facet, so the
// recap reads as the AND it now is: "Godan · Motion · rank 1–25"). Tokens within a
// facet join with '/', the parts join with '·' in paintSummary.
function filterSummary(c){
  const parts=[];
  [c.cat,c.type,c.trans,c.topic,c.status,c.source].forEach(arr=>{
    if(arr&&arr.length) parts.push(arr.map(deckLabel).join('/'));
  });
  if(!facetAll(c.jlpt)) parts.push(c.jlpt.join('/'));
  if(c.rmin>1||c.rmax<100) parts.push('rank '+c.rmin+'–'+c.rmax);
  return parts;
}
// Paint the recap into a #id element; hidden (:empty) when nothing is filtered.
function paintSummary(id,parts){
  const el=document.getElementById(id); if(!el)return;
  el.innerHTML = parts.length
    ? '<svg class="ic" aria-hidden="true"><use href="#i-filter"/></svg>Filtering: '+parts.map(p=>'<b>'+p+'</b>').join(' · ')
    : '';
}
// Hide the verb-only filter rows (Type / Transitivity — conjugation-class and
// transitivity are meaningless for nouns/adverbs/phrases) when the Category facet
// is set to exclude verbs; clear any stranded type/trans tokens so the deck isn't
// silently empty. Kept per-panel (one config + its repaint fn) so the study path,
// which runs at boot before bcfg exists, never touches the browse config (TDZ).
function syncVerbRows(sel,c,repaint){
  const show=!c.cat.length||c.cat.includes('verb');
  document.querySelectorAll(sel+' .frow.verb-only').forEach(r=>{r.style.display=show?'':'none';});
  if(!show&&(c.type.length||c.trans.length)){ c.type=[]; c.trans=[]; repaint(); }
}
// Live "N cards in deck" readout under the Start button + filter recap.
function updateDeckCount(){
  syncVerbRows('#panel-study',cfg,repaintDeck);
  const n=DATA.filter(v=>passes(v,cfg) && (cfg.kind!=='srs'||isDue(v.rank))).length;
  document.getElementById('deckCount').innerHTML=`<b>${n}</b> ${cfg.kind==='srs'?'due in this deck':'cards in deck'}`;
  paintSummary('deckSummary', filterSummary(cfg));
}
// SRS banner: count due cards, and flip to the green "all caught up" state at 0.
function updateDueBanner(){
  const n=dueCards().length;
  document.getElementById('dueCount').textContent=n;
  const banner=document.getElementById('dueBanner');
  banner.classList.toggle('empty', n===0);
  document.getElementById('dueBtn').disabled = n===0;
  document.getElementById('dueBtn').innerHTML = n===0
    ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>All caught up'
    : '<svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>Review due cards';
  renderForecast();   // the due count and the forecast both reflect the schedule — refresh together
}
// "Review due cards": force the deck to due-only, worst-first, full range, and
// reflect that in the chip UI before starting. This overrides the user's
// current picker selection on purpose — it's a dedicated review flow.
function startDueSession(){
  cfg.kind='srs';cfg.type=[];cfg.trans=[];cfg.topic=[];cfg.status=['due'];cfg.source=[];cfg.jlpt=['all'];cfg.rmin=1;cfg.rmax=100;cfg.ord='worst';
  repaintDeck();
  document.querySelectorAll('.chip.skind').forEach(x=>x.classList.toggle('active',x.dataset.skind==='srs'));
  document.querySelectorAll('.chip.jlpt').forEach(x=>x.classList.toggle('active',x.dataset.jlpt==='all'));
  document.getElementById('rmin').value=1;document.getElementById('rmax').value=100;
  document.querySelectorAll('.chip.ord').forEach(x=>x.classList.toggle('active',x.dataset.ord==='worst'));
  updateStartLabel();
  startSession();
}
updateDeckCount();
updateDueBanner();
updateStartLabel();

/* ============================================================================
   FLASHCARD SESSION
   ----------------------------------------------------------------------------
   Lifecycle: startSession() builds a deck and shows the first card →
   showCard() renders the current card (prompt only) → reveal() exposes the
   answer → grade() records the result (updates stats + SRS + persists) and
   advances → at the end, endSession() logs the session/daily totals and shows
   the score screen.

   `session` holds only ephemeral run state (the deck, the index, whether the
   answer is shown, and a results array for the end-screen %). Durable data
   goes straight into `store` via cardStat()/scheduleCard().
   ========================================================================== */
let session=null;

// ---- Text-to-speech ----
// Preferred path: the server's Google Translate TTS proxy (GET /v1/tts), which
// gives consistent, good ja-JP audio — far better than the browser's uneven
// speechSynthesis voices. It needs a server, so we only use it when the app is
// served over http(s); over file:// (or if the request fails) we fall back to
// speechSynthesis. Audio is available if EITHER path exists.
const HTTP_SERVED = location.protocol==='http:' || location.protocol==='https:';
const SPEECH_OK = typeof window!=='undefined' && 'speechSynthesis' in window;
const TTS_OK = HTTP_SERVED || SPEECH_OK;     // is any audio available? (gates the Audio UI)
let jaVoice=null;
function pickVoice(){
  if(!SPEECH_OK)return;
  const vs=speechSynthesis.getVoices();
  jaVoice = vs.find(v=>v.lang==='ja-JP') || vs.find(v=>v.lang&&v.lang.toLowerCase().startsWith('ja')) || null;
}
if(SPEECH_OK){ pickVoice(); speechSynthesis.addEventListener('voiceschanged',pickVoice); }
// Browser-synth fallback.
function speakSynth(text){
  if(!SPEECH_OK)return;
  try{
    speechSynthesis.cancel();                 // never stack/overlap utterances
    const u=new SpeechSynthesisUtterance(text);
    u.lang='ja-JP'; u.rate=0.9; if(jaVoice)u.voice=jaVoice;
    speechSynthesis.speak(u);
  }catch(e){/* speech is best-effort; ignore */}
}
// Reused <audio> for the server path so a new play() interrupts the previous one.
let ttsAudio=null;
function speak(text){
  if(!text)return;
  if(SPEECH_OK)try{speechSynthesis.cancel();}catch(e){}   // stop any in-flight synth
  if(HTTP_SERVED){
    try{
      if(!ttsAudio)ttsAudio=new Audio();
      ttsAudio.src='/v1/tts?text='+encodeURIComponent(text);
      const p=ttsAudio.play();
      if(p&&p.catch)p.catch(()=>speakSynth(text));         // network/format/autoplay fail → synth
    }catch(e){ speakSynth(text); }
  }else{
    speakSynth(text);
  }
}
// What text to hand the TTS for a card. Google TTS derives pitch accent from the
// WRITTEN form, so a kana-only reading is accent-ambiguous for homographs (橋 "bridge"
// vs 箸 "chopsticks" are both はし). Sending the kanji headword lets Google apply the
// dictionary accent. Kana-only words have no kanji to send, so they use the reading.
// `v.tts` is an optional per-card override (escape hatch for an ambiguous single kanji
// that Google misreads, e.g. 角 → つの). The visible reading is always v.read regardless.
const HAS_KANJI=/[一-龯々々〆]/;
function ttsText(v){ return v.tts || (v.jp && HAS_KANJI.test(v.jp) ? v.jp : v.read); }
function speakWord(v){ speak(ttsText(v)); }
function playReading(){ if(session)speakWord(session.deck[session.i]); }
// Hide the audio affordances entirely only when NO audio path is available.
if(!TTS_OK){
  const ar=document.getElementById('audioRow'); if(ar)ar.style.display='none';
  const sb=document.getElementById('speakBtn'); if(sb)sb.style.display='none';
}
// Normalize kana for typed grading: fold katakana→hiragana, drop spaces/separators,
// unify long-vowel marks. v.read is already hiragana, so this forgives a katakana
// IME, stray whitespace, and ASCII/full-width chōonpu variants.
function normKana(s){
  return (s||'').trim()
    .replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60))
    .replace(/[\s　・･、。.]/g,'')
    .replace(/[ー－―‐-―~～]/g,'ー')
    .toLowerCase();
}
// Romaji→hiragana for the typed-reading field, so a learner WITHOUT a Japanese
// IME can type "taberu" and have it graded against たべる. Greedy longest-match
// Hepburn with the common wāpuro variants (si/shi, tu/tsu, hu/fu, zi/ji, sya/sha,
// double-consonant→っ, n'/nn/trailing-n→ん). Anything not in the table — including
// characters that are ALREADY kana — passes through untouched, so a kana IME and a
// romaji typist flow through the same code path; submitTyped runs the result back
// through normKana before comparing. This feeds only the ADVISORY typed grade,
// never the SRS schedule, so over-permissiveness is harmless. (This relaxes the
// old "normKana is deliberately not romaji-aware" stance — per request.)
const ROMAJI={
  kya:'きゃ',kyu:'きゅ',kyo:'きょ',gya:'ぎゃ',gyu:'ぎゅ',gyo:'ぎょ',
  sha:'しゃ',shu:'しゅ',sho:'しょ',shi:'し',sya:'しゃ',syu:'しゅ',syo:'しょ',
  cha:'ちゃ',chu:'ちゅ',cho:'ちょ',chi:'ち',cya:'ちゃ',cyu:'ちゅ',cyo:'ちょ',
  tya:'ちゃ',tyu:'ちゅ',tyo:'ちょ',tsu:'つ',
  nya:'にゃ',nyu:'にゅ',nyo:'にょ',hya:'ひゃ',hyu:'ひゅ',hyo:'ひょ',
  mya:'みゃ',myu:'みゅ',myo:'みょ',rya:'りゃ',ryu:'りゅ',ryo:'りょ',
  bya:'びゃ',byu:'びゅ',byo:'びょ',pya:'ぴゃ',pyu:'ぴゅ',pyo:'ぴょ',
  jya:'じゃ',jyu:'じゅ',jyo:'じょ',zya:'じゃ',zyu:'じゅ',zyo:'じょ',
  dya:'ぢゃ',dyu:'ぢゅ',dyo:'ぢょ',
  ka:'か',ki:'き',ku:'く',ke:'け',ko:'こ',ga:'が',gi:'ぎ',gu:'ぐ',ge:'げ',go:'ご',
  sa:'さ',si:'し',su:'す',se:'せ',so:'そ',za:'ざ',zi:'じ',ji:'じ',zu:'ず',ze:'ぜ',zo:'ぞ',
  ta:'た',ti:'ち',tu:'つ',te:'て',to:'と',da:'だ',di:'ぢ',du:'づ',de:'で',do:'ど',
  na:'な',ni:'に',nu:'ぬ',ne:'ね',no:'の',ha:'は',hi:'ひ',hu:'ふ',fu:'ふ',he:'へ',ho:'ほ',
  fa:'ふぁ',fi:'ふぃ',fe:'ふぇ',fo:'ふぉ',
  ba:'ば',bi:'び',bu:'ぶ',be:'べ',bo:'ぼ',pa:'ぱ',pi:'ぴ',pu:'ぷ',pe:'ぺ',po:'ぽ',
  ma:'ま',mi:'み',mu:'む',me:'め',mo:'も',ya:'や',yu:'ゆ',yo:'よ',
  ra:'ら',ri:'り',ru:'る',re:'れ',ro:'ろ',wa:'わ',wo:'を',wi:'うぃ',we:'うぇ',
  ja:'じゃ',ju:'じゅ',jo:'じょ',
  a:'あ',i:'い',u:'う',e:'え',o:'お',
};
function romajiToKana(input){
  const s=(input||'').toLowerCase();
  let out='',i=0;
  while(i<s.length){
    const c=s[i],c2=s[i+1];
    if(c==='n'&&c2==="'"){out+='ん';i+=2;continue;}                       // n' → ん (explicit boundary)
    if(c==='n'&&c2==='n'){out+='ん';i+=1;continue;}                       // nn → ん, the 2nd n starts the next syllable
    if(c==='t'&&c2==='c'){out+='っ';i+=1;continue;}                       // tch → っ + ch (matcha → まっちゃ)
    if(c===c2&&'bcdfghjkmpqrstvwz'.indexOf(c)>=0){out+='っ';i+=1;continue;} // doubled consonant → っ (kitte → きって)
    const t3=s.substr(i,3),t2=s.substr(i,2),t1=s[i];
    if(ROMAJI[t3]){out+=ROMAJI[t3];i+=3;}
    else if(ROMAJI[t2]){out+=ROMAJI[t2];i+=2;}
    else if(ROMAJI[t1]){out+=ROMAJI[t1];i+=1;}
    else if(t1==='n'){out+='ん';i+=1;}                                    // bare n (word end / before a consonant)
    else{out+=t1;i+=1;}                                                   // unknown / already-kana → pass through
  }
  return out;
}

function startSession(){
  const deck=buildDeck();
  if(!deck.length){alert(cfg.kind==='srs'?"Nothing is due in that deck right now — switch to Free study to practice anyway.":"No cards in that deck yet.");return;}
  session={deck,i:0,revealed:false,results:[],kind:cfg.kind};
  document.getElementById('fcSetup').style.display='none';
  document.getElementById('fcDone').classList.remove('active');
  document.getElementById('fcStage').classList.add('active');
  showCard();
}
// Render session.deck[session.i]. The two test directions swap which fields are
// the prompt vs the answer. NOTE: prompt JP uses innerHTML (v.jp may carry
// markup); reading/meaning use textContent. The mnemonic+tip always show on
// the answer side as the "why".
// ---- Leveled-example UI (answer side) ----
// The chosen tier is the synced setting `settings.exampleLevel` (also the default
// for Browse). Disabled tiers (no sentence for this verb) can't be picked; if the
// saved tier is unavailable we fall back to the verb's own JLPT level, then the
// easiest available. The whole block hides when the verb has no example at all.
function renderExample(v){
  const block=document.getElementById('exampleBlock'), seg=document.getElementById('exLevels');
  const tiers=availableTiers(v);
  if(tiers.length){
    seg.style.display='';
    seg.innerHTML=JLPT_TIERS.map(t=>`<button class="chip exlv" type="button" data-exlv="${t}"${tiers.includes(t)?'':' disabled'}>${t}</button>`).join('');
  }else{ seg.style.display='none'; seg.innerHTML=''; }
  let lvl=settings.exampleLevel;
  if(tiers.length && !tiers.includes(lvl)) lvl = tiers.includes(v.jlpt)?v.jlpt:tiers[0];
  [...seg.querySelectorAll('.exlv')].forEach(b=>b.classList.toggle('active', b.dataset.exlv===lvl && !b.disabled));
  const ex=exampleForLevel(v,lvl);
  if(ex){ document.getElementById('exJp').innerHTML=ex[0]; document.getElementById('exEn').textContent=ex[1]; block.hidden=false; }
  else block.hidden=true;
}
// Pick a tier → remember it (synced setting) → re-render the current card's example.
document.getElementById('exLevels').addEventListener('click',e=>{
  const b=e.target.closest('.exlv'); if(!b||b.disabled)return;
  settings.exampleLevel=b.dataset.exlv; saveSettings();
  if(session) renderExample(session.deck[session.i]);
});

// Jisho.org dictionary deep-link for a headword. Shown on the answer side of the
// flashcard and in the Browse detail modal. encodeURIComponent keeps kanji/kana
// valid in the URL path (e.g. 食べる → /word/%E9%A3%9F%E3%81%B9%E3%82%8B).
function jishoUrl(jp){ return 'https://jisho.org/word/'+encodeURIComponent(jp); }
function showCard(){
  const v=session.deck[session.i];
  session.revealed=false;
  document.getElementById('fcProgress').textContent=`Card ${session.i+1} of ${session.deck.length}`;
  const fc=document.getElementById('flashcard');
  fc.className='flashcard '+colorClass(v);   // sets the colored spine via CSS
  void fc.offsetWidth; fc.classList.add('card-in');   // restart the card-advance entrance animation
  if(cfg.mode==='meaning'){            // JP shown → recall meaning + reading
    document.getElementById('promptLabel').textContent='Read this — give meaning + reading';
    document.getElementById('promptMain').className='prompt-main jp';
    document.getElementById('promptMain').innerHTML=v.jp;
    document.getElementById('promptSub').textContent='';
    document.getElementById('aRead').className='a-read jp';
    document.getElementById('aRead').textContent=v.read;
    document.getElementById('aMean').textContent=v.mean;
  }else{                               // meaning shown → recall reading + kanji
    document.getElementById('promptLabel').textContent='Give the reading + kanji';
    document.getElementById('promptMain').className='prompt-main';
    document.getElementById('promptMain').textContent=v.mean;
    document.getElementById('promptSub').textContent=cardStamp(v).label;
    document.getElementById('aRead').className='a-read jp';
    document.getElementById('aRead').innerHTML=v.read+' &nbsp; '+v.jp;
    document.getElementById('aMean').textContent='';
  }
  document.getElementById('aNote').innerHTML=v.mnem+(v.tip?'<br><br>'+v.tip:'');
  document.getElementById('jishoLink').href=jishoUrl(v.jp);   // dictionary deep-link
  renderExample(v);                                   // leveled example (shown once revealed)
  document.getElementById('answer').classList.remove('show');
  // Reset the answer affordances for this card. Typed mode shows the kana input;
  // self-graded shows the Reveal button. Grade buttons (+ any "suggested" ring and
  // the typed verdict) start hidden; session.suggested clears so Enter won't grade.
  const typed=cfg.input==='type';
  document.getElementById('revealRow').style.display=typed?'none':'flex';
  document.getElementById('inputRow').style.display=typed?'flex':'none';
  document.getElementById('gradeRow').style.display='none';
  document.getElementById('wrongBtn').classList.remove('suggested');
  document.getElementById('rightBtn').classList.remove('suggested');
  document.getElementById('typedVerdict').hidden=true;
  session.suggested=undefined;
  const inp=document.getElementById('answerInput');
  inp.value=''; inp.disabled=false;
  if(typed) setTimeout(()=>inp.focus(),0);
}
// Show the answer side (shared by self-graded Reveal and typed Check). Autoplays
// the reading when Audio=Auto. Sets session.revealed so grading is permitted.
function revealAnswer(){
  session.revealed=true;
  document.getElementById('answer').classList.add('show');
  if(cfg.audio==='auto') playReading();
}
// Self-graded path: reveal, then flip to the two grade buttons.
function reveal(){
  revealAnswer();
  document.getElementById('revealRow').style.display='none';
  document.getElementById('gradeRow').style.display='flex';
}
// Typed path: grade the typed kana against v.read, reveal the answer + a verdict,
// then surface the grade buttons with the auto-judged one emphasized. The verdict
// is ADVISORY — the user can still override (typo forgiveness) via 1/2 or a click;
// pressing Enter again accepts the suggested grade. session.suggested drives that.
function submitTyped(){
  const inp=document.getElementById('answerInput');
  if(inp.disabled)return;                          // guard double-submit
  const v=session.deck[session.i];
  const correct=normKana(romajiToKana(inp.value))===normKana(v.read);
  session.suggested=correct;
  inp.disabled=true;
  revealAnswer();
  const verdict=document.getElementById('typedVerdict');
  verdict.hidden=false;
  verdict.className='verdict '+(correct?'ok':'bad');
  verdict.innerHTML = correct
    ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>Correct'
    : '<svg class="ic" aria-hidden="true"><use href="#i-x"/></svg>You typed “'+escapeHtml(inp.value.trim()||'—')+'”';
  document.getElementById('inputRow').style.display='none';
  document.getElementById('gradeRow').style.display='flex';
  document.getElementById('wrongBtn').classList.toggle('suggested',!correct);
  document.getElementById('rightBtn').classList.toggle('suggested',correct);
}
// Record one result: append to attempts + accuracy counters (BOTH study kinds —
// free study still feeds accuracy/leech stats), then persist NOW (mid-session
// crash safety). The SRS SCHEDULE only advances for a card that's actually DUE,
// and only in an SRS session OR (in free study) when the freeReviewDue setting is
// on — so reviewing a NOT-due card early never bumps its box/next-review date.
function grade(correct){
  const v=session.deck[session.i];
  const c=cardStat(v.rank);
  c.attempts.push(correct?1:0);
  if(correct)c.right++;else c.wrong++;
  if(isDue(v.rank) && (session.kind==='srs' || settings.freeReviewDue)) scheduleCard(c,correct);
  session.results.push(correct?1:0);
  save();
  session.i++;
  if(session.i>=session.deck.length){endSession();}
  else{showCard();}
}
// Log the finished session into store.sessions (capped at 200) and roll its
// totals into today's store.daily bucket (local date). Then show the score.
// Guarded by results.length so an immediate "End session" with no grades is a
// no-op for stats. (Per-card stats were already saved in grade().)
// Local sessions kept for the Stats charts. Capped (the blob is synced whole), but
// the DURABLE record is the server-side study_sessions log (logSession below) — so
// even past this cap, no session history is ever lost for a signed-in user.
const SESSIONS_LOCAL_CAP=1000;
// Append a finished session to the durable server log (fire-and-forget; signed-in
// only). Local + blob already hold it — this just guarantees it's never pruned.
function logSession(right,tot,kind){
  if(typeof account==='undefined' || !account)return;
  // `mode` keeps the test direction (server column); `details.kind` carries the
  // SRS/free distinction so the durable log can differentiate the two.
  try{ api('/v1/sessions',{method:'POST',body:{right,total:tot,mode:cfg.mode,details:{kind,direction:cfg.mode}}}).catch(()=>{}); }catch(e){}
}
function endSession(){
  document.getElementById('fcStage').classList.remove('active');
  // Ended with nothing graded (e.g. immediate "End session") → don't show an empty
  // score card; just return to the picker.
  if(!session || !session.results.length){
    document.getElementById('fcDone').classList.remove('active');
    document.getElementById('fcSetup').style.display='block';
    updateDeckCount();updateDueBanner();updateStartLabel();
    return;
  }
  const right=session.results.reduce((s,x)=>s+x,0),tot=session.results.length;
  store.sessions.push({t:Date.now(),right,tot,kind:session.kind});
  if(store.sessions.length>SESSIONS_LOCAL_CAP)store.sessions=store.sessions.slice(-SESSIONS_LOCAL_CAP);
  const day=localDay();
  if(!store.daily[day])store.daily[day]={right:0,tot:0};
  store.daily[day].right+=right;store.daily[day].tot+=tot;
  save();                            // localStorage + debounced progress-blob push
  logSession(right,tot,session.kind); // durable append-only server log (never pruned)
  document.getElementById('doneScore').textContent=Math.round(100*right/tot)+'%';
  document.getElementById('doneDetail').textContent=`${right} of ${tot} correct`;
  if(typeof maybeShowSignup==='function')maybeShowSignup();   // nudge after first real session
  document.getElementById('fcDone').classList.add('active');
}
// Button wiring for the session controls.
document.getElementById('startBtn').addEventListener('click',()=>startSession());
document.getElementById('dueBtn').addEventListener('click',startDueSession);
// Forecast horizon toggle (24h/week/month/year): view-only, re-renders the bars.
document.getElementById('fcHorizons').addEventListener('click',e=>{
  const b=e.target.closest('.fch'); if(!b)return;
  forecastHorizon=b.dataset.h;
  document.querySelectorAll('.fch').forEach(x=>x.classList.toggle('active',x===b));
  renderForecast();
});
document.getElementById('revealBtn').addEventListener('click',reveal);
document.getElementById('checkBtn').addEventListener('click',submitTyped);
document.getElementById('speakBtn').addEventListener('click',playReading);
// Enter inside the kana field submits the typed answer (the global handler skips
// keys while the field is focused, so this is the one place Enter→submit lives).
document.getElementById('answerInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();submitTyped();}
});
document.getElementById('wrongBtn').addEventListener('click',()=>grade(false));
document.getElementById('rightBtn').addEventListener('click',()=>grade(true));
document.getElementById('endBtn').addEventListener('click',endSession);
// "Study again" returns to the picker and refreshes the live counts/banner.
document.getElementById('againBtn').addEventListener('click',()=>{
  document.getElementById('fcDone').classList.remove('active');
  document.getElementById('fcSetup').style.display='block';
  updateDeckCount();updateDueBanner();updateStartLabel();
});
// Keyboard shortcuts (only while a card is on screen, and not while typing in the
// kana field — Enter-to-submit is bound on the input itself).
//   Before reveal: Space/Enter flips the card (typed mode: Enter submits instead).
//   After reveal:  Space / Enter / 2  → CORRECT ;  X / 1  → WRONG.
document.addEventListener('keydown',e=>{
  if(!document.getElementById('fcStage').classList.contains('active'))return;
  if(e.target===document.getElementById('answerInput'))return;   // field owns its keys
  const k=e.key, isSpace=e.code==='Space', isEnter=k==='Enter';
  if(!session.revealed){
    if(cfg.input==='type'){ if(isEnter){e.preventDefault();submitTyped();} }   // typed: Enter submits
    else if(isSpace||isEnter){ e.preventDefault(); reveal(); }                  // self: flip
    return;
  }
  // Revealed → grade. Space/Enter/2 mark correct; X/1 mark wrong.
  if(isSpace||isEnter||k==='2'){ e.preventDefault(); grade(true); }
  else if(k==='1'||k==='x'||k==='X'){ e.preventDefault(); grade(false); }
});

/* ============================================================================
   BROWSE — the reference grid. Independent filter state (bcfg) from the study
   deck, but evaluated by the same passes() predicate, plus a free-text search
   over reading/kanji/meaning. Cards are built as innerHTML strings (fine at
   100 rows; if the deck grows large, switch to a template/fragment for perf).
   Clicking a card toggles .open to expand the detail (CSS max-height anim).
   ========================================================================== */
let bcfg={cat:[],type:[],trans:[],topic:[],status:[],source:[],jlpt:['all'],rmin:1,rmax:MAXRANK};
const repaintBrowse=wireFacets('.chip.bf', bcfg, renderBrowse);
makeMultiSelect('.chip.bjlpt', ()=>bcfg.jlpt, a=>bcfg.jlpt=a, 'jlpt', renderBrowse);
const brmin=document.getElementById('brmin'),brmax=document.getElementById('brmax');
// Same clamp+swap behavior as the study-deck range (see syncRange).
function bSyncRange(){
  let lo=parseInt(brmin.value)||1,hi=parseInt(brmax.value)||MAXRANK;
  lo=Math.max(1,Math.min(MAXRANK,lo));hi=Math.max(1,Math.min(MAXRANK,hi));
  if(lo>hi){const t=lo;lo=hi;hi=t;}
  bcfg.rmin=lo;bcfg.rmax=hi;renderBrowse();
}
brmin.addEventListener('change',bSyncRange);
brmax.addEventListener('change',bSyncRange);
document.getElementById('search').addEventListener('input',renderBrowse);

/* Collapsible Topic groups (filter redesign). The chips inside stay wired by
   their .bf / .deck class + data-* attr (makeMultiSelect doesn't care about DOM
   nesting); this only toggles a max-height region and keeps a live "· N" badge
   on the toggle so active topics remain visible while collapsed. A MutationObserver
   on the region's class attrs keeps the badge correct even when selections change
   programmatically (Reset / Study-leeches / due-session). Open state persists
   per-panel in localStorage. */
function setupTopicGroups(){
  document.querySelectorAll('.topic-toggle').forEach(btn=>{
    const region=document.getElementById(btn.dataset.target);
    if(!region)return;
    const base=btn.dataset.label||'Topics', txt=btn.querySelector('.tt-text');
    const key='jpverbs_topic_'+btn.dataset.target;
    function setOpen(open){
      region.classList.toggle('open',open);
      btn.classList.toggle('open',open);
      btn.setAttribute('aria-expanded',open?'true':'false');
    }
    function refresh(){
      const n=region.querySelectorAll('.chip.active').length;
      txt.textContent = n ? base+' · '+n : base;
      btn.classList.toggle('has-active', n>0);
    }
    btn.addEventListener('click',()=>{
      const open=!region.classList.contains('open');
      setOpen(open); localStorage.setItem(key, open?'1':'0');
    });
    new MutationObserver(refresh).observe(region,{subtree:true,attributes:true,attributeFilter:['class']});
    setOpen(localStorage.getItem(key)==='1');
    refresh();
  });
}
setupTopicGroups();

/* ============================================================================
   ACCESSIBILITY — roving tabindex for chip groups (OUTSTANDING #4).
   ----------------------------------------------------------------------------
   Each filter row (every `.chips` track + each open `.topic-inner`) becomes ONE
   tab stop instead of N: only one chip in the group is tabbable (tabindex 0),
   the rest are tabindex -1. ←/→ (and ↑/↓) move within the group, Home/End jump
   to the ends, and the tab stop follows the selected/last-focused chip so Tab
   returns where you left off.

   TWO flavours, chosen by the container's role:
   - MULTI-select facet rows (Category/Type/Transitivity/Topic/Status/JLPT,
     topics) are role=group TOOLBAR semantics: arrows only MOVE focus — Space/
     Enter toggles a chip through its existing makeMultiSelect click handler.
   - SINGLE-select rows opt into role=radiogroup IN THE MARKUP (Study type, Test
     direction, Input, Audio, Order). There arrows MOVE THE SELECTION the way a
     native radio group does: each chip is role=radio with aria-checked mirrored
     from its `.active` class, and the checked chip is the lone tab stop. Arrowing
     reuses the chip's own click handler so cfg/settings/repaint stay centralized.

   `button.chip` only, so the Font `<select>` and the rank number inputs stay
   normal tab stops (focus on them returns -1 from indexOf → arrows fall through
   to native behavior). Collapsed `.topic-inner` chips are pulled OUT of the tab
   order entirely (a MutationObserver on the region's `open` class), fixing the
   pre-existing wart where the visually-hidden topic chips were still focusable.
   ========================================================================== */
function setupRoving(container){
  const items=[...container.querySelectorAll('button.chip')];
  if(!items.length)return;
  // Single-select rows declare role=radiogroup in the markup; everything else is
  // a multi-select toolbar group.
  const isRadio=container.getAttribute('role')==='radiogroup';
  if(!isRadio)container.setAttribute('role','group');
  // a label (from the row's .filter-label) for screen readers.
  if(!container.getAttribute('aria-label')){
    const lbl=container.previousElementSibling;
    const txt=lbl&&lbl.classList.contains('filter-label')?lbl.textContent.trim()
      :(container.closest('.topic-region')?'Topics':'');
    if(txt)container.setAttribute('aria-label',txt);
  }
  // nav() = the currently-enabled chips (disabled levels like empty N2/N1 are
  // skipped, recomputed each keypress so it tracks dynamic disabled state).
  const nav=()=>items.filter(b=>!b.disabled);
  const active=items.find(el=>el.classList.contains('active')&&!el.disabled);
  let stop=active||nav()[0]||items[0];
  const setStop=el=>{stop=el;items.forEach(x=>x.tabIndex=x===el?0:-1);};
  setStop(stop);
  // Radiogroup: each chip is role=radio; keep aria-checked AND the tab stop synced
  // to `.active`. reflect() runs SYNCHRONOUSLY on activation — the chip's click
  // bubbles here AFTER its single-select handler flipped `.active`, so focus always
  // lands on already-correct state (no microtask lag for the AT to catch) — and via
  // a class observer for programmatic selection (paintPrefChips / a deep-link that
  // toggles `.active` without a click).
  if(isRadio){
    const reflect=()=>items.forEach(el=>{
      const on=el.classList.contains('active');
      el.setAttribute('aria-checked',on?'true':'false');
      if(on&&!el.disabled)setStop(el);
    });
    items.forEach(el=>el.setAttribute('role','radio'));
    reflect();
    container.addEventListener('click',reflect);
    items.forEach(el=>new MutationObserver(reflect).observe(el,{attributes:true,attributeFilter:['class']}));
  }
  // In a radiogroup arrow keys also activate the option (radios select on move);
  // el.click() routes through the chip's existing single-select handler (and the
  // container click listener above reflects aria-checked synchronously).
  function focusInNav(list,n){const el=list[(n+list.length)%list.length];if(el){if(isRadio)el.click();setStop(el);el.focus();}}
  container.addEventListener('keydown',e=>{
    const list=nav(), i=list.indexOf(document.activeElement);
    if(i<0)return;                                   // focus on a non-chip (e.g. rank input)
    if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();focusInNav(list,i+1);}
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();focusInNav(list,i-1);}
    else if(e.key==='Home'){e.preventDefault();focusInNav(list,0);}
    else if(e.key==='End'){e.preventDefault();focusInNav(list,list.length-1);}
  });
  items.forEach(el=>el.addEventListener('focus',()=>setStop(el)));  // tab stop follows focus
  // Collapsed topic chips must not be focusable. Mirror the region's open state.
  const region=container.closest('.topic-region');
  if(region){
    const sync=()=>{
      if(region.classList.contains('open'))setStop(stop);
      else items.forEach(el=>el.tabIndex=-1);
    };
    new MutationObserver(sync).observe(region,{attributes:true,attributeFilter:['class']});
    sync();
  }
}
// Disable JLPT level chips with no verbs in the current dataset (the 100 frequent
// verbs are almost all N5–N4, so N2/N1 are typically empty) rather than offering a
// dead filter; annotate a count tooltip on the rest. Covers both panels' chips and
// re-runs when DATA changes (custom verbs may populate a previously-empty level).
function annotateJlptChips(){
  const counts={};
  DATA.forEach(v=>{counts[v.jlpt]=(counts[v.jlpt]||0)+1;});
  document.querySelectorAll('.chip.jlpt,.chip.bjlpt').forEach(b=>{
    const lv=b.dataset.jlpt;
    if(lv==='all'){ b.title='All levels'; return; }
    const n=counts[lv]||0;
    b.disabled = n===0;
    b.title = n===0 ? `No cards at ${lv} in this deck` : `${n} card${n===1?'':'s'} at ${lv}`;
  });
}
annotateJlptChips();
// Same treatment for the part-of-speech category chips: all 100 built-ins are
// verbs, so Adjective/Noun/Adverb/Phrase start disabled and light up only once a
// custom card of that category exists. Roving nav skips disabled chips already.
function annotateCatChips(){
  const counts={};
  DATA.forEach(v=>{const c=v.cat||'verb';counts[c]=(counts[c]||0)+1;});
  document.querySelectorAll('.chip.deck,.chip.bf').forEach(b=>{
    const t=b.dataset.deck||b.dataset.filter;
    if(!CATS.includes(t))return;
    const n=counts[t]||0;
    b.disabled = n===0;
    b.title = n===0 ? `No ${t}s yet — add one in Browse` : `${n} ${t}${n===1?'':'s'}`;
  });
}
annotateCatChips();
// Source facet (みんなの日本語 / iTalki / per-lesson) only applies once Minna vocab
// has been activated. Hide the whole Source row when the deck has no Minna cards;
// otherwise dim individual source chips that currently match nothing. Same shape
// as annotateCatChips; runs at boot and on every DATA change.
function annotateSourceChips(){
  const hasMinna=DATA.some(v=>v.minna);
  document.querySelectorAll('.frow.source-row').forEach(r=>{r.style.display=hasMinna?'':'none';});
  if(!hasMinna)return;
  const counts={minna:0,italki:0};
  DATA.forEach(v=>{ if(v.minna)counts.minna++; if(v.italki)counts.italki++;
    (v.tags||[]).forEach(t=>{ if(/^mnn-l\d+$/.test(t))counts[t]=(counts[t]||0)+1; }); });
  document.querySelectorAll('.chip.deck,.chip.bf').forEach(b=>{
    const t=b.dataset.deck||b.dataset.filter;
    if(t!=='minna'&&t!=='italki'&&!/^mnn-l\d+$/.test(t))return;
    const n=counts[t]||0;
    b.disabled=n===0;
    b.title=n===0?'No cards with this source yet':`${n} card${n===1?'':'s'}`;
  });
}
annotateSourceChips();
document.querySelectorAll('.chips, .topic-inner').forEach(setupRoving);

/* ---- Browse detail modal ----
   Clicking a card opens this instead of expanding inline, so the grid stays scannable
   and we don't dump everything at once. Core identity is always shown; Mnemonic,
   Trap/tip and Example sentences are collapsible <details> (Mnemonic open by default).
   The Examples section is JLPT-level-filtered — a selector defaulting to
   settings.exampleLevel, showing one tier at a time (local view, doesn't change the
   global default). detailVerb/detailLevel hold the open modal's state. */
let detailVerb=null, detailLevel=null;
// Visual SRS status for the detail modal: a 5-segment Leitner track (filled up to
// the card's current box, each lit segment in its BOX_COLORS maturity tone) + the
// box number + a "next review" chip that flips to a red "due now" state when the
// interval has elapsed. New/unseen cards get a plain new-card line instead.
function detailMemoryLine(v){
  const c=store.cards[v.rank];
  if(!c||!c.box) return '<div class="det-memory new"><svg class="ic" aria-hidden="true"><use href="#i-cards"/></svg>New — not yet reviewed</div>';
  const box=c.box;
  const pips=[1,2,3,4,5].map(b=>`<span class="srs-pip${b<=box?' on':''}"${b<=box?` style="background:${BOX_COLORS[b]}"`:''}></span>`).join('');
  const due=Date.now()>=(c.due||0);
  return `<div class="det-memory" role="img" aria-label="Spaced-repetition box ${box} of 5, next review ${due?'due now':nextDueLabel(v.rank)}">
    <span class="srs-track">${pips}</span>
    <span class="srs-boxn">Box ${box}<small>&#8202;/&#8202;5</small></span>
    <span class="srs-due${due?' now':''}"><svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg>${due?'due now':nextDueLabel(v.rank)}</span>
  </div>`;
}
function renderDetailExample(){
  const v=detailVerb, seg=document.getElementById('dExLevels'); if(!v||!seg)return;
  const tiers=availableTiers(v);
  let lvl=detailLevel||settings.exampleLevel;
  if(tiers.length){
    if(!tiers.includes(lvl)) lvl=tiers.includes(v.jlpt)?v.jlpt:tiers[0];
    seg.style.display='';
    seg.innerHTML=JLPT_TIERS.map(t=>`<button class="chip exlv" type="button" data-exlv="${t}"${tiers.includes(t)?'':' disabled'}>${t}</button>`).join('');
  }else{ seg.style.display='none'; seg.innerHTML=''; }
  detailLevel=lvl;
  [...seg.querySelectorAll('.exlv')].forEach(b=>b.classList.toggle('active',b.dataset.exlv===lvl&&!b.disabled));
  const ex=exampleForLevel(v,lvl), jp=document.getElementById('dExJp'), en=document.getElementById('dExEn');
  if(ex){ jp.innerHTML=ex[0]; en.textContent=ex[1]; } else { jp.textContent='No example yet.'; en.textContent=''; }
}
function openVerbDetail(v){
  detailVerb=v; detailLevel=null;
  const tiLabel=v.trans==='t'?'transitive':(v.trans==='i'?'intransitive':'');
  const tags=`${tiLabel?`<span class="tag" style="color:var(--ichidan)">${tiLabel}</span>`:''}${v.tags.filter(t=>!t.startsWith('top')).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}`;
  document.getElementById('detailBody').innerHTML=`
    <div class="card-top"><div>
      <div class="verb-jp jp" style="font-size:34px">${v.jp}</div>
      <div class="verb-reading">${v.read}${TTS_OK?` <button class="speak-btn sm" id="dSpeak" type="button" aria-label="Play reading" title="Play reading"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>`:''}</div>
      <div class="verb-meaning">${v.mean}</div>
      <a class="jisho-link" target="_blank" rel="noopener noreferrer" href="${jishoUrl(v.jp)}"><svg class="ic" aria-hidden="true"><use href="#i-external"/></svg>View on Jisho</a></div>
      <div style="text-align:right"><div class="stamp ${cardStamp(v).cls}">${cardStamp(v).label}</div><div class="jlpt-pill">${v.jlpt}</div>${provenanceBadge(v)}</div></div>
    ${isLeech(v.rank)?'<span class="leech-badge">⚠ LEECH</span>':''}
    <div class="tags">${tags}</div>
    ${detailMemoryLine(v)}
    ${v.mnem?`<details open><summary>Mnemonic</summary><div class="det-body">${v.mnem}</div></details>`:''}
    ${v.tip?`<details><summary>Trap / tip</summary><div class="det-body">${v.tip}</div></details>`:''}
    <details><summary>Example sentences</summary><div class="det-body">
      <span class="jlptseg exseg" id="dExLevels" role="group" aria-label="Example level"></span>
      <div class="ex-jp jp" id="dExJp" style="margin-top:8px"></div><div class="ex-en" id="dExEn"></div>
    </div></details>
    ${v.custom?`<div class="verb-actions"><button class="chip" id="dEdit" type="button"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg>Edit</button><button class="chip" id="dDel" type="button" style="border-color:var(--godan);color:var(--godan)"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg>Delete</button></div>`:''}`;
  renderDetailExample();
  const sp=document.getElementById('dSpeak'); if(sp)sp.addEventListener('click',()=>speakWord(v));
  const seg=document.getElementById('dExLevels'); if(seg)seg.addEventListener('click',e=>{const b=e.target.closest('.exlv');if(!b||b.disabled)return;detailLevel=b.dataset.exlv;renderDetailExample();});
  if(v.custom){
    const eb=document.getElementById('dEdit'), db=document.getElementById('dDel');
    if(eb)eb.addEventListener('click',()=>{ closeDetail(); openVerbModal(v); });
    if(db)db.addEventListener('click',()=>{ if(confirm('Delete custom card '+v.jp+'? Its progress is also removed.')){ closeDetail(); deleteVerb(v.rank); } });
  }
  document.getElementById('detailModal').classList.add('show');
}
function closeDetail(){ document.getElementById('detailModal').classList.remove('show'); }
document.getElementById('detailClose').addEventListener('click',closeDetail);
document.getElementById('detailModal').addEventListener('click',e=>{ if(e.target.id==='detailModal')closeDetail(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&document.getElementById('detailModal').classList.contains('show'))closeDetail(); });

// Re-render the whole grid from scratch on any filter/search change. passF =
// passes the facet+rank filter; passQ = matches the search text. The frequency
// "topN-M" tags are filtered OUT of the visible tag chips (they'd be noise).
function renderBrowse(){
  syncVerbRows('#panel-browse',bcfg,repaintBrowse);
  const q=document.getElementById('search').value.trim().toLowerCase();
  const grid=document.getElementById('grid');grid.innerHTML='';let shown=0;
  DATA.forEach(v=>{
    const passF=passes(v,bcfg);
    const passQ=!q||v.read.includes(q)||v.jp.includes(q)||v.mean.toLowerCase().includes(q);
    if(!(passF&&passQ))return;shown++;
    const leech=isLeech(v.rank);const acc=rollingAcc(v.rank);
    const card=document.createElement('div');
    card.className='card '+colorClass(v)+(leech?' leech':'');  // class + leech recolor spine
    const tiLabel=v.trans==='t'?'transitive':(v.trans==='i'?'intransitive':'');
    const stamp=cardStamp(v);
    // Cards are SUMMARY only now — clicking opens the detail modal (openVerbDetail).
    card.innerHTML=`<div class="rank">#${v.rank}</div>
      ${acc!=null?`<div class="acc">${Math.round(acc*100)}% acc</div>`:''}
      <div class="card-top"><div>
        <div class="verb-jp jp">${v.jp}</div><div class="verb-reading">${v.read}${TTS_OK?` <button class="speak-btn sm" type="button" aria-label="Play reading" title="Play reading"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>`:''}</div>
        <div class="verb-meaning">${v.mean}</div></div>
        <div style="text-align:right"><div class="stamp ${stamp.cls}">${stamp.label}</div>
        <div class="jlpt-pill">${v.jlpt}</div>${provenanceBadge(v)}</div></div>
      ${leech?'<span class="leech-badge">⚠ LEECH</span>':''}
      <div class="tags">${tiLabel?`<span class="tag" style="color:var(--ichidan)">${tiLabel}</span>`:''}${v.tags.filter(t=>!t.startsWith('top') && t!=='みんなの日本語' && !/^mnn-l\d+$/.test(t)).map(t=>t==='iTalki'?`<span class="tag" style="color:var(--ichidan);border:1px solid var(--ichidan)">iTalki</span>`:`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`;
    card.addEventListener('click',()=>openVerbDetail(v));
    const sb=card.querySelector('.speak-btn');   // play reading without opening the modal
    if(sb)sb.addEventListener('click',e=>{e.stopPropagation();speakWord(v);});
    grid.appendChild(card);
  });
  document.getElementById('num').textContent=shown;     // "Showing N of 100"
  document.getElementById('empty').style.display=shown?'none':'block';
  paintSummary('bSummary', filterSummary(bcfg));
}

/* ============================================================================
   STATS + CHARTS — all hand-rolled, no chart library (keeps zero-dependency).
   lineChart() builds an SVG string for a 0–100% series; barChart() builds HTML
   rows. Both are pure render helpers fed by renderStats(). A few SVG colors are
   still literal hex (gridlines/axis labels) because they're intentionally the
   light-theme hairline tone; if you want them theme-aware, route through vars.
   ========================================================================== */
// 0–100% line chart. pts = [{y, label}]. Single-point series is centered.
// opt: {color, aria}. Theme-aware (gridlines/labels via CSS vars). Extras: an axis
// caption, a dashed average reference line, per-point value labels (when few enough)
// and a native <title> readout on every point for hover. No chart library.
function lineChart(el,pts,opt={}){
  const W=720,H=212,pad={l:38,r:50,t:18,b:30};
  el.innerHTML='';
  if(pts.length===0){el.innerHTML='<div class="empty" style="padding:24px">No data yet — finish a flashcard session.</div>';return;}
  const iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
  const n=pts.length, color=opt.color||'var(--godan)';
  const xOf=i=>pad.l+(n===1?iw/2:iw*i/(n-1));   // x position by index
  const yOf=y=>pad.t+ih-(y/100)*ih;              // y position by percentage
  let g=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opt.aria||'Accuracy over time, percent correct'}">`;
  // gridlines + y-axis labels at 0/25/50/75/100 (theme-aware tones)
  [0,25,50,75,100].forEach(gy=>{const y=yOf(gy);g+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${pad.l-6}" y="${y+3}" text-anchor="end" font-size="9" fill="var(--muted)" font-family="monospace">${gy}</text>`;});
  // y-axis caption
  g+=`<text x="${pad.l-6}" y="${pad.t-6}" text-anchor="end" font-size="8" fill="var(--muted)" font-family="monospace">% correct</text>`;
  // dashed average reference line + right-margin label
  const avg=Math.round(pts.reduce((s,p)=>s+p.y,0)/n), ay=yOf(avg);
  g+=`<line x1="${pad.l}" y1="${ay}" x2="${W-pad.r}" y2="${ay}" stroke="var(--ichidan)" stroke-width="1" stroke-dasharray="3 3" opacity="0.65"/><text x="${W-pad.r+4}" y="${ay+3}" font-size="8.5" fill="var(--ichidan)" font-family="monospace">avg ${avg}%</text>`;
  // area fill under the line + the line itself
  const dpath=pts.map((p,i)=>`${i?'L':'M'}${xOf(i).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(' ');
  g+=`<path d="${dpath} L${xOf(n-1).toFixed(1)},${yOf(0).toFixed(1)} L${xOf(0).toFixed(1)},${yOf(0).toFixed(1)} Z" fill="${color}" opacity="0.08"/>`;
  g+=`<path d="${dpath}" fill="none" stroke="${color}" stroke-width="2"/>`;
  // points (with hover readout) + value labels (few points) + thinned x-axis labels
  pts.forEach((p,i)=>{const x=xOf(i),y=yOf(p.y);
    g+=`<circle class="pt" cx="${x}" cy="${y}" r="3.2" fill="${color}"><title>${p.label}: ${p.y}%</title></circle>`;
    if(n<=12)g+=`<text x="${x}" y="${y-7}" text-anchor="middle" font-size="8.5" fill="var(--muted)" font-family="monospace">${p.y}</text>`;
    if(n<=12||i%Math.ceil(n/8)===0)g+=`<text x="${x}" y="${H-9}" text-anchor="middle" font-size="8" fill="var(--muted)" font-family="monospace">${p.label}</text>`;});
  g+='</svg>';el.innerHTML=g;
}
// Horizontal bar list. items = [{label, val(0–100), color}].
function barChart(el,items){
  el.innerHTML='';
  if(!items.length){el.innerHTML='<div class="empty" style="padding:24px">No attempts logged yet.</div>';return;}
  let h='';
  items.forEach(it=>{
    h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
      <div style="width:120px;font-family:var(--jp-font);font-size:14px">${it.label}</div>
      <div style="flex:1;background:var(--paper-2);border-radius:2px;height:16px;position:relative">
        <div style="width:${it.val}%;background:${it.color};height:100%;border-radius:2px"></div></div>
      <div style="width:42px;text-align:right;font-family:monospace;font-size:11px;color:var(--muted)">${it.val}%</div></div>`;
  });
  el.innerHTML=h;
}
// Per-card accuracy bars, capped to the worst CARDBARS_CAP by default (the list
// is sorted worst→best, so the actionable cards lead) with a show-all toggle.
// Without the cap a fully-drilled 100-card deck renders a ~2600px wall of mostly
// already-mastered bars — the worst offenders are what you actually came to see.
const CARDBARS_CAP=20;
let cardBarsExpanded=false;
function renderCardBars(){
  const drilled=DATA.filter(v=>{const c=store.cards[v.rank];return c&&c.attempts.length;})
    .map(v=>({label:v.jp,val:Math.round(rollingAcc(v.rank)*100),color:isLeech(v.rank)?'var(--leech)':(rollingAcc(v.rank)>=0.8?'var(--good)':'var(--godan)')}))
    .sort((a,b)=>a.val-b.val);
  const el=document.getElementById('cardBars');
  barChart(el, cardBarsExpanded?drilled:drilled.slice(0,CARDBARS_CAP));
  if(drilled.length>CARDBARS_CAP){
    const btn=document.createElement('button');
    btn.className='chip'; btn.style.marginTop='12px';
    btn.textContent=cardBarsExpanded?`Show worst ${CARDBARS_CAP} only`:`Show all ${drilled.length} cards`;
    btn.addEventListener('click',()=>{cardBarsExpanded=!cardBarsExpanded;renderCardBars();});
    el.appendChild(btn);
  }
}
// Rebuild the entire Stats panel from `store`. Called on tab activation and
// after import/reset. Each block below maps 1:1 to a container in the markup.
function renderStats(){
  // Summary boxes: overall accuracy + counts. "studied" = cards with ≥1 attempt.
  let tot=0,right=0,studied=0;
  DATA.forEach(v=>{const c=store.cards[v.rank];if(c&&c.attempts.length){studied++;tot+=c.attempts.length;right+=c.right;}});
  const overall=tot?Math.round(100*right/tot):0;
  // SRS vs free-study split, summed over logged sessions. Legacy sessions saved
  // before the two-kind split have no `kind` → counted as SRS (the old behavior
  // always rescheduled). `acc` is each kind's accuracy, shown as a hover readout.
  const mix={srs:{rev:0,right:0},free:{rev:0,right:0}};
  store.sessions.forEach(s=>{const m=mix[s.kind==='free'?'free':'srs'];m.rev+=s.tot;m.right+=s.right;});
  const acc=m=>m.rev?Math.round(100*m.right/m.rev)+'% correct':'no reviews yet';
  const sg=document.getElementById('statgrid');
  sg.innerHTML=`
    <div class="statbox"><div class="v">${overall}%</div><div class="l">Overall accuracy</div></div>
    <div class="statbox"><div class="v">${tot}</div><div class="l">Total reviews</div></div>
    <div class="statbox"><div class="v">${studied}/${DATA.length}</div><div class="l">Cards drilled</div></div>
    <div class="statbox"><div class="v" style="color:var(--ichidan)">${dueCards().length}</div><div class="l">Due today</div></div>
    <div class="statbox" title="${acc(mix.srs)}"><div class="v" style="color:var(--ichidan)">${mix.srs.rev}</div><div class="l">SRS reviews</div></div>
    <div class="statbox" title="${acc(mix.free)}"><div class="v">${mix.free.rev}</div><div class="l">Free-study reviews</div></div>
    <div class="statbox"><div class="v" style="color:var(--leech)">${leeches().length}</div><div class="l">Active leeches</div></div>
    <div class="statbox"><div class="v">${store.sessions.length}</div><div class="l">Sessions</div></div>`;
  // Daily accuracy line: one point per day in store.daily (label = MM-DD).
  const days=Object.keys(store.daily).sort();
  lineChart(document.getElementById('chartDaily'),days.map(d=>({y:Math.round(100*store.daily[d].right/store.daily[d].tot),label:d.slice(5)})),{aria:'Daily accuracy, percent correct per day'});
  // Per-session line: last 20 sessions, labeled by their absolute session number.
  const sess=store.sessions.slice(-20);
  lineChart(document.getElementById('chartSession'),sess.map((s,i)=>({y:Math.round(100*s.right/s.tot),label:'#'+(store.sessions.length-sess.length+i+1)})),{color:'var(--ichidan)',aria:'Per-session accuracy, percent correct per session'});
  // Leech list: the cards isLeech() currently flags, with their rolling accuracy.
  const lz=leeches();const ll=document.getElementById('leechList');
  if(!lz.length){ll.innerHTML='<div class="empty" style="padding:18px">No leeches detected. A leech is any card under 60% over its last 4+ attempts.</div>';}
  else{ll.innerHTML=lz.map(v=>`<div class="leech-row">
    <span class="lr-jp jp">${v.jp}</span>
    <span class="lr-meta">${v.read} · ${v.mean}</span>
    <span class="lr-acc"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg>${Math.round(rollingAcc(v.rank)*100)}%</span></div>`).join('');}
  // Per-card accuracy bars (worst-first, capped + show-all toggle). Bar color:
  // purple=leech, green≥80%, else red. See renderCardBars().
  renderCardBars();
  // SRS memory pipeline: count cards in each Leitner box (0=New … 5). Gives an
  // at-a-glance picture of how much of the deck has "graduated" to long intervals.
  const boxes=[0,0,0,0,0,0]; // index = box 0..5
  DATA.forEach(v=>{const c=store.cards[v.rank];const b=c&&c.box?c.box:0;boxes[b]++;});
  const total=DATA.length;
  const boxLabels=['New','Box 1','Box 2','Box 3','Box 4','Box 5'];
  // New→stone, then a red→amber→gold→olive→green gradient as cards mature.
  const boxColors=BOX_COLORS;
  const bd=document.getElementById('boxDist');
  bd.innerHTML=boxes.map((n,i)=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
    <div style="width:54px;font-family:monospace;font-size:11px;color:var(--muted)">${boxLabels[i]}</div>
    <div style="flex:1;background:var(--paper-2);border-radius:2px;height:16px;position:relative">
      <div class="barx" style="width:${total?Math.round(100*n/total):0}%;background:${boxColors[i]};height:100%;border-radius:2px;min-width:${n?'3px':'0'}"></div></div>
    <div style="width:32px;text-align:right;font-family:monospace;font-size:11px;color:var(--muted)">${n}</div></div>`).join('');
}
// "Study leeches now": jump to the flashcard tab with a leech-only deck. Like
// startDueSession() it overrides the picker and syncs the chip UI to match.
document.getElementById('studyLeeches').addEventListener('click',()=>{
  document.querySelector('.tab[data-tab="study"]').click();
  cfg.type=[];cfg.trans=[];cfg.topic=[];cfg.status=['leech'];cfg.source=[];cfg.jlpt=['all'];cfg.rmin=1;cfg.rmax=100;
  repaintDeck();
  document.querySelectorAll('.chip.jlpt').forEach(x=>x.classList.toggle('active',x.dataset.jlpt==='all'));
  document.getElementById('rmin').value=1;document.getElementById('rmax').value=100;
  updateDeckCount();
  startSession();
});
// Hard reset: wipe ALL progress (after a confirm) and re-render derived views.
document.getElementById('resetBtn').addEventListener('click',()=>{
  if(confirm("Erase all stats, session history, and leech data? This can't be undone.")){
    store={cards:{},sessions:[],daily:{}};save();renderStats();renderBrowse();updateDeckCount();
  }
});

/* ============================================================================
   CLOUD ACCOUNTS + SYNC
   ----------------------------------------------------------------------------
   The app still works fully offline against localStorage (see STORAGE). When
   the user signs in, progress is mirrored to the backing API so it follows
   them across devices. Model:
     • save() writes localStorage immediately, then (if signed in) schedules a
       debounced PUT of the whole `store` to the server.
     • On boot we probe /v1/auth/me. If signed in, we pull the server copy
       (server wins) and re-render; a brand-new account with no server data
       gets its current local store pushed up as the baseline.
   All requests are same-origin with credentials:'include' — the session lives
   in an httpOnly cookie set by the server, never touched by this JS.

   Three independent synced blobs (separate server `app` namespaces, all server-wins
   on login, all debounced-push on change):
     • 'verbs'        — the progress `store` (cards/sessions/daily). save().
     • 'custom-verbs' — the user's custom verb definitions. saveCustom().
     • 'settings'     — the Settings-page preferences. saveSettings().
   Completed sessions are ALSO appended to a durable server log (POST /v1/sessions)
   so full session history survives the capped in-blob `store.sessions`.

   Endpoints (served from this same origin):
     POST /v1/auth/register | /login | /logout      {email,password}
     GET  /v1/auth/me                    → {user:{id,email}|null}
     GET/PUT /v1/progress/verbs          {data:<store>}
     GET/PUT /v1/progress/custom-verbs   {data:{seq,verbs}}
     GET/PUT /v1/progress/settings       {data:<settings>}
     POST /v1/sessions                   {right,total,mode}  (append-only history)
   ========================================================================== */
const APP_KEY='verbs';            // progress namespace on the server
const CUSTOM_APP_KEY='custom-verbs'; // custom-verb-definitions namespace
const SETTINGS_APP_KEY='settings'; // synced preferences namespace
let account=null;                  // {id,email} when signed in, else null
let authMode='login';              // 'login' | 'register' — current modal mode
let serverReachable=true;          // false after a failed /me probe (e.g. file://)
let syncTimer=null;                 // progress-blob debounce
let customSyncTimer=null;           // custom-verbs debounce (independent)

// Thin JSON fetch wrapper. Throws an Error carrying .status / .code on non-2xx
// so callers can branch; a network failure throws fetch's own TypeError (no
// .status), which the UI treats as "server unreachable".
async function api(path,opts={}){
  const res=await fetch(path,{
    method:opts.method||'GET',
    headers:opts.body!==undefined?{'Content-Type':'application/json'}:undefined,
    body:opts.body!==undefined?JSON.stringify(opts.body):undefined,
    credentials:'include',
    cache:'no-store',
  });
  let data=null; try{data=await res.json();}catch(e){}
  if(!res.ok){
    const err=new Error((data&&data.error)||('HTTP '+res.status));
    err.code=data&&data.code; err.status=res.status; throw err;
  }
  return data;
}

function setSyncStatus(t){const el=document.getElementById('syncStatus');if(el)el.textContent=t;}

// Debounced push of the whole store (only when signed in). Coalesces the rapid
// save() calls during a session into one PUT shortly after activity settles.
function scheduleCloudSync(){
  if(!account)return;
  if(syncTimer)clearTimeout(syncTimer);
  syncTimer=setTimeout(pushCloud,1200);
}
async function pushCloud(){
  if(!account)return;
  setSyncStatus('saving…');
  try{ await api('/v1/progress/'+APP_KEY,{method:'PUT',body:{data:store}}); setSyncStatus('✓ synced'); }
  catch(err){ setSyncStatus('⚠ offline'); }   // next save() retries
}

// --- Custom-verb sync (mirrors the progress sync above, separate namespace) ---
// Add/edit/delete all go through saveCustom(), which schedules this push, so a
// removal propagates to the cloud just like an add.
function scheduleCustomSync(){
  if(!account)return;
  if(customSyncTimer)clearTimeout(customSyncTimer);
  customSyncTimer=setTimeout(pushCustomCloud,1200);
}
async function pushCustomCloud(){
  if(!account)return;
  setSyncStatus('saving…');
  try{ await api('/v1/progress/'+CUSTOM_APP_KEY,{method:'PUT',body:{data:loadCustom()}}); setSyncStatus('✓ synced'); }
  catch(err){ setSyncStatus('⚠ offline'); }
}
// Pull custom verbs after sign-in. Server wins when it has any; a fresh account
// seeds the cloud from whatever custom verbs are currently local. Writes via
// saveCustomLocal() so hydration doesn't immediately re-push the same bytes.
async function pullCustomCloud(){
  try{
    const r=await api('/v1/progress/'+CUSTOM_APP_KEY);
    if(r&&r.data&&Array.isArray(r.data.verbs)){
      saveCustomLocal({seq:r.data.seq||100, verbs:r.data.verbs});
      rebuildData();
    }else if(loadCustom().verbs.length){
      await pushCustomCloud();     // new account — seed cloud from local custom verbs
    }
  }catch(err){/* offline — keep local custom verbs */}
}

// --- Settings sync (separate namespace; same server-wins-on-login model) ---
let settingsSyncTimer=null;
function scheduleSettingsSync(){
  if(!account)return;
  if(settingsSyncTimer)clearTimeout(settingsSyncTimer);
  settingsSyncTimer=setTimeout(pushSettingsCloud,1200);
}
async function pushSettingsCloud(){
  if(!account)return;
  setSyncStatus('saving…');
  try{ await api('/v1/progress/'+SETTINGS_APP_KEY,{method:'PUT',body:{data:settings}}); setSyncStatus('✓ synced'); }
  catch(err){ setSyncStatus('⚠ offline'); }
}
// Pull settings after sign-in. Server wins; a fresh account seeds from local.
// Re-applies side-effects (furigana) and repaints the controls that read settings.
async function pullSettingsCloud(){
  try{
    const r=await api('/v1/progress/'+SETTINGS_APP_KEY);
    if(r&&r.data&&typeof r.data==='object'){
      settings=Object.assign({}, DEFAULT_SETTINGS, r.data);
      saveSettingsLocal(); applyFurigana(); paintPrefChips();
      if(typeof renderSettings==='function')renderSettings();
    }else{
      await pushSettingsCloud();    // new account — seed cloud from local settings
    }
  }catch(err){/* offline — keep local settings */}
}

// Pull server progress after sign-in. Server wins when it has data; a fresh
// account inherits whatever's currently local (one-time migration upward).
async function pullCloud(){
  try{
    const r=await api('/v1/progress/'+APP_KEY);
    if(r&&r.data&&r.data.cards){
      store={cards:r.data.cards||{},sessions:r.data.sessions||[],daily:r.data.daily||{}};
      saveLocal();                 // mirror to localStorage WITHOUT re-pushing
      setSyncStatus('✓ synced');
    }else{
      await pushCloud();           // new account — seed cloud from local
    }
  }catch(err){ setSyncStatus('⚠ offline'); }
  await pullCustomCloud();          // custom verbs + settings + minna share the sign-in pull
  await pullSettingsCloud();
  await pullMinnaCloud();
  migrateMinnaDupes(); rebuildData();   // apply pulled Minna overlays + clean any dupes
  refreshAllViews();
}

// Re-render every store-derived view. Mirrors the import handler's refresh set.
function refreshAllViews(){
  updateDeckCount(); updateDueBanner(); renderBrowse();
  if(typeof renderCustomCount==='function')renderCustomCount();
  if(document.getElementById('panel-stats').classList.contains('active'))renderStats();
  if(document.getElementById('panel-minna').classList.contains('active')&&typeof renderMinna==='function')renderMinna();
}

// Escape user-supplied text before innerHTML interpolation (e.g. account email).
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function updateAccountChip(){
  const btn=document.getElementById('accountBtn');
  if(account){ btn.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-cloud-check"/></svg>'+escapeHtml(account.email); btn.title='Signed in — click to sign out'; }
  else { btn.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-user"/></svg>Sign in'; btn.title='Sign in to sync progress'; setSyncStatus(''); }
}

/* ---- Auth modal wiring ---- */
const authModal=document.getElementById('authModal');
function openAuth(mode){
  authMode=mode||'login';
  const login=authMode==='login';
  document.getElementById('authTitle').textContent=login?'Sign in':'Create account';
  document.getElementById('authSub').textContent=login
    ?'Save your progress to the cloud and study from any device.'
    :'Create an account to back up and sync your progress.';
  document.getElementById('authSubmit').textContent=login?'Sign in':'Create account';
  document.getElementById('authPass').setAttribute('autocomplete',login?'current-password':'new-password');
  document.getElementById('authToggleText').textContent=login?'New here?':'Already have an account?';
  document.getElementById('authToggle').textContent=login?'Create an account':'Sign in';
  document.getElementById('authErr').textContent='';
  authModal.classList.add('show');
  document.getElementById('authEmail').focus();
}
function closeAuth(){ authModal.classList.remove('show'); }

document.getElementById('accountBtn').addEventListener('click',()=>{
  if(account){ if(confirm('Sign out? Your progress stays saved in the cloud.'))doLogout(); }
  else openAuth('login');
});
document.getElementById('authClose').addEventListener('click',closeAuth);
document.getElementById('authOffline').addEventListener('click',closeAuth);
document.getElementById('authToggle').addEventListener('click',()=>openAuth(authMode==='login'?'register':'login'));
authModal.addEventListener('click',e=>{ if(e.target===authModal)closeAuth(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&authModal.classList.contains('show'))closeAuth(); });

document.getElementById('authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=document.getElementById('authEmail').value.trim();
  const password=document.getElementById('authPass').value;
  const errEl=document.getElementById('authErr'); errEl.textContent='';
  const submit=document.getElementById('authSubmit'); submit.disabled=true;
  try{
    const path=authMode==='login'?'/v1/auth/login':'/v1/auth/register';
    const r=await api(path,{method:'POST',body:{email,password}});
    account=r.user; updateAccountChip(); closeAuth();
    document.getElementById('authPass').value='';
    await pullCloud();
  }catch(err){ errEl.textContent=friendlyAuthError(err); }
  finally{ submit.disabled=false; }
});

function friendlyAuthError(err){
  if(err.status===401)return 'Wrong email or password.';
  if(err.status===409)return 'That email is already registered — try signing in.';
  if(err.status===400||err.code==='validation_error')return 'Enter a valid email and a password of at least 8 characters.';
  if(err.status===undefined)return 'Could not reach the server. Check your connection and try again.';
  return err.message||'Something went wrong.';
}

async function doLogout(){
  try{ await api('/v1/auth/logout',{method:'POST'}); }catch(e){}
  account=null; updateAccountChip(); setSyncStatus('');
}

// Boot: probe the session and hydrate from cloud if signed in. We deliberately do
// NOT show the sign-up nudge here — a brand-new visitor sees the app first and only
// gets nudged AFTER finishing their first session (see maybeShowSignup, called from
// endSession), which converts far better than a cold first-paint banner.
async function bootAuth(){
  try{ const r=await api('/v1/auth/me'); account=(r&&r.user)?r.user:null; }
  catch(e){ serverReachable=false; account=null; }
  updateAccountChip();
  if(account){ await pullCloud(); return; }
}
// Show the dismissible sign-up banner once the user has engaged (finished a
// session): only when signed out, server reachable, and not previously dismissed.
// Safe to call repeatedly — it no-ops after dismissal or sign-in.
function maybeShowSignup(){
  if(account||!serverReachable)return;
  if(localStorage.getItem('jpverbs_signup_dismissed')==='1')return;
  document.getElementById('signupBanner').hidden=false;
}
// Sign-up banner actions: "Create account" opens the auth modal on demand;
// dismiss hides it and remembers the choice.
document.getElementById('signupCreate').addEventListener('click',()=>{
  document.getElementById('signupBanner').hidden=true; openAuth('register');
});
document.getElementById('signupDismiss').addEventListener('click',()=>{
  document.getElementById('signupBanner').hidden=true;
  localStorage.setItem('jpverbs_signup_dismissed','1');
});

/* ============================================================================
   CUSTOM VERBS — add / edit / delete (the modal CRUD layer).
   ----------------------------------------------------------------------------
   The store + DATA merge live up in the STORAGE area (loadCustom/saveCustom and
   the DATA concat). Here we wire the #verbModal form. A custom verb gets a rank
   from a monotonic `seq` (never reused, so progress in store.cards is stable
   across deletes) and custom:true. rebuildData() rebuilds DATA, extends MAXRANK +
   the rank-range UI, and re-runs the JLPT annotation; callers then re-render.
   ========================================================================== */
let editingRank=null;   // null = adding a new verb; otherwise the rank being edited
// Merge Minna provenance onto matching built-ins (the dedup path). A Minna word that
// already exists as a baked-in verb is NOT re-added as a bare card — its built-in rank
// gets an entry in minnaStore.overlays, and here we merge that onto a COPY of the
// built-in: it keeps its examples / mnemonic / rank / SRS progress but gains the
// みんなの日本語 + iTalki tags, flags, and (if present) pitch accent. Copies — not
// mutation of the shared VERBS objects — so removing an overlay reverts cleanly.
function applyMinnaOverlays(builtins){
  let ov;
  // minnaStore is a `let` declared further down; an early-boot rebuildData() (the
  // rank-range sync) runs before it initializes. Treat that as "no overlays yet" —
  // the post-minna-init boot rebuild applies them once the store exists.
  try{ ov=(minnaStore&&minnaStore.overlays)||{}; }catch(e){ return builtins; }
  if(!Object.keys(ov).length)return builtins;
  return builtins.map(v=>{
    const o=ov[v.rank]; if(!o)return v;
    const tags=[...(v.tags||[])]; (o.tags||[]).forEach(t=>{ if(!tags.includes(t))tags.push(t); });
    return Object.assign({},v,{tags,minna:true,italki:!!o.italki,minnaKey:o.minnaKey,minnaLesson:o.minnaLesson},
      o.accent!=null?{accent:o.accent}:{}, o.tts?{tts:o.tts}:{});
  });
}
function rebuildData(){
  const prevMax=MAXRANK;
  DATA=applyMinnaOverlays(VERBS.filter(v=>!v.skip)).concat(loadCustom().verbs);
  MAXRANK=DATA.reduce((m,v)=>Math.max(m,v.rank),0)||100;
  attachLevels();
  ['rmin','rmax','brmin','brmax'].forEach(id=>{const el=document.getElementById(id);if(el)el.max=MAXRANK;});
  // If a range's max was at the old ceiling ("show everything"), extend it so a
  // freshly-added custom verb is included by default; otherwise respect narrowing.
  if(cfg.rmax>=prevMax){cfg.rmax=MAXRANK;const e=document.getElementById('rmax');if(e)e.value=MAXRANK;}
  if(bcfg.rmax>=prevMax){bcfg.rmax=MAXRANK;const e=document.getElementById('brmax');if(e)e.value=MAXRANK;}
  annotateJlptChips(); annotateCatChips(); annotateSourceChips();
}
function renderCustomCount(){
  const all=loadCustom().verbs;
  const n=all.filter(v=>!v.minna).length, m=all.filter(v=>v.minna).length;
  const parts=[];
  if(n)parts.push(`<b>${n}</b> custom card${n===1?'':'s'}`);
  if(m)parts.push(`<b>${m}</b> みんなの日本語`);
  document.getElementById('customCount').innerHTML = parts.join(' · ');
}
// Per-category option lists for the modal's Type select. Verbs use the
// conjugation classes; adjectives reuse the field for the い/な split; nouns,
// adverbs and phrases have no subtype (the whole Type cell hides for them).
const VF_TYPE_OPTS={
  verb:[['godan','Godan (う-verb)'],['ichidan','Ichidan (る-verb)'],['irregular','Irregular']],
  adjective:[['i-adj','い-adjective'],['na-adj','な-adjective']]
};
// Repopulate #vfType for the chosen category, preserving the current value if it's
// still a valid option (so reopening an edit keeps the saved subtype selected).
function setTypeOptions(cat){
  const sel=document.getElementById('vfType'), cur=sel.value;
  const opts=VF_TYPE_OPTS[cat]||[];
  sel.innerHTML=opts.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  if(opts.some(o=>o[0]===cur))sel.value=cur;
}
// Show the verb/adjective-only fields (Type, Transitivity) only when they apply:
// Type for verbs+adjectives, Transitivity for verbs alone. Keeps the add-card form
// honest — you're never asked for a noun's conjugation class.
function syncVerbFields(){
  const cat=document.getElementById('vfCat').value;
  setTypeOptions(cat);
  document.getElementById('vfTypeCell').style.display = VF_TYPE_OPTS[cat]?'':'none';
  document.getElementById('vfTransCell').style.display = cat==='verb'?'':'none';
}
function openVerbModal(verb){
  editingRank = verb?verb.rank:null;
  document.getElementById('verbTitle').textContent = verb?'Edit card':'Add a card';
  document.getElementById('verbSubmit').textContent = verb?'Save changes':'Save card';
  document.getElementById('verbDelete').hidden = !verb;
  document.getElementById('verbErr').textContent='';
  const g=id=>document.getElementById(id);
  g('vfJp').value=verb?verb.jp:''; g('vfRead').value=verb?verb.read:''; g('vfMean').value=verb?verb.mean:'';
  g('vfCat').value=verb?(verb.cat||'verb'):'verb';
  syncVerbFields();                                   // rebuild Type options + show/hide before setting values
  g('vfType').value=verb&&verb.type?verb.type:(g('vfType').value);
  g('vfJlpt').value=verb?verb.jlpt:'N4';
  g('vfTrans').value=verb?(verb.trans||''):'';
  g('vfTags').value=verb?(verb.tags||[]).filter(t=>t!=='custom').join(', '):'';
  g('vfMnem').value=verb?(verb.mnem||''):''; g('vfTip').value=verb?(verb.tip||''):'';
  g('vfExJp').value=verb&&verb.ex&&verb.ex[0]?verb.ex[0][0]:'';
  g('vfExEn').value=verb&&verb.ex&&verb.ex[0]?verb.ex[0][1]:'';
  document.getElementById('verbModal').classList.add('show');
  setTimeout(()=>g('vfJp').focus(),0);
}
function closeVerbModal(){ document.getElementById('verbModal').classList.remove('show'); }
// Re-render every derived view after a custom-verb change.
function refreshAfterVerbChange(){
  renderCustomCount(); renderBrowse(); updateDeckCount(); updateDueBanner();
  if(document.getElementById('panel-stats').classList.contains('active'))renderStats();
}
function saveVerb(e){
  e.preventDefault();
  const val=id=>document.getElementById(id).value.trim();
  const jp=val('vfJp'),read=val('vfRead'),mean=val('vfMean');
  if(!jp||!read||!mean){ document.getElementById('verbErr').textContent='Japanese, reading, and meaning are all required.'; return; }
  const tags=val('vfTags').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(!tags.includes('custom'))tags.push('custom');
  const exJp=val('vfExJp');
  const cat=val('vfCat');
  // Only verbs+adjectives carry a `type`; only verbs carry transitivity. Store ''
  // for the categories where the field is hidden so a stale value can't linger.
  const verb={ jp, read, mean, cat, type:VF_TYPE_OPTS[cat]?val('vfType'):'', jlpt:val('vfJlpt'),
    trans:cat==='verb'?val('vfTrans'):'',
    tags, mnem:val('vfMnem'), tip:val('vfTip'), ex: exJp?[[exJp,val('vfExEn')]]:[], custom:true };
  const cs=loadCustom();
  const existing = editingRank!=null ? cs.verbs.findIndex(v=>v.rank===editingRank) : -1;
  if(existing>=0){ verb.rank=editingRank; cs.verbs[existing]=verb; }      // edit in place (keep rank → keep progress)
  else { cs.seq=(cs.seq||100)+1; verb.rank=cs.seq; cs.verbs.push(verb); } // new monotonic rank
  saveCustom(cs);
  rebuildData(); closeVerbModal(); refreshAfterVerbChange();
}
function deleteVerb(rank){
  const cs=loadCustom();
  cs.verbs=cs.verbs.filter(v=>v.rank!==rank);
  saveCustom(cs);
  if(store.cards[rank]){ delete store.cards[rank]; save(); }   // drop the orphaned progress
  rebuildData(); closeVerbModal(); refreshAfterVerbChange();
}
document.getElementById('addVerbBtn').addEventListener('click',()=>openVerbModal(null));
document.getElementById('verbClose').addEventListener('click',closeVerbModal);
document.getElementById('vfCat').addEventListener('change',syncVerbFields);   // category drives which verb/adjective fields show
document.getElementById('verbForm').addEventListener('submit',saveVerb);
document.getElementById('verbDelete').addEventListener('click',()=>{ if(editingRank!=null&&confirm('Delete this custom card? Its progress is also removed.'))deleteVerb(editingRank); });
document.getElementById('verbModal').addEventListener('click',e=>{ if(e.target.id==='verbModal')closeVerbModal(); }); // backdrop
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&document.getElementById('verbModal').classList.contains('show'))closeVerbModal(); });
rebuildData();          // sync the rank-range UI to MAXRANK (DATA already merged custom verbs at load)
renderCustomCount();

/* ============================================================================
   SETTINGS PAGE (modal). Each control writes `settings` + saveSettings() (which
   persists, applies furigana, and schedules a cloud push). renderSettings() paints
   the active chips from `settings` and is also called after a cloud pull.
   ========================================================================== */
function renderSettings(){
  const seg=(sel,attr,val)=>document.querySelectorAll(sel).forEach(b=>b.classList.toggle('active', b.dataset[attr]===val));
  seg('.setlv','setlv',settings.exampleLevel);
  seg('.setfg','setfg',settings.furigana?'on':'off');
  seg('.setin','setin',settings.input);
  seg('.setau','setau',settings.audio);
  seg('.setfr','setfr',settings.freeReviewDue?'on':'off');
  const foot=document.getElementById('settingsFoot');
  if(foot) foot.textContent = account ? ('Synced to '+account.email) : 'Sign in to sync these across your devices.';
}
function openSettings(){ renderSettings(); document.getElementById('settingsModal').classList.add('show'); }
function closeSettings(){ document.getElementById('settingsModal').classList.remove('show'); }
document.getElementById('settingsBtn').addEventListener('click',openSettings);
document.getElementById('settingsClose').addEventListener('click',closeSettings);
document.getElementById('settingsModal').addEventListener('click',e=>{ if(e.target.id==='settingsModal')closeSettings(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&document.getElementById('settingsModal').classList.contains('show'))closeSettings(); });
document.getElementById('setLevel').addEventListener('click',e=>{const b=e.target.closest('.setlv');if(!b)return;settings.exampleLevel=b.dataset.setlv;saveSettings();renderSettings();if(session&&document.getElementById('fcStage').classList.contains('active'))renderExample(session.deck[session.i]);});
document.getElementById('setFuri').addEventListener('click',e=>{const b=e.target.closest('.setfg');if(!b)return;settings.furigana=b.dataset.setfg==='on';saveSettings();renderSettings();});
document.getElementById('setInput').addEventListener('click',e=>{const b=e.target.closest('.setin');if(!b)return;settings.input=b.dataset.setin;saveSettings();paintPrefChips();renderSettings();});
document.getElementById('setAudio').addEventListener('click',e=>{const b=e.target.closest('.setau');if(!b)return;settings.audio=b.dataset.setau;saveSettings();paintPrefChips();renderSettings();});
document.getElementById('setFreeDue').addEventListener('click',e=>{const b=e.target.closest('.setfr');if(!b)return;settings.freeReviewDue=b.dataset.setfr==='on';saveSettings();renderSettings();});

/* ============================================================================
   みんなの日本語 DASHBOARD
   ----------------------------------------------------------------------------
   Account-gated Minna no Nihongo lesson view. Content (vocab/grammar/examples/
   conversation + native audio) is fetched at runtime from /v1/minna/*, which
   only answers for signed-in users, so the copyrighted textbook material never
   ships to anonymous visitors. renderMinna() runs lazily on tab activation.

   Vocab "activation" REUSES the custom-verb system: each word becomes a tagged
   custom card (loadCustom/saveCustom + seq rank), so it joins the deck / SRS /
   Browse / Stats and syncs under the existing 'custom-verbs' blob for free —
   no separate data path, no DATA-merge change. Idempotent via a stable
   minnaKey. The only NEW synced blob is per-lesson NOTES (app key 'minna') —
   the "augment as I study" scratchpad. Cards carry minna:true (+ minnaLesson)
   so Browse shows a みんなの日本語 badge instead of CUSTOM.
   ========================================================================== */
const MINNA_APP_KEY='minna';
const MINNA_KEY='jpverbs_minna';
// `overlays` = { <built-in rank>: {tags,italki,minnaLesson,minnaKey,accent?,tts?} } — the
// dedup record: Minna words that map onto a baked-in verb live here, not as custom cards.
const MINNA_DEFAULT={notes:{}, lastLesson:23, overlays:{}};
function loadMinnaStore(){ try{const o=JSON.parse(localStorage.getItem(MINNA_KEY));if(o&&typeof o==='object')return Object.assign({},MINNA_DEFAULT,o,{notes:o.notes||{}, overlays:o.overlays||{}});}catch(e){} return Object.assign({},MINNA_DEFAULT,{notes:{}, overlays:{}}); }
let minnaStore=loadMinnaStore();
function saveMinnaLocal(){ try{localStorage.setItem(MINNA_KEY,JSON.stringify(minnaStore));}catch(e){} }
function saveMinna(){ saveMinnaLocal(); if(typeof scheduleMinnaSync==='function')scheduleMinnaSync(); }

// --- Notes sync trio (mirrors the custom-verb / settings sync; app key 'minna') ---
let minnaSyncTimer=null;
function scheduleMinnaSync(){ if(!account)return; if(minnaSyncTimer)clearTimeout(minnaSyncTimer); minnaSyncTimer=setTimeout(pushMinnaCloud,1200); }
async function pushMinnaCloud(){ if(!account)return; setSyncStatus('saving…'); try{ await api('/v1/progress/'+MINNA_APP_KEY,{method:'PUT',body:{data:minnaStore}}); setSyncStatus('✓ synced'); }catch(err){ setSyncStatus('⚠ offline'); } }
async function pullMinnaCloud(){ try{ const r=await api('/v1/progress/'+MINNA_APP_KEY); if(r&&r.data&&typeof r.data==='object'){ minnaStore=Object.assign({},MINNA_DEFAULT,r.data,{notes:r.data.notes||{}, overlays:r.data.overlays||{}}); saveMinnaLocal(); }else if(Object.keys(minnaStore.notes||{}).length||Object.keys(minnaStore.overlays||{}).length){ await pushMinnaCloud(); } }catch(err){/* offline — keep local notes */} }

// --- Native-audio playback. One reused <audio>; same-origin so the session
//     cookie travels and /v1/minna/audio authorizes. Clicking a playing button
//     stops it (toggle). The .playing class lights the button. ---
let mnAudioEl=null, mnPlayingBtn=null;
function mnPlay(src, btn){
  if(!mnAudioEl)mnAudioEl=new Audio();
  if(btn && btn===mnPlayingBtn && !mnAudioEl.paused){ mnAudioEl.pause(); btn.classList.remove('playing'); mnPlayingBtn=null; return; }
  if(mnPlayingBtn)mnPlayingBtn.classList.remove('playing');
  mnAudioEl.src='/v1/minna/audio?src='+encodeURIComponent(src);
  mnPlayingBtn=btn||null; if(btn)btn.classList.add('playing');
  mnAudioEl.onended=mnAudioEl.onerror=()=>{ if(mnPlayingBtn){mnPlayingBtn.classList.remove('playing');mnPlayingBtn=null;} };
  mnAudioEl.play().catch(()=>{ if(btn)btn.classList.remove('playing'); mnPlayingBtn=null; });
}
const mnAudioBtn=(src)=> src?`<button class="speak-btn" type="button" data-aud="${escapeHtml(src)}" aria-label="Play native audio" title="Play native audio"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>`:'';

// --- Vocab → deck activation (via the custom-verb store). ---
// Build a deck card from a Minna vocab item, using the DICTIONARY form as the
// headword (the deck is dictionary-form; the textbook ます-form is kept in tip).
function minnaCard(item, lesson){
  // Tags drive both the Browse tag chips and the Source filter facet. Every Minna
  // card carries みんなの日本語 + its lesson; words flagged `italki:true` in the
  // lesson JSON (the subset actually covered in the maintainer's iTalki lessons)
  // also get the iTalki tag + a boolean flag the Source facet matches on.
  const tags=['みんなの日本語','mnn-l'+lesson];
  if(item.italki)tags.push('iTalki');
  return {
    jp: item.dict || item.kanji || item.kana,
    read: item.dictRead || item.kana,
    mean: item.mean,
    cat: item.cat || 'noun',
    type: item.type || '',
    jlpt: item.jlpt || 'N4',
    trans: item.trans || '',
    tags,
    mnem: '',
    tip: 'みんなの日本語 L'+lesson+' · textbook form: '+(item.kanji||item.kana)+(item.context?' '+item.context:''),
    ex: [],
    custom:true, minna:true, italki:!!item.italki, minnaKey:item.key, minnaLesson:lesson,
  };
}
// Does this Minna word already exist as a baked-in verb? → its built-in rank, else null.
function minnaBuiltinRank(item){ return BUILTIN_RANK_BY_JP[item.dict||item.kanji||item.kana]||null; }
// The overlay payload for a built-in match: provenance only (the built-in keeps its own
// content). Mirrors the tag set minnaCard builds.
function minnaOverlay(item, lesson){
  const tags=['みんなの日本語','mnn-l'+lesson]; if(item.italki)tags.push('iTalki');
  const o={tags, italki:!!item.italki, minnaLesson:lesson, minnaKey:item.key};
  if(item.accent!=null)o.accent=item.accent; if(item.tts)o.tts=item.tts;
  return o;
}
const overlaySig=o=>(o.tags||[]).join('|')+'·'+(o.italki?'1':'0');
// A word is in the deck if it's a custom card OR an overlay on a built-in.
function minnaInDeck(key){
  if(loadCustom().verbs.some(v=>v.minnaKey===key))return true;
  const ov=(minnaStore&&minnaStore.overlays)||{};
  return Object.keys(ov).some(r=>ov[r].minnaKey===key);
}
// Signature of the metadata a re-activation can change (tags + iTalki flag), so we
// can tell "already in deck, up to date" from "in deck but missing new info".
const minnaSig=v=>(v.tags||[]).join('|')+'·'+(v.italki?'1':'0');
// Non-mutating preview of what "Add all vocab to deck" would do: how many words are in
// the deck, new (toAdd), or already-added but carrying stale metadata (toUpdate). Words
// that match a built-in are tracked via the overlay map; the rest via custom cards.
function minnaActivationStatus(lesson, vocab){
  const cs=loadCustom(); const ov=(minnaStore&&minnaStore.overlays)||{};
  let inDeck=0, toAdd=0, toUpdate=0;
  vocab.forEach(item=>{
    const br=minnaBuiltinRank(item);
    if(br){
      const cur=ov[br];
      if(!cur){ toAdd++; return; }
      inDeck++;
      if(overlaySig(cur)!==overlaySig(minnaOverlay(item,lesson)))toUpdate++;
      return;
    }
    const existing=cs.verbs.find(v=>v.minnaKey===item.key);
    if(!existing){ toAdd++; return; }
    inDeck++;
    if(minnaSig(existing)!==minnaSig(minnaCard(item,lesson)))toUpdate++;
  });
  return {inDeck, total:vocab.length, toAdd, toUpdate};
}
// Activate a lesson's vocab into the deck. Words that match a built-in verb REUSE it
// (an overlay tags the built-in — no bare duplicate; it keeps its examples + mnemonic);
// genuinely-new words become custom cards. Re-activation patches metadata in place
// (preserving rank → SRS progress) so the iTalki tag etc. apply retroactively. Returns
// {added, updated}.
function activateMinnaVocab(lesson, vocab){
  const cs=loadCustom(); const ov=minnaStore.overlays=minnaStore.overlays||{};
  let added=0, updated=0, custChanged=false, ovChanged=false;
  vocab.forEach(item=>{
    const br=minnaBuiltinRank(item);
    if(br){
      // Reuse the built-in via an overlay; drop any bare duplicate a pre-dedup
      // activation may have created for this word.
      const fresh=minnaOverlay(item,lesson), cur=ov[br];
      if(!cur){ ov[br]=fresh; added++; ovChanged=true; }
      else if(overlaySig(cur)!==overlaySig(fresh)){ ov[br]=Object.assign({},cur,fresh); updated++; ovChanged=true; }
      const di=cs.verbs.findIndex(v=>v.minnaKey===item.key);
      if(di>=0){ cs.verbs.splice(di,1); custChanged=true; }
      return;
    }
    const fresh=minnaCard(item,lesson);
    const existing=cs.verbs.find(v=>v.minnaKey===item.key);
    if(existing){
      const changed=minnaSig(existing)!==minnaSig(fresh);
      Object.assign(existing,{tags:fresh.tags,italki:fresh.italki,mean:fresh.mean,cat:fresh.cat,type:fresh.type,trans:fresh.trans,tip:fresh.tip,levels:fresh.levels,mnem:fresh.mnem,accent:fresh.accent});
      if(changed)updated++; custChanged=true;
      return;
    }
    cs.seq=(cs.seq||100)+1; fresh.rank=cs.seq; cs.verbs.push(fresh); added++; custChanged=true;
  });
  if(custChanged)saveCustom(cs);
  if(ovChanged)saveMinna();
  if(custChanged||ovChanged){ rebuildData(); refreshAfterVerbChange(); }
  return {added, updated};
}
// One-time cleanup of pre-dedup duplicates: any Minna custom card that duplicates a
// built-in becomes an overlay (so the rich built-in represents the word) and the bare
// card is dropped. Idempotent; runs on boot + after a cloud pull, syncs only on change.
function migrateMinnaDupes(){
  const cs=loadCustom(); const ov=minnaStore.overlays=minnaStore.overlays||{};
  let cChanged=false, oChanged=false;
  for(let i=cs.verbs.length-1;i>=0;i--){
    const v=cs.verbs[i]; if(!v.minna)continue;
    const br=BUILTIN_RANK_BY_JP[v.jp]; if(!br)continue;
    if(!ov[br]){ ov[br]={tags:[...(v.tags||[])], italki:!!v.italki, minnaLesson:v.minnaLesson, minnaKey:v.minnaKey}; if(v.accent!=null)ov[br].accent=v.accent; oChanged=true; }
    cs.verbs.splice(i,1); cChanged=true;
  }
  if(cChanged)saveCustom(cs);
  if(oChanged)saveMinna();
  return cChanged||oChanged;
}

// --- Render ---
const minnaLessonCache={};               // n -> lesson JSON (avoids refetch on re-render)
async function fetchMinnaLesson(n){
  if(minnaLessonCache[n])return minnaLessonCache[n];
  const r=await api('/v1/minna/lessons/'+n);
  minnaLessonCache[n]=r; return r;
}
function mnSection(title,count,bodyHtml,open){
  return `<details class="mn-section"${open?' open':''}><summary>${title}${count!=null?` <span class="mn-count">· ${count}</span>`:''}</summary><div class="mn-sec-body">${bodyHtml}</div></details>`;
}
function renderMinnaGate(){
  document.getElementById('mnHead').innerHTML='';
  document.getElementById('mnBody').innerHTML='';
  const g=document.getElementById('mnGate'); g.hidden=false;
  g.innerHTML=`<svg class="ic gate-ic" aria-hidden="true"><use href="#i-book"/></svg>
    <h2>みんなの日本語</h2>
    <p>Your private Minna no Nihongo workbook — vocabulary with native audio, grammar, example sentences and conversation, lesson by lesson. Sign in to open it.</p>
    <button class="chip primary" id="mnSignin"><svg class="ic" aria-hidden="true"><use href="#i-user"/></svg>Sign in</button>`;
  const b=document.getElementById('mnSignin'); if(b)b.addEventListener('click',()=>openAuth('login'));
}
async function renderMinna(){
  if(!account){ renderMinnaGate(); return; }
  document.getElementById('mnGate').hidden=true;
  const head=document.getElementById('mnHead'), body=document.getElementById('mnBody');
  let lessons=[];
  try{ const r=await api('/v1/minna/lessons'); lessons=(r&&r.lessons)||[]; }
  catch(e){ if(e.status===401){ renderMinnaGate(); return; } body.innerHTML='<div class="mn-error">Could not reach the server.</div>'; return; }
  if(!lessons.length){ head.innerHTML=''; body.innerHTML='<div class="mn-error">No lessons have been added yet.</div>'; return; }
  const cur=lessons.includes(minnaStore.lastLesson)?minnaStore.lastLesson:lessons[0];
  minnaStore.lastLesson=cur;
  head.innerHTML=`<div class="mn-kicker">みんなの日本語 · Minna no Nihongo</div>
    <div class="frow"><span class="filter-label">Chapter</span><div class="chips" id="mnChapters" aria-label="Chapter">
      ${lessons.map(n=>`<button class="chip mnch${n===cur?' active':''}" type="button" data-lesson="${n}">L${n}</button>`).join('')}
    </div></div>`;
  head.querySelectorAll('.mnch').forEach(b=>b.addEventListener('click',()=>{ minnaStore.lastLesson=Number(b.dataset.lesson); saveMinna(); renderMinna(); }));
  await renderMinnaLesson(cur, body);
}
async function renderMinnaLesson(n, body){
  body.innerHTML='<div class="mn-loading">Loading lesson '+n+'…</div>';
  let L;
  try{ L=await fetchMinnaLesson(n); }
  catch(e){ body.innerHTML='<div class="mn-error">Could not load lesson '+n+(e&&e.status?(' ('+e.status+')'):'')+'.</div>'; return; }
  // Three button states: words still to add → "Add"; all in deck but some carry
  // stale metadata (e.g. a pre-iTalki activation) → "Update N tags" (so the
  // retroactive patch is reachable even when nothing is left to add); all current
  // → disabled "All vocab in your deck".
  const st=minnaActivationStatus(n, L.vocab||[]);
  const btn = st.toAdd ? {ic:'plus',   label:'Add all vocab to deck', dis:''}
    : st.toUpdate     ? {ic:'refresh', label:'Update '+st.toUpdate+' vocab tag'+(st.toUpdate===1?'':'s'), dis:''}
    :                   {ic:'check',   label:'All vocab in your deck', dis:' disabled'};
  body.innerHTML=`
    <div class="mn-head" style="margin-top:14px">
      <div class="mn-title">${escapeHtml(L.title||('Lesson '+n))}</div>
      ${L.theme?`<div class="mn-theme">${escapeHtml(L.theme)}</div>`:''}
    </div>
    <div class="mn-actions">
      <button class="chip primary" id="mnAddDeck"${btn.dis}><svg class="ic" aria-hidden="true"><use href="#i-${btn.ic}"/></svg>${btn.label}</button>
      <span class="v-in" id="mnDeckCount">${st.inDeck}/${st.total} in your SRS deck</span>
    </div>
    ${minnaVocabSection(L)}
    ${minnaGrammarSection(L)}
    ${minnaExamplesSection(L)}
    ${minnaConversationSection(L)}
    ${minnaNotesSection(n)}`;
  wireMinnaLesson(n, L, body);
}
function minnaVocabSection(L){
  if(!L.vocab||!L.vocab.length)return '';
  const rows=L.vocab.map(v=>`<tr>
      <td class="v-audio">${mnAudioBtn(v.audio)}</td>
      <td><div class="mn-kanji jp">${escapeHtml(v.kanji||v.kana)}</div><div class="mn-kana jp">${escapeHtml(v.kana)}${v.context?` <span class="mn-ctx">${escapeHtml(v.context)}</span>`:''}</div></td>
      <td class="mn-mean">${escapeHtml(v.mean)}<span class="mn-pos">${escapeHtml(CAT_LABEL[v.cat]||v.cat||'')}</span>${v.italki?'<span class="mn-italki" title="Covered in your iTalki lesson">iTalki</span>':''}</td>
      <td style="text-align:right">${minnaInDeck(v.key)?'<span class="v-in">✓</span>':''}</td>
    </tr>`).join('');
  return mnSection('Vocabulary', L.vocab.length, `<table class="mn-vocab"><tbody>${rows}</tbody></table>`, true);
}
function minnaExampleRows(list){
  return `<div class="mn-ex">${list.map(e=>`<div><div class="e-jp jp">${escapeHtml(e.jp)}</div><div class="e-en">${escapeHtml(e.en)}</div></div>`).join('')}</div>`;
}
function minnaGrammarSection(L){
  if(!L.grammar||!L.grammar.length)return '';
  const items=L.grammar.map(g=>`<div class="mn-gram">
      <div class="mn-pattern jp">${escapeHtml(g.pattern)}</div>
      ${g.structure?`<div class="mn-structure jp">${escapeHtml(g.structure)}</div>`:''}
      ${g.explain?`<div class="mn-explain">${escapeHtml(g.explain)}</div>`:''}
      ${g.examples&&g.examples.length?minnaExampleRows(g.examples):''}
    </div>`).join('');
  return mnSection('Grammar', L.grammar.length, items, true);
}
function minnaExamplesSection(L){
  if(!L.examples||!L.examples.length)return '';
  return mnSection('Example sentences', L.examples.length, minnaExampleRows(L.examples), false);
}
function minnaConversationSection(L){
  const c=L.conversation; if(!c||!c.lines||!c.lines.length)return '';
  const head=c.title?`<div class="mn-theme jp" style="margin:0 0 8px">${escapeHtml(c.title)}</div>`:'';
  const audio=c.audio?`<div class="mn-conv-audio">${mnAudioBtn(c.audio)}<span>Play the whole conversation</span></div>`:'';
  const lines=c.lines.map(ln=>`<div class="mn-line"><div class="mn-role">${escapeHtml(ln.role||'')}</div><div><div class="l-jp jp">${escapeHtml(ln.jp)}</div><div class="l-en">${escapeHtml(ln.en)}</div></div></div>`).join('');
  return mnSection('Conversation', c.lines.length, head+audio+lines, false);
}
function minnaNotesSection(n){
  const val=escapeHtml((minnaStore.notes&&minnaStore.notes[n])||'');
  return mnSection('My notes', null, `<div class="mn-notes"><textarea id="mnNotes" placeholder="Augment this lesson as you study with your tutor — grammar nuances, mistakes to avoid, anything. Synced to your account.">${val}</textarea><div class="mn-saved" id="mnNotesSaved"></div></div>`, false);
}
function wireMinnaLesson(n, L, body){
  body.querySelectorAll('[data-aud]').forEach(b=>b.addEventListener('click',()=>mnPlay(b.dataset.aud,b)));
  const add=body.querySelector('#mnAddDeck');
  if(add)add.addEventListener('click',()=>{
    const {added,updated}=activateMinnaVocab(n, L.vocab||[]);
    renderMinnaLesson(n, body);
    const msg=added ? '✓ added '+added+' word'+(added===1?'':'s')+' to your deck'
      : updated ? '✓ updated '+updated+' word'+(updated===1?'':'s')
      : 'already in your deck';
    setSyncStatus(msg);
  });
  const ta=body.querySelector('#mnNotes');
  if(ta){
    let t=null;
    ta.addEventListener('input',()=>{
      minnaStore.notes=minnaStore.notes||{}; minnaStore.notes[n]=ta.value;
      const s=body.querySelector('#mnNotesSaved'); if(s)s.textContent='saving…';
      if(t)clearTimeout(t);
      t=setTimeout(()=>{ saveMinna(); const e=body.querySelector('#mnNotesSaved'); if(e)e.textContent=account?'saved · synced':'saved on this device'; },500);
    });
  }
}
// Browse provenance badge: みんなの日本語 cards over the plain CUSTOM badge.
function provenanceBadge(v){
  if(v&&v.minna)return `<div class="minna-badge">みんなの日本語${v.minnaLesson?' · L'+v.minnaLesson:''}</div>`;
  if(v&&v.custom)return '<div class="custom-badge">CUSTOM</div>';
  return '';
}

// ---- Initial paint ----
// The flashcard tab is the default-active panel (its deck count + due banner
// were already computed above). Stats renders lazily on tab-open. Browse needs
// one render now so it's ready the moment the user switches to it.
migrateMinnaDupes(); rebuildData();   // apply local Minna overlays + clean pre-dedup dupes
renderBrowse();
// Kick off the session probe / cloud hydration once everything above is wired.
bootAuth();
