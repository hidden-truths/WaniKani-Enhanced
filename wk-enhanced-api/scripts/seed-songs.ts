// seed-songs — seed the curated CC / public-domain STARTER songs into the store as PUBLIC,
// anon-readable rows (the song table + one `sentence` row per line, owner_type='song'). Reads every
// data/songs/*.json (curated lyrics with <ruby> furigana), derives plainText + structured segments
// via core/text.js, and calls db.upsertPublicSong (idempotent by song ext_id, reuse-by-hash per
// line). Seeded lines carry NO tap tokens (those come from the runtime LLM analysis, not the seed) —
// they render plain ruby until annotated.
//
// User-authored BYO songs are NOT seeded here — those are written live via POST /v1/songs as PRIVATE
// rows. Only genuinely free-to-redistribute lyrics belong in data/songs/ (see its README).
//
// Run from wk-enhanced-api/ so .env loads (→ DATABASE_FILE). To seed PROD, point DATABASE_FILE at the
// prod sqlite (or run on the droplet), same pattern as seed-sentences.ts.
//   bun scripts/seed-songs.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { plainText, rubyToSegments } from '../../study-app/src/core/text.js';
import * as db from '../src/db/client.ts';

interface SongFileLine {
    jp: string; // <ruby> furigana
    en?: string;
    grammar?: string[];
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
for (const f of files) {
    const song = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as SongFile;
    db.upsertPublicSong({
        extId: song.extId,
        title: song.title,
        artist: song.artist ?? null,
        youtubeId: song.youtubeId ?? null,
        lines: song.lines.map((ln, i) => {
            const { text, furigana } = lineFor(ln.jp, `${f}[${i}]`);
            return { text, furigana, en: ln.en ?? null, grammar: ln.grammar ?? [] };
        }),
    });
    songs++;
    lines += song.lines.length;
}
console.log(`seeded ${songs} starter song(s) (${lines} lines) into the song store`);
