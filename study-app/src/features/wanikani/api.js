// WaniKani v2 API client — the ONLY module that talks to api.wanikani.com. Direct
// browser fetch by design: the WK API is CORS-enabled for exactly this kind of
// client-side app, the token is the user's own read token, and our backing API never
// needs to see WK data (it lives in the local IndexedDB cache, re-syncable anytime).
// This is deliberately NOT net/transport.js `api()` — that wrapper is for OUR
// cross-origin API (cookie credentials, API_BASE rebasing), neither of which applies.
//
// Rate limit: 60 req/min per token. A full first sync is ~30 requests so we never
// budget-manage proactively; we just honor a 429's Retry-After (capped, 3 attempts).

const WK_BASE = 'https://api.wanikani.com/v2';
const MAX_429_RETRIES = 3;
const MAX_WAIT_MS = 65_000;   // RateLimit-Reset is at most a minute away

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One GET against the WK API. `pathOrUrl` is either an API path ('/subjects') or a full
// pages.next_url. Throws Error with .status (+ .code 'unauthorized' on a bad token).
export async function wkFetch(pathOrUrl, token, params) {
  const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : WK_BASE + pathOrUrl);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, 'Wanikani-Revision': '20170710' },
    });
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      const after = Number(res.headers.get('Retry-After')) * 1000 || 2000 * (attempt + 1);
      await sleep(Math.min(after, MAX_WAIT_MS));
      continue;
    }
    if (res.status === 401) {
      const err = new Error('WaniKani rejected the API token.');
      err.status = 401; err.code = 'unauthorized';
      throw err;
    }
    if (!res.ok) {
      const err = new Error('WaniKani API error ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

// Follow a collection through every page (pages.next_url cursor pagination). Returns
// { data, dataUpdatedAt, totalCount }; `onPage(fetched, total)` reports progress so the
// first big sync (subjects = 10 pages of 1000) can paint a live counter.
export async function wkPaginate(path, token, params, onPage) {
  const data = [];
  let url = path, dataUpdatedAt = null, totalCount = 0, first = true;
  while (url) {
    const page = await wkFetch(url, token, first ? params : undefined);
    first = false;
    data.push(...page.data);
    totalCount = page.total_count ?? data.length;
    if (dataUpdatedAt === null) dataUpdatedAt = page.data_updated_at || null;
    if (onPage) onPage(data.length, totalCount);
    url = page.pages && page.pages.next_url;
  }
  return { data, dataUpdatedAt, totalCount };
}
