// 歌 / Songs — the runtime lyrics-analysis pass (the one genuinely new capability). Turns pasted
// Japanese lyrics into per-line furigana + English + grammar tags + per-word JLPT tokens by calling
// Claude (forced tool-use → structured JSON). Account-gated route; OPTIONAL infra (no key → the
// route 503s and the rest of Songs still works).
//
// Robustness split — the model does the LINGUISTICS, the server does the BOOKKEEPING:
//   • The model returns furigana segments + tokens (in order, with surfaces) — NOT offsets. We
//     COMPUTE UTF-16 offsets here by walking the line text, so `text.slice(start,end)===surface`
//     holds by construction (the offset contract the tap-to-lookup UI relies on — see the offset
//     dead-end in CLAUDE.md). Never trust an LLM to count UTF-16 code units.
//   • Furigana is validated (concat(seg.t)===line); a mismatch flags the line + falls back to plain
//     text. Token mis-alignment flags the line + drops its tokens (plain ruby). A missing line is
//     flagged. Flags drive the Add-screen proofread step.
// The validation/offset/flag logic is the pure `assembleAnalysis` (unit-tested); the model call
// (`analyzeLyrics`) is integration-only (mock-free, like the rest of the service layer).

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { log } from '../lib/log.ts';
import GRAMMAR_CATALOG from '../../data/grammar.json' with { type: 'json' };

const CATALOG = GRAMMAR_CATALOG as { id: string; label: string; jlpt: string }[];
const CATALOG_IDS = new Set(CATALOG.map((g) => g.id));
const TOOL_NAME = 'emit_song_analysis';
const MAX_LINES = 120;

// Thrown when ANTHROPIC_API_KEY isn't set → the route maps it to 503 analysis_unavailable.
export class AnalysisUnavailableError extends Error {
    constructor() {
        super('lyrics analysis is not configured (no ANTHROPIC_API_KEY)');
        this.name = 'AnalysisUnavailableError';
    }
}

export function isAnalysisConfigured(): boolean {
    return !!config.songs.anthropicApiKey;
}

// ---- shapes ----

export interface FuriganaSeg {
    t: string;
    r?: string;
}
// A token as the MODEL returns it (no offsets) — surfaces are in left-to-right order.
interface ModelToken {
    surface: string;
    lemma?: string;
    reading?: string;
    pos?: string;
    jlpt?: string;
    gloss?: string;
}
interface ModelLine {
    index: number;
    furigana?: FuriganaSeg[] | null;
    en?: string;
    grammar?: string[];
    tokens?: ModelToken[];
    flag?: boolean; // model self-flags a line it's unsure about
}
export interface ModelOutput {
    profile?: { jlpt?: string | null };
    lines: ModelLine[];
}

// A token AFTER server-side offset computation (the sentence-store token shape + jlpt/gloss).
export interface AnalyzedToken {
    i: number;
    start: number;
    end: number;
    surface: string;
    lemma: string;
    pos: string;
    reading: string;
    jlpt?: string;
    gloss?: string;
}
export interface AnalyzedLine {
    index: number;
    text: string;
    furigana: FuriganaSeg[] | null;
    en: string;
    grammar: string[];
    tokens: AnalyzedToken[];
    flags: string[]; // 'missing' | 'furigana' | 'tokens' | 'low-confidence'
}
export interface AnalyzedSong {
    profile: { jlpt: string | null; grammarCount: number; lineCount: number };
    lines: AnalyzedLine[];
}

// ---- pure assembly (validation + UTF-16 offset computation + flagging) ----

function furiganaReconstructs(furigana: FuriganaSeg[] | null | undefined, text: string): boolean {
    if (!Array.isArray(furigana)) return false;
    return furigana.map((s) => (s && typeof s.t === 'string' ? s.t : '')).join('') === text;
}

// Compute UTF-16 offsets by walking the line: find each surface at/after a running cursor. Returns
// null if any surface can't be aligned in order (→ caller flags + drops tokens). `indexOf` uses
// UTF-16 indices (JS strings), so start/end satisfy text.slice(start,end)===surface by construction.
function offsetTokens(text: string, tokens: ModelToken[]): AnalyzedToken[] | null {
    const out: AnalyzedToken[] = [];
    let cursor = 0;
    for (const t of tokens) {
        const surface = typeof t.surface === 'string' ? t.surface : '';
        if (!surface) return null;
        const idx = text.indexOf(surface, cursor);
        if (idx < 0) return null;
        out.push({
            i: out.length,
            start: idx,
            end: idx + surface.length,
            surface,
            lemma: t.lemma || surface,
            pos: (t.pos || '').toUpperCase(),
            reading: t.reading || '',
            ...(t.jlpt ? { jlpt: t.jlpt } : {}),
            ...(t.gloss ? { gloss: t.gloss } : {}),
        });
        cursor = idx + surface.length;
    }
    return out;
}

// Compose the validated, offset-resolved analysis for the (already-trimmed) input lines from the
// model's raw output. Pure + deterministic → unit-tested without any Anthropic mock.
export function assembleAnalysis(inputLines: string[], output: ModelOutput): AnalyzedSong {
    const byIndex = new Map<number, ModelLine>();
    for (const l of output?.lines ?? []) if (l && typeof l.index === 'number') byIndex.set(l.index, l);

    const lines: AnalyzedLine[] = inputLines.map((text, i) => {
        const a = byIndex.get(i);
        if (!a) return { index: i, text, furigana: null, en: '', grammar: [], tokens: [], flags: ['missing'] };

        const flags: string[] = a.flag ? ['low-confidence'] : [];

        let furigana: FuriganaSeg[] | null = Array.isArray(a.furigana) ? a.furigana : null;
        if (furigana && !furiganaReconstructs(furigana, text)) {
            furigana = null;
            flags.push('furigana');
        }

        let tokens: AnalyzedToken[] = [];
        if (Array.isArray(a.tokens) && a.tokens.length) {
            const computed = offsetTokens(text, a.tokens);
            if (computed) tokens = computed;
            else flags.push('tokens');
        }

        const grammar = Array.isArray(a.grammar) ? a.grammar.filter((g) => CATALOG_IDS.has(g)) : [];
        return { index: i, text, furigana, en: typeof a.en === 'string' ? a.en : '', grammar, tokens, flags };
    });

    const grammarCount = new Set(lines.flatMap((l) => l.grammar)).size;
    const jlpt = output?.profile?.jlpt ?? null;
    return { profile: { jlpt, grammarCount, lineCount: lines.length }, lines };
}

