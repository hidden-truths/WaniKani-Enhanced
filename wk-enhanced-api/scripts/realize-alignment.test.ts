// Cross-component alignment guard for template realization.
//
// The server's src/lib/realize.ts is a hand-PORT of the study-app client's realization
// (study-app/src/core/selftalk.js `realizeTemplate` + core/text.js `plainText`/`rubyToSegments`) —
// the runtime container ships no study-app/, so it can't import it. The two copies are coupled by a
// SILENT content-hash contract: the server materializes a combo into a PUBLIC `sentence` row keyed by
// ttsTextHash(text); the client plays that combo via /v1/audio/tts on plainText(jp) of the SAME
// realization; and the TTS pre-gen driver keys its clip the same way. If the two realizations ever
// derive `text`/`furigana` differently, those keys silently stop agreeing → wrong/blank voice + a
// duplicate corpus row, with no error anywhere.
//
// realize.ts says "KEEP BYTE-FOR-BYTE ALIGNED" in a comment; this test makes it an enforced invariant
// by importing BOTH copies (a test, like the seed scripts, may reach across study-app/ — it lives in
// scripts/, which is outside the server tsconfig) and asserting they produce identical jp / text /
// furigana / English over EVERY filler combo of EVERY bundled template.

import { test, expect } from 'bun:test';
import {
    realizeTemplate as serverRealize,
    plainText as serverPlainText,
    rubyToSegments as serverRubyToSegments,
} from '../src/lib/realize.ts';
import { realizeTemplate as clientRealize, comboRole as clientComboRole } from '../../study-app/src/core/selftalk.js';
import { plainText as clientPlainText, rubyToSegments as clientRubyToSegments } from '../../study-app/src/core/text.js';
import { SELFTALK_TEMPLATES } from '../../study-app/src/data/selftalk-templates.js';

// Every filler-index combo for a template (full cartesian product over its slots), capped so a future
// high-fan-out template can't blow up the suite — past the cap we walk a deterministic stride sample.
function combos(tpl: any): Record<string, number>[] {
    const slots = tpl.slots || [];
    const counts: number[] = slots.map((s: any) => Math.max(1, (s.fillers || []).length));
    const total = counts.reduce((a: number, b: number) => a * b, 1);
    const CAP = 2000;
    const out: Record<string, number>[] = [];
    const emit = (n: number) => {
        const picks: Record<string, number> = {};
        let rem = n;
        for (let i = 0; i < slots.length; i++) {
            picks[slots[i].id] = rem % counts[i];
            rem = Math.floor(rem / counts[i]);
        }
        out.push(picks);
    };
    const step = total <= CAP ? 1 : Math.floor(total / CAP);
    for (let n = 0; n < total; n += step) emit(n);
    return out;
}

test('bundled Self-Talk templates are present', () => {
    expect(Array.isArray(SELFTALK_TEMPLATES)).toBe(true);
    expect(SELFTALK_TEMPLATES.length).toBeGreaterThan(0);
});

for (const tpl of SELFTALK_TEMPLATES as any[]) {
    test(`client/server realization aligns: ${tpl.id}`, () => {
        for (const picks of combos(tpl)) {
            const s = serverRealize(tpl, picks);
            const c = clientRealize(tpl, picks);
            // substitution agrees
            expect(s.jp).toBe(c.jp);
            // text (the /v1/audio/tts key + the materialized-row hash input) agrees — both vs each
            // other and vs each ported helper run independently on the realized jp
            expect(s.text).toBe(c.text);
            expect(serverPlainText(s.jp)).toBe(clientPlainText(s.jp));
            // structured furigana agrees (server returns it; recompute the client's from the jp)
            expect(JSON.stringify(s.furigana)).toBe(JSON.stringify(clientRubyToSegments(s.jp)));
            expect(JSON.stringify(serverRubyToSegments(s.jp))).toBe(JSON.stringify(clientRubyToSegments(s.jp)));
            // realized English agrees
            expect(s.mean).toBe(c.mean);
            // the canonical combo key (written as sentence_link.role) agrees with the client's dedup
            // key. The client builds it via core comboRole; drift here silently breaks materialize
            // idempotency / per-session dedup → duplicate public-corpus rows, with no error anywhere.
            expect(s.role).toBe(clientComboRole(tpl, picks));
        }
    });
}
