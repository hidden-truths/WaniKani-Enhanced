// WaniKani v2 API. Used only by the warm pipeline to enumerate the full
// vocab corpus. Requires a personal access token (the maintainer's, not
// per-user) — get one at https://www.wanikani.com/settings/personal_access_tokens.
// Lazy warming works without this, so leaving WK_API_TOKEN unset is fine
// during local dev.

import { config } from '../config.ts';
import { log } from '../lib/log.ts';
import { sleep } from '../lib/sleep.ts';

const BASE_URL = 'https://api.wanikani.com/v2/subjects';

interface WkSubject {
    id: number;
    object: string;
    data: {
        characters?: string | null;
        slug?: string;
    };
}

interface WkPage {
    data: WkSubject[];
    pages: { next_url: string | null };
}

// Fetches every vocab subject from WK. Returns a unique sorted list of the
// vocab `characters` (which is the dictionary-form string IK indexes by).
export async function fetchAllWkVocab(): Promise<string[]> {
    if (!config.wkApiToken) {
        throw new Error('WK_API_TOKEN not set — cannot enumerate WK vocab corpus');
    }
    const seen = new Set<string>();
    let url: string | null = `${BASE_URL}?types=vocabulary`;
    let pageCount = 0;
    while (url) {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.wkApiToken}` },
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`WK API ${url} → ${res.status}`);
        const page = (await res.json()) as WkPage;
        for (const subject of page.data) {
            const chars = subject.data.characters;
            if (chars) seen.add(chars);
        }
        pageCount++;
        log.debug('wk.page', { pageCount, runningTotal: seen.size });
        url = page.pages.next_url;
        // WK rate-limit is 60 req/min. Sleep ~1.1s between pages.
        if (url) await sleep(1100);
    }
    const out = Array.from(seen).sort();
    log.info('wk.fetched', { pages: pageCount, vocabCount: out.length });
    return out;
}
