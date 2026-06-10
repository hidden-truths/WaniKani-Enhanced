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
const TYPE_LABEL={godan:"GODAN",ichidan:"ICHIDAN",irregular:"IRREG"};
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

// ---- Leveled example sentences ----
// Each built-in verb gets `v.levels` = EXAMPLES[rank] = {N5:[jp,en],…,N1:[jp,en]}
// (from examples.js). attachLevels() runs after every DATA rebuild. Custom verbs
// have no entry (EXAMPLES is 1..100), so they keep `levels:null` and fall back to
// their single `ex`. JLPT_TIERS is the easy→hard order the UI selector uses.
const JLPT_TIERS=['N5','N4','N3','N2','N1'];
function attachLevels(){
  const E = typeof EXAMPLES!=='undefined' ? EXAMPLES : {};
  DATA.forEach(v=>{ v.levels = E[v.rank] || null; });
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
}));

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
// The single source of truth for "should this verb appear?" (see model above).
// c = {type:[],trans:[],topic:[],status:[], jlpt:[], rmin, rmax}. The four token
// facets AND together; jlpt and rank AND on top. Pure function — easy to unit-test.
function passes(v,c){
  if(!facetMatch(v,c.type))return false;
  if(!facetMatch(v,c.trans))return false;
  if(!facetMatch(v,c.topic))return false;
  if(!facetMatch(v,c.status))return false;
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
const DECK_FACETS=['type','trans','topic','status'];
const TOKEN_FACET={godan:'type',ichidan:'type',irregular:'type',suru:'type',fake:'type',
  trans:'trans',intrans:'trans','ti-pair':'trans',leech:'status',due:'status'};
const tokenFacet=t=>TOKEN_FACET[t]||'topic';
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
let cfg={mode:"meaning",input:"self",audio:"off",type:[],trans:[],topic:[],status:[],ord:"shuffle",jlpt:["all"],rmin:1,rmax:MAXRANK};
document.querySelectorAll('.chip.mode').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.chip.mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');cfg.mode=b.dataset.mode;updateDeckCount();}));
// Input mode (self-graded vs type-the-reading) + audio autoplay. Both are study-
// style PREFERENCES (persisted under their own localStorage keys, not in `store`),
// restored onto the chips at boot. bindSingle = the single-select chip pattern.
cfg.input=localStorage.getItem('jpverbs_input')||'self';
cfg.audio=localStorage.getItem('jpverbs_audio')||'off';
function bindSingle(selector,attr,onSet){
  document.querySelectorAll(selector).forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll(selector).forEach(x=>x.classList.remove('active'));
    b.classList.add('active');onSet(b.dataset[attr]);}));
}
bindSingle('.chip.imode','imode',v=>{cfg.input=v;localStorage.setItem('jpverbs_input',v);});
bindSingle('.chip.amode','amode',v=>{cfg.audio=v;localStorage.setItem('jpverbs_audio',v);});
document.querySelectorAll('.chip.imode').forEach(x=>x.classList.toggle('active',x.dataset.imode===cfg.input));
document.querySelectorAll('.chip.amode').forEach(x=>x.classList.toggle('active',x.dataset.amode===cfg.audio));
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
  if(cfg.ord==='shuffle'){for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}}
  else if(cfg.ord==='freq'){d.sort((a,b)=>a.rank-b.rank);}
  else if(cfg.ord==='worst'){d.sort((a,b)=>{const ra=rollingAcc(a.rank)??1,rb=rollingAcc(b.rank)??1;return ra-rb;});}
  return d;
}
// Token → human label for the active-filter recap line. Shared by both panels
// (deck/bf tokens are identical). Drives filterSummary() below.
const DECK_LABEL={godan:'Godan',ichidan:'Ichidan',irregular:'Irregular',suru:'Suru',fake:'Fake-ichidan',trans:'Transitive',intrans:'Intransitive','ti-pair':'T/I pairs',leech:'Leeches',due:'Due cards',motion:'Motion',transit:'Transit',wearing:'Wearing',speaking:'Speaking',communication:'Communication',giving:'Giving/Recv',emotion:'Emotion',cognition:'Cognition',perception:'Perception',existence:'Existence',change:'Change',ability:'Ability',onoff:'On/Off',daily:'Daily',body:'Body',work:'Work',study:'Study',food:'Food',money:'Money'};
// Build the active-facet parts for a config (one part per non-empty facet, so the
// recap reads as the AND it now is: "Godan · Motion · rank 1–25"). Tokens within a
// facet join with '/', the parts join with '·' in paintSummary.
function filterSummary(c){
  const parts=[];
  [c.type,c.trans,c.topic,c.status].forEach(arr=>{
    if(arr&&arr.length) parts.push(arr.map(t=>DECK_LABEL[t]||t).join('/'));
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
// Live "N cards in deck" readout under the Start button + filter recap.
function updateDeckCount(){
  const n=DATA.filter(v=>passes(v,cfg)).length;
  document.getElementById('deckCount').innerHTML=`<b>${n}</b> cards in deck`;
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
}
// "Review due cards": force the deck to due-only, worst-first, full range, and
// reflect that in the chip UI before starting. This overrides the user's
// current picker selection on purpose — it's a dedicated review flow.
function startDueSession(){
  cfg.type=[];cfg.trans=[];cfg.topic=[];cfg.status=['due'];cfg.jlpt=['all'];cfg.rmin=1;cfg.rmax=100;cfg.ord='worst';
  repaintDeck();
  document.querySelectorAll('.chip.jlpt').forEach(x=>x.classList.toggle('active',x.dataset.jlpt==='all'));
  document.getElementById('rmin').value=1;document.getElementById('rmax').value=100;
  document.querySelectorAll('.chip.ord').forEach(x=>x.classList.toggle('active',x.dataset.ord==='worst'));
  startSession();
}
updateDeckCount();
updateDueBanner();

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
function playReading(){ if(session)speak(session.deck[session.i].read); }
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

function startSession(){
  const deck=buildDeck();
  if(!deck.length){alert("No cards in that deck yet.");return;}
  session={deck,i:0,revealed:false,results:[]};
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
// The chosen tier persists across cards (jpverbs_exlevel). Disabled tiers (no
// sentence for this verb) can't be picked; if the saved tier is unavailable we
// fall back to the verb's own JLPT level, then the easiest available. The whole
// block hides when the verb has no example at all.
let exLevel = (typeof localStorage!=='undefined' && localStorage.getItem('jpverbs_exlevel')) || 'N5';
function renderExample(v){
  const block=document.getElementById('exampleBlock'), seg=document.getElementById('exLevels');
  const tiers=availableTiers(v);
  if(tiers.length){
    seg.style.display='';
    seg.innerHTML=JLPT_TIERS.map(t=>`<button class="chip exlv" type="button" data-exlv="${t}"${tiers.includes(t)?'':' disabled'}>${t}</button>`).join('');
  }else{ seg.style.display='none'; seg.innerHTML=''; }
  let lvl=exLevel;
  if(tiers.length && !tiers.includes(lvl)) lvl = tiers.includes(v.jlpt)?v.jlpt:tiers[0];
  [...seg.querySelectorAll('.exlv')].forEach(b=>b.classList.toggle('active', b.dataset.exlv===lvl && !b.disabled));
  const ex=exampleForLevel(v,lvl);
  if(ex){ document.getElementById('exJp').innerHTML=ex[0]; document.getElementById('exEn').textContent=ex[1]; block.hidden=false; }
  else block.hidden=true;
}
// Pick a tier → remember it → re-render the current card's example.
document.getElementById('exLevels').addEventListener('click',e=>{
  const b=e.target.closest('.exlv'); if(!b||b.disabled)return;
  exLevel=b.dataset.exlv; try{localStorage.setItem('jpverbs_exlevel',exLevel);}catch(e2){}
  if(session) renderExample(session.deck[session.i]);
});

function showCard(){
  const v=session.deck[session.i];
  session.revealed=false;
  document.getElementById('fcProgress').textContent=`Card ${session.i+1} of ${session.deck.length}`;
  const fc=document.getElementById('flashcard');
  fc.className='flashcard '+v.type;   // sets the colored spine via CSS
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
    document.getElementById('promptSub').textContent=TYPE_LABEL[v.type];
    document.getElementById('aRead').className='a-read jp';
    document.getElementById('aRead').innerHTML=v.read+' &nbsp; '+v.jp;
    document.getElementById('aMean').textContent='';
  }
  document.getElementById('aNote').innerHTML=v.mnem+(v.tip?'<br><br>'+v.tip:'');
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
  const correct=normKana(inp.value)===normKana(v.read);
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
// Record one result: append to attempts, bump right/wrong, update SRS schedule,
// and persist NOW (mid-session crash safety — this is bug-fix #1). Then advance.
function grade(correct){
  const v=session.deck[session.i];
  const c=cardStat(v.rank);
  c.attempts.push(correct?1:0);
  if(correct)c.right++;else c.wrong++;
  scheduleCard(c,correct);
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
function endSession(){
  if(session && session.results.length){
    const right=session.results.reduce((s,x)=>s+x,0),tot=session.results.length;
    store.sessions.push({t:Date.now(),right,tot});
    if(store.sessions.length>200)store.sessions=store.sessions.slice(-200);
    const day=localDay();
    if(!store.daily[day])store.daily[day]={right:0,tot:0};
    store.daily[day].right+=right;store.daily[day].tot+=tot;
    save();
    document.getElementById('doneScore').textContent=Math.round(100*right/tot)+'%';
    document.getElementById('doneDetail').textContent=`${right} of ${tot} correct`;
    if(typeof maybeShowSignup==='function')maybeShowSignup();   // nudge after first real session
  }
  document.getElementById('fcStage').classList.remove('active');
  document.getElementById('fcDone').classList.add('active');
}
// Button wiring for the session controls.
document.getElementById('startBtn').addEventListener('click',()=>startSession());
document.getElementById('dueBtn').addEventListener('click',startDueSession);
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
  updateDeckCount();updateDueBanner();
});
// Keyboard shortcuts (only while a card is on screen). Self-graded: Space reveals,
// then 1 = wrong / 2 = right. Typed: Enter submits (handled on the field), then
// Enter accepts the suggested grade, or 1/2 override. Keys are not hijacked while
// the kana field is focused so the user can type freely.
document.addEventListener('keydown',e=>{
  if(!document.getElementById('fcStage').classList.contains('active'))return;
  const inField = e.target===document.getElementById('answerInput');
  if(e.key==='Enter' && !inField){
    if(cfg.input==='type' && !session.revealed){e.preventDefault();submitTyped();return;}
    if(session.revealed && typeof session.suggested==='boolean'){e.preventDefault();grade(session.suggested);return;}
  }
  if(inField)return;                                  // let the field own its keys
  if(e.code==='Space'){e.preventDefault();if(cfg.input!=='type'&&!session.revealed)reveal();}
  else if(e.key==='1'&&session.revealed)grade(false);
  else if(e.key==='2'&&session.revealed)grade(true);
});

/* ============================================================================
   BROWSE — the reference grid. Independent filter state (bcfg) from the study
   deck, but evaluated by the same passes() predicate, plus a free-text search
   over reading/kanji/meaning. Cards are built as innerHTML strings (fine at
   100 rows; if the deck grows large, switch to a template/fragment for perf).
   Clicking a card toggles .open to expand the detail (CSS max-height anim).
   ========================================================================== */
let bcfg={type:[],trans:[],topic:[],status:[],jlpt:['all'],rmin:1,rmax:MAXRANK};
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
   the rest are tabindex -1. ←/→ (and ↑/↓) move focus within the group, Home/End
   jump to the ends, and the tab stop follows the last-focused chip so Tab
   returns where you left off. This is TOOLBAR semantics, not radiogroup: arrows
   only MOVE focus — Space/Enter still activates a chip through its existing
   makeMultiSelect click handler, so selection behavior is unchanged.

   `button.chip` only, so the Font `<select>` and the rank number inputs stay
   normal tab stops (focus on them returns -1 from indexOf → arrows fall through
   to native behavior). Collapsed `.topic-inner` chips are pulled OUT of the tab
   order entirely (a MutationObserver on the region's `open` class), fixing the
   pre-existing wart where the visually-hidden topic chips were still focusable.
   ========================================================================== */
function setupRoving(container){
  const items=[...container.querySelectorAll('button.chip')];
  if(!items.length)return;
  // role=group + a label (from the row's .filter-label) for screen readers.
  container.setAttribute('role','group');
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
  function focusInNav(list,n){const el=list[(n+list.length)%list.length];if(el){setStop(el);el.focus();}}
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
    b.title = n===0 ? `No verbs at ${lv} in this deck` : `${n} verb${n===1?'':'s'} at ${lv}`;
  });
}
annotateJlptChips();
document.querySelectorAll('.chips, .topic-inner').forEach(setupRoving);

// Browse detail's example block. Built-in verbs list every available JLPT tier
// (easy→hard) with a level pill; custom verbs fall back to their single `ex`.
function exampleListHtml(v){
  if(v.levels){
    const rows=JLPT_TIERS.filter(t=>v.levels[t]).map(t=>{
      const e=v.levels[t];
      return `<div class="ex jp"><span class="ex-pill">${t}</span>${e[0]}<span class="en">${e[1]}</span></div>`;
    }).join('');
    if(rows) return `<div class="blk"><div class="blk-label">Examples by level</div>${rows}</div>`;
  }
  if(v.ex&&v.ex.length) return `<div class="blk"><div class="blk-label">Examples</div>${v.ex.map(e=>`<div class="ex jp">${e[0]}<span class="en">${e[1]}</span></div>`).join('')}</div>`;
  return '';
}
// Re-render the whole grid from scratch on any filter/search change. passF =
// passes the facet+rank filter; passQ = matches the search text. The frequency
// "topN-M" tags are filtered OUT of the visible tag chips (they'd be noise).
function renderBrowse(){
  const q=document.getElementById('search').value.trim().toLowerCase();
  const grid=document.getElementById('grid');grid.innerHTML='';let shown=0;
  DATA.forEach(v=>{
    const passF=passes(v,bcfg);
    const passQ=!q||v.read.includes(q)||v.jp.includes(q)||v.mean.toLowerCase().includes(q);
    if(!(passF&&passQ))return;shown++;
    const leech=isLeech(v.rank);const acc=rollingAcc(v.rank);
    const card=document.createElement('div');
    card.className='card '+v.type+(leech?' leech':'');  // class + leech recolor spine
    const tiLabel=v.trans==='t'?'transitive':(v.trans==='i'?'intransitive':'');
    card.innerHTML=`<div class="rank">#${v.rank}</div>
      ${acc!=null?`<div class="acc">${Math.round(acc*100)}% acc</div>`:''}
      <div class="card-top"><div>
        <div class="verb-jp jp">${v.jp}</div><div class="verb-reading">${v.read}${TTS_OK?` <button class="speak-btn sm" type="button" aria-label="Play reading" title="Play reading"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>`:''}</div>
        <div class="verb-meaning">${v.mean}</div></div>
        <div style="text-align:right"><div class="stamp ${v.type}">${TYPE_LABEL[v.type]}</div>
        <div class="jlpt-pill">${v.jlpt}</div>${v.custom?'<div class="custom-badge">CUSTOM</div>':''}</div></div>
      ${leech?'<span class="leech-badge">⚠ LEECH</span>':''}
      <div class="tags">${tiLabel?`<span class="tag" style="color:var(--ichidan)">${tiLabel}</span>`:''}${v.tags.filter(t=>!t.startsWith('top')).map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      <div class="detail"><div class="detail-inner">
        <div class="blk"><div class="blk-label">Memory status</div><div class="blk-body" style="font-family:'SF Mono',monospace;font-size:12px">${store.cards[v.rank]&&store.cards[v.rank].box?`Box ${store.cards[v.rank].box} · next review: ${nextDueLabel(v.rank)}`:'New — not yet reviewed'}</div></div>
        ${v.mnem?`<div class="blk"><div class="blk-label">Mnemonic</div><div class="blk-body">${v.mnem}</div></div>`:''}
        ${v.tip?`<div class="blk"><div class="blk-label warn">Trap / Tip</div><div class="blk-body">${v.tip}</div></div>`:''}
        ${exampleListHtml(v)}
        ${v.custom?'<div class="verb-actions"><button class="chip verb-edit" type="button"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg>Edit</button><button class="chip verb-del" type="button" style="border-color:var(--godan);color:var(--godan)"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg>Delete</button></div>':''}
      </div></div>`;
    card.addEventListener('click',()=>card.classList.toggle('open'));
    const sb=card.querySelector('.speak-btn');   // play reading without toggling the card
    if(sb)sb.addEventListener('click',e=>{e.stopPropagation();speak(v.read);});
    if(v.custom){                                // edit/delete custom verbs (don't toggle the card)
      const eb=card.querySelector('.verb-edit'), db=card.querySelector('.verb-del');
      if(eb)eb.addEventListener('click',e=>{e.stopPropagation();openVerbModal(v);});
      if(db)db.addEventListener('click',e=>{e.stopPropagation();if(confirm('Delete custom verb '+v.jp+'? Its progress is also removed.'))deleteVerb(v.rank);});
    }
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
  const sg=document.getElementById('statgrid');
  sg.innerHTML=`
    <div class="statbox"><div class="v">${overall}%</div><div class="l">Overall accuracy</div></div>
    <div class="statbox"><div class="v">${tot}</div><div class="l">Total reviews</div></div>
    <div class="statbox"><div class="v">${studied}/${DATA.length}</div><div class="l">Cards drilled</div></div>
    <div class="statbox"><div class="v" style="color:var(--ichidan)">${dueCards().length}</div><div class="l">Due today</div></div>
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
  const boxColors=['var(--muted)','var(--godan)','#d98a3d','#c9b037','#7fae54','var(--good)'];
  const bd=document.getElementById('boxDist');
  bd.innerHTML=boxes.map((n,i)=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
    <div style="width:54px;font-family:monospace;font-size:11px;color:var(--muted)">${boxLabels[i]}</div>
    <div style="flex:1;background:var(--paper-2);border-radius:2px;height:16px;position:relative">
      <div style="width:${total?Math.round(100*n/total):0}%;background:${boxColors[i]};height:100%;border-radius:2px;min-width:${n?'3px':'0'}"></div></div>
    <div style="width:32px;text-align:right;font-family:monospace;font-size:11px;color:var(--muted)">${n}</div></div>`).join('');
}
// "Study leeches now": jump to the flashcard tab with a leech-only deck. Like
// startDueSession() it overrides the picker and syncs the chip UI to match.
document.getElementById('studyLeeches').addEventListener('click',()=>{
  document.querySelector('.tab[data-tab="study"]').click();
  cfg.type=[];cfg.trans=[];cfg.topic=[];cfg.status=['leech'];cfg.jlpt=['all'];cfg.rmin=1;cfg.rmax=100;
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

   Two independent synced blobs (separate server `app` namespaces, both server-wins
   on login, both debounced-push on change):
     • 'verbs'        — the progress `store` (cards/sessions/daily). save().
     • 'custom-verbs' — the user's custom verb definitions. saveCustom().

   Endpoints (served from this same origin):
     POST /v1/auth/register | /login | /logout      {email,password}
     GET  /v1/auth/me                    → {user:{id,email}|null}
     GET/PUT /v1/progress/verbs          {data:<store>}
     GET/PUT /v1/progress/custom-verbs   {data:{seq,verbs}}
   ========================================================================== */
const APP_KEY='verbs';            // progress namespace on the server
const CUSTOM_APP_KEY='custom-verbs'; // custom-verb-definitions namespace
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
  await pullCustomCloud();          // custom verbs share the sign-in pull
  refreshAllViews();
}

// Re-render every store-derived view. Mirrors the import handler's refresh set.
function refreshAllViews(){
  updateDeckCount(); updateDueBanner(); renderBrowse();
  if(typeof renderCustomCount==='function')renderCustomCount();
  if(document.getElementById('panel-stats').classList.contains('active'))renderStats();
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
function rebuildData(){
  const prevMax=MAXRANK;
  DATA=VERBS.filter(v=>!v.skip).concat(loadCustom().verbs);
  MAXRANK=DATA.reduce((m,v)=>Math.max(m,v.rank),0)||100;
  attachLevels();
  ['rmin','rmax','brmin','brmax'].forEach(id=>{const el=document.getElementById(id);if(el)el.max=MAXRANK;});
  // If a range's max was at the old ceiling ("show everything"), extend it so a
  // freshly-added custom verb is included by default; otherwise respect narrowing.
  if(cfg.rmax>=prevMax){cfg.rmax=MAXRANK;const e=document.getElementById('rmax');if(e)e.value=MAXRANK;}
  if(bcfg.rmax>=prevMax){bcfg.rmax=MAXRANK;const e=document.getElementById('brmax');if(e)e.value=MAXRANK;}
  annotateJlptChips();
}
function renderCustomCount(){
  const n=loadCustom().verbs.length;
  document.getElementById('customCount').innerHTML = n?`<b>${n}</b> custom verb${n===1?'':'s'}`:'';
}
function openVerbModal(verb){
  editingRank = verb?verb.rank:null;
  document.getElementById('verbTitle').textContent = verb?'Edit verb':'Add a verb';
  document.getElementById('verbSubmit').textContent = verb?'Save changes':'Save verb';
  document.getElementById('verbDelete').hidden = !verb;
  document.getElementById('verbErr').textContent='';
  const g=id=>document.getElementById(id);
  g('vfJp').value=verb?verb.jp:''; g('vfRead').value=verb?verb.read:''; g('vfMean').value=verb?verb.mean:'';
  g('vfType').value=verb?verb.type:'godan'; g('vfJlpt').value=verb?verb.jlpt:'N4';
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
  const verb={ jp, read, mean, type:val('vfType'), jlpt:val('vfJlpt'), trans:val('vfTrans'),
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
document.getElementById('verbForm').addEventListener('submit',saveVerb);
document.getElementById('verbDelete').addEventListener('click',()=>{ if(editingRank!=null&&confirm('Delete this custom verb? Its progress is also removed.'))deleteVerb(editingRank); });
document.getElementById('verbModal').addEventListener('click',e=>{ if(e.target.id==='verbModal')closeVerbModal(); }); // backdrop
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&document.getElementById('verbModal').classList.contains('show'))closeVerbModal(); });
rebuildData();          // sync the rank-range UI to MAXRANK (DATA already merged custom verbs at load)
renderCustomCount();

// ---- Initial paint ----
// The flashcard tab is the default-active panel (its deck count + due banner
// were already computed above). Stats renders lazily on tab-open. Browse needs
// one render now so it's ready the moment the user switches to it.
renderBrowse();
// Kick off the session probe / cloud hydration once everything above is wired.
bootAuth();
