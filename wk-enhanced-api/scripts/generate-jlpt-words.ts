// Generate the study app's per-level JLPT word data files (gap-fill card source) by enriching
// data/jlpt-vocab.json ({ headword: level 1..5 } — NO readings/glosses) against JMdict:
//
//   bun scripts/generate-jlpt-words.ts /path/to/JMdict_e
//
// Emits ../study-app/src/data/jlpt-words/{N5,N4,N3,N2,N1}.js — each a FREQUENCY-ORDERED
// (JMdict priority markers: ichi1/news1/spec1/gai1/nfXX) array of tuples
// [jp, read, mean, cat, type, trans] in the deck's taxonomy (cat: verb/adjective/noun/adverb/
// phrase; type: godan/ichidan/irregular/i-adj/na-adj/''; trans: 't'/'i'/''). The ordering IS the
// gap-fill batch selection order, so the client needs no separate frequency table.
//
// Matching: a kanji-bearing headword matches an entry's <keb> (reading = first non-restricted,
// non-nokanji <reb>); a kana headword matches a <reb> directly (read = jp). The best-priority
// entry wins when several share a headword. `jp` stays the list headword VERBATIM (kana stays
// kana) so the coverage lens's headword-or-reading matching always agrees with the card.
//
// JMdict_e is the EDRDG English edition; it is NOT committed — download it locally:
//   curl -sL http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz | gunzip > /tmp/JMdict_e
// The generated files carry the EDRDG attribution their license requires.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HAS_KANJI = /[一-龯々〆ヶ]/;

// XML entity unescape for glosses (JMdict_e glosses are plain text + these five), then strip any
// residual angle brackets — `mean` ends up in innerHTML render paths in the app.
function cleanGloss(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[<>]/g, '')
    .trim();
}

// Priority markers → a comparable frequency score (higher = more common).
export function priScore(markers: string[]): number {
  let score = 0;
  for (const m of markers) {
    if (m === 'ichi1' || m === 'news1' || m === 'spec1') score += 3;
    else if (m === 'gai1') score += 2;
    else if (m === 'ichi2' || m === 'news2' || m === 'spec2' || m === 'gai2') score += 1;
    else if (/^nf\d\d$/.test(m)) score += (49 - Number(m.slice(2))) / 16; // nf01 ≈ 3 … nf48 ≈ 0.06
  }
  return score;
}

// POS entity names (kept literal — we never expand the DTD) → the deck taxonomy.
export function posTraits(pos: string[]): { cat: string; type: string; trans: string } {
  const has = (p: string) => pos.includes(p);
  const some = (re: RegExp) => pos.some((p) => re.test(p));
  let cat = 'noun', type = '';
  if (some(/^v5/)) { cat = 'verb'; type = 'godan'; }
  else if (has('v1') || has('v1-s') || has('vz')) { cat = 'verb'; type = 'ichidan'; }
  else if (has('vk') || has('vs-i') || has('vs-s')) { cat = 'verb'; type = 'irregular'; }
  else if (has('adj-i') || has('adj-ix')) { cat = 'adjective'; type = 'i-adj'; }
  else if (has('adj-na')) { cat = 'adjective'; type = 'na-adj'; }
  else if (has('adj-t') || has('adj-f') || has('adj-pn')) cat = 'adjective';
  else if (has('adv') || has('adv-to')) cat = 'adverb';
  else if (has('exp') || has('int') || has('conj') || has('prt')) cat = 'phrase';
  // NOTE: bare 'vs' ("noun taking する") stays a noun — the suru-compound verb is a separate card.
  const t = has('vt'), i = has('vi');
  const trans = cat === 'verb' && t !== i ? (t ? 't' : 'i') : '';
  return { cat, type, trans };
}

type Sense = { pos: string[]; glosses: string[]; stagk: string[]; stagr: string[] };
type Entry = {
  kebs: { text: string; pri: string[] }[];
  rebs: { text: string; pri: string[]; restr: string[]; nokanji: boolean }[];
  senses: Sense[];
};

const block = (xml: string, tag: string): string[] => {
  const out: string[] = [];
  let i = 0;
  const open = `<${tag}>`, close = `</${tag}>`;
  while ((i = xml.indexOf(open, i)) >= 0) {
    const end = xml.indexOf(close, i);
    if (end < 0) break;
    out.push(xml.slice(i + open.length, end));
    i = end + close.length;
  }
  return out;
};
const values = (xml: string, tag: string): string[] => block(xml, tag);
const entities = (xml: string, tag: string): string[] =>
  block(xml, tag).map((v) => v.replace(/^&|;$/g, ''));

export function parseEntry(xml: string): Entry {
  const kebs = block(xml, 'k_ele').map((k) => ({ text: values(k, 'keb')[0] ?? '', pri: values(k, 'ke_pri') }));
  const rebs = block(xml, 'r_ele').map((r) => ({
    text: values(r, 'reb')[0] ?? '',
    pri: values(r, 're_pri'),
    restr: values(r, 're_restr'),
    nokanji: r.includes('<re_nokanji'),
  }));
  // <pos> is per-sense but inherits from the previous sense when omitted (JMdict convention).
  let lastPos: string[] = [];
  const senses = block(xml, 'sense').map((s) => {
    const pos = entities(s, 'pos');
    if (pos.length) lastPos = pos;
    return { pos: lastPos, glosses: values(s, 'gloss').map(cleanGloss).filter(Boolean), stagk: values(s, 'stagk'), stagr: values(s, 'stagr') };
  });
  return { kebs, rebs, senses };
}