// ---- the model call ----

// Split pasted lyrics into trimmed, non-empty lines (the unit of analysis + the sentence rows).
export function splitLyrics(raw: string): string[] {
    return raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, MAX_LINES);
}

const SYSTEM = `You are a meticulous Japanese-language annotator for a JLPT N5–N3 study app. You are given the
lyric lines of a song (numbered). For EACH line, produce a careful linguistic analysis and return it
by calling the ${TOOL_NAME} tool. Rules:

- furigana: an array of {t, r?} segments. \`t\` is a run of the ORIGINAL line text; \`r\` is its kana
  reading (omit \`r\` for kana/punctuation that needs no ruby). The concatenation of every \`t\` MUST
  exactly reproduce the line, character-for-character (do not add, drop, or reorder any character).
  Put ruby only on kanji runs.
- en: a natural, faithful English translation of the line.
- grammar: ids of grammar patterns USED in the line, chosen ONLY from the catalog given below. Omit
  patterns not in the catalog. Most lines use 0–2.
- tokens: the CONTENT words of the line (nouns, verbs, adjectives, adverbs, proper nouns) in
  left-to-right order. For each: surface (exactly as it appears in the line), lemma (dictionary
  form), reading (kana), pos (one of NOUN, PROPN, VERB, ADJ, ADV), jlpt (N5–N1 estimate), and a
  short English gloss. Skip particles, auxiliaries, and punctuation. Do NOT include character
  offsets — the server computes them.
- flag: set true for a line whose reading or parse you are genuinely unsure about (rare/ambiguous
  readings, archaic or unclear lines), so a human can proofread it.
- profile.jlpt: the overall JLPT level of the song (N5 easiest … N1 hardest).

Return ONLY the tool call. Be accurate over comprehensive: a wrong furigana reading is worse than a
flagged line.`;

const TOOL = {
    name: TOOL_NAME,
    description: 'Emit the per-line analysis of the song.',
    input_schema: {
        type: 'object' as const,
        properties: {
            profile: {
                type: 'object',
                properties: { jlpt: { type: 'string', description: 'Overall song JLPT level, N5–N1.' } },
            },
            lines: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        index: { type: 'integer', description: 'The 0-based line number given in the prompt.' },
                        furigana: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: { t: { type: 'string' }, r: { type: 'string' } },
                                required: ['t'],
                            },
                        },
                        en: { type: 'string' },
                        grammar: { type: 'array', items: { type: 'string' } },
                        tokens: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    surface: { type: 'string' },
                                    lemma: { type: 'string' },
                                    reading: { type: 'string' },
                                    pos: { type: 'string', enum: ['NOUN', 'PROPN', 'VERB', 'ADJ', 'ADV'] },
                                    jlpt: { type: 'string' },
                                    gloss: { type: 'string' },
                                },
                                required: ['surface'],
                            },
                        },
                        flag: { type: 'boolean' },
                    },
                    required: ['index'],
                },
            },
        },
        required: ['lines'],
    },
};

function catalogPrompt(): string {
    return CATALOG.map((g) => `- ${g.id} (${g.label}, ${g.jlpt})`).join('\n');
}

// Analyze a pasted song. Throws AnalysisUnavailableError when no key is configured. `lines` are the
// already-split, trimmed lyric lines (see splitLyrics).
export async function analyzeLyrics(input: {
    lines: string[];
    title?: string;
    artist?: string;
}): Promise<AnalyzedSong> {
    if (!isAnalysisConfigured()) throw new AnalysisUnavailableError();
    const { lines, title, artist } = input;

    const client = new Anthropic({ apiKey: config.songs.anthropicApiKey, maxRetries: 2, timeout: 120_000 });
    const header = [title && `Title: ${title}`, artist && `Artist: ${artist}`].filter(Boolean).join('\n');
    const numbered = lines.map((l, i) => `${i}\t${l}`).join('\n');
    const userContent =
        `Grammar catalog (use ONLY these ids for the grammar field):\n${catalogPrompt()}\n\n` +
        `${header ? header + '\n\n' : ''}Lines (index<TAB>text):\n${numbered}`;

    // Stream → finalMessage so a large song (many lines × tokens) can't trip the SDK's
    // non-streaming HTTP-timeout guard. Forced tool-use → exactly one structured tool_use block.
    const stream = client.messages.stream({
        model: config.songs.anthropicModel,
        max_tokens: 32_000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: userContent }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'max_tokens') {
        throw new Error('analysis output truncated — try a shorter song');
    }
    const block = msg.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') throw new Error('the model did not return a structured analysis');

    const result = assembleAnalysis(lines, block.input as ModelOutput);
    const flagged = result.lines.filter((l) => l.flags.length).length;
    log.info('songs.analyze', {
        model: config.songs.anthropicModel,
        lines: lines.length,
        flagged,
        grammar: result.profile.grammarCount,
        inputTokens: msg.usage?.input_tokens,
        outputTokens: msg.usage?.output_tokens,
    });
    return result;
}
