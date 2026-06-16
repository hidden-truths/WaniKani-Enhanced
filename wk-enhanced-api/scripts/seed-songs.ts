// seed-songs — seed the curated STARTER songs into the store as PUBLIC, anon-readable rows (the song
// table + one `sentence` row per line, owner_type='song'). Reads every data/songs/*.json (curated
// lyrics with <ruby> furigana), derives plainText + structured segments via core/text.js, and calls
// db.upsertPublicSong (idempotent by song ext_id, reuse-by-hash per line).
//
// A line MAY carry pre-computed tap tokens (the curated analysis): its optional `tokens` are CONTENT
// words in left-to-right order WITHOUT offsets; this script computes their UTF-16 offsets via the
// SAME offsetTokens the runtime analyzer uses (services/songAnalyze.ts), so text.slice===surface holds
// by construction and one offset routine serves both producers. A line with no tokens still seeds and
// renders plain ruby (Read works), but contributes no Mine vocab / coverage (those need tokens).
//
// User-authored BYO songs are NOT seeded here — those are written live via POST /v1/songs as PRIVATE
// rows. Only lyrics you're entitled to redistribute belong in data/songs/ (see its README).
//
// Run from wk-enhanced-api/ so .env loads (→ DATABASE_FILE). To seed PROD, point DATABASE_FILE at the
// prod sqlite (or run on the droplet), same pattern as seed-sentences.ts.
//   bun scripts/seed-songs.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { plainText, rubyToSegments } from '../../study-app/src/core/text.js';
import { offsetTokens } from '../src/services/songAnalyze.ts';
import * as db from '../src/db/client.ts';

// A content word as authored in a seed file: in-order surface (must appear in the line text), plus the
// dictionary form / reading / UD POS and an optional JLPT level + English gloss. Offsets are computed.
interface SongFileToken {
    surface: string;
    lemma?: string;
    reading?: string;
    pos: string; // UD coarse POS — NOUN/PROPN/VERB/ADJ/ADV count as studiable content words
    jlpt?: string; // 'N5'..'N1'
    gloss?: string;
}
interface SongFileLine {
    jp: string; // <ruby> furigana
    en?: string;
    grammar?: string[];
    tokens?: SongFileToken[]; // optional curated analysis → Mine vocab + coverage + tap-to-lookup
}
interface SongFile {
    extId: string;
    title: string;
    artist?: string | null;
    youtubeId?: string | null;
    lines: SongFileLine[];
}

// concat(seg.t) must reconstruct plainText(jp) — the structural-furigana invariant (upsertPublicSong
// enforces it too, but checking here names the offending file/line if a curated source ever drifts).
function lineFor(jp: string, label: string) {
    const text = plainText(jp);
    const furigana = rubyToSegments(jp);
    const concat = furigana.map((s: { t: string }) => s.t).join('');
    if (concat !== text) {
        console.error(`furigana mismatch in ${label}: ${JSON.stringify(concat)} !== ${JSON.stringify(text)}`);
        process.exit(1);
    }
    return { text, furigana };
}

const dir = fileURLToPath(new URL('../data/songs', import.meta.url));
if (!existsSync(dir)) {
    console.log('no data/songs directory — nothing to seed');
    process.exit(0);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
let songs = 0;
let lines = 0;
let skipped = 0;
for (const f of files) {
    const song = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as SongFile;
    // A scaffold (verified metadata, lyrics not yet filled in) carries no lines — leave it inert
    // rather than seeding a 0-line song that would show 0% / empty Mine in the library.
    if (!song.lines?.length) {
        console.log(`skip ${f}: no lines yet (scaffold)`);
        skipped++;
        continue;
    }
    db.upsertPublicSong({
        extId: song.extId,
        title: song.title,
        artist: song.artist ?? null,
        youtubeId: song.youtubeId ?? null,
        lines: song.lines.map((ln, i) => {
            const label = `${f}[${i}]`;
            const { text, furigana } = lineFor(ln.jp, label);
            let tokens;
            if (ln.tokens?.length) {
                // Same in-order offset walk as the runtime analyzer; null = a surface isn't in the line.
                const computed = offsetTokens(text, ln.tokens);
                if (!computed) {
                    console.error(`token offset mismatch in ${label}: a token surface is not found (in order) in ${JSON.stringify(text)}`);
                    process.exit(1);
                }
                tokens = computed;
            }
            return { text, furigana, en: ln.en ?? null, grammar: ln.grammar ?? [], tokens };
        }),
    });
    songs++;
    lines += song.lines.length;
}
console.log(`seeded ${songs} starter song(s) (${lines} lines) into the song store${skipped ? ` — skipped ${skipped} scaffold(s)` : ''}`);
