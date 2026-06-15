// ACCESSIBILITY — roving tabindex for chip groups (OUTSTANDING #4) + the "disable
// empty filter chips" annotations (JLPT levels / categories / Minna sources).
//
// Each filter row (every `.chips` track + each open `.topic-inner`) becomes ONE tab stop
// instead of N: only one chip in the group is tabbable (tabindex 0), the rest are
// tabindex -1. ←/→ (and ↑/↓) move within the group, Home/End jump to the ends, and the
// tab stop follows the selected/last-focused chip so Tab returns where you left off.
//
// TWO flavours, chosen by the container's role:
// - MULTI-select facet rows (Category/Type/Transitivity/Topic/Status/JLPT, topics) are
//   role=group TOOLBAR semantics: arrows only MOVE focus — Space/Enter toggles a chip
//   through its existing makeMultiSelect click handler.
// - SINGLE-select rows opt into role=radiogroup IN THE MARKUP (Study type, Test direction,
//   Input, Audio, Order). There arrows MOVE THE SELECTION the way a native radio group
//   does: each chip is role=radio with aria-checked mirrored from its `.active` class, and
//   the checked chip is the lone tab stop. Arrowing reuses the chip's own click handler so
//   cfg/settings/repaint stay centralized.
//
// `button.chip` only, so the Font `<select>` and the rank number inputs stay normal tab
// stops (focus on them returns -1 from indexOf → arrows fall through to native behavior).
// Collapsed `.topic-inner` chips are pulled OUT of the tab order entirely (a
// MutationObserver on the region's `open` class).
import { state } from '../state.js';
import { CATS } from '../core/index.js';

export function setupRoving(container){
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
// re-runs when state.DATA changes (custom verbs may populate a previously-empty level).
export function annotateJlptChips(){
  const counts={};
  state.DATA.forEach(v=>{counts[v.jlpt]=(counts[v.jlpt]||0)+1;});
  document.querySelectorAll('.chip.jlpt,.chip.bjlpt').forEach(b=>{
    const lv=b.dataset.jlpt;
    if(lv==='all'){ b.title='All levels'; return; }
    const n=counts[lv]||0;
    b.disabled = n===0;
    b.title = n===0 ? `No cards at ${lv} in this deck` : `${n} card${n===1?'':'s'} at ${lv}`;
  });
}
// Same treatment for the part-of-speech category chips: all 100 built-ins are
// verbs, so Adjective/Noun/Adverb/Phrase start disabled and light up only once a
// custom card of that category exists. Roving nav skips disabled chips already.
export function annotateCatChips(){
  const counts={};
  state.DATA.forEach(v=>{const c=v.cat||'verb';counts[c]=(counts[c]||0)+1;});
  document.querySelectorAll('.chip.deck,.chip.bf').forEach(b=>{
    const t=b.dataset.deck||b.dataset.filter;
    if(!CATS.includes(t))return;
    const n=counts[t]||0;
    b.disabled = n===0;
    b.title = n===0 ? `No ${t}s yet — add one in Browse` : `${n} ${t}${n===1?'':'s'}`;
  });
}
// Source facet (みんなの日本語 / iTalki / per-lesson) only applies once Minna vocab
// has been activated. Hide the whole Source row when the deck has no Minna cards;
// otherwise dim individual source chips that currently match nothing. Same shape
// as annotateCatChips; runs at boot and on every state.DATA change.
export function annotateSourceChips(){
  // Show the Source row once the deck has ANY provenance-tagged cards — みんなの日本語 OR a 歌/song
  // word (both populate the source facet); otherwise hide it entirely.
  const hasSource=state.DATA.some(v=>v.minna||v.song);
  document.querySelectorAll('.frow.source-row').forEach(r=>{r.style.display=hasSource?'':'none';});
  if(!hasSource)return;
  const counts={minna:0,italki:0,song:0};
  state.DATA.forEach(v=>{ if(v.minna)counts.minna++; if(v.italki)counts.italki++; if(v.song)counts.song++;
    (v.tags||[]).forEach(t=>{ if(/^mnn-l\d+$/.test(t)||/^song-/.test(t))counts[t]=(counts[t]||0)+1; }); });
  document.querySelectorAll('.chip.deck,.chip.bf').forEach(b=>{
    const t=b.dataset.deck||b.dataset.filter;
    if(t!=='minna'&&t!=='italki'&&t!=='song'&&!/^mnn-l\d+$/.test(t)&&!/^song-/.test(t))return;
    const n=counts[t]||0;
    b.disabled=n===0;
    b.title=n===0?'No cards with this source yet':`${n} card${n===1?'':'s'}`;
  });
}
// Boot wiring: annotate the chips, then make every chip group a roving-tabindex group.
export function initA11y(){
  annotateJlptChips();
  annotateCatChips();
  annotateSourceChips();
  document.querySelectorAll('.chips, .topic-inner').forEach(setupRoving);
}