// Resolve one wanted headword against a parsed entry. Returns null when the entry doesn't carry it.
export function matchEntry(entry: Entry, headword: string):
  { read: string; mean: string; cat: string; type: string; trans: string; score: number } | null {
  const isKanji = HAS_KANJI.test(headword);
  let read = '', priMarkers: string[] = [];
  if (isKanji) {
    const keb = entry.kebs.find((k) => k.text === headword);
    if (!keb) return null;
    const reb = entry.rebs.find((r) => !r.nokanji && (!r.restr.length || r.restr.includes(headword)));
    if (!reb) return null;
    read = reb.text;
    priMarkers = [...keb.pri, ...reb.pri];
  } else {
    const reb = entry.rebs.find((r) => r.text === headword);
    if (!reb) return null;
    read = headword;
    priMarkers = reb.pri;
  }
  // First sense with an English gloss whose stagk/stagr restrictions admit the matched forms.
  const sense = entry.senses.find((s) =>
    s.glosses.length
    && (!s.stagk.length || !isKanji || s.stagk.includes(headword))
    && (!s.stagr.length || s.stagr.includes(read)));
  if (!sense) return null;
  const { cat, type, trans } = posTraits(sense.pos);
  return { read, mean: sense.glosses.slice(0, 3).join('; '), cat, type, trans, score: priScore(priMarkers) };
}

export function generate(jmdictXml: string, vocab: Record<string, number>) {
  const wantKanji = new Map<string, number>(); // headword → source order
  const wantKana = new Map<string, number>();
  let order = 0;
  for (const w of Object.keys(vocab)) (HAS_KANJI.test(w) ? wantKanji : wantKana).set(w, order++);

  type Hit = { read: string; mean: string; cat: string; type: string; trans: string; score: number };
  const best = new Map<string, Hit>();
  let i = 0;
  while ((i = jmdictXml.indexOf('<entry>', i)) >= 0) {
    const end = jmdictXml.indexOf('</entry>', i);
    if (end < 0) break;
    const raw = jmdictXml.slice(i + 7, end);
    i = end + 8;
    // Cheap pre-filter: parse only entries whose keb/reb text can possibly match a wanted word.
    let parsed: Entry | null = null;
    const tryWord = (w: string) => {
      parsed ??= parseEntry(raw);
      const hit = matchEntry(parsed, w);
      if (hit && (!best.has(w) || hit.score > best.get(w)!.score)) best.set(w, hit);
    };
    for (const m of raw.matchAll(/<keb>([^<]+)<\/keb>/g)) if (wantKanji.has(m[1])) tryWord(m[1]);
    for (const m of raw.matchAll(/<reb>([^<]+)<\/reb>/g)) if (wantKana.has(m[1])) tryWord(m[1]);
  }

  const LEVELS: Record<number, string> = { 5: 'N5', 4: 'N4', 3: 'N3', 2: 'N2', 1: 'N1' };
  const byLevel: Record<string, { jp: string; hit: Hit; order: number }[]> = { N5: [], N4: [], N3: [], N2: [], N1: [] };
  const misses: Record<string, string[]> = { N5: [], N4: [], N3: [], N2: [], N1: [] };
  for (const [w, lvl] of Object.entries(vocab)) {
    const level = LEVELS[lvl];
    if (!level) continue;
    const hit = best.get(w);
    if (hit) byLevel[level].push({ jp: w, hit, order: (wantKanji.get(w) ?? wantKana.get(w))! });
    else misses[level].push(w);
  }
  for (const level of Object.values(LEVELS)) {
    byLevel[level].sort((a, b) => b.hit.score - a.hit.score || a.order - b.order);
  }
  return { byLevel, misses };
}

if (import.meta.main) {
  const jmdictPath = process.argv[2];
  if (!jmdictPath) {
    console.error('usage: bun scripts/generate-jlpt-words.ts /path/to/JMdict_e');
    process.exit(1);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const vocab = JSON.parse(readFileSync(join(here, '../data/jlpt-vocab.json'), 'utf8')) as Record<string, number>;
  const xml = readFileSync(jmdictPath, 'utf8');
  const { byLevel, misses } = generate(xml, vocab);

  const outDir = join(here, '../../study-app/src/data/jlpt-words');
  mkdirSync(outDir, { recursive: true });
  for (const [level, rows] of Object.entries(byLevel)) {
    const header = `// GENERATED by wk-enhanced-api/scripts/generate-jlpt-words.ts — do not hand-edit.
// ${level} words from data/jlpt-vocab.json enriched with readings/glosses/POS from JMdict.
// This file uses the JMdict dictionary (EDRDG, https://www.edrdg.org/), licensed under the
// EDRDG licence (CC BY-SA 4.0); see https://www.edrdg.org/edrdg/licence.html.
// Frequency-ordered (JMdict priority markers) — the order IS the gap-fill selection order.
// Tuple shape: [jp, read, mean, cat, type, trans]. Loaded lazily (features/jlpt/data.js
// ensureJlptWords) so each level code-splits out of the main bundle, like data/jlpt.js.
`;
    const lines = rows.map(({ jp, hit }) =>
      JSON.stringify([jp, hit.read, hit.mean, hit.cat, hit.type, hit.trans]));
    writeFileSync(join(outDir, `${level}.js`), `${header}export const WORDS = [\n${lines.join(',\n')}\n];\n`);
    console.log(`${level}: ${rows.length} words (${misses[level].length} missed)`);
  }
  const missedAll = Object.entries(misses).flatMap(([l, ws]) => ws.map((w) => `${l} ${w}`));
  if (missedAll.length) {
    console.log(`\nJMdict misses (${missedAll.length}) — patch by hand or accept the gap:`);
    for (const m of missedAll) console.log(`  ${m}`);
  }
}
