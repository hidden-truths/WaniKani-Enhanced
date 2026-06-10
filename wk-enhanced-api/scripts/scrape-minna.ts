#!/usr/bin/env bun
/**
 * scrape-minna.ts — pull a Minna no Nihongo lesson from vnjpclub.com into a
 * draft JSON for the study app's みんなの日本語 dashboard.
 *
 *   bun scripts/scrape-minna.ts 23           # → data/minna/lesson-23.draft.json
 *
 * WHAT IS RELIABLE vs WHAT NEEDS CURATION
 *   - Vocabulary table (`<table class="search_result">`) is clean and general:
 *     kana / kanji / native-audio path / English. Extracted faithfully.
 *   - Audio inventory (every `/Audio/.../*.mp3`) is extracted verbatim.
 *   - Grammar / reading / conversation prose is best-effort (the pages are
 *     table-and-i18n soup, grammar "structures" ship as PNGs). The JP/EN pairs
 *     come from the site's `candich`/`nddich` reveal blocks.
 *
 * The output is a *draft* (`lesson-<n>.draft.json`) — never the curated
 * `lesson-<n>.json` the server serves. Curate the draft by hand: split the
 * `[context]` off headwords, assign cat/type/trans + dictionary forms for the
 * deck merge, fix source typos (e.g. ch23's 橋 was mislabelled "chopsticks"),
 * and add furigana. Same machine-extracted + human-validated discipline as
 * examples.js. Be polite: this hits vnjpclub a handful of times per run.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const BASE = 'https://www.vnjpclub.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const SECTIONS = ['vocabulary', 'grammar', 'reading', 'conversation'] as const;
type Section = (typeof SECTIONS)[number];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchSection(lesson: number, section: Section): Promise<string> {
    const url = `${BASE}/en/minna-no-nihongo/lesson-${lesson}-${section}.html`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: `${BASE}/` } });
    if (!res.ok) throw new Error(`${section}: HTTP ${res.status}`);
    return res.text();
}

// Strip ruby parens/readings (keep the base text), then all tags, then collapse.
function clean(html: string): string {
    return html
        .replace(/<rp>.*?<\/rp>/gs, '')
        .replace(/<rt>.*?<\/rt>/gs, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

// The vocab table is the one clean, general structure. Each <tr> is
// kana / kanji / <audio src> / meaning. The `[context]` is left attached to the
// headword for the curator to split.
function parseVocab(html: string) {
    const start = html.indexOf('class="search_result"');
    if (start < 0) return [];
    const table = html.slice(start, start + html.slice(start).indexOf('</table>'));
    const rows = [...table.matchAll(/<tr>(.*?)<\/tr>/gs)].map((m) => m[1]);
    const out: any[] = [];
    for (const r of rows) {
        const tds = [...r.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]);
        if (tds.length < 4) continue; // skips the <th> header row
        const audio = tds[2].match(/(\/Audio\/[A-Za-z0-9_/]+\.mp3)/)?.[1] ?? null;
        out.push({ kana: clean(tds[0]), kanji: clean(tds[1]), mean: clean(tds[3]), audio });
    }
    return out;
}

// JP/EN pairs from the site's reveal blocks: `candich` holds the Japanese,
// `nddich` the English translation. Used for grammar/reading/conversation.
function parsePairs(html: string) {
    const noScript = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const jp = [...noScript.matchAll(/class="candich"[^>]*>(.*?)<\/div>\s*<div class="kqdich/gs)].map((m) => clean(m[1]));
    const en = [...noScript.matchAll(/class="nddich[^"]*"[^>]*>(.*?)<\/div>/gs)].map((m) => clean(m[1]));
    const pairs: { jp: string; en: string }[] = [];
    for (let i = 0; i < Math.max(jp.length, en.length); i++) {
        pairs.push({ jp: jp[i] ?? '', en: en[i] ?? '' });
    }
    return pairs.filter((p) => p.jp);
}

const collectAudio = (html: string) => [...new Set([...html.matchAll(/\/Audio\/[A-Za-z0-9_/]+\.mp3/g)].map((m) => m[0]))];

async function main() {
    const lesson = Number(process.argv[2]);
    if (!Number.isInteger(lesson) || lesson < 1 || lesson > 50) {
        console.error('usage: bun scripts/scrape-minna.ts <lesson 1-50>');
        process.exit(1);
    }
    const pages: Partial<Record<Section, string>> = {};
    for (const section of SECTIONS) {
        try {
            pages[section] = await fetchSection(lesson, section);
            console.error(`  fetched ${section}`);
        } catch (e) {
            console.error(`  ${section}: ${(e as Error).message} (skipped)`);
        }
        await sleep(600); // politeness gap
    }

    const draft = {
        lesson,
        _draft: true,
        _note: 'Machine-extracted from vnjpclub.com — CURATE before serving (see scrape-minna.ts header).',
        vocab: pages.vocabulary ? parseVocab(pages.vocabulary) : [],
        grammar: pages.grammar ? parsePairs(pages.grammar) : [],
        reading: pages.reading ? parsePairs(pages.reading) : [],
        conversation: pages.conversation ? parsePairs(pages.conversation) : [],
        audio: Object.fromEntries(SECTIONS.map((s) => [s, pages[s] ? collectAudio(pages[s]!) : []])),
    };

    const out = join(import.meta.dirname, '..', 'data', 'minna', `lesson-${lesson}.draft.json`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(draft, null, 2) + '\n');
    console.error(`\nwrote ${out}`);
    console.error(`  vocab=${draft.vocab.length} grammar=${draft.grammar.length} reading=${draft.reading.length} conversation=${draft.conversation.length}`);
}

// Only run when invoked directly (`bun scripts/scrape-minna.ts 23`); stays inert
// when imported by the test file so `main()` doesn't fire on import.
if (import.meta.main) main();

// Pure helpers exported for unit tests (see scripts/scrape-minna.test.ts).
export { clean, parseVocab, parsePairs, collectAudio };
