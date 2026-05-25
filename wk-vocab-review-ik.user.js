// ==UserScript==
// @name         WK Vocab Review — ImmersionKit Examples
// @namespace    https://github.com/jbrelly/wk-ik-examples
// @version      1.1.1
// @description  ImmersionKit example sentences (audio + image) inlaid into WaniKani vocab reviews.
// @author       jbrelly
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @connect      apiv2.immersionkit.com
// @connect      duckduckgo.com
// @connect      translate.googleapis.com
// @connect      api.wkenhanced.dev
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ---------- Constants ----------

    const SCRIPT_ID = 'wk-ik-examples';
    const SCRIPT_TITLE = 'WK Vocab Review — ImmersionKit';
    const SCRIPT_VERSION = '1.1.1';

    // API server endpoints. Single source of truth for prod / dev URLs; lift
    // here when changing the deployed domain. Note: changing PROD_API_BASE
    // also requires updating the `@connect` directive in the metadata block
    // at the top of this file (Tampermonkey re-prompts the user when the
    // metadata changes).
    const PROD_API_BASE = 'https://api.wkenhanced.dev';
    const DEV_API_BASE = 'http://localhost:3000';

    // Bump this when on-disk cache shape or sourcing logic changes in a way that
    // makes stale entries actively wrong (vs. just suboptimal). Boot will clear
    // examples/images/audio caches once when this differs from the stored value.
    // Selections (the per-word refresh-button state) are NOT cleared.
    const CACHE_SCHEMA_VERSION = 5;
    const SCHEMA_VERSION_KEY = 'wk-ik-examples.schema-version';
    const WKOF_VERSION_NEEDED = '1.0.52';

    const IK_API_BASE = 'https://apiv2.immersionkit.com/search';
    // Canonical encoded-title → { title, category, tags } map for every deck IK
    // serves. Their snake_case-with-special-chars encoding ("kanon__2006_") is
    // lossy — multiple original strings collapse to the same encoded form, so
    // any reverse heuristic can only ever be a best guess. This endpoint gives
    // us the source of truth in one ~12KB JSON payload.
    const IK_INDEX_META_URL = 'https://apiv2.immersionkit.com/index_meta';
    const INDEX_META_CACHE_KEY = 'wk-ik-examples.index_meta';
    // 7 days — IK adds new decks occasionally but the map is stable enough that
    // weekly is plenty. On fetch failure we fall back to the underscore-decoding
    // heuristic, so a stale or missing map is degraded-but-functional.
    const INDEX_META_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    // IK's direct media bucket (us-southeast-1.linodeobjects.com) has been offline
    // since Aug 2025 — those URLs still 403. However the API server exposes a
    // /download_media proxy that serves the same files; that's what we use for the
    // primary audio source, falling back to Google TTS when IK has no `sound` field
    // (e.g. text-only literature) or the proxy fails.
    const IK_DOWNLOAD_MEDIA_BASE = 'https://apiv2.immersionkit.com/download_media';
    const IK_AUDIO_CACHE_PREFIX = 'wk-ik-examples.ik-audio.';
    const IK_AUDIO_NEG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    // googleapis.com is more lenient than translate.google.com for cross-origin TTS use;
    // client=gtx is the currently-working unauthenticated client identifier (tw-ob is
    // being phased out and gets rejected on some origins).
    const GOOGLE_TTS_BASE = 'https://translate.googleapis.com/translate_tts';
    const DDG_SEARCH_URL = 'https://duckduckgo.com/';
    const DDG_IMAGES_URL = 'https://duckduckgo.com/i.js';
    const IMG_CACHE_PREFIX = 'wk-ik-examples.img.';
    const IMG_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const AUDIO_CACHE_PREFIX = 'wk-ik-examples.audio.';
    // Google TTS audio is keyed by sentence text and never changes; no TTL needed.
    const SELECTIONS_CACHE_KEY = 'wk-ik-examples.selections';
    // Persistent map of per-word refresh-button selections: { <word>: { s, i } }.
    const TURBO_EVENTS_URL =
        'https://update.greasyfork.org/scripts/501980/Wanikani%20Open%20Framework%20Turbo%20Events.user.js';

    const CACHE_PREFIX = `${SCRIPT_ID}.ik.`;
    const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const NEG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    // ---------- API server ----------
    //
    // When `useApiServer` is on and `apiServerUrl` is non-empty, the userscript
    // routes vocab lookups through our backing server (wk-vocab-api) instead of
    // calling IK / DDG / Google directly. The direct code path remains as an
    // opt-out fallback; the server path is the default.
    //
    // Cache: payloads are stored under SERVER_CACHE_PREFIX keyed by the raw
    // (un-encoded) word — separate namespace from the direct-path caches so
    // they don't fight, and so toggling the setting doesn't trash either side.
    // ETag round-trips: we send `If-None-Match` when revisiting a word; the
    // server 304s when fetchedAt hasn't moved, so revisits are zero-byte.
    const SERVER_CACHE_PREFIX = 'wk-vocab-cache.payload.';
    // 7 day local TTL — much shorter than the server's 30-day warm refresh,
    // because the ETag round-trip is cheap and authoritative. The TTL is a
    // backstop for "server has been unreachable for a long time, eventually
    // give up and try fresh."
    const SERVER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    // Short TTL applied when the server marks a payload `incomplete: true`
    // (DDG fallback pool still warming in background). The next request within
    // ~60s re-fetches and picks up the completed payload — usually a 304 if
    // the background warm hasn't finished yet, or a fresh 200 if it has.
    const SERVER_INCOMPLETE_TTL_MS = 60 * 1000;
    // Batch endpoint max body size (mirrors server's BatchRequestSchema cap).
    // Prefetch chunks larger batches into multiple requests.
    const SERVER_BATCH_MAX = 50;
    // Single-word GET timeout. Has to absorb a server-side cold lazy-warm
    // (IK call + media downloads behind a 500ms rate-limit gate); the worst
    // observed cold case is ~25s, so 30s is "well-padded ceiling, abort
    // anything beyond." On abort the existing .catch falls back to the
    // stale cached payload (if any) or empty-card render.
    const SERVER_GET_TIMEOUT_MS = 30000;
    // Batch endpoint never warms — server returns whatever's cached in
    // sub-second time. A long wait here always means the server or
    // cloudflared is hung; abort fast so prefetch doesn't sit on a dead
    // socket while we render the current card.
    const SERVER_BATCH_TIMEOUT_MS = 10000;

    const CSS_PREFIX = 'wk-ik';
    const CARD_CLASS = `${CSS_PREFIX}-card`;

    const DEFAULTS = {
        autoPlayAudio: false,
        showImage: true,
        showFurigana: true,
        playHotkey: 'p',
        // String key (matches dropdown content keys); parsed to float at apply
        // time. '1' = native speed, which is also the audio element default.
        playbackRate: '1',
        sentencePreference: 'shortest',
        requireAudio: true,
        // 'any' disables the filter. 'n5'..'n1' filters to examples whose
        // hardest surrounding word (excluding the target itself) is at or
        // below the chosen JLPT level. Falls back to unfiltered when empty.
        jlptCeiling: 'any',
        // 'any' disables the preference. 'n5'..'n1' biases default ordering
        // toward sentences whose hardest word is *exactly* at the preferred
        // level — they come first in the pool (still inside the ceiling
        // filter), and the picker opens with "Preferred JLPT first" as the
        // initial sort. Independent of jlptCeiling so the user can e.g. let
        // anything through (ceiling=any) while still preferring N3 by default.
        jlptPreferred: 'any',
        // ---- API server ----
        // When true AND apiServerUrl is non-empty, route all vocab fetches
        // through our backing server instead of IK / DDG / Google directly.
        // Default on; flip off to force direct mode if the server is
        // unreachable.
        useApiServer: true,
        // Base URL of the wk-vocab-api server. Empty disables the API path
        // (forces direct mode). Defaults to PROD_API_BASE; for local dev,
        // set to DEV_API_BASE in settings. Trailing slash is stripped at
        // use time.
        apiServerUrl: PROD_API_BASE,
        // When useApiServer is on, on review-session entry prefetch the next
        // N upcoming subjects via POST /v1/vocab/batch. 0 disables; default 10.
        prefetchCount: 10,
    };

    // ---------- WKOF presence + version check ----------

    // We use `@grant GM_xmlhttpRequest` (needed for DuckDuckGo image search, which is
    // a cross-origin request to duckduckgo.com — fetch() can't read the JSON response
    // without CORS). That puts us in Tampermonkey's sandbox, so WKOF (installed on the
    // page's window by its own @grant none) must be reached via unsafeWindow.
    const PAGE_WIN = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    const wkof = PAGE_WIN.wkof;

    if (!wkof) {
        alert(
            `${SCRIPT_TITLE} requires the Wanikani Open Framework.\n` +
            `You will now be forwarded to installation instructions.`
        );
        window.location.href =
            'https://community.wanikani.com/t/instructions-installing-wanikani-open-framework/28549';
        return;
    }

    if (
        !wkof.version ||
        wkof.version.compare_to(WKOF_VERSION_NEEDED) === 'older'
    ) {
        alert(
            `${SCRIPT_TITLE} requires Wanikani Open Framework version ${WKOF_VERSION_NEEDED} or newer.\n` +
            `You will now be forwarded to the update page.`
        );
        window.location.href =
            'https://greasyfork.org/en/scripts/38582-wanikani-open-framework';
        return;
    }

    // Canonical encoded-title map from IK's /index_meta endpoint. Populated
    // by loadIndexMeta() — only needed by the direct path's URL builders
    // and by prettifyTitle when no server-resolved title is available.
    // Server-path examples carry pre-resolved titles + URLs in the payload,
    // so on the server path indexMeta stays null and that's fine.
    //
    // Null while uninitialized; an object even when the fetch fails (just
    // empty), so lookup code treats null as "not yet loaded" and a
    // present-but-missing key as "fall back to heuristic".
    let indexMeta = null;

    // Fire-once-only guard for ensureIndexMeta(). Callers can fire it
    // freely; the actual network fetch happens at most once per session.
    let indexMetaPromise = null;

    // ---------- Module-scoped state ----------

    const state = {
        currentSubjectId: null,
        currentCharacters: null,
        answered: false,
        cardEl: null,
        observer: null,
        emptyTimer: null,
        currentFetchToken: 0,
        // Refresh-button cycling: indices into the cached sentence + image arrays.
        // Reset to saved-selection-or-0 on each new subject; incremented by the
        // refresh buttons; persisted per-word in wkof.file_cache.
        sentenceIdx: 0,
        imageIdx: 0,
        selections: {},        // {<word>: { s: number, i: number }}
        hostEl: null,          // .character-header we attached the card into
        // WK asks reading and meaning as two separate questions per vocab subject.
        // Track which type the user is currently on so we can reset `answered`
        // when the question switches mid-subject (no new subject = same card).
        currentQuestionType: null,    // 'meaning' | 'reading' | null
        // meaningAnswered / readingAnswered are convenience mirrors of the
        // CURRENT subject's entry in subjectProgress below. We keep them as
        // top-level fields so the half-dozen read sites (furigana logic, button
        // titles, reveal check) stay terse. Refreshed from subjectProgress on
        // every subject change in handleDomChange; written through on every
        // submission in revealAll.
        meaningAnswered: false,
        readingAnswered: false,
        // Per-subject progress map for this session. Lets the reveal trigger
        // ("both questions submitted") fire correctly even when WK interleaves
        // other subjects between the two questions of one subject — common in
        // shuffled-mode reviews where you might answer meaning for A, then see
        // B, C, D, and come back to A for reading much later. Without this,
        // the comeback's readingAnswered=true would happen on top of a fresh
        // meaningAnswered=false (since the flags would have been wiped during
        // the B/C/D detour) and the reveal would never fire.
        // Shape: { <subjectId>: { meaningAnswered: bool, readingAnswered: bool } }
        // In-memory only; cleared on teardown. No cross-session persistence —
        // WK removes subjects from the queue once both questions are correct,
        // so a subject seen across sessions is starting fresh anyway.
        subjectProgress: {},
        // Per-card UI state for the ふ toggle button: true = furigana rendered when
        // gating allows. Initialized from settings().showFurigana on new subject;
        // user toggles flip it without touching the persistent setting.
        furiganaVisible: false,
        // Per-card "expand beyond the JLPT ceiling" override, set by the sentence
        // picker when the user clicks an above-ceiling entry (or persisted via
        // state.selections from a previous session). When true, pickExample
        // skips the jlptCeiling filter so the cycle and the picker show the
        // unfiltered pool. Reset to false on every new subject; the user has to
        // explicitly opt in per card.
        bypassCeilingForCurrentSubject: false,
        // Live picker overlay (sentence picker) + its keydown handler, stashed
        // so handleDomChange / new subject can tear it down cleanly. Null when
        // no picker is open.
        pickerEl: null,
        pickerKeyHandler: null,
    };

    // Lazily get-or-create the per-subject progress entry. Callers should treat
    // the returned object as live — mutating its fields persists across subject
    // transitions for the rest of the session.
    function getSubjectProgress(subjectId) {
        if (!subjectId) return { meaningAnswered: false, readingAnswered: false };
        if (!state.subjectProgress[subjectId]) {
            state.subjectProgress[subjectId] = { meaningAnswered: false, readingAnswered: false };
        }
        return state.subjectProgress[subjectId];
    }

    // ---------- Boot chain ----------

    console.log(`[${SCRIPT_ID}] booting v${SCRIPT_VERSION} on`, window.location.pathname);

    wkof.include('Menu,Settings');
    wkof
        .ready('Menu,Settings')
        .then(() => console.log(`[${SCRIPT_ID}] Menu+Settings ready`))
        .then(() => wkof.load_script(TURBO_EVENTS_URL, true /* use_cache */))
        .then(() => wkof.ready('TurboEvents').catch(() => {})) // best-effort; some versions don't register a state
        .then(loadSettings)
        .then(() => console.log(`[${SCRIPT_ID}] settings loaded`))
        .then(installMenu)
        .then(injectStyles)
        .then(loadSelections) // restore per-word refresh-button selections
        .then(maybeUpgradeCache) // wipe stale caches if CACHE_SCHEMA_VERSION bumped
        .then(() => {
            // index_meta is only consumed by the direct path's URL builders
            // and by prettifyTitle's fallback. Server-path examples carry
            // pre-resolved titles, so paying the ~12KB fetch + ~100ms boot
            // delay on the server path is wasted work for the vast majority
            // of users. Kick it off non-blocking on direct mode; defer
            // entirely on server mode (ensureIndexMeta in the direct-path
            // consumers triggers it on first need if the user flips back).
            if (!serverPathEnabled()) ensureIndexMeta();
        })
        .then(registerListeners)
        .then(() => {
            // Expose console-callable helpers in the page context.
            PAGE_WIN.openWkIkSettings = openSettings;
            PAGE_WIN.debugWkIk = debugWkIk;
            PAGE_WIN.debugWkIkTitle = debugWkIkTitle;
            PAGE_WIN.debugWkIkApi = debugWkIkApi;
            console.log(
                `[${SCRIPT_ID}] boot OK. Console: openWkIkSettings() | debugWkIk() | debugWkIkTitle('<encoded_title>') | debugWkIkApi('<word>')`
            );
        })
        .catch((err) => {
            console.error(`[${SCRIPT_ID}] boot failed:`, err);
        });

    // ---------- Settings ----------

    function loadSettings() {
        return wkof.Settings.load(SCRIPT_ID, DEFAULTS);
    }

    function installMenu() {
        try {
            wkof.Menu.insert_script_link({
                name: SCRIPT_ID,
                submenu: 'Settings',
                title: SCRIPT_TITLE,
                on_click: openSettings,
            });
            console.log(`[${SCRIPT_ID}] menu link installed under Settings submenu`);
        } catch (err) {
            console.error(`[${SCRIPT_ID}] menu install failed:`, err);
        }
    }

    // Scan wkof.file_cache.dir (the in-memory index of cached keys) and group
    // entries by our four prefixes + the singleton keys. Read-only — purely
    // informational for the settings dialog's "Cache" section. Returns the
    // raw counts and a sorted list of cached vocab words so the user can see
    // what's accumulated.
    //
    // The IK audio prefix bucket lumps positive (real MP3 ArrayBuffer) and
    // negative (failure marker) cache entries together — we'd have to load
    // each entry to distinguish, which would defeat the "just curious" intent.
    function buildCacheSummary() {
        const dir = (wkof.file_cache && wkof.file_cache.dir) || {};
        const summary = {
            examples: 0,
            serverPayloads: 0,
            imageUrlLists: 0,
            ikAudio: 0,
            ttsAudio: 0,
            words: [],
            serverWords: [],
            indexMetaCached: false,
            selections: Object.keys(state.selections || {}).length,
        };
        for (const key of Object.keys(dir)) {
            if (key.startsWith(CACHE_PREFIX)) {
                summary.examples++;
                try {
                    summary.words.push(decodeURIComponent(key.slice(CACHE_PREFIX.length)));
                } catch (_) { /* corrupt key — count but don't list */ }
            } else if (key.startsWith(SERVER_CACHE_PREFIX)) {
                summary.serverPayloads++;
                try {
                    summary.serverWords.push(decodeURIComponent(key.slice(SERVER_CACHE_PREFIX.length)));
                } catch (_) { /* corrupt key — count but don't list */ }
            } else if (key.startsWith(IMG_CACHE_PREFIX)) {
                summary.imageUrlLists++;
            } else if (key.startsWith(IK_AUDIO_CACHE_PREFIX)) {
                summary.ikAudio++;
            } else if (key.startsWith(AUDIO_CACHE_PREFIX)) {
                summary.ttsAudio++;
            } else if (key === INDEX_META_CACHE_KEY) {
                summary.indexMetaCached = true;
            }
        }
        summary.words.sort();
        summary.serverWords.sort();
        return summary;
    }

    // Estimate the on-disk size of a single cache entry, in UTF-8 bytes.
    // Audio entries stash an ArrayBuffer directly (`{buffer, type}`), so we
    // can use the buffer's byteLength + a few bytes for the type string.
    // Everything else is a plain JSON object; we measure via Blob to get the
    // real UTF-8 length (JSON.stringify().length only counts UTF-16 code
    // units, which underestimates Japanese characters by a factor of ~3).
    // Negative-cache entries ({failedAt}) hit the JSON branch and are tiny.
    function estimateEntrySize(entry) {
        if (!entry || typeof entry !== 'object') return 0;
        if (entry.buffer instanceof ArrayBuffer) {
            return entry.buffer.byteLength + (typeof entry.type === 'string' ? entry.type.length : 0);
        }
        try {
            return new Blob([JSON.stringify(entry)]).size;
        } catch (_) {
            return 0;
        }
    }

    function formatBytes(n) {
        if (!n) return '0 B';
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    }

    // Walk every cache entry we own and sum byte-estimates per category.
    // Async because each load is an IndexedDB read; runs in parallel to
    // minimize wall-clock time. Returns a buckets object + total. Safe to
    // call on an empty cache (returns all zeros). Never rejects — entries
    // that fail to load contribute 0.
    function measureCacheSizes() {
        const dir = (wkof.file_cache && wkof.file_cache.dir) || {};
        const keys = Object.keys(dir);
        const buckets = {
            examples: 0,
            serverPayloads: 0,
            imageUrlLists: 0,
            ikAudio: 0,
            ttsAudio: 0,
            selections: 0,
            indexMeta: 0,
            other: 0,
        };
        const tasks = keys.map((key) =>
            wkof.file_cache.load(key)
                .then((entry) => ({ key, size: estimateEntrySize(entry) }))
                .catch(() => ({ key, size: 0 }))
        );
        return Promise.all(tasks).then((results) => {
            for (const { key, size } of results) {
                if (key.startsWith(CACHE_PREFIX)) buckets.examples += size;
                else if (key.startsWith(SERVER_CACHE_PREFIX)) buckets.serverPayloads += size;
                else if (key.startsWith(IMG_CACHE_PREFIX)) buckets.imageUrlLists += size;
                else if (key.startsWith(IK_AUDIO_CACHE_PREFIX)) buckets.ikAudio += size;
                else if (key.startsWith(AUDIO_CACHE_PREFIX)) buckets.ttsAudio += size;
                else if (key === SELECTIONS_CACHE_KEY) buckets.selections += size;
                else if (key === INDEX_META_CACHE_KEY) buckets.indexMeta += size;
                else buckets.other += size; // schema-version pin etc.
            }
            buckets.total = Object.values(buckets).reduce((a, b) => a + b, 0);
            return buckets;
        });
    }

    // Populate the cache-info div with a freshly-computed summary. Called
    // after dialog.open() (the html-type content is in the DOM by then) and
    // again after clearCache so the numbers reflect the empty state.
    //
    // Sizes are filled in asynchronously: counts render immediately, then
    // each row's size span is replaced as measureCacheSizes() resolves. A
    // few hundred IndexedDB reads in parallel completes in ~1s on typical
    // hardware, so this avoids blocking the dialog open while still
    // surfacing real disk usage instead of requiring a button click.
    function populateCacheInfo() {
        const el = document.getElementById(`${SCRIPT_ID}-cache-info`);
        if (!el) return;
        const s = buildCacheSummary();
        const indexMetaState = s.indexMetaCached
            ? `cached (${indexMeta ? Object.keys(indexMeta).length + ' decks' : 'not yet loaded into memory'})`
            : 'not cached';
        el.innerHTML = '';
        const bucketRows = [
            { key: 'serverPayloads', label: 'API server payloads', count: `${s.serverPayloads} word(s)` },
            { key: 'examples', label: 'Direct-mode IK examples', count: `${s.examples} word(s)` },
            { key: 'imageUrlLists', label: 'Direct-mode DDG image lists', count: `${s.imageUrlLists} word(s)` },
            { key: 'ikAudio', label: 'Direct-mode IK audio clips', count: `${s.ikAudio} entry(s) (positive + negative)` },
            { key: 'ttsAudio', label: 'Direct-mode Google TTS clips', count: `${s.ttsAudio} sentence(s)` },
            { key: 'selections', label: 'Refresh-button selections', count: `${s.selections} word(s)` },
            { key: 'indexMeta', label: 'IK index_meta', count: indexMetaState },
        ];
        const sizeSpans = {};
        for (const b of bucketRows) {
            const row = document.createElement('div');
            const label = document.createElement('strong');
            label.textContent = `${b.label}: `;
            row.appendChild(label);
            row.appendChild(document.createTextNode(b.count));
            row.appendChild(document.createTextNode(' · '));
            const sizeSpan = document.createElement('span');
            sizeSpan.style.opacity = '0.7';
            sizeSpan.textContent = '…';
            sizeSpans[b.key] = sizeSpan;
            row.appendChild(sizeSpan);
            el.appendChild(row);
        }
        const totalRow = document.createElement('div');
        totalRow.style.marginTop = '0.4em';
        totalRow.style.paddingTop = '0.4em';
        totalRow.style.borderTop = '1px solid rgba(0, 0, 0, 0.08)';
        const totalLabel = document.createElement('strong');
        totalLabel.textContent = 'Total on disk: ';
        totalRow.appendChild(totalLabel);
        const totalSpan = document.createElement('span');
        totalSpan.textContent = 'measuring…';
        sizeSpans.total = totalSpan;
        totalRow.appendChild(totalSpan);
        el.appendChild(totalRow);

        // Kick off the measurement; results stream into the size spans when
        // the promise resolves. Errors fall back to "unavailable" rather
        // than leaving the spinners stuck.
        measureCacheSizes()
            .then((sizes) => {
                for (const k of Object.keys(sizeSpans)) {
                    if (typeof sizes[k] === 'number') sizeSpans[k].textContent = formatBytes(sizes[k]);
                }
            })
            .catch((err) => {
                console.warn(`[${SCRIPT_ID}] cache size measurement failed:`, err);
                for (const span of Object.values(sizeSpans)) span.textContent = 'unavailable';
            });

        // Collapsible word lists, one per cache prefix that has entries.
        // Server payloads + direct-mode IK examples are different namespaces
        // (a user can have both if they've flipped the toggle around);
        // showing them separately makes it obvious which path produced what.
        const addWordList = (label, words) => {
            if (!words || !words.length) return;
            const details = document.createElement('details');
            details.style.marginTop = '0.5em';
            details.style.paddingTop = '0.4em';
            details.style.borderTop = '1px solid rgba(0,0,0,0.1)';
            const summaryEl = document.createElement('summary');
            summaryEl.style.cursor = 'pointer';
            summaryEl.textContent = `${label} (${words.length})`;
            details.appendChild(summaryEl);
            const wordsBox = document.createElement('div');
            wordsBox.style.marginTop = '0.4em';
            wordsBox.style.fontSize = '0.95em';
            wordsBox.style.opacity = '0.85';
            wordsBox.style.maxHeight = '180px';
            wordsBox.style.overflowY = 'auto';
            wordsBox.style.lang = 'ja';
            wordsBox.textContent = words.join(', ');
            details.appendChild(wordsBox);
            el.appendChild(details);
        };
        addWordList('Cached words (server)', s.serverWords);
        addWordList('Cached words (direct mode)', s.words);
        if (!s.serverWords.length && !s.words.length) {
            const hint = document.createElement('div');
            hint.style.marginTop = '0.5em';
            hint.style.fontSize = '0.95em';
            hint.style.opacity = '0.7';
            hint.textContent = '(no vocab cached yet — words will appear here as you review)';
            el.appendChild(hint);
        }
    }

    function openSettings() {
        // Snapshot useApiServer at dialog-open time so on_save can detect a
        // flip and wipe the now-unused side's cache. Without this, toggling
        // server↔direct leaves stale entries sitting in IndexedDB until
        // their TTL expires (30 days for direct-mode IK examples, 7 for
        // server payloads) — a real disk-usage issue for users who
        // experiment with the toggle.
        const prevUseApiServer = !!(settings().useApiServer);
        const dialog = new wkof.Settings({
            script_id: SCRIPT_ID,
            title: SCRIPT_TITLE,
            on_save: () => {
                const nowUseApiServer = !!settings().useApiServer;
                if (prevUseApiServer !== nowUseApiServer) {
                    wipeAbandonedCachePrefixes(nowUseApiServer);
                }
                // Re-render current card if one is showing, in case user toggled settings mid-review.
                if (state.cardEl && state.currentCharacters) {
                    refreshCardForCurrentSubject();
                }
            },
            content: {
                main: {
                    type: 'page',
                    label: 'Main',
                    content: {
                        behavior: {
                            type: 'section',
                            label: 'Behavior',
                        },
                        autoPlayAudio: {
                            type: 'checkbox',
                            label: 'Auto-play audio on meaning reveal',
                            default: DEFAULTS.autoPlayAudio,
                            hover_tip:
                                'After you submit a meaning answer, automatically play the sentence audio. Reading answers always auto-play the sentence audio (queued after WaniKani\'s own vocab pronunciation), independent of this setting.',
                        },
                        showImage: {
                            type: 'checkbox',
                            label: 'Show image for the vocab word',
                            default: DEFAULTS.showImage,
                            hover_tip:
                                'When on, search DuckDuckGo for an illustration of the vocab word and display it after you answer. Cached for 30 days per word.',
                        },
                        showFurigana: {
                            type: 'checkbox',
                            label: 'Show furigana on the example sentence',
                            default: DEFAULTS.showFurigana,
                            hover_tip:
                                'When on, render furigana (small kana above kanji) on the example sentence after you submit the reading question. Furigana is always hidden before the reading is graded so it doesn\'t spoil the answer. The target vocab word\'s own reading is never shown. Per-card ふ button toggles it on/off without changing this default.',
                        },
                        playHotkey: {
                            type: 'text',
                            label: 'Hotkey to replay audio',
                            default: DEFAULTS.playHotkey,
                            placeholder: 'p',
                            hover_tip:
                                'Single key to press for replaying the example-sentence audio (case-insensitive, no modifier keys — Ctrl/Cmd combos are ignored so browser shortcuts still work). Leave blank to disable. Ignored while you\'re still typing your answer; works after submit even with the input focused.',
                        },
                        playbackRate: {
                            type: 'dropdown',
                            label: 'Audio playback speed',
                            default: DEFAULTS.playbackRate,
                            content: {
                                '0.5': '0.5x (slowest)',
                                '0.75': '0.75x',
                                '1': '1x (normal)',
                                '1.25': '1.25x',
                            },
                            hover_tip:
                                'Playback speed for the example sentence audio. Native voice-actor audio (anime/drama) is often too fast for intermediate listening — try 0.75x to parse morphology, then rebuild to 1x. Affects all audio sources (IK proxy, Google TTS fallback); takes effect on the next card render.',
                        },
                        apiServer: {
                            type: 'section',
                            label: 'API server',
                        },
                        useApiServer: {
                            type: 'checkbox',
                            label: 'Use API server (instead of direct IK/DDG/Google)',
                            default: DEFAULTS.useApiServer,
                            hover_tip:
                                'When on, every vocab lookup goes through the configured API server URL below; the direct code path is skipped. Default on. Falls back to the empty-card state if the server is unreachable; flip off to restore the direct path. For local dev, point the URL at your `bun dev` server in wk-vocab-api/.',
                        },
                        apiServerUrl: {
                            type: 'text',
                            label: 'API server URL',
                            default: DEFAULTS.apiServerUrl,
                            placeholder: DEV_API_BASE,
                            hover_tip:
                                `Base URL of the wk-vocab-api server. For local dev: ${DEV_API_BASE}. Trailing slash is stripped. Leave blank to disable the API path even when the checkbox above is on.`,
                        },
                        prefetchCount: {
                            type: 'number',
                            label: 'Prefetch upcoming subjects (0 = off)',
                            default: DEFAULTS.prefetchCount,
                            min: 0,
                            max: 50,
                            hover_tip:
                                'When the API server is in use, batch-fetch this many upcoming review subjects on session entry so subsequent cards render instantly from local cache. Direct mode also prefetches but one-at-a-time. Capped at 50 (the server batch endpoint limit).',
                        },
                        selection: {
                            type: 'section',
                            label: 'Example selection',
                        },
                        sentencePreference: {
                            type: 'dropdown',
                            label: 'Which example to pick',
                            default: DEFAULTS.sentencePreference,
                            content: {
                                shortest: 'Shortest',
                                longest: 'Longest',
                                first: 'First match',
                            },
                        },
                        requireAudio: {
                            type: 'checkbox',
                            label: 'Prefer examples from spoken media (anime/drama/games)',
                            default: DEFAULTS.requireAudio,
                            hover_tip:
                                'When on, prefer IK examples that came with original voice-actor audio (anime/drama/games) over text-only literature. Voice-actor audio is the primary source — you only hear Google TTS when IK has no recording for that line or the audio fetch fails.',
                        },
                        jlptCeiling: {
                            type: 'dropdown',
                            label: 'JLPT difficulty ceiling',
                            default: DEFAULTS.jlptCeiling,
                            content: {
                                any: 'Any difficulty',
                                n5: 'N5 or easier',
                                n4: 'N4 or easier',
                                n3: 'N3 or easier',
                                n2: 'N2 or easier',
                                n1: 'N1 or easier',
                            },
                            hover_tip:
                                'Hard filter — absolutely no sentences whose hardest surrounding word is above this level will be selected. Falls back to showing some sentence when no candidate qualifies. Scoring uses a bundled JLPT vocab list; conjugated verbs and proper nouns are treated as unknown and don\'t block a sentence (fail-open).',
                        },
                        jlptPreferred: {
                            type: 'dropdown',
                            label: 'Preferred JLPT level',
                            default: DEFAULTS.jlptPreferred,
                            content: {
                                any: 'No preference',
                                n5: 'N5',
                                n4: 'N4',
                                n3: 'N3',
                                n2: 'N2',
                                n1: 'N1',
                            },
                            hover_tip:
                                'Soft preference — within whatever the ceiling allows, sentences at this exact level come first in the ⟳ cycle, and the sentence picker opens with "Preferred JLPT first" as the initial sort. Independent of the ceiling: you can set ceiling=Any and still prefer N3 sentences as your default.',
                        },
                        maintenance: {
                            type: 'section',
                            label: 'Maintenance',
                        },
                        cacheInfo: {
                            type: 'html',
                            html:
                                `<div id="${SCRIPT_ID}-cache-info" ` +
                                `style="font-size: 0.85em; line-height: 1.55; ` +
                                `padding: 0.5em 0.7em; background: rgba(0,0,0,0.04); ` +
                                `border-radius: 4px;">Loading cache info…</div>`,
                        },
                        clearCache: {
                            type: 'button',
                            label: 'Cached examples + images + audio',
                            text: 'Clear cache',
                            on_click: clearCache,
                        },
                    },
                },
            },
        });
        dialog.open();
        // The cacheInfo html-type field is in the DOM now; populate it with a
        // freshly-computed summary. setTimeout(0) defers past any final WKOF
        // dialog-construction work in the same task.
        setTimeout(populateCacheInfo, 0);
    }

    function settings() {
        return wkof.settings[SCRIPT_ID] || DEFAULTS;
    }

    // One-time cache upgrade on boot. If the stored schema version doesn't match
    // CACHE_SCHEMA_VERSION, wipe everything except selections and persist the new
    // version. Bump CACHE_SCHEMA_VERSION whenever stale cache entries would lead
    // to wrong behavior (e.g. sourcing logic changes, like the v0.10.0 switch from
    // DDG-only images to IK + DDG pool).
    function maybeUpgradeCache() {
        return wkof.file_cache
            .load(SCHEMA_VERSION_KEY)
            .catch(() => null)
            .then((entry) => {
                const stored = entry && entry.version;
                if (stored === CACHE_SCHEMA_VERSION) return;
                console.log(
                    `[${SCRIPT_ID}] cache schema upgrade ${stored || '(none)'} → ${CACHE_SCHEMA_VERSION}; clearing cached examples/images/audio (selections preserved)`
                );
                return Promise.all([
                    wkof.file_cache.delete(new RegExp('^' + escapeRegExp(CACHE_PREFIX))),
                    wkof.file_cache.delete(new RegExp('^' + escapeRegExp(IMG_CACHE_PREFIX))),
                    wkof.file_cache.delete(new RegExp('^' + escapeRegExp(AUDIO_CACHE_PREFIX))),
                    wkof.file_cache.delete(new RegExp('^' + escapeRegExp(IK_AUDIO_CACHE_PREFIX))),
                    wkof.file_cache.delete(new RegExp('^' + escapeRegExp(SERVER_CACHE_PREFIX))),
                ])
                    .then(() => wkof.file_cache.save(SCHEMA_VERSION_KEY, { version: CACHE_SCHEMA_VERSION }))
                    .catch((err) => console.warn(`[${SCRIPT_ID}] cache upgrade failed:`, err));
            });
    }

    // Called from the settings dialog's on_save when useApiServer flipped.
    // Wipes the cache prefix(es) for the path the user just abandoned, so
    // stale entries don't sit in IndexedDB until their TTL expires (30d for
    // direct-mode IK examples, 7d for server payloads). The index_meta map
    // is preserved either way — it's tiny, useful to both paths under
    // certain failure modes (server-side title-resolution gaps), and
    // re-fetched lazily anyway.
    function wipeAbandonedCachePrefixes(useApiServerNow) {
        const prefixes = useApiServerNow
            // Server is now active → direct-mode caches are dead weight.
            ? [CACHE_PREFIX, IMG_CACHE_PREFIX, AUDIO_CACHE_PREFIX, IK_AUDIO_CACHE_PREFIX]
            // Direct is now active → server payload cache is dead weight.
            : [SERVER_CACHE_PREFIX];
        const tasks = prefixes.map((p) =>
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(p))).catch(() => 0)
        );
        Promise.all(tasks).then((counts) => {
            const total = counts.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
            console.log(
                `[${SCRIPT_ID}] useApiServer flipped to ${useApiServerNow}; wiped ${total} ` +
                `entries from ${prefixes.length} abandoned cache prefix(es).`
            );
            // If the settings dialog is still on screen, refresh the cache widget.
            populateCacheInfo();
        });
    }

    function clearCache() {
        // Clear IK examples, DDG images, IK + TTS audio, per-word selections,
        // and the IK index_meta map. The map will be re-fetched on next boot.
        Promise.all([
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(CACHE_PREFIX))),
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(IMG_CACHE_PREFIX))),
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(AUDIO_CACHE_PREFIX))),
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(IK_AUDIO_CACHE_PREFIX))),
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(SERVER_CACHE_PREFIX))),
            wkof.file_cache.delete(SELECTIONS_CACHE_KEY),
            wkof.file_cache.delete(INDEX_META_CACHE_KEY),
        ])
            .then(() => {
                state.selections = {};
                // If the settings dialog is open, refresh the cache-info section
                // so the user sees the zeroed counts. No-op when the dialog is
                // closed (the element won't exist).
                populateCacheInfo();
                alert(`${SCRIPT_TITLE}: cache cleared (examples + images + audio + selections + index meta).`);
            })
            .catch((err) => {
                console.error(`[${SCRIPT_ID}] clearCache failed:`, err);
                alert(`${SCRIPT_TITLE}: cache clear failed (see console).`);
            });
    }

    // ---------- Styles ----------

    function injectStyles() {
        const css = `
/* Use the .character-header.* compound selector for extra specificity so WK's
   own .character-header rules can't outrank our min-height. Tall enough to
   give the side image breathing room without overlapping the WK stats strip.
   We deliberately do NOT touch the header's display property -- WK pins its
   nav icons and review-stats to the top-left/top-right corners of this
   element, and any flex override of ours would pull them into the centered
   flow. Instead we absolutely position just the .character-header__characters
   child below so the big vocab character stays vertically centered in the
   taller box while WK's corner content stays exactly where WK put it. */
.character-header.${CSS_PREFIX}-host {
    position: relative;
    min-height: 280px;
}
/* WK nests the vocab character inside a .character-header__content wrapper
   that has its own position:relative. That wrapper is the positioning context
   for .character-header__characters' absolute positioning -- so when we
   expand .character-header to 280px, the character is still trapped inside
   the ~82px __content box (verified via debugWkIk() DOM dump). Demote
   __content to position:static so the character absolute positioning looks
   up past it to our .wk-ik-host. */
.character-header.${CSS_PREFIX}-host .character-header__content {
    position: static !important;
}
/* Now that the character is positioned relative to the full host, fill the
   host with the character's box and flex-center the glyph inside it. This is
   robust to whatever font-size/line-height WK ships — the glyph ends up at
   the visual center of the 280px purple area regardless of how big it renders. */
.character-header.${CSS_PREFIX}-host .character-header__characters {
    position: absolute !important;
    inset: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    margin: 0 !important;
    padding: 0 !important;
    /* Bounding box covers the entire header now (inset:0), so without this
       it intercepts clicks across the whole header — including the corners
       where WK pins home/gear (top-left) and like/check/inbox (top-right).
       The character glyph itself is purely visual / non-interactive; the
       only thing we'd lose by disabling pointer events is drag-selecting
       the glyph, which nobody does. */
    pointer-events: none !important;
}
.${CARD_CLASS} {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1em;
    padding: 0.8em 1.2em;
    pointer-events: none;
    box-sizing: border-box;
    background: transparent;
    border: none;
    margin: 0;
    z-index: 1;
    font-family: inherit;
}
.${CARD_CLASS} .${CSS_PREFIX}-left,
.${CARD_CLASS} .${CSS_PREFIX}-right {
    pointer-events: auto;
    flex: 0 1 auto;
    max-width: 32%;
    display: flex;
    flex-direction: column;
    gap: 0.4em;
}
/* Right panel needs more width budget than the left because anime/drama
   screenshots are almost always landscape — at our 240px image height a 16:9
   grab is ~427px wide. Keep the cap below 50% so the centered vocab character
   (positioned absolutely inside .character-header) stays visually dominant. */
.${CARD_CLASS} .${CSS_PREFIX}-right {
    max-width: 44%;
}
.${CARD_CLASS} .${CSS_PREFIX}-left {
    align-items: flex-start;
    text-align: left;
}
.${CARD_CLASS} .${CSS_PREFIX}-right {
    align-items: flex-end;
    text-align: right;
}
.${CARD_CLASS} .${CSS_PREFIX}-sentence {
    font-size: 1em;
    line-height: 1.5;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.${CARD_CLASS} .${CSS_PREFIX}-translation {
    font-size: 0.85em;
    line-height: 1.4;
    color: #fff;
    opacity: 0.9;
    text-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.${CARD_CLASS} .${CSS_PREFIX}-translation[hidden] { display: none; }
.${CARD_CLASS} .${CSS_PREFIX}-source {
    font-size: 0.75em;
    color: #fff;
    opacity: 0.8;
    font-style: italic;
    text-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.${CARD_CLASS} mark.${CSS_PREFIX}-target {
    /* Brighter lavender derived from the vocab purple rgb(148,28,227).
       Light enough to keep dark text legible, same hue so it feels cohesive
       with the purple header instead of jarring like yellow. */
    background: #c084fc;
    color: #2a004a;
    padding: 0 0.15em;
    border-radius: 2px;
    text-shadow: none;
}
/* Ruby/rt: keep furigana small enough that turning it on doesn't bump line
   height noticeably. Slightly translucent so the kanji body remains the
   visual anchor. */
.${CARD_CLASS} ruby rt {
    font-size: 0.55em;
    opacity: 0.85;
    line-height: 1;
    text-shadow: 0 1px 1px rgba(0,0,0,0.35);
}
/* When the showFurigana setting is on, the sentence renderer always emits
   <ruby><rt> for every kanji — even before the reading is graded — so the
   kanji line reserves vertical space for the rt characters. Until the
   .wk-ik-show-furigana class is added on reveal, the rt text stays invisible
   via visibility:hidden (keeps the box, hides the glyphs) so the kanji line
   doesn't jump when furigana fades in. visibility:hidden vs display:none is
   the whole point here — display:none would defeat the layout reservation. */
.${CARD_CLASS} .${CSS_PREFIX}-sentence rt {
    visibility: hidden;
}
.${CARD_CLASS} .${CSS_PREFIX}-sentence.${CSS_PREFIX}-show-furigana rt {
    visibility: visible;
}
/* Belt-and-braces: even if the renderer ever emits an <rt> inside the target
   mark (it shouldn't — kanji segments inside the mark are emitted without
   <rt> by renderSentence), CSS hides it so the reading is never visible
   above the very word being tested. */
.${CARD_CLASS} mark.${CSS_PREFIX}-target ruby rt { display: none; }
.${CARD_CLASS} .${CSS_PREFIX}-left-controls {
    display: flex;
    align-items: center;
    gap: 0.4em;
}
.${CARD_CLASS} .${CSS_PREFIX}-audio {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    background: rgba(255,255,255,0.2);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.5);
    border-radius: 4px;
    padding: 0.3em 0.7em;
    font-size: 0.85em;
    cursor: pointer;
}
.${CARD_CLASS} .${CSS_PREFIX}-audio:hover {
    background: rgba(255,255,255,0.3);
}
.${CARD_CLASS} .${CSS_PREFIX}-audio:disabled {
    background: rgba(255,255,255,0.1);
    cursor: not-allowed;
}
.${CARD_CLASS} .${CSS_PREFIX}-furigana-toggle {
    width: 1.8em;
    height: 1.8em;
    line-height: 1.5em;
    text-align: center;
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.5);
    border-radius: 50%;
    color: #fff;
    cursor: pointer;
    font-size: 0.9em;
    padding: 0;
    flex-shrink: 0;
}
.${CARD_CLASS} .${CSS_PREFIX}-refresh-sentence {
    min-width: 1.8em;
    height: 1.8em;
    line-height: 1;
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.5);
    border-radius: 0.9em;
    color: #fff;
    cursor: pointer;
    font-size: 0.9em;
    padding: 0 0.55em;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.${CARD_CLASS} .${CSS_PREFIX}-refresh-sentence:hover,
.${CARD_CLASS} .${CSS_PREFIX}-furigana-toggle:not([disabled]):hover {
    background: rgba(255,255,255,0.35);
}
.${CARD_CLASS} .${CSS_PREFIX}-furigana-toggle[disabled] {
    opacity: 0.4;
    cursor: not-allowed;
}
.${CARD_CLASS} .${CSS_PREFIX}-furigana-toggle[aria-pressed="true"] {
    background: rgba(255,255,255,0.55);
    color: #2a004a;
    border-color: rgba(255,255,255,0.85);
}
.${CARD_CLASS} .${CSS_PREFIX}-image[hidden] { display: none; }
.${CARD_CLASS} .${CSS_PREFIX}-image {
    /* Default to 140px — small enough to clear the WK stats (like / check /
       inbox / percent) pinned at the top-right of .character-header. Grows
       back to 240px on hover (which briefly overlaps the stats; acceptable
       because the user has to deliberately point at the image, and moving
       the cursor up to click a stat shrinks it back). Click opens a full-
       screen modal — see showImageModal.

       pointer-events: auto on the figure (was 'none') so the image catches
       clicks for the modal. The refresh-image button still has its own
       pointer-events: auto and absolute position; it stops propagation in
       its click handler so refresh doesn't also trigger the modal. */
    position: relative;
    display: inline-block;
    margin: 0;
    max-height: 140px;
    max-width: 100%;
    pointer-events: auto;
    transition: max-height 0.18s ease;
}
.${CARD_CLASS} .${CSS_PREFIX}-image:hover {
    max-height: 240px;
}
.${CARD_CLASS} .${CSS_PREFIX}-image img {
    display: block;
    max-height: 140px;
    max-width: 100%;
    width: auto;
    height: auto;
    border-radius: 4px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    cursor: zoom-in;
    transition: max-height 0.18s ease;
}
.${CARD_CLASS} .${CSS_PREFIX}-image:hover img {
    max-height: 240px;
}
/* Fullscreen image modal opened by clicking the card image. Click anywhere
   or press Escape to close. z-index sits above WK's own UI (its dialogs
   live around z-index 1000-2000). */
.${CSS_PREFIX}-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.92);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
}
.${CSS_PREFIX}-modal img {
    max-width: 95vw;
    max-height: 95vh;
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 6px 30px rgba(0, 0, 0, 0.6);
}

/* Sentence picker overlay opened by right-click / long-press on the ⟳ button.
   Modal-style backdrop with a centered panel listing all IK candidates for
   the current word. Faded rows are above the JLPT ceiling but still clickable
   — picking one flips the per-card bypass flag so they stay reachable via ⟳. */
.${CSS_PREFIX}-picker {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1em;
}
.${CSS_PREFIX}-picker-panel {
    background: #fafafa;
    color: #222;
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    max-width: 640px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.${CSS_PREFIX}-picker-header {
    padding: 0.7em 1em 0.5em;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    flex: 0 0 auto;
}
.${CSS_PREFIX}-picker-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8em;
    flex-wrap: wrap;
}
.${CSS_PREFIX}-picker-title {
    font-size: 1em;
    font-weight: 600;
}
.${CSS_PREFIX}-picker-sort-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: 0.85em;
    opacity: 0.85;
}
.${CSS_PREFIX}-picker-sort {
    font: inherit;
    padding: 0.15em 0.3em;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 3px;
    background: #fff;
    color: inherit;
    cursor: pointer;
}
.${CSS_PREFIX}-picker-note {
    font-size: 0.8em;
    opacity: 0.7;
    margin-top: 0.4em;
}
.${CSS_PREFIX}-picker-footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8em;
    padding: 0.5em 1em;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    background: rgba(0, 0, 0, 0.02);
}
.${CSS_PREFIX}-picker-page-btn {
    font: inherit;
    padding: 0.3em 0.7em;
    border: 1px solid rgba(0, 0, 0, 0.25);
    border-radius: 4px;
    background: #fff;
    color: inherit;
    cursor: pointer;
}
.${CSS_PREFIX}-picker-page-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.04);
}
.${CSS_PREFIX}-picker-page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.${CSS_PREFIX}-picker-page-label {
    font-size: 0.85em;
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
}
.${CSS_PREFIX}-picker-list {
    overflow-y: auto;
    padding: 0.3em 0;
}
.${CSS_PREFIX}-picker-row {
    display: flex;
    align-items: flex-start;
    gap: 0.6em;
    width: 100%;
    padding: 0.6em 1em;
    background: transparent;
    border: none;
    border-left: 3px solid transparent;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
}
.${CSS_PREFIX}-picker-row:hover {
    background: rgba(0, 0, 0, 0.05);
}
.${CSS_PREFIX}-picker-row.current {
    border-left-color: #aa00ff;
    background: rgba(170, 0, 255, 0.08);
}
.${CSS_PREFIX}-picker-row.above-ceiling {
    opacity: 0.45;
}
.${CSS_PREFIX}-picker-row.above-ceiling:hover {
    opacity: 0.75;
}
.${CSS_PREFIX}-picker-num {
    flex: 0 0 auto;
    font-size: 0.85em;
    opacity: 0.55;
    min-width: 1.6em;
    padding-top: 0.1em;
}
.${CSS_PREFIX}-picker-main {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 0.2em;
    min-width: 0; /* allow children to shrink + wrap */
}
.${CSS_PREFIX}-picker-text {
    font-size: 1em;
    line-height: 1.35;
    word-break: break-word;
}
.${CSS_PREFIX}-picker-translation {
    font-size: 0.82em;
    line-height: 1.3;
    opacity: 0.65;
    font-style: italic;
}
.${CSS_PREFIX}-picker-meta {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.3em;
    padding-top: 0.05em;
}
.${CSS_PREFIX}-picker-badge {
    display: inline-block;
    font-size: 0.72em;
    font-weight: 600;
    line-height: 1;
    padding: 0.25em 0.45em;
    border-radius: 0.5em;
    color: #fff;
    background: #888;
    letter-spacing: 0.02em;
}
/* JLPT-level colors: green (easy) → red (hard). The unknown badge is neutral
   grey with reduced opacity so it doesn't compete with the real-level chips. */
.${CSS_PREFIX}-picker-badge.lvl-n5 { background: #2e7d32; }
.${CSS_PREFIX}-picker-badge.lvl-n4 { background: #558b2f; }
.${CSS_PREFIX}-picker-badge.lvl-n3 { background: #ef6c00; }
.${CSS_PREFIX}-picker-badge.lvl-n2 { background: #c62828; }
.${CSS_PREFIX}-picker-badge.lvl-n1 { background: #6a1b9a; }
.${CSS_PREFIX}-picker-badge.lvl-unknown {
    background: #bbb;
    color: #555;
}
.${CSS_PREFIX}-picker-source {
    font-size: 0.75em;
    opacity: 0.55;
    white-space: nowrap;
    max-width: 12em;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* WKOF Settings dialog scrolling. WKOF wraps our content in a div whose id is
   wkofs_<script_id>; jQuery UI's surrounding .ui-dialog sizes to fit its
   content by default, so a tall settings form can extend past the viewport
   and become unreachable. Capping our content's max-height + enabling
   overflow-y makes the form scroll within a sane window without touching
   WKOF's own outer chrome. !important is needed to outrank WKOF/jQuery UI's
   inline styles. */
#wkofs_${SCRIPT_ID} {
    max-height: 70vh !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
}

.${CARD_CLASS} .${CSS_PREFIX}-refresh-image {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 1.8em;
    height: 1.8em;
    line-height: 1;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #bbb;
    /* Pill instead of circle to fit the "N/M" counter alongside ⟳. */
    border-radius: 0.9em;
    color: #444;
    cursor: pointer;
    font-size: 0.85em;
    padding: 0 0.5em;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25em;
    /* Re-enable click capture — the parent figure has pointer-events: none
       so it doesn't block WK's top-right stats. */
    pointer-events: auto;
}
.${CARD_CLASS} .${CSS_PREFIX}-refresh-image:hover {
    background: #fff;
    color: #f100a1;
    border-color: #f100a1;
}
.${CARD_CLASS}.${CSS_PREFIX}-empty {
    color: #fff;
    font-style: italic;
    justify-content: flex-start;
    align-items: flex-end;
    padding: 0.5em 1em;
    opacity: 0.85;
}
/* Loading placeholder shown between subject change and IK fetch completion.
   Tucked into the bottom-left like the empty-card message so it doesn't
   compete with the centered vocab character. Subtle white-on-purple spinner;
   the goal is "something is happening" not "look at me". */
.${CARD_CLASS}.${CSS_PREFIX}-loading {
    justify-content: flex-start;
    align-items: flex-end;
    padding: 0.5em 1em;
}
.${CARD_CLASS} .${CSS_PREFIX}-spinner {
    width: 1.2em;
    height: 1.2em;
    border: 2px solid rgba(255, 255, 255, 0.25);
    border-top-color: rgba(255, 255, 255, 0.85);
    border-radius: 50%;
    animation: ${CSS_PREFIX}-spin 0.8s linear infinite;
}
@keyframes ${CSS_PREFIX}-spin {
    to { transform: rotate(360deg); }
}
`;
        const style = document.createElement('style');
        style.id = `${SCRIPT_ID}-styles`;
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ---------- Event registration ----------

    function registerListeners() {
        // Turbo Events library may or may not be available depending on whether it's installed.
        const turbo = wkof.turbo;

        if (turbo && turbo.on && typeof turbo.on.common === 'object' && typeof turbo.on.common.reviews === 'function') {
            // Turbo lib will call us every time the user enters a review page.
            turbo.on.common.reviews(onEnterReviews);
        } else {
            // Fallback: attach only if we're already on a review page when the script boots.
            const startIfReviews = () => {
                if (isOnReviewPage()) onEnterReviews();
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', startIfReviews, { once: true });
            } else {
                startIfReviews();
            }
        }

        // Cleanup on navigation away (Turbo before-visit).
        document.addEventListener('turbo:before-visit', (event) => {
            const dest = event.detail && event.detail.url;
            if (!dest || !dest.includes('/subjects/review')) {
                teardown();
            }
        });

        // Replay-audio hotkey. Bound once at boot — handler no-ops when there's
        // no active card. Skipped when the user is mid-answer (typing in an
        // input before submitting) to avoid hijacking keystrokes; once the
        // answer is graded the hotkey works even with input focus.
        document.addEventListener('keydown', onPlayHotkey);
    }

    function onPlayHotkey(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const key = (settings().playHotkey || '').trim().toLowerCase();
        if (!key) return;
        if ((e.key || '').toLowerCase() !== key) return;

        const t = e.target;
        const inEditable = t && (
            t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.isContentEditable
        );
        if (inEditable && !state.answered) return;

        const card = state.cardEl;
        if (!card || typeof card._play !== 'function') return;
        e.preventDefault();
        card._play();
    }

    function isOnReviewPage() {
        return /\/subjects\/review/.test(window.location.pathname);
    }

    function onEnterReviews() {
        // Reset in case we're re-entering.
        teardown();

        const target = document.body;
        state.observer = new MutationObserver(handleDomChange);
        state.observer.observe(target, {
            subtree: true,
            childList: true,
            attributes: true,
            // No attributeFilter — we want to catch whatever attribute WK actually
            // uses to signal "answer graded" (data-quiz-input-quiz-state-value,
            // data-quiz-state, data-graded, aria-invalid, etc.). The handler is
            // cheap; the noise is fine.
        });

        // Run once at boot to catch the initial question.
        handleDomChange();
    }

    function teardown() {
        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
        }
        removeCard();
        clearHostStyling();
        state.currentSubjectId = null;
        state.currentCharacters = null;
        state.answered = false;
        state.currentQuestionType = null;
        state.meaningAnswered = false;
        state.readingAnswered = false;
        state.furiganaVisible = false;
        state.subjectProgress = {};
        state.currentFetchToken += 1;
    }

    // ---------- DOM-change handler ----------

    function handleDomChange() {
        // Sweep duplicate cards. WK's reveal animation appears to clone the question
        // subtree (which contains our card), producing a second visible copy. Our
        // state.cardEl references the original — anything else is a stale clone.
        dedupeCards();

        const subject = getCurrentSubject();
        if (!subject) {
            return; // No active question — leave any existing card alone.
        }

        if (!isVocab(subject)) {
            removeCard();
            clearHostStyling();
            closeSentencePicker();
            state.currentSubjectId = null;
            state.currentCharacters = null;
            state.answered = false;
            state.currentQuestionType = null;
            state.meaningAnswered = false;
            state.readingAnswered = false;
            state.furiganaVisible = false;
            state.bypassCeilingForCurrentSubject = false;
            return;
        }

        const isNewSubject = subject.id !== state.currentSubjectId;

        if (isNewSubject) {
            closeSentencePicker();
            state.currentSubjectId = subject.id;
            state.currentCharacters = subject.characters;
            state.answered = false;
            state.currentQuestionType = null;     // picked up on next mutation tick
            // Pull cached per-subject progress so a revisit after WK interleaves
            // other subjects doesn't lose the earlier submission's flag.
            const progress = getSubjectProgress(subject.id);
            state.meaningAnswered = progress.meaningAnswered;
            state.readingAnswered = progress.readingAnswered;
            state.furiganaVisible = !!settings().showFurigana; // default visibility for the new card
            // Reset the JLPT-ceiling bypass; applySavedSelection below may
            // restore it to true if the user had picked an above-ceiling
            // sentence for this word in a prior session.
            state.bypassCeilingForCurrentSubject = false;
            // Restore the user's last-chosen sentence/image indices for this word, or
            // default to 0 if none saved. This survives page refreshes via wkof.file_cache.
            applySavedSelection(subject.characters);
            const fetchToken = ++state.currentFetchToken;

            // Apply host styling eagerly — BEFORE the async fetch — so the
            // header reaches its final dimensions immediately. Without this,
            // removeCard would leave the header un-styled until the fetch
            // returns and renderCard re-applies via attachCardToDom, producing
            // a visible collapse → expand on every new vocab.
            applyHostStyling();
            // Loading placeholder shown for the duration of the IK fetch.
            // Replaced in place by renderCard / renderEmptyCard when the
            // promise resolves. Safe to render even on cache hits — getExamples
            // resolves via microtask before the next paint, so the spinner
            // never actually flashes when the answer is already in cache.
            renderLoadingCard();
            const renderT0 = Date.now();
            console.log(`[${SCRIPT_ID}] subject.start`, {
                word: subject.characters,
                subjectId: subject.id,
                mode: serverPathEnabled() ? 'server' : 'direct',
                sentenceIdx: state.sentenceIdx,
                imageIdx: state.imageIdx,
            });
            getExamples(subject.characters)
                .then((cached) => {
                    if (fetchToken !== state.currentFetchToken) return; // Stale
                    const chosen = pickFromCached(cached, state.sentenceIdx);
                    console.log(`[${SCRIPT_ID}] subject.ready`, {
                        word: subject.characters,
                        ms: Date.now() - renderT0,
                        poolSize: cached && Array.isArray(cached.raw) ? cached.raw.length : 0,
                        rendered: !!chosen,
                    });
                    if (!chosen) renderEmptyCard();
                    else renderCard(chosen);
                    // Warm the cache for the next few subjects in WK's queue.
                    // Runs after the current card is on-screen so we don't
                    // compete with its audio/image fetches for socket budget.
                    // When the server path is on, the user-configured
                    // prefetchCount applies (capped to SERVER_BATCH_MAX);
                    // direct mode keeps the original conservative 5.
                    const prefs = settings();
                    const prefetchN = serverPathEnabled()
                        ? Math.max(0, Math.min(SERVER_BATCH_MAX, prefs.prefetchCount | 0 || 0))
                        : 5;
                    if (prefetchN > 0) prefetchUpcomingExamples(prefetchN);
                })
                .catch((err) => {
                    console.error(`[${SCRIPT_ID}] fetch failed:`, err);
                    if (fetchToken === state.currentFetchToken) renderEmptyCard();
                });
            return;
        }

        // Question-type change within the same subject (WK moves reading → meaning
        // or vice versa). Reset `answered` so we re-trigger reveal logic on the
        // next submission; the card itself persists (same vocab, same sentence).
        const qtype = currentQuestionType();
        if (qtype && qtype !== state.currentQuestionType) {
            state.currentQuestionType = qtype;
            state.answered = false;
        }

        if (!state.answered) {
            const trigger = answerHasBeenSubmitted();
            if (trigger) {
                state.answered = true;
                console.log(`[${SCRIPT_ID}] reveal triggered by: ${trigger} (qtype=${state.currentQuestionType || 'unknown'})`);
                revealAll();
            }
        }
    }

    // ---------- Upcoming-subject prefetch ----------
    //
    // Warm the IK examples cache for subjects WK is about to show so the next
    // card-render skips the IK fetch entirely (no spinner, no fetch latency).
    //
    // WK doesn't publish an "upcoming items" API surface, so we read it out of
    // the live quiz-queue Stimulus controller's DOM. WK's Stimulus controllers
    // typically expose state via `data-<controller>-<name>-value` attributes
    // containing JSON — for the quiz queue we look for any value attribute
    // that parses as an array whose entries have a `characters` field.
    //
    // The whole thing is best-effort: if WK's queue isn't exposed in a shape
    // we recognize, we log once and skip — no harm done, just no prefetch
    // benefit. Call debugWkIk() to dump the queue DOM if you want to
    // investigate what WK is actually exposing.
    //
    // We only prefetch IK examples (not audio/image) per NEW_FEATURES.md
    // guidance — bandwidth cost would be high relative to the marginal win
    // (audio fetch already starts at render time of the upcoming card).
    function getUpcomingCharacters(maxCount) {
        const found = [];
        const tryAdd = (str) => {
            if (typeof str !== 'string') return;
            const trimmed = str.trim();
            if (!trimmed) return;
            if (trimmed === state.currentCharacters) return;
            if (found.includes(trimmed)) return;
            found.push(trimmed);
        };

        const queueRoots = document.querySelectorAll('[data-controller~="quiz-queue"]');
        for (const root of queueRoots) {
            for (const attr of root.attributes) {
                if (!attr.name.startsWith('data-quiz-queue-')) continue;
                if (!attr.name.endsWith('-value')) continue;
                let parsed;
                try {
                    parsed = JSON.parse(attr.value);
                } catch (_) {
                    continue;
                }
                if (!Array.isArray(parsed)) continue;
                for (const item of parsed) {
                    if (!item || typeof item !== 'object') continue;
                    tryAdd(item.characters || item.slug || (item.data && item.data.characters));
                    if (found.length >= maxCount) break;
                }
                if (found.length >= maxCount) break;
            }
            if (found.length >= maxCount) break;
        }

        return found.slice(0, maxCount);
    }

    function prefetchUpcomingExamples(maxCount) {
        let chars;
        try {
            chars = getUpcomingCharacters(maxCount || 5);
        } catch (err) {
            console.warn(`[${SCRIPT_ID}] prefetch: queue scrape threw:`, err);
            return;
        }
        if (!chars.length) {
            // One-shot log so we know whether the queue DOM is readable on
            // this WK build without spamming on every card.
            if (!state._prefetchNoneLogged) {
                state._prefetchNoneLogged = true;
                console.log(
                    `[${SCRIPT_ID}] prefetch: no upcoming-subject characters found in WK DOM ` +
                    `(call debugWkIk() to investigate the quiz-queue surface)`
                );
            }
            return;
        }
        // Server path: skip words that already have a fresh local payload,
        // then bulk-fetch the rest in one round trip. Hits the server's
        // /v1/vocab/batch endpoint (server doesn't lazy-warm on batch — any
        // misses come back in `missing` and we fire individual GETs for them,
        // which DO lazy-warm).
        if (serverPathEnabled()) {
            console.log(`[${SCRIPT_ID}] prefetch (server): ${chars.length} upcoming: ${chars.join(', ')}`);
            Promise.all(chars.map((c) => {
                return wkof.file_cache.load(serverCacheKey(c))
                    .then((entry) => isServerCacheFresh(entry) ? c : null)
                    .catch(() => null);
            })).then((cachedFlags) => {
                const toFetch = chars.filter((_, i) => cachedFlags[i] === null);
                if (!toFetch.length) return;
                fetchVocabBatch(toFetch).then(({ missing }) => {
                    // For batch-missing entries (the server has no cached row),
                    // fire individual GETs so each one lazy-warms. Fire-and-
                    // forget; even partial success populates the cache for
                    // subsequent renders.
                    if (missing && missing.length) {
                        console.log(`[${SCRIPT_ID}] prefetch: ${missing.length} cold; lazy-warming individually`);
                        for (const w of missing) {
                            fetchVocab(w).catch(() => {});
                        }
                    }
                });
            });
            return;
        }
        // Direct path: same one-at-a-time prefetch as before.
        console.log(`[${SCRIPT_ID}] prefetch: warming ${chars.length} upcoming example(s): ${chars.join(', ')}`);
        for (const c of chars) {
            // getExamples is cache-aware — already-fresh entries resolve via
            // microtask without hitting the network. Errors are swallowed:
            // prefetch failures shouldn't surface to the user.
            getExamples(c).catch(() => {});
        }
    }

    function refreshCardForCurrentSubject() {
        if (!state.currentCharacters) return;
        const wasAnswered = state.answered;
        const fetchToken = ++state.currentFetchToken;
        removeCard();
        getExamples(state.currentCharacters).then((cached) => {
            if (fetchToken !== state.currentFetchToken) return;
            const chosen = pickFromCached(cached, state.sentenceIdx);
            if (!chosen) renderEmptyCard();
            else {
                renderCard(chosen);
                if (wasAnswered) {
                    state.answered = true;
                    revealAll();
                }
            }
        });
    }

    // ---------- Subject detection ----------

    function getCurrentSubject() {
        // Multi-selector defense — WK's review-page DOM evolves; try several signals.
        const characters = readText(
            document.querySelector('.character-header__characters') ||
            document.querySelector('[class*="character-header__characters"]') ||
            document.querySelector('#character')
        );

        if (!characters) return null;

        const idAttrEl =
            document.querySelector('[data-subject-id]') ||
            document.querySelector('[data-quiz-queue-item-id]') ||
            document.querySelector('[data-current-item-id]');
        const id =
            (idAttrEl && (
                idAttrEl.getAttribute('data-subject-id') ||
                idAttrEl.getAttribute('data-quiz-queue-item-id') ||
                idAttrEl.getAttribute('data-current-item-id')
            )) ||
            // Fall back to the characters themselves as a synthetic ID.
            `chars:${characters}`;

        const typeEl =
            document.querySelector('[data-subject-type]') ||
            document.querySelector('.character-header');
        const subjectType = inferSubjectType(typeEl, characters);

        return {
            id: String(id),
            characters,
            type: subjectType,
        };
    }

    function inferSubjectType(el, characters) {
        // Prefer explicit data attribute when present.
        const attr = el && el.getAttribute && el.getAttribute('data-subject-type');
        if (attr) return attr;

        // Fall back to class-name hints commonly present on the character header.
        if (el && el.className) {
            const cls = el.className.toString();
            if (/vocabulary/i.test(cls)) return 'vocabulary';
            if (/kanji/i.test(cls)) return 'kanji';
            if (/radical/i.test(cls)) return 'radical';
        }

        // Last-resort heuristic: a single-character string with no kana is most likely a kanji.
        if (characters && characters.length === 1 && !/[぀-ゟ゠-ヿ]/.test(characters)) {
            return 'kanji';
        }
        return 'vocabulary';
    }

    function isVocab(subject) {
        return subject.type === 'vocabulary' || subject.type === 'kana_vocabulary';
    }

    function findUserResponseInput() {
        return (
            document.querySelector('#user-response') ||
            document.querySelector('input[name="user-response"]') ||
            document.querySelector('.quiz-input__input') ||
            document.querySelector('[data-quiz-input-target="input"]')
        );
    }

    // WK's per-question label has `data-question-type="meaning"` or `"reading"`.
    // Returns lowercase string or null if not present.
    function currentQuestionType() {
        const el = document.querySelector('[data-question-type]');
        if (!el) return null;
        const v = (el.getAttribute('data-question-type') || '').toLowerCase().trim();
        return v || null;
    }

    // Detects "WK has graded the user's submitted answer" (input bar turned
    // green or red). Current WK doesn't toggle any class or attribute on grading
    // — the green/red comes from CSS `:valid`/`:invalid` driven by
    // `input.setCustomValidity(...)`, which is invisible to className/getAttribute.
    // So the only reliable signal is the computed background-color of
    // `input#user-response`. We walk up to a few ancestors in case a future WK
    // revision moves the color to a wrapper element. The subject-info panel
    // visibility is kept as a last-resort fallback for layout changes we can't
    // anticipate — in current WK it only fires on Item Info click, which is
    // explicitly NOT what we want for the primary signal.
    function answerHasBeenSubmitted() {
        const input = findUserResponseInput();
        if (input) {
            let el = input;
            let steps = 0;
            while (el && el !== document.body && steps < 10) {
                const bg = readBgColor(el);
                if (bg) return `bg:${bg.kind}(${bg.raw})`;
                el = el.parentElement;
                steps++;
            }
        }

        // Last-resort fallback. Logged distinctly so we can see in console when
        // we're falling through to the Item-Info-coupled path.
        const panels = [
            '.subject-info',
            '.subject-section',
            '.subject-meaning',
            '.subject-reading',
            '[data-quiz-information-container]',
        ];
        for (const sel of panels) {
            const el = document.querySelector(sel);
            if (el && el.isConnected && el.offsetParent !== null) {
                return `${sel}-visible(fallback)`;
            }
        }

        return null;
    }

    // Parse computed background-color and classify as 'red' / 'green' / null.
    // Thresholds are conservative — has to be clearly one dominant channel with
    // meaningful alpha, so we don't false-positive on cards/borders/tints.
    function readBgColor(el) {
        let bg;
        try {
            bg = window.getComputedStyle(el).backgroundColor;
        } catch (_) {
            return null;
        }
        if (!bg) return null;
        const m = bg.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
        if (!m) return null;
        const r = +m[1], g = +m[2], b = +m[3];
        const a = m[4] !== undefined ? +m[4] : 1;
        if (a < 0.2) return null; // transparent
        // Strong red: r dominates, both g and b are noticeably lower.
        if (r >= 180 && g <= 140 && b <= 140 && (r - g) >= 60 && (r - b) >= 60) {
            return { kind: 'red', raw: bg };
        }
        // Strong green: g dominates, both r and b are noticeably lower.
        if (g >= 150 && r <= 180 && b <= 140 && (g - b) >= 50 && (g - r) >= 20) {
            return { kind: 'green', raw: bg };
        }
        return null;
    }

    // Ad-hoc DOM inspector — call `debugWkIk()` from the console to dump the current
    // state of every panel/marker we know about. Useful when reveal detection misfires.
    function debugWkIk() {
        const selectors = [
            '.subject-info',
            '.subject-section',
            '.subject-meaning',
            '.subject-reading',
            '[data-quiz-information-container]',
            '.quiz-input__input-container',
            '.character-header',
            '[data-quiz-input-quiz-state-value]',
            '[data-state]',
        ];
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length === 0) { console.log(`${sel}: (none)`); continue; }
            els.forEach((el, i) => {
                const cs = window.getComputedStyle(el);
                console.log(`${sel}[${i}]`, {
                    classList: Array.from(el.classList).join(' '),
                    hidden: el.hidden,
                    display: cs.display,
                    offsetParentVisible: el.offsetParent !== null,
                    'data-state': el.getAttribute('data-state'),
                    'data-quiz-input-quiz-state-value': el.getAttribute('data-quiz-input-quiz-state-value'),
                });
            });
        }
        // Dump the quiz-input subtree's class/data state so we can identify the
        // graded-state markers WK is actually using today. After submitting an
        // answer (DO NOT click Item Info), look here for which element/class
        // signals "correct"/"incorrect" — if none of our primary selectors match
        // it, that's the layout change to add to answerHasBeenSubmitted().
        const inputRoot = document.querySelector('.quiz-input');
        if (inputRoot) {
            console.log('--- .quiz-input subtree (classes + data-*) ---');
            const all = [inputRoot, ...inputRoot.querySelectorAll('*')];
            all.forEach((el) => {
                const cls = Array.from(el.classList).join(' ');
                const dataAttrs = Array.from(el.attributes)
                    .filter((a) => a.name.startsWith('data-'))
                    .map((a) => `${a.name}="${a.value}"`)
                    .join(' ');
                if (cls || dataAttrs) {
                    console.log(`  ${el.tagName.toLowerCase()}${cls ? '.' + cls.replace(/ /g, '.') : ''} ${dataAttrs}`);
                }
            });
        } else {
            console.log('.quiz-input: (not present)');
        }
        // Dump the background-color chain from the user-response input up to <body>.
        // After submit, look for the element whose bg flipped to a colored value —
        // its tag/class is the visual carrier of the green/red signal.
        const input = (typeof findUserResponseInput === 'function')
            ? findUserResponseInput()
            : document.querySelector('#user-response, .quiz-input__input, input[name="user-response"]');
        if (input) {
            console.log('--- bg-color chain from input → body ---');
            let el = input;
            let steps = 0;
            while (el && el !== document.body && steps < 12) {
                const cs = window.getComputedStyle(el);
                const sig = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + Array.from(el.classList).join('.') : ''}`;
                console.log(`  ${sig}  bg=${cs.backgroundColor}  color=${cs.color}`);
                el = el.parentElement;
                steps++;
            }
        } else {
            console.log('user-response input: (not found)');
        }
        // Dump every [data-controller~="quiz-queue"] element with its full
        // attribute list. Used to discover where WK exposes the upcoming-items
        // list so prefetchUpcomingExamples can find it. If you see a JSON-
        // looking *-value attribute whose array entries have a `characters`
        // field, the prefetcher should pick it up automatically; if entries
        // use a different field name, add it to getUpcomingCharacters' tryAdd
        // probe list.
        const queueRoots = document.querySelectorAll('[data-controller~="quiz-queue"]');
        if (queueRoots.length) {
            console.log('--- quiz-queue Stimulus roots (for prefetch tuning) ---');
            queueRoots.forEach((root, i) => {
                const cls = Array.from(root.classList).join(' ');
                console.log(`  root[${i}] <${root.tagName.toLowerCase()}.${cls}>`);
                for (const attr of root.attributes) {
                    if (!attr.name.startsWith('data-')) continue;
                    const truncVal = attr.value.length > 200
                        ? attr.value.slice(0, 200) + `… (+${attr.value.length - 200} chars)`
                        : attr.value;
                    console.log(`    ${attr.name} = ${truncVal}`);
                }
            });
        } else {
            console.log('quiz-queue Stimulus root: (none found — prefetch will no-op)');
        }
        // Dump the .character-header DOM tree with bounding boxes + computed
        // position/display, so we can diagnose vocab-character positioning
        // issues (e.g. when our centering CSS doesn't apply where we expect
        // because the character is nested inside a positioned wrapper).
        const headerForDump = document.querySelector('.character-header');
        if (headerForDump) {
            console.log('--- .character-header DOM tree (bbox in viewport coords) ---');
            const dumpNode = (el, depth) => {
                const indent = '  '.repeat(depth);
                const r = el.getBoundingClientRect();
                const cs = window.getComputedStyle(el);
                const cls = el.classList.length ? '.' + Array.from(el.classList).join('.') : '';
                const id = el.id ? `#${el.id}` : '';
                console.log(
                    `${indent}<${el.tagName.toLowerCase()}${id}${cls}>` +
                    ` bbox=(${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})` +
                    ` pos=${cs.position} display=${cs.display}` +
                    ` font-size=${cs.fontSize}`
                );
                for (const child of el.children) dumpNode(child, depth + 1);
            };
            dumpNode(headerForDump, 0);
        }
    }

    // Inspect the encoded-title → folder lookup for a given title. Use this
    // when a specific word's audio or image fails to load and you want to
    // know whether the problem is on our side (lookup miss → using broken
    // heuristic) or upstream (IK doesn't have the asset). Pass the
    // lowercased+underscored title string from the boot-time "raw IK example"
    // log (e.g. debugWkIkTitle('kanon__2006_')). Logs:
    //   1. whether indexMeta is loaded at all,
    //   2. whether the encoded title is present in the map (MAP HIT vs MISS),
    //   3. heuristic fallback's guess at the folder name,
    //   4. fully-built sample audio + image URLs you can paste into a new tab
    //      to verify reachability.
    function debugWkIkTitle(encodedTitle) {
        const tag = `--- debugWkIkTitle(${JSON.stringify(encodedTitle)}) ---`;
        console.log(tag);
        if (!encodedTitle) { console.log('(empty input)'); return; }
        if (!indexMeta) {
            console.log('indexMeta is null — kicking off lazy load (server-path users skip the boot-time fetch). Re-run debugWkIkTitle in a second or two.');
            ensureIndexMeta();
            return;
        }
        const total = Object.keys(indexMeta).length;
        const fromMap = indexMeta[encodedTitle];
        if (fromMap) {
            console.log(`MAP HIT (${total} entries loaded):`, fromMap);
        } else {
            console.log(`MAP MISS (${total} entries loaded). Encoded title is not in IK's /index_meta — either a new deck IK added after our 7d cache, or the title field doesn't match. Nearest first-char matches:`,
                Object.keys(indexMeta).filter((k) => k[0] === encodedTitle[0]).slice(0, 8));
            console.log('Heuristic-fallback folder name would be:', JSON.stringify(ikTitleToFolder(encodedTitle)));
        }
        // Build sample URLs with placeholder file names so the resolver runs
        // through resolveIkFolderAndCategory the same way it does for a real
        // example. Replace SAMPLE.mp3 / SAMPLE.jpg with the real `sound` /
        // `image` field from the failing example to get a real URL.
        const fakeExample = { title: encodedTitle, id: 'anime_xxx', sound: 'SAMPLE.mp3', image: 'SAMPLE.jpg' };
        console.log('Sample audio URL (with placeholder filename):', buildIkAudioUrl(fakeExample));
        console.log('Sample image URL (with placeholder filename):', buildIkImageUrl(fakeExample));
        console.log('To check the real file, replace SAMPLE.mp3/SAMPLE.jpg with the `sound`/`image` field from the failing example (visible in the boot log\'s "raw IK example" dump) and paste into a new browser tab.');
    }

    // Diagnostic helper for the API-server path. Mirrors debugWkIk():
    // - reports current toggle / URL configuration
    // - hits /v1/health and dumps the result
    // - runs a sample fetchVocab for the given word (default '食べる')
    // - dumps the local payload-cache size and a sample cached entry
    //
    // Exposed on PAGE_WIN so it's callable from devtools as `debugWkIkApi()`
    // even though the userscript runs in the Tampermonkey sandbox.
    function debugWkIkApi(word) {
        const tag = `--- debugWkIkApi(${JSON.stringify(word || '食べる')}) ---`;
        console.log(tag);
        const prefs = settings();
        const base = getApiBase();
        console.log('settings:', {
            useApiServer: prefs.useApiServer,
            apiServerUrl: prefs.apiServerUrl,
            prefetchCount: prefs.prefetchCount,
            serverPathEnabled: serverPathEnabled(),
            resolvedBase: base,
        });
        if (!base) {
            console.log('No apiServerUrl configured — set one in the settings dialog first.');
            return;
        }
        const probeWord = word || '食べる';
        // Health probe.
        fetch(`${base}/v1/health`, { credentials: 'omit', mode: 'cors', cache: 'no-cache' })
            .then((r) => r.json().then((j) => ({ status: r.status, body: j })))
            .then((r) => console.log('GET /v1/health →', r))
            .catch((err) => console.warn('GET /v1/health failed:', err));
        // Sample fetch (raw, no adapter — show what the wire sees).
        const probeUrl = `${base}/v1/vocab/${encodeURIComponent(probeWord)}`;
        console.log(`GET ${probeUrl} ...`);
        fetch(probeUrl, { credentials: 'omit', mode: 'cors', cache: 'no-cache' })
            .then((r) => r.json().then((j) => ({ status: r.status, etag: r.headers.get('ETag'), body: j })))
            .then((r) => {
                console.log('Server response:', {
                    status: r.status,
                    etag: r.etag,
                    word: r.body && r.body.word,
                    fetchedAt: r.body && r.body.fetchedAt,
                    exampleCount: r.body && Array.isArray(r.body.examples) ? r.body.examples.length : null,
                    fallbackImageCount: r.body && Array.isArray(r.body.fallbackImages) ? r.body.fallbackImages.length : null,
                    firstExample: r.body && r.body.examples && r.body.examples[0],
                });
            })
            .catch((err) => console.warn('GET /v1/vocab failed:', err));
        // Local cache snapshot.
        const dir = wkof.file_cache && wkof.file_cache.dir;
        const cacheKeys = dir ? Object.keys(dir).filter((k) => k.startsWith(SERVER_CACHE_PREFIX)) : [];
        console.log(`Local payload cache: ${cacheKeys.length} entr${cacheKeys.length === 1 ? 'y' : 'ies'}${dir ? '' : ' (wkof.file_cache.dir unavailable; entry list unknown)'}`);
        wkof.file_cache.load(serverCacheKey(probeWord))
            .then((entry) => {
                console.log(`Local cache for "${probeWord}":`, entry ? {
                    etag: entry.etag,
                    savedAt: entry.savedAt,
                    ageMs: Date.now() - entry.savedAt,
                    fresh: isServerCacheFresh(entry),
                    exampleCount: entry.payload && Array.isArray(entry.payload.examples) ? entry.payload.examples.length : null,
                } : '(empty)');
            })
            .catch(() => console.log(`Local cache for "${probeWord}": (empty)`));
    }

    function readText(el) {
        if (!el) return null;
        const t = (el.textContent || '').trim();
        return t || null;
    }

    // ---------- Fetch + cache ----------

    function cacheKey(slug) {
        return `${CACHE_PREFIX}${encodeURIComponent(slug)}`;
    }

    // Top-level entry point for the data layer. Routes to the wk-vocab-api
    // server path by default; falls through to the direct IK/DDG/Google path
    // when `useApiServer` is off or `apiServerUrl` is empty. Both paths
    // return the same shape: { fetchedAt, raw, chosen } — the server path
    // uses an adapter (serverPayloadToCacheEntry) to reshape the server's
    // payload into IK-raw-lookalike entries so downstream code (pickExample,
    // buildPool, renderCard, picker) is untouched. The direct path will be
    // spun out to a separate legacy/ snapshot in a future release; we keep
    // it inline for now so users can opt out without installing a second
    // userscript.
    function getExamples(slug) {
        if (serverPathEnabled()) {
            return getExamplesViaServer(slug);
        }
        return getExamplesDirect(slug);
    }

    function getExamplesDirect(slug) {
        const key = cacheKey(slug);
        return wkof.file_cache
            .load(key)
            .then((cached) => {
                if (cached && isCacheFresh(cached)) {
                    return reselectIfNeeded(cached, slug);
                }
                throw new Error('cache_stale');
            })
            .catch(() => fetchAndCache(slug));
    }

    function isCacheFresh(entry) {
        if (!entry || typeof entry.fetchedAt !== 'number') return false;
        const ttl = entry.chosen ? CACHE_TTL_MS : NEG_CACHE_TTL_MS;
        return Date.now() - entry.fetchedAt < ttl;
    }

    function reselectIfNeeded(cached, slug) {
        // We always re-pick from `raw` at render time using state.sentenceIdx, so this
        // is now just a passthrough. Kept for clarity/future use.
        return cached;
    }

    // Pick the example at the given index from the cached raw array.
    function pickFromCached(cached, index) {
        if (!cached || !cached.raw || !cached.raw.length) return null;
        return pickExample(cached.raw, settings(), index || 0);
    }

    // Refresh-button handlers: advance one index at a time and re-render the card.
    // Both indices wrap on overflow via modulo inside pickExample/loadImageAt.
    //
    // Sentence refresh ALSO resets imageIdx → the new sentence comes with its own
    // IK screenshot, and that should become the default. If the user wants a
    // different image they can press the image-refresh button (which cycles through
    // DDG illustrations as fallbacks).
    function refreshSentence() {
        state.sentenceIdx = (state.sentenceIdx || 0) + 1;
        state.imageIdx = 0;
        persistCurrentSelection();
        refreshCardForCurrentSubject();
    }
    function refreshImage() {
        state.imageIdx = (state.imageIdx || 0) + 1;
        persistCurrentSelection();
        refreshCardForCurrentSubject();
    }

    // ---------- Per-word selection persistence ----------

    // Fetch IK's /index_meta and stash the canonical encoded → {title, category}
    // map. Cached in wkof.file_cache for INDEX_META_TTL_MS. On any failure we
    // fall through to an empty map — URL builders then use the regex heuristic,
    // which is correct for simple titles (kill_la_kill, fate_zero) and wrong-
    // but-non-fatal for the trickier ones (durarara__, kanon__2006_, etc.).
    //
    // Prefer ensureIndexMeta() below over calling this directly — that
    // wrapper is fire-once-only and safe to call from sync code paths.
    function loadIndexMeta() {
        return wkof.file_cache
            .load(INDEX_META_CACHE_KEY)
            .then((entry) => {
                if (entry && entry.byEncoded && typeof entry.fetchedAt === 'number' &&
                    Date.now() - entry.fetchedAt < INDEX_META_TTL_MS) {
                    indexMeta = entry.byEncoded;
                    console.log(
                        `[${SCRIPT_ID}] index_meta loaded from cache (${Object.keys(indexMeta).length} entries)`
                    );
                    return;
                }
                throw new Error('index_meta_cache_stale');
            })
            .catch(() => fetchAndCacheIndexMeta());
    }

    // Fire-once-only wrapper for loadIndexMeta. Safe to call from any code
    // path that *might* need the map; subsequent calls return the in-flight
    // (or completed) promise. Callers shouldn't await the result if they
    // can tolerate a null indexMeta — the underlying lookups all fall back
    // to the regex heuristic. This is the kick-off pattern: trigger the
    // load now, render-with-fallback this call, render-with-map next call.
    function ensureIndexMeta() {
        if (indexMetaPromise) return indexMetaPromise;
        indexMetaPromise = loadIndexMeta();
        return indexMetaPromise;
    }

    function fetchAndCacheIndexMeta() {
        return fetch(IK_INDEX_META_URL, { credentials: 'omit' })
            .then((res) => {
                if (!res.ok) throw new Error(`index_meta HTTP ${res.status}`);
                return res.json();
            })
            .then((json) => {
                const src = (json && json.data) || {};
                const byEncoded = {};
                for (const enc of Object.keys(src)) {
                    const v = src[enc];
                    if (v && v.title) {
                        byEncoded[enc] = { title: v.title, category: v.category || null };
                    }
                }
                indexMeta = byEncoded;
                wkof.file_cache
                    .save(INDEX_META_CACHE_KEY, {
                        byEncoded,
                        fetchedAt: Date.now(),
                        lastUpdatedTimestamp: json && json.lastUpdatedTimestamp || null,
                    })
                    .catch((err) => console.warn(`[${SCRIPT_ID}] index_meta cache save failed:`, err));
                console.log(`[${SCRIPT_ID}] index_meta fetched (${Object.keys(byEncoded).length} entries)`);
            })
            .catch((err) => {
                console.warn(
                    `[${SCRIPT_ID}] index_meta fetch failed; falling back to heuristic title decoding:`,
                    err
                );
                indexMeta = {}; // empty map — lookups miss → heuristic
            });
    }

    // Load the persisted selection map from wkof.file_cache. Called once during boot.
    // Non-blocking on failure — selections just default to 0,0 if absent.
    function loadSelections() {
        return wkof.file_cache
            .load(SELECTIONS_CACHE_KEY)
            .then((entry) => {
                if (entry && entry.selections && typeof entry.selections === 'object') {
                    state.selections = entry.selections;
                    console.log(
                        `[${SCRIPT_ID}] loaded ${Object.keys(state.selections).length} saved selections`
                    );
                }
            })
            .catch(() => { /* no saved selections yet — first run */ });
    }

    function saveSelections() {
        return wkof.file_cache
            .save(SELECTIONS_CACHE_KEY, { selections: state.selections, savedAt: Date.now() })
            .catch((err) => console.warn(`[${SCRIPT_ID}] save selections failed:`, err));
    }

    // Apply the saved selection for a vocab word (or default to 0,0,false) to
    // state. The `b` field is the JLPT-ceiling bypass: when true, this word's
    // sentenceIdx points into the *unfiltered* pool (set last session by the
    // user via the sentence picker). Missing `b` (old selections from before
    // picker support) defaults to false, which is safe — old indices were
    // always into the filtered pool.
    function applySavedSelection(word) {
        const sel = (word && state.selections[word]) || null;
        state.sentenceIdx = (sel && Number.isFinite(sel.s)) ? sel.s : 0;
        state.imageIdx = (sel && Number.isFinite(sel.i)) ? sel.i : 0;
        state.bypassCeilingForCurrentSubject = !!(sel && sel.b);
    }

    // Persist the current state.sentenceIdx/imageIdx/bypass for the current word.
    function persistCurrentSelection() {
        const word = state.currentCharacters;
        if (!word) return;
        state.selections[word] = {
            s: state.sentenceIdx || 0,
            i: state.imageIdx || 0,
            b: !!state.bypassCeilingForCurrentSubject,
        };
        // Fire-and-forget; if the save fails we'll log but not block UX.
        saveSelections();
    }

    function fetchAndCache(slug) {
        const url = buildIkUrl(slug, settings());
        return fetch(url, { credentials: 'omit' })
            .then((res) => {
                if (!res.ok) throw new Error(`IK HTTP ${res.status}`);
                return res.json();
            })
            .then((json) => {
                const examples = normalizeExamples(json);
                // Attach _jlptMax to each raw entry now, while we still have
                // `slug` (= target vocab word). Score is consulted in
                // pickExample's jlptCeiling filter. Done at cache-write time
                // so renders stay cheap. Bump CACHE_SCHEMA_VERSION whenever
                // scoreJlpt's semantics change so stale entries get re-scored.
                //
                // No slice cap: the sentence picker offers pagination + sort
                // over the full set, so trimming here would silently hide
                // candidates. IK responses top out around 500 per word.
                const raw = examples.map((e) => {
                    e._jlptMax = scoreJlpt(e, slug);
                    return e;
                });
                // Pre-pick `chosen` only so `isCacheFresh` can use it as a positive-hit
                // signal. Renderer always uses pickExample(cached.raw, ...) with the
                // current index, not this value.
                const chosen = pickExample(raw, settings(), 0);
                const entry = { fetchedAt: Date.now(), chosen, raw };
                wkof.file_cache.save(cacheKey(slug), entry).catch(() => {});
                return entry;
            });
    }

    function buildIkUrl(slug, prefs) {
        const params = new URLSearchParams({
            q: slug,
            exactMatch: 'true',
            // Pull everything IK has for this word. The picker offers
            // pagination + sort over the full result, so capping early would
            // silently hide candidates from the user. Common words top out
            // around 500; rarer words return a few dozen. IK's server-side
            // cap appears to be ~500, so any large number here is effectively
            // "give me all you have."
            limit: '1000',
        });
        if (prefs.sentencePreference === 'shortest') {
            params.set('sort', 'sentence_length:asc');
        } else if (prefs.sentencePreference === 'longest') {
            params.set('sort', 'sentence_length:desc');
        }
        return `${IK_API_BASE}?${params.toString()}`;
    }

    // ---------- API server path ----------
    //
    // These functions are the default data-layer path (the direct IK / DDG /
    // Google path is the opt-out fallback). They produce the same
    // { fetchedAt, raw, chosen } cache-entry shape as the direct path so
    // downstream code is identical. The adapter (serverPayloadToCacheEntry)
    // does the heavy lifting: it reshapes the server's payload (camelCase,
    // nested source, pre-resolved jlptMax + media URLs) into IK-raw-lookalike
    // entries.

    function serverPathEnabled() {
        const prefs = settings();
        return !!(prefs.useApiServer && getApiBase());
    }

    function getApiBase() {
        const raw = (settings().apiServerUrl || '').trim();
        if (!raw) return '';
        // Strip trailing slash so caller can blindly concatenate `/v1/...`.
        return raw.replace(/\/+$/, '');
    }

    function serverCacheKey(word) {
        return `${SERVER_CACHE_PREFIX}${encodeURIComponent(word)}`;
    }

    function isServerCacheFresh(entry) {
        if (!entry || !entry.payload || typeof entry.savedAt !== 'number') return false;
        // Incomplete payloads (DDG still warming server-side) get a much
        // shorter TTL so the next visit re-fetches and picks up the full
        // version. Without this, a 7-day cache would pin the partial
        // payload until manual clear.
        const ttl = entry.payload.incomplete ? SERVER_INCOMPLETE_TTL_MS : SERVER_CACHE_TTL_MS;
        return Date.now() - entry.savedAt < ttl;
    }

    // Cache-aware variant of getExamples for the server path. Mirrors
    // getExamplesDirect's flow:
    //   1. Try local cache. If fresh, adapt and return.
    //   2. Otherwise call fetchVocab(word) — which itself sends If-None-Match
    //      and may resolve 304 with cached payload.
    function getExamplesViaServer(word) {
        return wkof.file_cache
            .load(serverCacheKey(word))
            .catch(() => null)
            .then((entry) => {
                if (entry && isServerCacheFresh(entry)) {
                    const ttlMs = entry.payload && entry.payload.incomplete
                        ? SERVER_INCOMPLETE_TTL_MS : SERVER_CACHE_TTL_MS;
                    console.log(`[${SCRIPT_ID}] server.cache hit`, {
                        word,
                        ageMs: Date.now() - entry.savedAt,
                        ttlMs,
                        examples: Array.isArray(entry.payload && entry.payload.examples)
                            ? entry.payload.examples.length : 0,
                        incomplete: !!(entry.payload && entry.payload.incomplete),
                        etag: entry.etag || null,
                    });
                    return serverPayloadToCacheEntry(entry.payload);
                }
                console.log(`[${SCRIPT_ID}] server.cache miss`, {
                    word,
                    reason: !entry ? 'no_entry' : 'stale',
                    ...(entry ? { ageMs: Date.now() - entry.savedAt, hasEtag: !!entry.etag } : {}),
                });
                return fetchVocab(word, entry).then((payload) => {
                    if (!payload) return { fetchedAt: Date.now(), raw: [], chosen: null };
                    return serverPayloadToCacheEntry(payload);
                });
            });
    }

    // Hit GET /v1/vocab/{word} on the configured server, with ETag round-trip.
    // Returns the payload object on success (200 or 304), or null on 404 / 5xx /
    // network error. Updates local cache on 200.
    //
    // We use native fetch() (not GM_xmlhttpRequest) because our server returns
    // permissive CORS. That also dodges the @connect requirement for arbitrary
    // user-configured prod domains — only the @connect-gated GM_xmlhttpRequest
    // cares.
    function fetchVocab(word, cachedEntryHint) {
        const base = getApiBase();
        if (!base) return Promise.resolve(null);
        const url = `${base}/v1/vocab/${encodeURIComponent(word)}`;
        const headers = {};
        if (cachedEntryHint && cachedEntryHint.etag) {
            headers['If-None-Match'] = cachedEntryHint.etag;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SERVER_GET_TIMEOUT_MS);
        const t0 = Date.now();
        const ifNoneMatch = cachedEntryHint && cachedEntryHint.etag ? cachedEntryHint.etag : null;
        console.log(`[${SCRIPT_ID}] server.get start`, { word, ifNoneMatch });
        // cache: 'no-cache' forces conditional revalidation against the
        // server's ETag on every request, instead of letting Chrome's HTTP
        // cache silently serve the response for the full `max-age=86400`
        // window the server advertises. With If-None-Match the revalidation
        // collapses to a 304, so this is cheap; without it, the alternative
        // is stale empty payloads (observed: a 2026-05-25 review session
        // that hit a word during the bulk warm got an empty response,
        // Chrome cached it under max-age=86400, and the userscript kept
        // re-serving the empty payload from cache even after the warm
        // re-populated the row server-side).
        return fetch(url, { headers, credentials: 'omit', mode: 'cors', cache: 'no-cache', signal: ctrl.signal })
            .finally(() => clearTimeout(timer))
            .then((res) => {
                const ms = Date.now() - t0;
                if (res.status === 304) {
                    console.log(`[${SCRIPT_ID}] server.get 304 (not modified)`, { word, ms, etag: ifNoneMatch });
                    // ETag matched — refresh the savedAt so TTL math sees this
                    // as a recently-verified entry, but keep the same payload.
                    if (cachedEntryHint && cachedEntryHint.payload) {
                        const refreshed = {
                            payload: cachedEntryHint.payload,
                            etag: cachedEntryHint.etag,
                            savedAt: Date.now(),
                        };
                        wkof.file_cache.save(serverCacheKey(word), refreshed).catch(() => {});
                        return cachedEntryHint.payload;
                    }
                    return null;
                }
                if (res.status === 404) {
                    console.log(`[${SCRIPT_ID}] server.get 404 (no examples)`, { word, ms });
                    return null;
                }
                if (!res.ok) {
                    console.warn(`[${SCRIPT_ID}] server.get error`, { word, ms, status: res.status });
                    return null;
                }
                const etag = res.headers.get('ETag') || res.headers.get('etag') || null;
                return res.json().then((payload) => {
                    console.log(`[${SCRIPT_ID}] server.get 200`, {
                        word,
                        ms,
                        examples: Array.isArray(payload && payload.examples) ? payload.examples.length : 0,
                        fallbackImages: Array.isArray(payload && payload.fallbackImages) ? payload.fallbackImages.length : 0,
                        incomplete: !!(payload && payload.incomplete),
                        etag,
                    });
                    const entry = { payload, etag, savedAt: Date.now() };
                    wkof.file_cache.save(serverCacheKey(word), entry).catch(() => {});
                    return payload;
                });
            })
            .catch((err) => {
                const ms = Date.now() - t0;
                const aborted = err && err.name === 'AbortError';
                console.warn(`[${SCRIPT_ID}] server.get failed`, {
                    word,
                    ms,
                    reason: aborted ? 'timeout' : 'network',
                    err: err && err.message,
                    fallback: cachedEntryHint && cachedEntryHint.payload ? 'stale_cache' : 'none',
                });
                // Fall back to whatever stale cached payload we have, if any —
                // better than rendering an empty card just because the server
                // was momentarily unreachable.
                if (cachedEntryHint && cachedEntryHint.payload) {
                    return cachedEntryHint.payload;
                }
                return null;
            });
    }

    // Bulk-fetch helper for prefetch. Splits `words` into chunks of
    // SERVER_BATCH_MAX, POSTs each, writes every found payload to local cache.
    // Resolves with { found, missing } merged across chunks. Never throws —
    // prefetch failures shouldn't surface to the user.
    function fetchVocabBatch(words) {
        const base = getApiBase();
        if (!base || !words || !words.length) {
            return Promise.resolve({ found: {}, missing: [] });
        }
        // Chunk and dispatch in parallel.
        const chunks = [];
        for (let i = 0; i < words.length; i += SERVER_BATCH_MAX) {
            chunks.push(words.slice(i, i + SERVER_BATCH_MAX));
        }
        const t0 = Date.now();
        console.log(`[${SCRIPT_ID}] server.batch start`, { requested: words.length, chunks: chunks.length });
        return Promise.all(chunks.map((chunk, chunkIdx) => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), SERVER_BATCH_TIMEOUT_MS);
            const chunkT0 = Date.now();
            return fetch(`${base}/v1/vocab/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'omit',
                mode: 'cors',
                signal: ctrl.signal,
                body: JSON.stringify({ words: chunk }),
            })
                .finally(() => clearTimeout(timer))
                .then((res) => {
                    const ms = Date.now() - chunkT0;
                    if (!res.ok) {
                        console.warn(`[${SCRIPT_ID}] server.batch chunk error`, {
                            chunkIdx, size: chunk.length, ms, status: res.status,
                        });
                        return { found: {}, missing: chunk };
                    }
                    return res.json().then((body) => {
                        console.log(`[${SCRIPT_ID}] server.batch chunk 200`, {
                            chunkIdx,
                            size: chunk.length,
                            ms,
                            found: body && body.found ? Object.keys(body.found).length : 0,
                            missing: Array.isArray(body && body.missing) ? body.missing.length : 0,
                        });
                        return body;
                    });
                })
                .catch((err) => {
                    const ms = Date.now() - chunkT0;
                    const aborted = err && err.name === 'AbortError';
                    console.warn(`[${SCRIPT_ID}] server.batch chunk failed`, {
                        chunkIdx, size: chunk.length, ms,
                        reason: aborted ? 'timeout' : 'network',
                        err: err && err.message,
                    });
                    return { found: {}, missing: chunk };
                });
        })).then((results) => {
            const merged = { found: {}, missing: [] };
            for (const r of results) {
                if (r && r.found) Object.assign(merged.found, r.found);
                if (r && Array.isArray(r.missing)) merged.missing.push(...r.missing);
            }
            // Persist every found payload to local cache so subsequent
            // getExamples calls hit instantly. We don't have ETags from
            // /batch (server doesn't compute them per-row), so on the next
            // GET /v1/vocab/{word} the cache-fresh check fires and we skip
            // the network entirely until TTL expiry.
            for (const word of Object.keys(merged.found)) {
                const entry = { payload: merged.found[word], etag: null, savedAt: Date.now() };
                wkof.file_cache.save(serverCacheKey(word), entry).catch(() => {});
            }
            console.log(`[${SCRIPT_ID}] server.batch done`, {
                requested: words.length,
                found: Object.keys(merged.found).length,
                missing: merged.missing.length,
                chunks: chunks.length,
                ms: Date.now() - t0,
            });
            return merged;
        });
    }

    // Adapter: reshape the server's payload into the cache-entry shape that
    // downstream code (pickExample, buildPool, renderCard, sentence picker)
    // expects. The transform per-example:
    //   - server's camelCase fields → IK's snake_case names that downstream
    //     reads (sentence_with_furigana, word_list, title)
    //   - server's pre-resolved jlptMax → _jlptMax (so scoreJlpt is bypassed
    //     for server-sourced entries; we trust the server's score)
    //   - server's hasOriginalAudio → a non-empty `sound` sentinel string so
    //     hasOriginalAudio(e) (which checks e.sound || e.sound_url) returns
    //     true for the buildPool requireAudio filter
    //   - server's pretty source title → stashed as _prettyTitle so the
    //     renderer / picker display it without re-encoding through
    //     prettifyTitle's heuristic
    //   - server's pre-built audioUrl / imageUrl → stashed as _serverAudioUrl
    //     and _serverImageUrl; formatExample prefers these over buildIkAudioUrl
    //   - payload.fallbackImages → stashed on every entry as
    //     _serverFallbackImages so loadImageAt can use them in place of DDG
    function serverPayloadToCacheEntry(payload) {
        if (!payload || !Array.isArray(payload.examples)) {
            return { fetchedAt: Date.now(), raw: [], chosen: null };
        }
        const fallbacks = Array.isArray(payload.fallbackImages) ? payload.fallbackImages : [];
        const raw = payload.examples.map((e) => {
            const src = e.source || {};
            return {
                // IK-raw-lookalike fields downstream consumers read directly:
                sentence: e.sentence || '',
                sentence_with_furigana: e.sentenceFurigana || '',
                translation: e.translation || '',
                word_list: Array.isArray(e.wordList) ? e.wordList : [],
                title: src.encodedTitle || '',
                deck_name: src.encodedTitle || '',
                sound: e.hasOriginalAudio ? '__server_audio__' : '',
                // JLPT score pre-computed server-side. Same 0..5 semantics as
                // the client-side scoreJlpt (0 = unknown sentinel, fail-open).
                _jlptMax: typeof e.jlptMax === 'number' ? e.jlptMax : 0,
                // Server-path annotations (undefined on direct-path entries):
                _prettyTitle: src.title || '',
                _serverAudioUrl: e.audioUrl || null,
                _serverImageUrl: e.imageUrl || null,
                _serverFallbackImages: fallbacks,
                _serverExampleId: e.id || null,
            };
        });
        // Pre-pick `chosen` mirrors the direct path so getExamplesDirect's
        // isCacheFresh + reselectIfNeeded flow stays parallel. Renderer always
        // re-picks from `raw` at the current state.sentenceIdx anyway.
        const chosen = raw.length ? pickExample(raw, settings(), 0) : null;
        return {
            fetchedAt: typeof payload.fetchedAt === 'number' ? payload.fetchedAt : Date.now(),
            chosen,
            raw,
        };
    }

    // ---------- Audio (IK proxy → Google Translate TTS) + Image (DDG) ----------

    // ============================================================
    // IK title-encoding workaround (READ THIS BEFORE TOUCHING URL CODE)
    // ============================================================
    //
    // The PROBLEM:
    // IK's example.title field uses a lossy encoding — lowercase the title,
    // then map every non-alphanumeric char to "_" one-for-one. That means
    // "Kanon (2006)", "Kanon  2006-", and "kanon-(2006(" all collapse to the
    // same string "kanon__2006_". The number of underscores is preserved but
    // their original identity (space vs paren vs apostrophe vs hyphen vs ...)
    // is destroyed. So we CANNOT locally invert the encoding to rebuild the
    // proper folder name on IK's media proxy, which DOES need the real chars.
    //
    // Concrete examples of titles whose encoding cannot be reversed by any
    // local heuristic (verified against /index_meta):
    //   "durarara__"                            → "Durarara!!"
    //   "god_s_blessing_on_this_wonderful_world_" → "God's Blessing on this Wonderful World!"
    //   "re_zero___starting_life_in_another_world" → "Re Zero − Starting Life in Another World"
    //   "demon_slayer___kimetsu_no_yaiba"       → "Demon Slayer - Kimetsu no Yaiba"
    //   "frieren_beyond_journey_s_end"          → "Frieren Beyond Journey's End"
    //
    // The FIX:
    // IK exposes GET /index_meta — see loadIndexMeta() below — which returns
    // the canonical encoded → {title, category, tags} map for every deck they
    // serve (~96 entries, ~12KB JSON). We fetch this once on boot, cache it
    // for 7 days, and use it as the source of truth for the folder name.
    //
    // The FALLBACK:
    // When the map is unavailable (boot still in flight, /index_meta returns
    // 5xx, brand-new deck not yet in our cached map), we degrade to the
    // ikTitleToFolder + decodeIkTitle regex heuristic. The heuristic is
    // correct for the easy cases (kill_la_kill → "Kill la Kill", fate_zero →
    // "Fate Zero") and silently wrong on hard cases. Wrong-but-non-fatal: the
    // proxy returns an empty body, our < 1KB check trips, we negative-cache
    // and fall through to Google TTS / DDG illustrations.
    //
    // The DIAGNOSTIC TOOL:
    // Call debugWkIkTitle('<encoded_title>') from devtools to inspect the
    // map state and the URL we would build for a given title. See the
    // function below near the existing debugWkIk() helper.
    //
    // If audio or images stop loading for a specific title, the playbook is
    // (1) check the boot log for "index_meta fetched/loaded (N entries)"
    // (2) call debugWkIkTitle() for the failing title
    // (3) if MAP MISS but the deck plainly exists on IK, clear the cache via
    //     the settings dialog (forces /index_meta refetch on next boot)
    // (4) if MAP HIT but the URL still 404s, the file genuinely isn't on the
    //     proxy bucket — let it fall through to TTS / DDG.
    // ============================================================

    // Resolve { folder, category } for an IK example. Prefers the canonical
    // /index_meta mapping and falls back to the regex heuristic when the
    // map is unavailable or the title isn't yet listed. Kicks off a lazy
    // load of indexMeta on first call (no-op if already loaded or in flight)
    // so users who flip from server to direct mode mid-session don't sit
    // on heuristic-only resolution forever.
    function resolveIkFolderAndCategory(e) {
        if (!e || !e.title) return null;
        if (indexMeta === null) ensureIndexMeta();
        const fromMap = indexMeta && indexMeta[e.title];
        const folder = fromMap ? fromMap.title : ikTitleToFolder(e.title);
        let category = fromMap && fromMap.category;
        if (!category) {
            // Heuristic fallback: id is shaped "<category>_<encoded_title>_..."
            category = e.id ? String(e.id).split('_')[0] : null;
        }
        if (!folder || !category) return null;
        return { folder, category };
    }

    // Build an audio URL using the IK API's /download_media proxy. The site itself
    // serves audio from URLs like:
    //   https://apiv2.immersionkit.com/download_media?path=media/anime/Fate%20Zero/media/<sound>
    // The path components are derived from fields in the example object:
    //   <category> + <folder> = resolveIkFolderAndCategory(e) (index_meta lookup)
    //   <sound>               = `sound` field verbatim
    // Returns null if any required field is missing.
    function buildIkAudioUrl(e) {
        if (!e || !e.sound) return null;
        const fc = resolveIkFolderAndCategory(e);
        if (!fc) return null;
        // Encode each path segment individually so spaces, "×", etc. get percent-
        // encoded while the slashes between segments stay literal (matching the
        // exact format the IK website uses).
        const segments = ['media', fc.category, fc.folder, 'media', e.sound];
        const path = segments.map(encodeURIComponent).join('/');
        return `${IK_DOWNLOAD_MEDIA_BASE}?path=${path}`;
    }

    // Decode IK's underscored title into a flat token array. IK collapses each
    // special character (space, paren, etc.) to a single "_", which is mostly
    // unambiguous on its way back to spaces — except for the trailing
    // "__YYYY_" disambiguator pattern that encodes " (YYYY)". We undo that
    // pattern explicitly before treating remaining underscores as spaces.
    // Empty tokens (collapsed double/trailing underscores from non-year cases
    // we can't reverse) are dropped — the resulting folder name will miss
    // those special chars, which is acceptable degradation.
    function decodeIkTitle(title) {
        let s = String(title);
        s = s.replace(/__(\d+)_$/, ' ($1)');
        s = s.replace(/_/g, ' ');
        return s.split(' ').filter(Boolean);
    }

    // Map IK's encoded title to its actual folder name on the proxy.
    //   "kill_la_kill"   → "Kill la Kill"
    //   "kanon__2006_"   → "Kanon (2006)"
    //   "hunter_x_hunter"→ "Hunter × Hunter"
    // IK uses title-case convention: capitalize each token EXCEPT short ASCII
    // function words (la, of, on, the, and, etc.) which stay lowercase — but
    // the FIRST token is always capitalized even if short ("The Walking Dead").
    // The lone "x" token is the IK convention for "×".
    function ikTitleToFolder(title) {
        const tokens = decodeIkTitle(title);
        return tokens
            .map((tok, i) => {
                if (tok === 'x') return '×';
                if (i > 0 && tok.length <= 3 && /^[a-z]+$/.test(tok)) return tok;
                if (!/^[a-z]/i.test(tok)) return tok;
                return tok[0].toUpperCase() + tok.slice(1);
            })
            .join(' ');
    }

    // Same URL shape as buildIkAudioUrl but with the `image` field (a screenshot
    // from the source anime/drama/game frame). Returns null if `image` is missing
    // (e.g. text-only literature examples like Skyrim quest text).
    function buildIkImageUrl(e) {
        if (!e || !e.image) return null;
        const fc = resolveIkFolderAndCategory(e);
        if (!fc) return null;
        const segments = ['media', fc.category, fc.folder, 'media', e.image];
        const path = segments.map(encodeURIComponent).join('/');
        return `${IK_DOWNLOAD_MEDIA_BASE}?path=${path}`;
    }

    // Fetch the IK proxy MP3 with persistent cache. Stored as ArrayBuffer in
    // wkof.file_cache keyed by the full IK URL (so different sources of the same
    // sentence cache independently). Negative results (404/403/empty) are cached
    // for 7 days so we don't hammer the proxy on every play.
    function fetchIkAudioBlobUrl(url) {
        const key = `${IK_AUDIO_CACHE_PREFIX}${encodeURIComponent(url)}`;
        return wkof.file_cache
            .load(key)
            .then((entry) => {
                if (entry && entry.buffer) {
                    const blob = new Blob([entry.buffer], { type: entry.type || 'audio/mpeg' });
                    return URL.createObjectURL(blob);
                }
                if (entry && entry.failedAt &&
                    Date.now() - entry.failedAt < IK_AUDIO_NEG_CACHE_TTL_MS) {
                    throw new Error('ik_audio_negative_cached');
                }
                throw new Error('ik_audio_cache_miss');
            })
            .catch((err) => {
                if (err && err.message === 'ik_audio_negative_cached') throw err;
                return fetchAndCacheIkAudio(url, key);
            });
    }

    function fetchAndCacheIkAudio(url, key) {
        return gmFetch(url, 'blob', {
            timeout: 15000,
            // Spoof the IK website origin in case the proxy ever checks Referer.
            headers: { 'Referer': 'https://www.immersionkit.com/' },
        })
            .then((r) => r.response.arrayBuffer().then((buffer) => ({
                buffer,
                type: r.response.type || 'audio/mpeg',
            })))
            .then(({ buffer, type }) => {
                // Sanity check — the proxy returns a tiny body for missing files
                // (e.g. when a sentence has no original audio). Treat that as a miss
                // so we fall back to TTS instead of playing silence.
                if (!buffer || buffer.byteLength < 1024) {
                    throw new Error(`ik_audio_too_small (${buffer && buffer.byteLength} bytes)`);
                }
                wkof.file_cache
                    .save(key, { buffer, type, fetchedAt: Date.now() })
                    .catch((err) => console.warn(`[${SCRIPT_ID}] IK audio cache save failed:`, err));
                const blob = new Blob([buffer], { type });
                return URL.createObjectURL(blob);
            })
            .catch((err) => {
                // Negative-cache the failure so we don't retry on every play within
                // the TTL window. (Cleared via the "Clear cache" settings button.)
                wkof.file_cache
                    .save(key, { failedAt: Date.now() })
                    .catch(() => {});
                throw err;
            });
    }

    // Orchestrator: pick the best available audio source for this example.
    //
    // Server-path examples carry a pre-resolved CDN URL (IK voice-actor
    // recording or pre-rendered TTS, whichever the server cached) on
    // example.ikAudioUrl with _serverAudio=true. We hand that straight to
    // the <audio> element — no blob conversion, no Referer spoof, no
    // negative-cache layer. The server's `Cache-Control: max-age=31536000,
    // immutable` header lets the browser HTTP cache hold it indefinitely.
    //
    // Direct-path examples: fetch the IK proxy URL (real human audio when
    // available) via gmFetch with Referer spoof, then fall back to Google
    // TTS (synthesized but always works). Both produce a blob URL that
    // attaches to the <audio> element.
    //
    // Returns a URL the <audio> element can play.
    function resolveAudioBlobUrl(example) {
        const sentencePreview = (example && example.sentence || '').slice(0, 30);
        if (example && example._serverAudio && example.ikAudioUrl) {
            console.log(`[${SCRIPT_ID}] audio.source server-cdn`, {
                sentence: sentencePreview,
                url: example.ikAudioUrl,
            });
            return Promise.resolve(example.ikAudioUrl);
        }
        const ikUrl = example && example.ikAudioUrl;
        if (ikUrl) {
            return fetchIkAudioBlobUrl(ikUrl)
                .then((url) => {
                    console.log(`[${SCRIPT_ID}] audio.source ik-proxy`, {
                        sentence: sentencePreview,
                        ikUrl,
                    });
                    return url;
                })
                .catch((err) => {
                    console.warn(`[${SCRIPT_ID}] audio.source ik-proxy failed → tts`, {
                        sentence: sentencePreview,
                        err: err && err.message,
                    });
                    return fetchTtsBlobUrl(example.sentence).then((url) => {
                        console.log(`[${SCRIPT_ID}] audio.source tts (ik-proxy fallback)`, {
                            sentence: sentencePreview,
                        });
                        return url;
                    });
                });
        }
        return fetchTtsBlobUrl(example.sentence).then((url) => {
            console.log(`[${SCRIPT_ID}] audio.source tts (no ik url)`, { sentence: sentencePreview });
            return url;
        });
    }

    // Google Translate TTS — unofficial but widely used. Returns MP3 of the input
    // text in the target language. 200-char limit per request, so we truncate.
    function buildTtsUrl(text) {
        const truncated = (text || '').slice(0, 200);
        const params = new URLSearchParams({
            ie: 'UTF-8',
            tl: 'ja',
            client: 'gtx',
            q: truncated,
        });
        return `${GOOGLE_TTS_BASE}?${params.toString()}`;
    }

    // Fetch the TTS MP3 with persistent cache. Stored as ArrayBuffer in wkof.file_cache
    // (IndexedDB) keyed by sentence text, since the same sentence will always produce
    // the same audio. We store as ArrayBuffer (not Blob) for portability across browsers
    // and to dodge any wkof serialization quirks. Returns a fresh blob: URL each call.
    function fetchTtsBlobUrl(text) {
        const key = `${AUDIO_CACHE_PREFIX}${encodeURIComponent(text)}`;
        return wkof.file_cache
            .load(key)
            .then((entry) => {
                if (!entry || !entry.buffer) throw new Error('audio_cache_miss');
                const blob = new Blob([entry.buffer], { type: entry.type || 'audio/mpeg' });
                return URL.createObjectURL(blob);
            })
            .catch(() => fetchAndCacheTts(text, key));
    }

    function fetchAndCacheTts(text, key) {
        return gmFetch(buildTtsUrl(text), 'blob', {
            timeout: 10000,
            headers: { 'Referer': 'https://translate.google.com/' },
        })
            .then((r) => r.response.arrayBuffer().then((buffer) => ({ buffer, type: r.response.type || 'audio/mpeg' })))
            .then(({ buffer, type }) => {
                // Store in cache (fire-and-forget; don't block playback on save).
                wkof.file_cache
                    .save(key, { buffer, type, fetchedAt: Date.now() })
                    .catch((err) => console.warn(`[${SCRIPT_ID}] audio cache save failed:`, err));
                const blob = new Blob([buffer], { type });
                return URL.createObjectURL(blob);
            });
    }

    function speakWithWebSpeech(text) {
        if (!('speechSynthesis' in window) || !text) return;
        try {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'ja-JP';
            u.rate = 0.95;
            const voices = window.speechSynthesis.getVoices() || [];
            const ja = voices.find((v) => v.lang === 'ja-JP') ||
                       voices.find((v) => (v.lang || '').toLowerCase().startsWith('ja'));
            if (ja) u.voice = ja;
            window.speechSynthesis.speak(u);
        } catch (err) {
            console.warn(`[${SCRIPT_ID}] web-speech fallback failed:`, err);
        }
    }

    // GM_xmlhttpRequest wrapper — used for DDG since the response must be readable
    // (fetch() would be CORS-blocked).
    function gmFetch(url, responseType, options) {
        const opts = options || {};
        return new Promise((resolve, reject) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    responseType,
                    timeout: opts.timeout || 15000,
                    headers: opts.headers,
                    onload: (r) => {
                        if (r.status >= 200 && r.status < 300) resolve(r);
                        else reject(new Error(`GM_xmlhttpRequest ${r.status} on ${url}`));
                    },
                    onerror: () => reject(new Error(`GM_xmlhttpRequest network error on ${url}`)),
                    ontimeout: () => reject(new Error(`GM_xmlhttpRequest timeout on ${url}`)),
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    // DuckDuckGo image search. Two-step protocol: first GET the search page to obtain
    // the `vqd` token, then call the i.js JSON endpoint with that token. Returns up to
    // 10 image URLs so the user can cycle through them with the refresh button.
    function fetchDdgImages(query) {
        const fullQuery = `${query} イラスト`;
        const tokenUrl = `${DDG_SEARCH_URL}?q=${encodeURIComponent(fullQuery)}&iax=images&ia=images`;
        return gmFetch(tokenUrl, '', { timeout: 10000 })
            .then((r) => {
                const m = (r.responseText || '').match(/vqd=["']?(\d-[\d-]+)/);
                if (!m) throw new Error('DDG: vqd token not found');
                const vqd = m[1];
                const url = `${DDG_IMAGES_URL}?l=us-en&o=json&q=${encodeURIComponent(fullQuery)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=-1`;
                return gmFetch(url, 'json', { timeout: 10000 });
            })
            .then((r) => {
                const data = r.response;
                if (!data || !Array.isArray(data.results)) throw new Error('DDG: no results array');
                return data.results
                    .map((x) => x.image || x.thumbnail)
                    .filter(Boolean)
                    .slice(0, 10);
            });
    }

    // Load DDG image URLs for a word (cached, 30d TTL). Always resolves — returns
    // [] on failure or empty response, so callers can blindly concatenate.
    function fetchDdgImagesCached(word) {
        if (!word) return Promise.resolve([]);
        const key = `${IMG_CACHE_PREFIX}${encodeURIComponent(word)}`;
        return wkof.file_cache
            .load(key)
            .then((entry) => {
                if (entry && typeof entry.fetchedAt === 'number' &&
                    Date.now() - entry.fetchedAt < IMG_CACHE_TTL_MS &&
                    Array.isArray(entry.urls)) {
                    return entry.urls;
                }
                throw new Error('img_cache_stale_or_old_format');
            })
            .catch(() => {
                return fetchDdgImages(word)
                    .then((urls) => {
                        wkof.file_cache
                            .save(key, { fetchedAt: Date.now(), urls })
                            .catch(() => {});
                        return urls || [];
                    })
                    .catch((err) => {
                        console.warn(`[${SCRIPT_ID}] DDG image fetch failed for "${word}":`, err);
                        // Negative-cache so we don't hammer DDG every render.
                        wkof.file_cache
                            .save(key, { fetchedAt: Date.now(), urls: [] })
                            .catch(() => {});
                        return [];
                    });
            });
    }

    // Resolve image #index from the combined pool:
    //   pool = [ikImageUrl (if non-null), ...fallback urls]
    // So index 0 is always the IK screenshot when one exists, with fallback
    // illustrations filling positions 1..N. When IK has no `image` field
    // (text-only sources), fallbacks occupy the whole pool starting at index 0.
    // Index wraps via modulo so the refresh button cycles forever.
    //
    // `serverFallbacks` (when non-null) is the array of CDN URLs the API
    // server pre-computed for this word — used in place of a DDG fetch so the
    // server path doesn't trigger any third-party network call. Direct-path
    // callers pass null and we fall through to fetchDdgImagesCached.
    //
    // Calls onSuccess(url, poolSize) or onError().
    function loadImageAt(word, ikImageUrl, index, onSuccess, onError, serverFallbacks) {
        const idx = Math.max(0, index | 0);
        const fallbacksFromServer = Array.isArray(serverFallbacks);
        const fallbackPromise = fallbacksFromServer
            ? Promise.resolve(serverFallbacks)
            : fetchDdgImagesCached(word);
        fallbackPromise.then((fallbackUrls) => {
            const pool = ikImageUrl ? [ikImageUrl, ...fallbackUrls] : fallbackUrls;
            if (pool.length === 0) {
                console.warn(`[${SCRIPT_ID}] image.pool empty`, { word, hasIk: !!ikImageUrl, fallbacksFrom: fallbacksFromServer ? 'server' : 'ddg' });
                onError && onError();
                return;
            }
            const wrappedIdx = idx % pool.length;
            const chosenIsIk = !!ikImageUrl && wrappedIdx === 0;
            console.log(`[${SCRIPT_ID}] image.pool`, {
                word,
                hasIk: !!ikImageUrl,
                fallbacks: fallbackUrls.length,
                fallbacksFrom: fallbacksFromServer ? 'server-cdn' : 'ddg',
                poolSize: pool.length,
                requestedIdx: index,
                wrappedIdx,
                chosen: chosenIsIk ? 'ik' : (fallbacksFromServer ? 'server-cdn' : 'ddg'),
            });
            onSuccess(pool[wrappedIdx], pool.length);
        });
    }

    function normalizeExamples(json) {
        // ImmersionKit v2 returns { examples: [...] } at top level; older shapes nest under `data`.
        if (Array.isArray(json && json.examples)) return json.examples;
        if (json && Array.isArray(json.data && json.data[0] && json.data[0].examples)) {
            return json.data[0].examples;
        }
        return [];
    }

    // Returns the encoded title for an IK example. `title` is the modern
    // field; `deck_name` is the legacy alias still emitted by some
    // versions of the IK API. Used as a lookup key for indexMeta and as
    // input to ikTitleToFolder / prettifyTitle.
    function getTitle(e) {
        return (e && (e.title || e.deck_name)) || '';
    }

    // Display form of IK's encoded title for the source-attribution line.
    // Prefers the canonical /index_meta mapping (e.g. "Durarara!!" preserves
    // the exclamation, "God's Blessing on this Wonderful World!" keeps the
    // apostrophe). Heuristic fallback handles cases where the map is missing
    // the title or hasn't loaded yet — same convention as ikTitleToFolder,
    // except the lone "x" Hunter × Hunter separator is dropped rather than
    // rendered as "×" so attribution lines read naturally.
    function prettifyTitle(title) {
        if (!title) return '';
        if (indexMeta === null) ensureIndexMeta();
        const fromMap = indexMeta && indexMeta[title];
        if (fromMap && fromMap.title) return fromMap.title;
        const tokens = decodeIkTitle(title).filter((tok) => tok !== 'x');
        return tokens
            .map((tok, i) => {
                if (i > 0 && tok.length <= 3 && /^[a-z]+$/.test(tok)) return tok;
                if (!/^[a-z]/i.test(tok)) return tok;
                return tok[0].toUpperCase() + tok.slice(1);
            })
            .join(' ');
    }
    // `requireAudio` is a sentence-source filter: we prefer IK examples that
    // came with original voice-actor audio (anime/drama/games scenes) over
    // text-only literature. When the example has audio, the player uses
    // the real recording (via IK proxy or pre-rendered server CDN URL);
    // when it doesn't, the player falls back to Google TTS.
    function hasOriginalAudio(e) {
        return !!(e && (e.sound || e.sound_url));
    }

    // Score an IK example by the hardest JLPT level among its identifiable
    // surrounding tokens. Returns 1–5 (5 = N5 easiest, 1 = N1 hardest), or
    // **0** as the "unknown" sentinel when no token could be classified —
    // typical for sentences of only conjugated verbs / particles that our
    // dictionary-form JLPT_VOCAB can't resolve. Consumers must distinguish
    // 0 from real scores: buildPool treats it as fail-open (passes any
    // ceiling) and the picker renders "?" instead of a misleading "N5".
    //
    // The target vocab word is excluded from scoring: every cached example
    // contains the target, so including it would make every sentence bottle-
    // neck at the target's own level (an N1 target would always score N1,
    // making the filter useless for that vocab). The score reflects the
    // *surrounding* difficulty only.
    function scoreJlpt(example, targetWord) {
        const tokens = (example && example.word_list) || [];
        let hardest = 6;
        let anyKnown = false;
        for (const tok of tokens) {
            if (!tok || tok === targetWord) continue;
            const lvl = JLPT_VOCAB[tok];
            if (typeof lvl !== 'number') continue;
            anyKnown = true;
            if (lvl < hardest) hardest = lvl;
        }
        return anyKnown ? hardest : 0;
    }

    // Map setting value ('any' | 'n5' | … | 'n1') to a ceiling number (0 means
    // no filter, 1..5 corresponds to N1..N5). 0 disables the filter entirely.
    function jlptCeilingNumber(setting) {
        if (!setting || setting === 'any') return 0;
        const m = /^n([1-5])$/i.exec(String(setting));
        return m ? parseInt(m[1], 10) : 0;
    }

    // Build the candidate pool for `pickExample` (and the sentence picker UI).
    // Applies the requireAudio filter, optionally the JLPT-ceiling filter, and
    // optionally the sentencePreference sort. Returns the filtered (and maybe
    // sorted) array — same IK-API object references as input. Each filter
    // step "falls back" to the unfiltered pool if it would empty the pool:
    // better to show some sentence than none.
    //
    // Options:
    //   applyCeiling (default true) — skip with false to include all entries
    //     regardless of jlptCeiling. The picker passes false so above-ceiling
    //     rows render faded but still clickable.
    //   skipSort (default false) — set true to leave entries in input order.
    //     The picker passes true so it can apply its own user-selected sort
    //     without buildPool's length sort fighting it.
    function buildPool(examples, prefs, options) {
        if (!examples || !examples.length) return [];
        let pool = examples.slice();
        if (prefs.requireAudio) {
            const withAudio = pool.filter(hasOriginalAudio);
            if (withAudio.length) pool = withAudio;
        }
        const applyCeiling = options ? options.applyCeiling !== false : true;
        if (applyCeiling) {
            const ceiling = jlptCeilingNumber(prefs.jlptCeiling);
            if (ceiling > 0) {
                const atOrBelow = pool.filter((e) => {
                    const lvl = typeof e._jlptMax === 'number' ? e._jlptMax : 0;
                    // 0 = unknown (no identifiable tokens) → fail-open, keep
                    // it in the pool. Without this a sentence of only
                    // conjugated verbs scores 0 and would be silently dropped.
                    return lvl === 0 || lvl >= ceiling;
                });
                if (atOrBelow.length) pool = atOrBelow;
            }
        }
        const skipSort = !!(options && options.skipSort);
        if (!skipSort) {
            // Compound sort: jlptPreferred matches first (when set), then
            // sentencePreference within each group. Stable JS sort means
            // ties preserve IK's original order. When neither preference is
            // set (preferred='any' and sentencePreference='first') we leave
            // the pool in IK's incoming order.
            const preferredLevel = jlptCeilingNumber(prefs.jlptPreferred);
            const lengthMode = prefs.sentencePreference;
            if (preferredLevel > 0 || lengthMode === 'shortest' || lengthMode === 'longest') {
                pool.sort((a, b) => {
                    if (preferredLevel > 0) {
                        const aMatch = a._jlptMax === preferredLevel;
                        const bMatch = b._jlptMax === preferredLevel;
                        if (aMatch !== bMatch) return aMatch ? -1 : 1;
                    }
                    if (lengthMode === 'shortest') {
                        return (a.sentence || '').length - (b.sentence || '').length;
                    }
                    if (lengthMode === 'longest') {
                        return (b.sentence || '').length - (a.sentence || '').length;
                    }
                    return 0;
                });
            }
        }
        return pool;
    }

    // Format a raw IK example into the shape renderCard consumes. Forwards
    // the server-path annotations (_prettyTitle, _serverAudioUrl,
    // _serverImageUrl, _serverFallbackImages) when present; direct-path
    // entries set them to null and the downstream code paths fall back to
    // their original behaviors (IK proxy URL build + DDG image fetch).
    function formatExample(e, poolSize) {
        const serverAudio = e._serverAudioUrl || null;
        const serverImage = e._serverImageUrl || null;
        return {
            sentence: e.sentence || '',
            sentence_with_furigana: e.sentence_with_furigana || '',
            translation: e.translation || '',
            title: getTitle(e),
            // Pre-compute the IK proxy URLs (null when any required field is missing).
            // resolveAudioBlobUrl uses ikAudioUrl as the primary source, falling back
            // to Google TTS on failure or absence. loadImageAt uses ikImageUrl as
            // image #0 in the pool, with DDG results filling positions 1..N.
            // When the entry came from the API server, prefer its pre-resolved
            // CDN URLs over the IK proxy.
            ikAudioUrl: serverAudio || buildIkAudioUrl(e),
            ikImageUrl: serverImage || buildIkImageUrl(e),
            poolSize,
            // Server-path passthroughs:
            _serverAudio: !!serverAudio,
            _serverImage: !!serverImage,
            _serverFallbackImages: e._serverFallbackImages || null,
            _prettyTitle: e._prettyTitle || '',
        };
    }

    // Pretty source-name for display. Prefers the server-resolved title when
    // available (avoids the lossy-encoding heuristic), falls back to the
    // direct-path prettifyTitle (which itself consults indexMeta + heuristic).
    function displayTitle(eOrRaw) {
        if (eOrRaw && eOrRaw._prettyTitle) return eOrRaw._prettyTitle;
        // `eOrRaw` here can be either a formatExample output (has `title`) or
        // a raw IK entry (has `title` or `deck_name`). getTitle handles both.
        return prettifyTitle(getTitle(eOrRaw));
    }

    let loggedRawExample = false;

    function pickExample(examples, prefs, index) {
        if (!examples || !examples.length) return null;

        // One-time debug: log a raw example so field names can be verified against the live API.
        if (!loggedRawExample && examples[0]) {
            loggedRawExample = true;
            console.log(`[${SCRIPT_ID}] raw IK example (first match):`, examples[0]);
        }

        const pool = buildPool(examples, prefs, {
            applyCeiling: !state.bypassCeilingForCurrentSubject,
        });
        if (!pool.length) return null;
        const idx = Math.max(0, index | 0) % pool.length;
        const e = pool[idx];
        if (!e) return null;
        return formatExample(e, pool.length);
    }

    // ---------- Render ----------

    function renderCard(example) {
        removeCard();
        const prefs = settings();
        const target = state.currentCharacters || '';

        const card = document.createElement('aside');
        card.className = CARD_CLASS;
        // Initialize as already-revealed when we're rendering for a subject
        // whose meaning question the user has already answered in this session
        // (shuffled mode can interleave other subjects between the two
        // questions of one subject — see state.subjectProgress).
        card.setAttribute('data-revealed', state.meaningAnswered ? 'true' : 'false');

        // LEFT panel: sentence (always visible) + play/refresh controls + translation
        // (revealed) + source attribution. Sits to the left of the vocab character.
        const leftPanel = document.createElement('div');
        leftPanel.className = `${CSS_PREFIX}-left`;

        const sentenceEl = document.createElement('div');
        sentenceEl.className = `${CSS_PREFIX}-sentence`;
        sentenceEl.setAttribute('lang', 'ja');
        applyFuriganaState(sentenceEl, example);
        leftPanel.appendChild(sentenceEl);

        const leftControls = document.createElement('div');
        leftControls.className = `${CSS_PREFIX}-left-controls`;

        // Audio: layered sources via resolveAudioBlobUrl. On the server path the
        // example carries a pre-resolved CDN URL (IK voice-actor recording or
        // pre-rendered TTS) that the browser plays directly. On the direct
        // path we hit the IK download_media proxy (real human audio when
        // available) via GM_xmlhttpRequest with a Referer spoof, then fall
        // through to Google Translate TTS (similar spoof — Google rejects
        // wanikani.com origin via direct <audio>). Both blob fetches feed an
        // object-URL into the <audio> element. Web Speech (Kyoko on macOS)
        // is the last-resort fallback if every blob source fails.
        if (example.sentence) {
            const audio = document.createElement('audio');
            // preload='auto' so once the blob URL is attached the audio element
            // decodes immediately — eliminates the ~tens-of-ms decode delay on
            // play() when the user answers quickly. The actual network fetch
            // for IK / TTS audio is already kicked off below (via
            // resolveAudioBlobUrl), so this only affects the decode step.
            audio.preload = 'auto';
            // User-configurable playback speed (0.5x — 1.25x). Set on the
            // element before src so the rate is already in place by the time
            // the blob URL attaches; the rate persists across .play() calls
            // and isn't reset on currentTime=0 (verified in HTMLMediaElement
            // spec). Re-reading settings() on every render means changing the
            // setting takes effect on the next card.
            audio.playbackRate = parseFloat(settings().playbackRate) || 1.0;
            audio.style.display = 'none';
            card.appendChild(audio);

            // Kick off the audio fetch right away. Tries IK proxy first (real human
            // audio when available), falls back to Google TTS, with Web Speech as the
            // last-resort fallback if both blob fetches fail. The blob URL will be
            // ready by the time the user clicks Play (or revealAll auto-plays).
            const audioPromise = resolveAudioBlobUrl(example)
                .then((blobUrl) => {
                    audio.src = blobUrl;
                    // Revoke the blob URL when the card is replaced (in removeCard).
                    card._blobUrl = blobUrl;
                    return true;
                })
                .catch((err) => {
                    console.warn(`[${SCRIPT_ID}] all blob audio sources failed, will use Web Speech:`, err);
                    return false;
                });

            const playSentence = () => {
                audioPromise.then((ok) => {
                    if (ok && audio.src) {
                        audio.currentTime = 0;
                        audio.play().catch((err) => {
                            console.warn(`[${SCRIPT_ID}] audio.play failed, falling back to Web Speech:`, err);
                            speakWithWebSpeech(example.sentence);
                        });
                    } else {
                        speakWithWebSpeech(example.sentence);
                    }
                });
            };

            const btn = document.createElement('button');
            btn.className = `${CSS_PREFIX}-audio`;
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Play sentence audio');
            btn.textContent = '▶ Play';
            btn.addEventListener('click', playSentence);
            leftControls.appendChild(btn);

            // Store hook for autoplay on reveal.
            card._play = playSentence;
        }

        // ふ furigana toggle. Only attached when the example actually has parseable
        // furigana data (no point showing a perpetually-disabled button otherwise).
        // The button stays disabled until the reading question for this subject
        // is graded — revealAll flips disabled=false and calls applyFuriganaState.
        // Click handler toggles state.furiganaVisible and hands off to
        // applyFuriganaState, which usually just flips a CSS class (no re-render)
        // because the ruby DOM is already in place. See that function's header
        // for why the DOM is pre-rendered.
        const hasFurigana = !!parseFurigana(example.sentence_with_furigana);
        if (hasFurigana) {
            const furiganaBtn = document.createElement('button');
            furiganaBtn.className = `${CSS_PREFIX}-furigana-toggle`;
            furiganaBtn.type = 'button';
            furiganaBtn.textContent = 'ふ';
            furiganaBtn.disabled = !state.readingAnswered;
            furiganaBtn.setAttribute('aria-pressed', String(!!state.furiganaVisible));
            furiganaBtn.setAttribute(
                'aria-label',
                state.readingAnswered ? 'Toggle furigana' : 'Furigana (unlocks after reading is graded)'
            );
            furiganaBtn.title = state.readingAnswered
                ? (state.furiganaVisible ? 'Hide furigana' : 'Show furigana')
                : 'Furigana unlocks after you submit the reading';
            furiganaBtn.addEventListener('click', () => {
                if (!state.readingAnswered) return;
                state.furiganaVisible = !state.furiganaVisible;
                furiganaBtn.setAttribute('aria-pressed', String(state.furiganaVisible));
                furiganaBtn.title = state.furiganaVisible ? 'Hide furigana' : 'Show furigana';
                applyFuriganaState(card.querySelector(`.${CSS_PREFIX}-sentence`), card._example);
            });
            leftControls.appendChild(furiganaBtn);
            card._furiganaBtn = furiganaBtn;
        }

        // Stash the example on the card so revealAll / applyFuriganaState can
        // pick it up later without needing to thread it through state.
        card._example = example;

        const sentenceRefreshBtn = document.createElement('button');
        sentenceRefreshBtn.className = `${CSS_PREFIX}-refresh-sentence`;
        sentenceRefreshBtn.type = 'button';
        sentenceRefreshBtn.title = 'Get a different sentence. Right-click or long-press to pick from list.';
        sentenceRefreshBtn.setAttribute('aria-label', 'Get a different sentence');
        const sIcon = document.createElement('span');
        sIcon.textContent = '⟳';
        sentenceRefreshBtn.appendChild(sIcon);
        // Click cycles to the next sentence. Right-click or long-press (≥400ms)
        // opens the sentence picker overlay. After a long-press fires, any
        // click within the next ~500ms is suppressed so the pointer-release
        // doesn't also advance the cycle. We use a timestamp (vs. a boolean
        // flag) so the suppression naturally expires — a flag would get stuck
        // true if the user releases over the picker overlay instead of the
        // button (no click event fires to reset it), causing the next genuine
        // click to be silently swallowed.
        let longPressTimer = null;
        let lastLongPressAt = 0;
        const LONG_PRESS_MS = 400;
        const CLICK_SUPPRESS_WINDOW_MS = 500;
        const clearLongPress = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };
        sentenceRefreshBtn.addEventListener('click', (ev) => {
            if (Date.now() - lastLongPressAt < CLICK_SUPPRESS_WINDOW_MS) {
                ev.preventDefault();
                ev.stopPropagation();
                return;
            }
            refreshSentence();
        });
        sentenceRefreshBtn.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            clearLongPress();
            showSentencePicker();
        });
        sentenceRefreshBtn.addEventListener('pointerdown', (ev) => {
            // Only main button (left mouse / touch / pen). Right-click is
            // already handled via contextmenu above.
            if (ev.button !== 0) return;
            clearLongPress();
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                lastLongPressAt = Date.now();
                showSentencePicker();
            }, LONG_PRESS_MS);
        });
        sentenceRefreshBtn.addEventListener('pointerup', clearLongPress);
        sentenceRefreshBtn.addEventListener('pointerleave', clearLongPress);
        sentenceRefreshBtn.addEventListener('pointercancel', clearLongPress);
        leftControls.appendChild(sentenceRefreshBtn);

        leftPanel.appendChild(leftControls);

        const translationEl = document.createElement('div');
        translationEl.className = `${CSS_PREFIX}-translation`;
        translationEl.textContent = example.translation || '';
        // Hidden until the meaning question is answered (the translation IS
        // the answer to that question — would spoil otherwise). Pre-revealed
        // when re-rendering a subject whose meaning has already been graded.
        translationEl.hidden = !state.meaningAnswered;
        leftPanel.appendChild(translationEl);

        if (example.title || example._prettyTitle) {
            const src = document.createElement('div');
            src.className = `${CSS_PREFIX}-source`;
            src.textContent = `— ${displayTitle(example)}`;
            leftPanel.appendChild(src);
        }

        card.appendChild(leftPanel);

        // RIGHT panel: image (hidden until reveal). Sits to the right of the vocab
        // character. DDG search for "<word> イラスト" (illustration); imageIdx cycles
        // through up to 10 cached results per word.
        if (prefs.showImage && target) {
            const rightPanel = document.createElement('div');
            rightPanel.className = `${CSS_PREFIX}-right`;

            const fig = document.createElement('figure');
            fig.className = `${CSS_PREFIX}-image`;
            // Hidden until the meaning question is answered (same gating as
            // the translation — they're both English-side spoilers). Pre-
            // revealed when re-rendering a subject whose meaning has already
            // been graded earlier in this session.
            fig.hidden = !state.meaningAnswered;
            const img = document.createElement('img');
            img.alt = '';
            // Deliberately NOT loading="lazy" — the figure is hidden until
            // reveal, and with lazy loading the browser would skip the network
            // request entirely until the figure becomes visible, producing a
            // ~hundreds-of-ms delay between answer and image showing up.
            // Eager (the default) ensures the image is downloading the moment
            // src is set, so by reveal time it's already in cache.
            img.decoding = 'async';
            // Click anywhere on the image to open it in a fullscreen modal.
            // The refresh button overlays the image but stops propagation so
            // ⟳ doesn't also pop the modal.
            img.addEventListener('click', () => {
                if (img.src) showImageModal(img.src);
            });
            fig.appendChild(img);

            const imageRefreshBtn = document.createElement('button');
            imageRefreshBtn.className = `${CSS_PREFIX}-refresh-image`;
            imageRefreshBtn.type = 'button';
            imageRefreshBtn.title = 'Get a different image';
            imageRefreshBtn.setAttribute('aria-label', 'Get a different image');
            const iIcon = document.createElement('span');
            iIcon.textContent = '⟳';
            imageRefreshBtn.appendChild(iIcon);
            imageRefreshBtn.addEventListener('click', (e) => {
                // Don't bubble — the parent figure has a click handler that
                // pops the fullscreen modal; refresh shouldn't also do that.
                e.stopPropagation();
                refreshImage();
            });
            fig.appendChild(imageRefreshBtn);

            rightPanel.appendChild(fig);
            card.appendChild(rightPanel);

            // Auto-fallback: if the resolved URL itself 404s/empties out (typical
            // failure mode for the IK proxy when a sentence has no screenshot
            // server-side), silently advance through the pool. Bounded by attempts
            // so we don't spin forever when every URL is broken.
            const tryLoadAt = (idx, attemptsLeft) => {
                if (attemptsLeft <= 0) { fig.remove(); return; }
                loadImageAt(
                    target,
                    example.ikImageUrl,
                    idx,
                    (url, poolSize) => {
                        img.src = url;
                        img.onerror = () => {
                            if (poolSize <= 1) {
                                fig.remove();
                            } else {
                                console.warn(`[${SCRIPT_ID}] image idx ${idx} failed to load; trying ${idx + 1}`);
                                tryLoadAt(idx + 1, attemptsLeft - 1);
                            }
                        };
                    },
                    () => fig.remove(),
                    example._serverFallbackImages
                );
            };
            tryLoadAt(state.imageIdx || 0, 3);
        }

        attachCardToDom(card);
        state.cardEl = card;
    }

    // Parse IK's bracket-format furigana string (e.g. "今日[きょう]は晴[は]れて")
    // into a flat segment array: [{kanji, reading} | {text}, ...]. The base string
    // (kanji + text concatenated, no readings) must equal the plain `sentence`
    // field — callers rely on that to align with target-word marking.
    //
    // Returns null when the input is empty or contains no bracket pairs — caller
    // should fall back to plain text rendering in that case.
    function parseFurigana(str) {
        if (!str || typeof str !== 'string') return null;
        // CJK Unified Ideographs + Ext A + 々 (iteration) + ヶ (counter-context kanji surrogate).
        // Avoid \p{Script=Han} for Tampermonkey/older-engine safety.
        const re = /([一-鿿㐀-䶿々ヶ]+)\[([^\]]+)\]/g;
        const segments = [];
        let lastIndex = 0;
        let match;
        while ((match = re.exec(str)) !== null) {
            if (match.index > lastIndex) {
                segments.push({ text: str.slice(lastIndex, match.index) });
            }
            segments.push({ kanji: match[1], reading: match[2] });
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < str.length) {
            segments.push({ text: str.slice(lastIndex) });
        }
        if (!segments.some((s) => 'kanji' in s)) return null;
        return segments;
    }

    // Render the example sentence into `container`, optionally with furigana
    // (ruby/rt) markup and with the target vocab word wrapped in <mark>. Furigana
    // is suppressed inside the mark — even after reveal we never display the
    // reading of the actual word being tested.
    //
    // Falls back to the plain-text branch when:
    //   * caller asked for no furigana (gating logic in revealAll / settings),
    //   * the IK example has no sentence_with_furigana field, or
    //   * the parser found no kanji-bracket pairs.
    function renderSentence(container, sentence, sentenceWithFurigana, target, withFurigana) {
        container.textContent = ''; // clear
        const segments = withFurigana ? parseFurigana(sentenceWithFurigana) : null;
        if (!segments) {
            renderSentencePlain(container, sentence, target);
            return;
        }

        // Locate the target word in the plain-text concatenation of segments.
        // If the segment base doesn't exactly reconstruct `sentence` we still
        // proceed — we just match against the base string we actually have.
        const baseChars = segments.map((s) => 'kanji' in s ? s.kanji : s.text).join('');
        const markStart = (target && baseChars.includes(target)) ? baseChars.indexOf(target) : -1;
        const markEnd = markStart === -1 ? -1 : markStart + target.length;

        let offset = 0;
        let markEl = null;
        const closeMark = () => {
            if (markEl) {
                container.appendChild(markEl);
                markEl = null;
            }
        };

        for (const seg of segments) {
            const segLen = ('kanji' in seg) ? seg.kanji.length : seg.text.length;
            const segStart = offset;
            const segEnd = offset + segLen;
            offset = segEnd;

            const insideMark = markStart !== -1 && segStart < markEnd && segEnd > markStart;

            if ('kanji' in seg) {
                // Kanji segments are atomic — splitting them would break the
                // kanji-reading pairing. If any part of the segment falls inside
                // the mark range we include the whole segment in the mark, with
                // its <rt> suppressed.
                const node = document.createElement('ruby');
                node.appendChild(document.createTextNode(seg.kanji));
                if (!insideMark) {
                    const rt = document.createElement('rt');
                    rt.textContent = seg.reading;
                    node.appendChild(rt);
                }
                appendToTarget(node, insideMark);
            } else {
                // Text segments are plain — safe to split at the mark boundaries
                // so the highlight aligns precisely with target_word characters.
                const text = seg.text;
                if (markStart === -1 || segEnd <= markStart || segStart >= markEnd) {
                    appendToTarget(document.createTextNode(text), false);
                } else {
                    // Segment overlaps the mark range. Split into up-to-three pieces.
                    const localMarkStart = Math.max(markStart - segStart, 0);
                    const localMarkEnd = Math.min(markEnd - segStart, text.length);
                    if (localMarkStart > 0) {
                        appendToTarget(document.createTextNode(text.slice(0, localMarkStart)), false);
                    }
                    appendToTarget(document.createTextNode(text.slice(localMarkStart, localMarkEnd)), true);
                    if (localMarkEnd < text.length) {
                        appendToTarget(document.createTextNode(text.slice(localMarkEnd)), false);
                    }
                }
            }
        }
        closeMark();

        function appendToTarget(node, intoMark) {
            if (intoMark) {
                if (!markEl) {
                    markEl = document.createElement('mark');
                    markEl.className = `${CSS_PREFIX}-target`;
                }
                markEl.appendChild(node);
            } else {
                closeMark();
                container.appendChild(node);
            }
        }
    }

    function renderSentencePlain(container, sentence, target) {
        if (!target || !sentence.includes(target)) {
            container.textContent = sentence;
            return;
        }
        const parts = sentence.split(target);
        parts.forEach((part, idx) => {
            if (part) container.appendChild(document.createTextNode(part));
            if (idx < parts.length - 1) {
                const mark = document.createElement('mark');
                mark.className = `${CSS_PREFIX}-target`;
                mark.textContent = target;
                container.appendChild(mark);
            }
        });
    }

    // Render the sentence into `sentenceEl` AND synchronize the ふ-visibility
    // state. Called from renderCard (initial draw), revealAll (reading branch),
    // and the ふ button click handler — one entry point so the gating logic
    // lives in one place.
    //
    // Two modes depending on the showFurigana setting:
    //
    //   * Setting ON  → always emit <ruby><rt> for every kanji, regardless of
    //     whether the reading has been graded. The rt characters stay invisible
    //     via CSS (visibility:hidden on rt) until the .wk-ik-show-furigana
    //     class is added on reveal. Result: the kanji line reserves its full
    //     final height from the moment the card renders, so revealing the
    //     furigana doesn't bump the sentence. Toggling ふ on/off after reveal
    //     is also a pure class flip — no DOM rebuild, no jump.
    //
    //   * Setting OFF → emit plain text by default. If the user explicitly
    //     toggles ふ on for this card (and the reading is graded) we re-render
    //     with ruby DOM, which DOES cause a one-time layout shift. Accepted
    //     tradeoff: not reserving the rt space on every card preserves the
    //     minimal look for users who opted out.
    //
    // To avoid wasted DOM churn in the common "setting on, ふ toggle pressed"
    // path (where emitRuby doesn't actually change), we stash the previous
    // emitRuby state on the element and skip the renderSentence call when it
    // matches — turning the visible work into just a classList.toggle.
    function applyFuriganaState(sentenceEl, example) {
        if (!sentenceEl || !example) return;
        const hasFurigana = !!parseFurigana(example.sentence_with_furigana);
        const settingOn = !!settings().showFurigana;
        const showNow = !!(state.furiganaVisible && state.readingAnswered);
        const emitRuby = hasFurigana && (settingOn || showNow);

        const prevEmit = sentenceEl.dataset.wkIkEmitRuby === 'true';
        if (prevEmit !== emitRuby || !sentenceEl.firstChild) {
            renderSentence(
                sentenceEl,
                example.sentence,
                example.sentence_with_furigana,
                state.currentCharacters || '',
                emitRuby
            );
            sentenceEl.dataset.wkIkEmitRuby = String(emitRuby);
        }
        sentenceEl.classList.toggle(`${CSS_PREFIX}-show-furigana`, emitRuby && showNow);
    }

    // ---------- Sentence picker ----------

    // Open the picker overlay listing all IK candidates for the current word.
    // Triggered by right-click or long-press on the ⟳ sentence button. Cache
    // is already hot by the time the user can interact (renderCard requires
    // cached examples), so getExamples here is a synchronous-feeling read.
    function showSentencePicker() {
        const word = state.currentCharacters;
        if (!word) return;
        getExamples(word).then((cached) => {
            if (!cached || !cached.raw || !cached.raw.length) return;
            // Subject may have changed between trigger and resolve — abort
            // if so, the new card's picker (if any) supersedes this.
            if (state.currentCharacters !== word) return;
            renderSentencePickerOverlay(cached.raw, word);
        });
    }

    // Page size for the paginated picker. With ~70vh dialog cap and ~70px per
    // row this gives one full page on most laptops without inner scrolling;
    // larger pools surface via the prev/next buttons.
    const PICKER_PAGE_SIZE = 25;

    // Sort options offered by the picker dropdown. `cmp` is null for "leave
    // in pool order" — the picker calls buildPool with skipSort: true, so
    // "default" means IK's original order, not the buildPool compound sort.
    // jlptSortKey treats 0 (unknown) as "infinity hard" so easy-first sorts
    // don't pull unknown rows to the top — those go to the bottom instead.
    //
    // Returned as a function (not a const) so the "Preferred JLPT (NX) first"
    // entry can carry a dynamic label and comparator bound to the user's
    // current jlptPreferred setting. When jlptPreferred='any' the entry is
    // omitted entirely.
    function getPickerSorts(prefs) {
        const preferredLevel = jlptCeilingNumber(prefs.jlptPreferred);
        const sorts = {
            default: { label: 'Default order', cmp: null },
        };
        if (preferredLevel > 0) {
            sorts.preferred = {
                label: `Preferred JLPT (N${preferredLevel}) first`,
                cmp: (a, b) => {
                    const aMatch = a._jlptMax === preferredLevel;
                    const bMatch = b._jlptMax === preferredLevel;
                    if (aMatch !== bMatch) return aMatch ? -1 : 1;
                    return 0;
                },
            };
        }
        sorts.shortest = {
            label: 'Sentence length (short → long)',
            cmp: (a, b) => (a.sentence || '').length - (b.sentence || '').length,
        };
        sorts.longest = {
            label: 'Sentence length (long → short)',
            cmp: (a, b) => (b.sentence || '').length - (a.sentence || '').length,
        };
        sorts.jlpt_easy = {
            label: 'JLPT level (easy → hard)',
            cmp: (a, b) => jlptSortKey(b) - jlptSortKey(a),
        };
        sorts.jlpt_hard = {
            label: 'JLPT level (hard → easy)',
            cmp: (a, b) => jlptSortKey(a) - jlptSortKey(b),
        };
        sorts.source = {
            label: 'Source name (A → Z)',
            cmp: (a, b) => (displayTitle(a) || '').localeCompare(displayTitle(b) || ''),
        };
        return sorts;
    }

    function jlptSortKey(e) {
        const lvl = typeof e._jlptMax === 'number' ? e._jlptMax : 0;
        // For easy-first sorts: known levels rank by their number (5=easy
        // first, 1=hard last); unknown (0) sinks to the very bottom so we
        // don't misrepresent unscored sentences as easy.
        return lvl === 0 ? -1 : lvl;
    }

    function renderSentencePickerOverlay(raw, word) {
        closeSentencePicker(); // tear down any existing overlay first
        const prefs = settings();
        const ceiling = jlptCeilingNumber(prefs.jlptCeiling);

        // Full unfiltered pool: every candidate IK has, with audio filter
        // applied but no JLPT filter and no buildPool sort (the picker
        // controls its own sort below). Above-ceiling rows still render here
        // — they're faded but clickable.
        const fullPool = buildPool(raw, prefs, { applyCeiling: false, skipSort: true });
        // Active pool reflects what the card is currently rendering (bypass
        // flag taken into account) — used only to compute the "current"
        // entry for highlighting in the picker list.
        const activePool = buildPool(raw, prefs, {
            applyCeiling: !state.bypassCeilingForCurrentSubject,
        });
        const currentExample = activePool.length
            ? activePool[((state.sentenceIdx || 0) % activePool.length + activePool.length) % activePool.length]
            : null;

        // Sort options available in this dropdown depend on whether the
        // user has set jlptPreferred — when set, the menu includes a
        // "Preferred JLPT (NX) first" entry that's also the initial sort.
        const sortOptions = getPickerSorts(prefs);
        const preferredLevel = jlptCeilingNumber(prefs.jlptPreferred);
        const initialSortKey = preferredLevel > 0 ? 'preferred' : 'default';

        // Local picker state. Resets every time the picker opens; sort and
        // page do not persist across opens.
        const pickerState = {
            sortKey: initialSortKey,
            sortedPool: (() => {
                const cmp = sortOptions[initialSortKey] && sortOptions[initialSortKey].cmp;
                return cmp ? fullPool.slice().sort(cmp) : fullPool.slice();
            })(),
            page: 0,
        };

        const overlay = document.createElement('div');
        overlay.className = `${CSS_PREFIX}-picker`;

        const panel = document.createElement('div');
        panel.className = `${CSS_PREFIX}-picker-panel`;
        panel.addEventListener('click', (ev) => ev.stopPropagation());

        const header = document.createElement('div');
        header.className = `${CSS_PREFIX}-picker-header`;

        const titleRow = document.createElement('div');
        titleRow.className = `${CSS_PREFIX}-picker-title-row`;

        const title = document.createElement('div');
        title.className = `${CSS_PREFIX}-picker-title`;
        title.textContent = `Pick a sentence for ${word} · ${fullPool.length} candidate${fullPool.length === 1 ? '' : 's'}`;
        titleRow.appendChild(title);

        const sortWrap = document.createElement('label');
        sortWrap.className = `${CSS_PREFIX}-picker-sort-wrap`;
        const sortLabel = document.createElement('span');
        sortLabel.textContent = 'Sort: ';
        sortWrap.appendChild(sortLabel);
        const sortSelect = document.createElement('select');
        sortSelect.className = `${CSS_PREFIX}-picker-sort`;
        for (const [k, v] of Object.entries(sortOptions)) {
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = v.label;
            if (k === initialSortKey) opt.selected = true;
            sortSelect.appendChild(opt);
        }
        sortWrap.appendChild(sortSelect);
        titleRow.appendChild(sortWrap);

        header.appendChild(titleRow);

        if (ceiling > 0) {
            const note = document.createElement('div');
            note.className = `${CSS_PREFIX}-picker-note`;
            note.textContent = `Faded entries are above your JLPT ceiling (N${ceiling}). Click to view anyway.`;
            header.appendChild(note);
        }
        panel.appendChild(header);

        const list = document.createElement('div');
        list.className = `${CSS_PREFIX}-picker-list`;
        panel.appendChild(list);

        const footer = document.createElement('div');
        footer.className = `${CSS_PREFIX}-picker-footer`;

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = `${CSS_PREFIX}-picker-page-btn`;
        prevBtn.textContent = '← Prev';

        const pageLabel = document.createElement('span');
        pageLabel.className = `${CSS_PREFIX}-picker-page-label`;

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = `${CSS_PREFIX}-picker-page-btn`;
        nextBtn.textContent = 'Next →';

        footer.appendChild(prevBtn);
        footer.appendChild(pageLabel);
        footer.appendChild(nextBtn);
        panel.appendChild(footer);

        overlay.appendChild(panel);

        function renderList() {
            list.innerHTML = '';
            const total = pickerState.sortedPool.length;
            const totalPages = Math.max(1, Math.ceil(total / PICKER_PAGE_SIZE));
            pickerState.page = Math.max(0, Math.min(pickerState.page, totalPages - 1));
            const start = pickerState.page * PICKER_PAGE_SIZE;
            const end = Math.min(start + PICKER_PAGE_SIZE, total);

            for (let i = start; i < end; i++) {
                const e = pickerState.sortedPool[i];
                list.appendChild(buildPickerRow(e, i, currentExample, ceiling, raw, prefs));
            }

            prevBtn.disabled = pickerState.page === 0;
            nextBtn.disabled = pickerState.page >= totalPages - 1;
            pageLabel.textContent = total
                ? `${start + 1}–${end} of ${total}   ·   Page ${pickerState.page + 1} / ${totalPages}`
                : 'No candidates';
            list.scrollTop = 0;
        }

        function applySort(key) {
            const cmp = sortOptions[key] && sortOptions[key].cmp;
            pickerState.sortKey = key;
            pickerState.sortedPool = cmp ? fullPool.slice().sort(cmp) : fullPool.slice();
            pickerState.page = 0;
            renderList();
        }

        sortSelect.addEventListener('change', () => applySort(sortSelect.value));
        prevBtn.addEventListener('click', () => {
            if (pickerState.page > 0) {
                pickerState.page--;
                renderList();
            }
        });
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(pickerState.sortedPool.length / PICKER_PAGE_SIZE);
            if (pickerState.page < totalPages - 1) {
                pickerState.page++;
                renderList();
            }
        });

        overlay.addEventListener('click', () => closeSentencePicker());

        const onKey = (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                closeSentencePicker();
            }
        };
        document.addEventListener('keydown', onKey, true);

        state.pickerEl = overlay;
        state.pickerKeyHandler = onKey;

        document.body.appendChild(overlay);
        renderList();
    }

    // Build a single row in the picker list. Factored out so renderList can
    // call it inside its slice loop without 80 lines of inline DOM.
    function buildPickerRow(e, absoluteIdx, currentExample, ceiling, raw, prefs) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `${CSS_PREFIX}-picker-row`;
        if (e === currentExample) row.classList.add('current');

        const lvl = typeof e._jlptMax === 'number' ? e._jlptMax : 0;
        const exceedsCeiling = ceiling > 0 && lvl > 0 && lvl < ceiling;
        if (exceedsCeiling) {
            row.classList.add('above-ceiling');
            row.title = `Hardest known word ≈ N${lvl}, above your N${ceiling} ceiling.`;
        }

        const num = document.createElement('span');
        num.className = `${CSS_PREFIX}-picker-num`;
        // 1-based number across the whole sorted pool, not page-local — so
        // the user sees stable positions regardless of pagination.
        num.textContent = `${absoluteIdx + 1}.`;
        row.appendChild(num);

        const main = document.createElement('span');
        main.className = `${CSS_PREFIX}-picker-main`;

        const text = document.createElement('span');
        text.className = `${CSS_PREFIX}-picker-text`;
        text.setAttribute('lang', 'ja');
        text.textContent = e.sentence || '';
        main.appendChild(text);

        if (e.translation) {
            const tr = document.createElement('span');
            tr.className = `${CSS_PREFIX}-picker-translation`;
            tr.textContent = e.translation;
            main.appendChild(tr);
        }
        row.appendChild(main);

        const meta = document.createElement('span');
        meta.className = `${CSS_PREFIX}-picker-meta`;

        const badge = document.createElement('span');
        badge.className = `${CSS_PREFIX}-picker-badge`;
        if (lvl >= 1 && lvl <= 5) {
            badge.classList.add(`lvl-n${lvl}`);
            badge.textContent = `N${lvl}`;
            badge.title = `Hardest identifiable word in this sentence is JLPT N${lvl}`;
        } else {
            badge.classList.add('lvl-unknown');
            badge.textContent = '?';
            badge.title = 'No tokens in this sentence are in our JLPT lookup (mostly inflected verbs / proper nouns) — actual difficulty unknown';
        }
        meta.appendChild(badge);

        const srcText = displayTitle(e);
        if (srcText) {
            const src = document.createElement('span');
            src.className = `${CSS_PREFIX}-picker-source`;
            src.textContent = srcText;
            meta.appendChild(src);
        }
        row.appendChild(meta);

        row.addEventListener('click', () => onPickerEntryClick(e, raw, prefs));
        return row;
    }

    function onPickerEntryClick(entry, raw, prefs) {
        const ceiling = jlptCeilingNumber(prefs.jlptCeiling);
        const lvl = typeof entry._jlptMax === 'number' ? entry._jlptMax : 5;
        const exceedsCeiling = ceiling > 0 && lvl < ceiling;

        // Match the bypass flag to the chosen entry's relationship to the
        // ceiling. Picking an in-ceiling entry clears any prior bypass —
        // the user signaled "back to normal mode." Picking an above-ceiling
        // entry sets it so the ⟳ cycle stays in the broader pool too.
        state.bypassCeilingForCurrentSubject = exceedsCeiling;

        const nextPool = buildPool(raw, prefs, { applyCeiling: !exceedsCeiling });
        const newIdx = nextPool.indexOf(entry);
        state.sentenceIdx = Math.max(0, newIdx);
        // New sentence → reset image cycle so its IK screenshot becomes the
        // default (same rule as the ⟳ refresh button).
        state.imageIdx = 0;
        persistCurrentSelection();
        closeSentencePicker();
        refreshCardForCurrentSubject();
    }

    function closeSentencePicker() {
        if (state.pickerEl) {
            state.pickerEl.remove();
            state.pickerEl = null;
        }
        if (state.pickerKeyHandler) {
            document.removeEventListener('keydown', state.pickerKeyHandler, true);
            state.pickerKeyHandler = null;
        }
    }

    // Open the given image URL in a fullscreen overlay. Click the backdrop
    // (anywhere) or press Escape to close. Only one modal at a time — if one
    // is already open we replace it (rapid clicks shouldn't stack overlays).
    function showImageModal(src) {
        const existing = document.querySelector('.' + `${CSS_PREFIX}-modal`);
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = `${CSS_PREFIX}-modal`;
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        modal.appendChild(img);

        const close = () => {
            modal.remove();
            document.removeEventListener('keydown', onKey, true);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                // Capture phase + preventDefault so WK's own input handlers
                // (which may also react to Escape) don't see the keystroke.
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        };
        modal.addEventListener('click', close);
        document.addEventListener('keydown', onKey, true);

        document.body.appendChild(modal);
    }

    // Placeholder card shown between subject change and IK fetch completion.
    // Replaced in place by renderCard / renderEmptyCard once getExamples
    // resolves — both call removeCard at the top, so this is just a "something
    // is loading" hint that fills the otherwise-empty card area for ~100-500ms.
    function renderLoadingCard() {
        removeCard();
        const card = document.createElement('aside');
        card.className = `${CARD_CLASS} ${CSS_PREFIX}-loading`;
        const spinner = document.createElement('div');
        spinner.className = `${CSS_PREFIX}-spinner`;
        spinner.setAttribute('aria-label', 'Loading example sentence');
        card.appendChild(spinner);
        attachCardToDom(card);
        state.cardEl = card;
    }

    function renderEmptyCard() {
        removeCard();
        const card = document.createElement('aside');
        card.className = `${CARD_CLASS} ${CSS_PREFIX}-empty`;
        card.textContent = 'No example found.';
        attachCardToDom(card);
        state.cardEl = card;
        // No auto-remove timer: removing the empty card would also strip our
        // host styling (via the old coupling) and visibly reset the header to
        // its default WK height. The message is small and tucked into the
        // bottom-left corner of the expanded purple area; it stays until the
        // next subject loads.
    }

    // Apply / clear the host styling (min-height + position:relative + character
    // centering) to .character-header. These are decoupled from card lifecycle:
    // we call applyHostStyling() the moment we identify a vocab subject (BEFORE
    // the IK fetch completes) so the header doesn't visibly collapse and
    // re-expand on every new word. clearHostStyling() runs on non-vocab subjects
    // and on teardown. Idempotent — safe to call repeatedly.
    function applyHostStyling() {
        const header = document.querySelector('.character-header');
        if (!header) return null;
        if (!header.classList.contains(`${CSS_PREFIX}-host`)) {
            header.classList.add(`${CSS_PREFIX}-host`);
            header.style.minHeight = '280px';
        }
        state.hostEl = header;
        return header;
    }

    function clearHostStyling() {
        if (state.hostEl) {
            state.hostEl.classList.remove(`${CSS_PREFIX}-host`);
            state.hostEl.style.minHeight = '';
            state.hostEl = null;
        }
    }

    function attachCardToDom(card) {
        // Defensive sweep — removes any stale cards left over from Turbo bfcache
        // restoration before we attach the new one.
        document.querySelectorAll('.' + CARD_CLASS).forEach((el) => {
            if (el !== card) el.remove();
        });

        // Preferred home: inside the purple character header at the top of the
        // review page. Host styling is already in place (applied eagerly on
        // subject change); we just append the card here.
        const header = applyHostStyling();
        if (header) {
            header.appendChild(card);
            return;
        }

        // Fallback: insert near the quiz input if the header isn't there yet.
        const anchor =
            document.querySelector('.quiz-input') ||
            document.querySelector('#additional-content') ||
            document.querySelector('.additional-content') ||
            document.querySelector('.quiz') ||
            document.body;

        if (anchor && anchor.parentNode && anchor !== document.body) {
            anchor.parentNode.insertBefore(card, anchor.nextSibling);
        } else {
            anchor.appendChild(card);
        }
    }

    // Remove any card elements in the DOM that aren't our canonical state.cardEl.
    // Called on every DOM mutation to catch clones WK creates during reveal.
    function dedupeCards() {
        const all = document.querySelectorAll('.' + CARD_CLASS);
        if (all.length <= 1) return;
        let removed = 0;
        all.forEach((el) => {
            if (el !== state.cardEl) {
                el.remove();
                removed++;
            }
        });
        if (removed > 0) {
            console.log(`[${SCRIPT_ID}] dedupe: removed ${removed} stale card clone(s)`);
        }
    }

    // Question-type-aware reveal. Each supplementary element is gated on the
    // specific question that it would spoil — symmetric per-feature gating,
    // not per-subject completion. WK asks meaning and reading as two separate
    // questions per vocab, in either order:
    //
    //   * Meaning submit → set meaningAnswered. Reveal translation + image
    //                      immediately (they don't spoil the reading question
    //                      — the kana reading isn't visible in either). Plays
    //                      audio if autoPlayAudio is on.
    //   * Reading submit → set readingAnswered, unlock the ふ furigana toggle,
    //                      re-render the sentence so furigana characters
    //                      become visible (gated here because furigana WOULD
    //                      spoil the reading). Always autoplays the sentence
    //                      audio (queued after WK's vocab pronunciation so
    //                      they don't overlap).
    //
    // If the same subject is revisited later in a shuffled session (WK can
    // interleave other subjects between this card's two questions), the
    // per-subject progress map restores meaning/reading flags so the card
    // renders in the correct revealed state from the start — see renderCard's
    // use of state.meaningAnswered to initialize fig.hidden / translation.hidden.
    function revealAll() {
        const card = state.cardEl;
        if (!card) return;
        const qtype = state.currentQuestionType || currentQuestionType() || 'meaning';
        const progress = getSubjectProgress(state.currentSubjectId);

        if (qtype === 'meaning') {
            state.meaningAnswered = true;
            progress.meaningAnswered = true;
        } else if (qtype === 'reading') {
            // Reading just got graded — furigana is now safe to show without
            // spoiling. Enable the toggle button and re-render the sentence
            // so it picks up the current furiganaVisible state.
            state.readingAnswered = true;
            progress.readingAnswered = true;
            if (card._furiganaBtn) {
                card._furiganaBtn.disabled = false;
                card._furiganaBtn.setAttribute('aria-label', 'Toggle furigana');
                card._furiganaBtn.title = state.furiganaVisible
                    ? 'Hide furigana'
                    : 'Show furigana';
            }
            applyFuriganaState(card.querySelector(`.${CSS_PREFIX}-sentence`), card._example);
        }

        // Image + translation reveal as soon as meaning is answered (no
        // dependency on reading). Sticky for the rest of the card so any
        // post-reveal mutations don't re-hide.
        if (state.meaningAnswered) {
            card.setAttribute('data-revealed', 'true');
            const translation = card.querySelector(`.${CSS_PREFIX}-translation`);
            if (translation) translation.hidden = false;
            const fig = card.querySelector(`.${CSS_PREFIX}-image`);
            if (fig) fig.hidden = false;
        }

        if (typeof card._play !== 'function') return;

        if (qtype === 'reading') {
            // Always autoplay on reading submit, but yield to WK's vocab audio
            // (which auto-plays the just-revealed reading) so they don't overlap.
            autoplayAfterWkAudio(card._play);
        } else if (settings().autoPlayAudio) {
            card._play();
        }
    }

    // Schedule a sentence-audio playback that waits for WaniKani's own vocab
    // audio (the word reading clip that plays right after a reading submit) to
    // finish. Strategy: brief delay so WK has time to start its <audio>, then
    // look for a currently-playing audio element that isn't ours; if found,
    // attach a one-shot `ended` listener (with a safety timer in case `ended`
    // never fires). If nothing's playing after the detection window, just play
    // after a reasonable fixed delay — covers the case where WK uses Web Audio
    // API (which has no DOM <audio> element to inspect).
    function autoplayAfterWkAudio(playFn) {
        const DETECT_DELAY_MS = 400;
        const FALLBACK_DELAY_MS = 2500;
        const POST_WK_BUFFER_MS = 200;

        setTimeout(() => {
            let wkAudio = null;
            for (const a of document.querySelectorAll('audio')) {
                if (a.closest('.' + CARD_CLASS)) continue; // skip our own <audio>
                if (!a.paused && !a.ended) { wkAudio = a; break; }
            }

            if (wkAudio) {
                const dur = wkAudio.duration || 3;
                console.log(`[${SCRIPT_ID}] reading autoplay: waiting for WK audio (~${dur.toFixed(1)}s)`);
                let played = false;
                const play = () => { if (played) return; played = true; playFn(); };
                wkAudio.addEventListener('ended', () => setTimeout(play, POST_WK_BUFFER_MS), { once: true });
                // Safety: in case `ended` never fires (audio paused/replaced),
                // play after the expected duration + a generous buffer.
                setTimeout(play, (dur * 1000) + 1500);
            } else {
                console.log(`[${SCRIPT_ID}] reading autoplay: no <audio> detected, fallback ${FALLBACK_DELAY_MS}ms`);
                setTimeout(playFn, FALLBACK_DELAY_MS);
            }
        }, DETECT_DELAY_MS);
    }

    function removeCard() {
        if (state.emptyTimer) {
            clearTimeout(state.emptyTimer);
            state.emptyTimer = null;
        }
        if (state.cardEl) {
            // Free any blob URL we allocated for direct-path audio (IK proxy
            // or Google TTS). Server-path audio uses real CDN URLs, not
            // blob URLs — revokeObjectURL on a non-blob URL is a no-op, and
            // the try/catch covers any browser that disagrees.
            if (state.cardEl._blobUrl) {
                try { URL.revokeObjectURL(state.cardEl._blobUrl); } catch (_) {}
            }
            if (state.cardEl.parentNode) {
                state.cardEl.parentNode.removeChild(state.cardEl);
            }
        }
        state.cardEl = null;
        // NOTE: we deliberately do NOT clear host styling here. Host lifecycle
        // is governed by subject type (vocab vs not) in handleDomChange — see
        // applyHostStyling/clearHostStyling. Keeping the host expanded across
        // vocab-to-vocab transitions avoids the visible header collapse/expand
        // during the IK fetch window.
    }

    // ---------- Utilities ----------

    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    // ---------- JLPT vocabulary data ----------
    //
    // Bundled dictionary-form → JLPT level number map. Level numbers: 5 = N5
    // (easiest) … 1 = N1 (hardest). Used by scoreJlpt() to compute a max-level
    // "bottleneck" for each cached IK example, which the jlptCeiling setting
    // then filters against.
    //
    // Source: jamsinclair/open-anki-jlpt-decks (MIT license). We keep only the
    // CSV `expression` column. Multi-variant entries ("足; 脚") are split into
    // separate keys; template/placeholder rows ("〜 (まる) ごと") and multi-word
    // noise are dropped. Cross-level duplicates collapse to the easiest level
    // (e.g. "下" appears in both n3 and n5, stored as 5).
    //
    // 7604 entries, ~92KB inline. Lookup is O(1) property access.
    const JLPT_VOCAB = {"あ":4,"ああ":5,"あいにく":3,"あいまい":2,"あくどい":1,"あくび":2,"あげる":4,"あざ":1,"あそこ":5,"あちこち":3,"あちら":5,"あちらこちら":2,"あっさり":1,"あっち":5,"あつらえる":1,"あなた":5,"あの":5,"あふれる":2,"あぶる":2,"あべこべ":1,"あみもの":2,"あやふや":1,"あらゆる":3,"あらわす":2,"ありがとう":3,"ありのまま":1,"ありふれる":1,"あるいは":3,"あれ":5,"あれこれ":2,"あんな":4,"あんなに":3,"あんまり":3,"いい":5,"いいえ":5,"いい加減":1,"いかが":5,"いかに":1,"いかにも":1,"いきなり":2,"いくつ":5,"いくら":5,"いけない":3,"いざ":1,"いじめる":4,"いじる":1,"いずれ":3,"いたずら":3,"いただきます":3,"いただく":4,"いたって":1,"いたわる":1,"いちいち":2,"いっそ":1,"いってきます":2,"いってまいります":2,"いつ":5,"いつか":3,"いつでも":3,"いつのまにか":3,"いつまでも":3,"いつも":5,"いびき":1,"いやに":1,"いやらしい":1,"いよいよ":2,"いらいら":3,"いらっしゃい":3,"いらっしゃる":4,"いわゆる":3,"うかがう":4,"うがい":3,"うたた寝":1,"うち":5,"うっかり":3,"うっとうしい":1,"うつむく":1,"うどん":2,"うなずく":2,"うなる":3,"うぬぼれ":1,"うまい":4,"うるさい":5,"うろうろ":2,"うん":4,"うんざり":1,"うんと":2,"ええ":5,"ええと":2,"おいでになる":4,"おおげさ":1,"おおざっぱ":2,"おおまかな":1,"おかけください":2,"おかげさまで":2,"おかしい":4,"おかず":2,"おかまいなく":2,"おじいさん":5,"おだてる":1,"おっかない":1,"おっしゃる":4,"おつり":4,"おととし":5,"おどおど":1,"おはよう":2,"おばあさん":5,"おびただしい":1,"おまけ":1,"おまちどおさま":2,"おまわりさん":5,"おむつ":1,"おめでたい":2,"おめでとう":3,"おもちゃ":4,"おやつ":2,"およそ":3,"おる":4,"おろそか":1,"おんぶ":1,"お世話になりました":2,"お互い":3,"お代わり":2,"お休み":2,"お使い":1,"お供":1,"お元気で":2,"お兄さん":5,"お先に":2,"お出掛け":2,"お前":3,"お参り":2,"お喋り":3,"お土産":4,"お大事に":2,"お姉さん":5,"お嬢さん":4,"お子さん":4,"お宅":4,"お宮":1,"お帰り":2,"お弁当":5,"お待たせしました":2,"お待ちください":2,"お手上げ":1,"お手伝いさん":2,"お手洗い":5,"お昼":3,"お母さん":5,"お気の毒に":2,"お洒落":3,"お父さん":5,"お産":1,"お皿":5,"お目に掛かる":3,"お礼":4,"お祝い":4,"お祭り":4,"お腹":5,"お茶":5,"お菓子":5,"お袋":1,"お見舞い":4,"お辞儀":3,"お邪魔します":2,"お酒":5,"お金":5,"お金持ち":4,"お陰":4,"お願いします":2,"お風呂":5,"かかと":1,"かかる":5,"かけざん":2,"かける":5,"かさばる":1,"かさむ":1,"かしこまりました":2,"かしょ":2,"かじる":2,"かたかな":2,"かたづく":2,"かつて":1,"かなり":3,"かなわない":1,"かばん":5,"かぶる":5,"かぶれる":1,"かまう":4,"かもしれない":3,"かゆい":3,"からかう":2,"かりに":1,"かるた":2,"かろうじて":1,"がっかり":3,"がっくり":1,"がっしり":1,"がっちり":1,"きしむ":1,"きちっと":1,"きちんと":3,"きっかけ":2,"きっかり":1,"きっちり":1,"きっと":4,"きっぱり":1,"きつい":3,"きまりわるい":1,"きらびやか":1,"ぎっしり":2,"くぐる":1,"くしゃみ":2,"くじびき":1,"くすぐったい":1,"くたびれる":2,"くださる":4,"くだらない":2,"くっきり":1,"くっつく":2,"くっつける":2,"くどい":2,"くるむ":2,"くれぐれも":2,"くれる":4,"ぐっすり":3,"ぐっと":1,"ぐらい":5,"けがする":4,"けがらわしい":1,"けち":3,"けなす":1,"けれど":4,"けれども":4,"けんかする":4,"げっそり":1,"こう":4,"こうして":2,"こくせき":2,"ここ":5,"こしらえる":2,"こじれる":1,"こたつ":1,"こだわる":1,"こちら":5,"こちらこそ":2,"こっそり":2,"こっち":5,"ことごとく":1,"ことによると":3,"こないだ":2,"この":5,"この間":4,"この頃":4,"こぼす":3,"こぼれる":3,"これ":5,"これから":4,"これら":3,"こんな":5,"こんなに":3,"こんにちは":3,"こんばんは":2,"ごちそう":4,"ごちそうさま":2,"ごまかす":1,"ごみ":4,"ごめんください":2,"ごめんなさい":3,"ごらんになる":4,"ご主人":4,"ご存じ":4,"ご苦労様":2,"さあ":5,"さえずる":1,"さっき":4,"さっさと":2,"さっと":1,"さっぱり":3,"さっぱりする":1,"さて":3,"さほど":1,"さも":1,"さようなら":2,"さわやか":2,"さ来年":5,"ざっと":3,"しかし":5,"しかしながら":1,"しかも":3,"しきたり":1,"しきりに":3,"しくじる":1,"したがって":3,"しっかり":4,"しっぽ":2,"しつこい":2,"しなやか":1,"しばしば":3,"しばらく":4,"しびれる":2,"しぶとい":1,"しぼむ":2,"しみじみ":2,"しめる":2,"しゃがむ":2,"しゃっくり":2,"しゃぶる":2,"しゃべる":3,"しょうがない":2,"しょっちゅう":1,"じっくり":1,"じっと":3,"じゃ":5,"じゃあ":5,"じゃんけん":2,"すがすがしい":1,"すくなくとも":3,"すぐに":5,"すっかり":4,"すっきり":2,"すっと":4,"すっぱい":3,"すてき":3,"すなわち":3,"すばしこい":1,"すまない":2,"すみやか":1,"すり":4,"する":5,"すると":4,"すれちがい":1,"すれ違う":3,"すんなり":1,"ずうっと":2,"ずっと":3,"ずばり":1,"ずぶぬれ":1,"ずらす":2,"ずらっと":1,"ずらり":2,"ずるずる":1,"ずれ":1,"ずれる":3,"せっせと":2,"せめて":2,"ぜひとも":2,"そう":5,"そういえば":2,"そうして":5,"そうっと":2,"そうです":5,"そこ":5,"そこで":3,"そこら":1,"そして":5,"そそっかしい":2,"そちら":5,"そっくり":3,"そっち":5,"そっと":3,"その":5,"そのうえ":3,"そのうち":3,"そのころ":2,"そのため":2,"そのまま":3,"その他":2,"そば":5,"そらす":1,"それ":5,"それから":5,"それぞれ":3,"それで":4,"それでは":5,"それでも":3,"それと":3,"それとも":3,"それなのに":2,"それなら":2,"それに":4,"それほど":4,"それゆえ":1,"そろそろ":4,"そんな":4,"そんなに":4,"ぞんざい":1,"たくましい":1,"たしか":3,"ただ":3,"ただいま":2,"たちまち":2,"たっぷり":3,"たて":5,"たとえ":3,"たばこ":5,"たびたび":3,"たまに":4,"たまらない":3,"ためらう":2,"たやすい":1,"たんす":2,"だから":4,"だが":3,"だけど":3,"だったら":1,"だって":3,"だと":1,"だぶだぶ":1,"だめ":4,"だらしない":2,"だるい":1,"ちぎる":2,"ちっとも":4,"ちゃんと":3,"ちやほや":1,"ちょうだい":3,"ちょくちょく":1,"ちょっと":5,"ちらっと":1,"ついで":2,"つうか":2,"つかの間":1,"つくづく":1,"つける":5,"つねる":1,"つぶら":1,"つまずく":2,"つまらない":5,"つまり":3,"つもり":4,"てっきり":1,"てっぺん":1,"てんで":1,"でかい":1,"できもの":1,"できる":5,"できるだけ":4,"できれば":3,"ですから":3,"でたらめ":2,"では":5,"でも":5,"と":3,"とうとう":4,"とかく":1,"とがめる":1,"とぎれる":1,"ところが":3,"ところで":3,"とっくに":2,"とっさに":1,"とって":1,"とても":5,"とにかく":3,"とぼける":1,"ともかく":2,"とりあえず":1,"とろける":1,"とんだ":1,"とんでもない":3,"どう":5,"どうして":5,"どうしても":3,"どうせ":2,"どうぞ":5,"どうぞよろしく":3,"どうにか":1,"どうも":5,"どうやら":1,"どきどき":2,"どこ":5,"どこか":3,"どちら":5,"どっち":5,"どっと":2,"どなた":5,"どの":5,"どれ":5,"どんどん":4,"どんな":5,"どんなに":3,"ない":5,"なお":3,"なおさら":1,"なさる":4,"なぜ":5,"なぜなら":3,"なにしろ":2,"なにとぞ":1,"なにも":3,"なにより":1,"なる":5,"なるたけ":1,"なるべく":4,"なるほど":4,"なんだかんだ":1,"なんとなく":2,"なんとも":2,"なんなり":1,"にきび":1,"にぎやか":5,"にこにこ":2,"にせ物":1,"にっこり":3,"にも関わらず":1,"ねじ":2,"ねじまわし":1,"ねだる":1,"のこぎり":2,"のどか":1,"のろのろ":2,"のんびり":3,"はい":5,"はかない":1,"はきはき":2,"はく":5,"はさみ":3,"はじめまして":2,"はず":4,"はっきり":4,"はまる":1,"はめる":2,"はらはら":1,"ばい菌":1,"ばかばかしい":1,"ばからしい":2,"ばったり":3,"ばてる":1,"ばね":2,"ばらまく":1,"ひいては":1,"ひげ":4,"ひたすら":1,"ひとまず":2,"ひとりでに":2,"ひどい":4,"ひゃっかじてん":2,"ひょっと":1,"びっくりする":4,"びっしょり":1,"びら":1,"びり":1,"ぴかぴか":2,"ぴたり":2,"ぴったり":3,"ふくめる":2,"ふさわしい":1,"ふざける":2,"ふと":3,"ふらふら":1,"ふわふわ":2,"ふんだん":1,"ぶかぶか":1,"ぶつかる":3,"ぶつける":3,"ぶつぶつ":2,"ぶどう":4,"ぶらさげる":2,"ぶらぶら":1,"へそ":2,"へりくだる":1,"ぺこぺこ":1,"ほっと":3,"ほっぺた":1,"ほとり":1,"ほとんど":4,"ほぼ":3,"ぼつぼつ":1,"ぼやく":1,"ぼやける":1,"ぼろ":2,"ぼんやり":3,"まあ":3,"まあまあ":2,"まく":2,"まごつく":1,"まごまご":2,"まさか":3,"まさしく":1,"まさに":3,"まざる":2,"まして":1,"まじる":2,"ますます":3,"まず":4,"まずい":5,"まぜる":2,"また":5,"またぐ":2,"または":4,"まだ":5,"まちまち":1,"まっすぐ":5,"まと":1,"まとまる":3,"まとめる":3,"まぶしい":3,"まぶた":2,"まるっきり":1,"まるで":3,"みじめ":2,"みすぼらしい":1,"みっともない":2,"みんな":5,"むしる":1,"めちゃくちゃ":2,"めっきり":2,"めでたい":2,"めまい":2,"もう":5,"もうすぐ":4,"もがく":1,"もし":4,"もしかしたら":2,"もしかして":1,"もしかすると":3,"もしくは":1,"もしも":3,"もしもし":5,"もたらす":1,"もたれる":2,"もちろん":4,"もったいない":3,"もっと":5,"もてなす":1,"もてる":1,"もはや":1,"もめる":1,"もやす":2,"もらう":4,"もろに":1,"やかましい":2,"やかん":2,"やがて":3,"やけに":1,"やたらに":2,"やっつける":2,"やっと":4,"やっぱり":4,"やはり":4,"やむをえない":2,"やや":3,"ややこしい":1,"やりとおす":1,"やりとげる":1,"やる":5,"ゆっくりと":5,"ゆとり":1,"よい":5,"よく":5,"よこす":2,"よごす":2,"より":3,"よろしい":4,"りっぱ":5,"ろうそく":2,"ろくな":1,"わがまま":3,"わざと":3,"わざわざ":1,"アイスクリーム":3,"アイデア":2,"アイディア":2,"アウト":3,"アクセサリー":4,"アクセル":1,"アクセント":2,"アジア":4,"アップ":3,"アナウンサー":4,"アパート":5,"アフリカ":4,"アプローチ":1,"アマチュア":1,"アメリカ":4,"アラブ":1,"アルカリ":1,"アルコール":4,"アルバイト":4,"アルバム":3,"アルミ":1,"アワー":1,"アンケート":3,"アンコール":1,"アンテナ":2,"イェス":1,"イコール":2,"イメージ":3,"インキ":2,"インク":3,"インタビュー":3,"インターチェンジ":1,"インターナショナル":1,"インターフォン":1,"インテリ":1,"インフォメーション":1,"インフレ":1,"ウイスキー":3,"ウエートレス":2,"ウーマン":2,"ウール":2,"エアメール":1,"エスカレーター":4,"エチケット":2,"エネルギー":3,"エプロン":2,"エレガント":1,"エレベーター":5,"エンジニア":1,"エンジン":3,"オイル":2,"オフィス":3,"オリエンテーション":1,"オルガン":2,"オンライン":1,"オーケストラ":2,"オートバイ":4,"オートマチック":1,"オートメーション":2,"オーバー":4,"カクテル":1,"カセット":2,"カット":1,"カップ":5,"カテゴリー":1,"カバー":2,"カムバック":1,"カメラ":5,"カメラマン":1,"カラー":2,"カルテ":1,"カレンダー":5,"カレー":5,"カロリー":2,"カンニング":1,"カー":3,"カーテン":4,"カード":3,"カーブ":2,"カーペット":1,"ガイド":1,"ガイドブック":1,"ガス":4,"ガソリン":4,"ガソリンスタンド":4,"ガム":2,"ガラス":4,"ガレージ":1,"キャッチ":1,"キャプテン":3,"キャリア":1,"キャンパス":2,"キャンプ":3,"キロ":5,"キログラム":5,"キロメートル":5,"ギター":5,"ギャング":2,"クイズ":1,"クラシック":3,"クラス":5,"クリスマス":3,"クリーニング":2,"クリーム":3,"クレーン":1,"クーラー":2,"グラス":3,"グラム":5,"グランド":3,"グループ":3,"グレー":1,"ケーキ":4,"ケース":3,"ゲスト":1,"ゲーム":3,"コック":2,"コップ":5,"コピーする":5,"コマーシャル":1,"コメント":1,"コレクション":2,"コンクリート":2,"コンクール":2,"コンサート":4,"コンセント":2,"コンテスト":3,"コントラスト":1,"コントロール":1,"コンパス":1,"コンピュータ":4,"コンピューター":4,"コース":2,"コーチ":3,"コート":5,"コード":3,"コーナー":1,"コーヒー":5,"コーラス":2,"ゴム":2,"ゴール":3,"サイクル":1,"サイズ":1,"サイレン":2,"サイン":3,"サボる":1,"サラダ":4,"サラリーマン":2,"サンキュー":1,"サンタクロース":1,"サンダル":4,"サンドイッチ":4,"サンプル":2,"サークル":2,"サービス":3,"システム":1,"シック":1,"シナリオ":1,"シャッター":2,"シャツ":5,"シャワー":5,"ショック":3,"ショップ":2,"ショー":1,"シリーズ":2,"シーズン":2,"シーツ":2,"シート":1,"ジェット機":3,"ジャズ":1,"ジャム":4,"ジャンパー":1,"ジャンプ":1,"ジャンボ":1,"ジャンル":1,"ジャーナリスト":2,"ジュース":3,"ジーパン":1,"ジーンズ":3,"スイッチ":3,"スカート":5,"スカーフ":2,"スキー":3,"スクリーン":4,"スクール":2,"スケジュール":3,"スケート":3,"スタイル":3,"スタジオ":1,"スタンド":3,"スター":3,"スタート":2,"スチュワーデス":2,"スチーム":1,"ステレオ":4,"ステーキ":4,"ステージ":2,"スト":1,"ストッキング":2,"ストップ":2,"ストライキ":1,"ストレス":3,"ストロボ":1,"ストロー":1,"ストーブ":5,"スピーカー":2,"スピーチ":3,"スプリング":1,"スプーン":5,"スペース":1,"スポーツ":5,"スポーツカー":1,"スマート":2,"スライド":2,"スラックス":1,"スリッパ":2,"スーツ":4,"スーツケース":4,"スープ":3,"ズボン":5,"セクション":1,"セックス":1,"セット":3,"セメント":2,"セレモニー":1,"センス":1,"センター":3,"センチ":2,"セーター":5,"セール":1,"ゼミ":2,"ゼリー":1,"ゼロ":5,"ソックス":1,"ソファー":3,"ソフト":4,"ソロ":1,"ソース":1,"タイア":2,"タイトル":3,"タイピスト":1,"タイプ":4,"タイプライター":3,"タイマー":1,"タイミング":1,"タイム":1,"タイムリー":1,"タイル":1,"タオル":3,"タクシー":5,"タレント":1,"タワー":1,"ダイヤ":3,"ダイヤグラム":2,"ダイヤモンド":2,"ダイヤル":2,"ダウン":3,"ダブル":2,"ダム":2,"ダンス":3,"ダンプ":1,"ダース":1,"チェックする":4,"チェンジ":1,"チップ":2,"チャイム":3,"チャンス":3,"チャンネル":1,"チョーク":2,"チーズ":3,"チーム":3,"チームワーク":1,"ティシュペーパー":1,"テキスト":4,"テスト":5,"テニス":4,"テニスコート":2,"テレックス":1,"テレビ":5,"テント":3,"テンポ":2,"テーブル":5,"テープ":5,"テープレコーダー":5,"テーマ":2,"デコレーション":1,"デザイン":3,"デザート":3,"デッサン":1,"デパート":5,"デモ":3,"デモンストレーション":1,"データ":3,"デート":3,"トイレ":5,"トップ":3,"トラック":3,"トラブル":1,"トランジスター":1,"トランプ":3,"トレーニング":3,"トン":3,"トンネル":3,"トーン":1,"ドア":5,"ドライ":1,"ドライクリーニング":1,"ドライバー":1,"ドライブ":3,"ドライブイン":1,"ドラマ":3,"ドリル":1,"ドレス":3,"ナイター":1,"ナイフ":5,"ナイロン":2,"ナプキン":1,"ナンセンス":1,"ナンバー":2,"ニュアンス":1,"ニュー":1,"ニュース":5,"ネガ":1,"ネクタイ":5,"ネックレス":2,"ノイローゼ":1,"ノック":3,"ノー":3,"ノート":5,"ハイキング":3,"ハンカチ":5,"ハンガー":1,"ハンサム":3,"ハンドル":2,"ハンバーグ":4,"バイオリン":3,"バイバイ":2,"バケツ":2,"バス":5,"バター":5,"バック":2,"バッグ":3,"バッジ":1,"バッテリー":1,"バット":1,"バランス":3,"バンド":2,"バー":1,"パイプ":3,"パイロット":3,"パジャマ":1,"パス":3,"パスポート":3,"パソコン":4,"パターン":2,"パチンコ":1,"パトカー":1,"パパ":4,"パン":5,"パンク":1,"パンツ":2,"パーセント":3,"パーティー":5,"パート":1,"ヒント":1,"ビジネス":1,"ビタミン":2,"ビデオ":3,"ビニール":2,"ビル":4,"ビルディング":2,"ビール":3,"ビールス":1,"ピアノ":4,"ピクニック":3,"ピストル":2,"ピン":3,"ピンク":2,"ファイト":1,"ファイル":1,"ファスナー":2,"ファックス":4,"ファン":1,"フィルタ":1,"フィルム":5,"フォーク":5,"フォーム":1,"フライパン":2,"フリー":2,"フロント":1,"ブザー":1,"ブラウス":2,"ブラシ":2,"ブル":1,"ブレーキ":3,"ブローチ":2,"ブーツ":1,"ブーム":1,"プラス":3,"プラスチック":3,"プラットホーム":2,"プラン":3,"プリント":2,"プレゼント":4,"プロ":3,"プログラム":2,"プール":5,"ヘリコプター":2,"ベスト":1,"ベストセラー":1,"ベッド":5,"ベテラン":2,"ベル":4,"ベルト":3,"ベンチ":3,"ベース":1,"ペア":1,"ペット":5,"ペン":5,"ペンキ":3,"ペンチ":2,"ページ":5,"ホテル":5,"ホース":1,"ホーム":3,"ホール":1,"ボイコット":1,"ボタン":5,"ボルト":1,"ボーイ":3,"ボート":3,"ボーナス":2,"ボール":3,"ボールペン":5,"ポイント":1,"ポケット":5,"ポジション":1,"ポスター":2,"ポスト":5,"ポット":1,"ポンプ":1,"ポーズ":1,"マイク":3,"マイクロフォン":1,"マイナス":3,"マスク":2,"マスコミ":3,"マスター":3,"マッサージ":3,"マッチ":5,"マフラー":2,"ママ":3,"マラソン":2,"マンション":2,"マーク":1,"マーケット":3,"ミシン":2,"ミス":3,"ミスプリント":1,"ミセス":1,"ミュージック":1,"ミルク":3,"ムード":1,"メッセージ":3,"メディア":1,"メニュー":2,"メモ":3,"メロディー":1,"メンバー":3,"メーカー":1,"メートル":5,"モダン":2,"モデル":2,"モニター":1,"モノレール":2,"モーター":2,"モーテル":1,"ヤング":1,"ユニフォーム":1,"ユニーク":1,"ユーモア":3,"ヨット":3,"ヨーロッパ":3,"ライス":1,"ライター":3,"ラケット":3,"ラジオ":5,"ラジオカセ":5,"ラッシュアワー":2,"ラベル":3,"ランチ":2,"ランニング":2,"ランプ":1,"リズム":2,"リットル":2,"リボン":2,"リポート":4,"リード":1,"ルーズ":1,"ルール":3,"レインコート":2,"レギュラー":1,"レクリェーション":2,"レコード":5,"レジ":4,"レジャー":2,"レストラン":5,"レッスン":1,"レディー":1,"レバー":1,"レベル":3,"レポート":4,"レンジ":1,"レンズ":2,"レンタカー":1,"レントゲン":1,"レース":1,"ロケット":3,"ロッカー":2,"ロビー":2,"ロマンチック":1,"ロープ":1,"ロープウエイ":1,"ローマ字":2,"ワイシャツ":5,"ワイン":3,"ワット":1,"ワンピース":2,"ワープロ":4,"一":5,"一つ":5,"一人":5,"一人一人":3,"一休み":2,"一体":3,"一切":1,"一別":1,"一同":1,"一変":1,"一定":2,"一家":3,"一層":3,"一帯":3,"一度":4,"一度に":3,"一律":1,"一心":1,"一応":2,"一息":1,"一括":1,"一挙に":1,"一斉":2,"一方":3,"一日":5,"一旦":2,"一昨年":2,"一昨日":5,"一昨昨日":2,"一時":3,"一月":5,"一杯":4,"一概に":1,"一様":1,"一段と":2,"一気":1,"一流":2,"一生":3,"一生懸命":4,"一番":5,"一目":1,"一瞬":3,"一種":3,"一筋":1,"一緒":5,"一致":3,"一般":3,"一見":1,"一言":3,"一通り":2,"一連":1,"一部分":1,"一面":1,"一頃":1,"丁寧":4,"丁度":5,"七":5,"七つ":5,"七日":5,"万":5,"万一":3,"万人":1,"万年筆":5,"万歳":2,"万能":1,"丈":1,"丈夫":5,"三":5,"三つ":5,"三味線":1,"三日":5,"三日月":2,"三角":2,"上":5,"上がり":1,"上がる":4,"上げる":5,"上り":2,"上る":3,"上下":2,"上京":3,"上位":1,"上司":3,"上品":2,"上回る":1,"上手":5,"上旬":2,"上昇":1,"上演":1,"上着":5,"上空":1,"上等":3,"上級":2,"上達":3,"上陸":1,"下":5,"下げる":4,"下さい":5,"下す":3,"下り":3,"下りる":4,"下る":4,"下取り":1,"下品":2,"下地":1,"下宿":4,"下心":1,"下手":5,"下旬":2,"下書き":2,"下水":2,"下火":1,"下町":2,"下痢":1,"下着":4,"下線":2,"下調べ":1,"下車":2,"下降":2,"下駄":2,"不":3,"不便":4,"不利":3,"不動産":1,"不可":3,"不可欠":1,"不吉":1,"不在":1,"不安":3,"不審":1,"不平":3,"不幸":3,"不当":1,"不思議":3,"不意":1,"不振":1,"不明":1,"不景気":1,"不服":1,"不正":3,"不況":1,"不満":3,"不潔":2,"不自由":3,"不良":1,"不規則":2,"不評":1,"不調":1,"不足":3,"不通":3,"不運":2,"不順":1,"与える":3,"与党":1,"且つ":1,"世":3,"世の中":3,"世代":1,"世帯":1,"世界":4,"世紀":3,"世話":4,"世論":1,"世辞":1,"世間":3,"丘":3,"丘陵":3,"両側":2,"両方":4,"両替":3,"両極":1,"両立":1,"両親":5,"並":3,"並びに":1,"並ぶ":5,"並べる":5,"並列":1,"並木":2,"並行":2,"中":5,"中々":4,"中世":2,"中傷":1,"中古":3,"中味":3,"中和":1,"中央":3,"中学":3,"中学校":4,"中年":2,"中心":3,"中性":2,"中指":2,"中断":1,"中旬":2,"中枢":1,"中止":3,"中毒":1,"中程":1,"中立":1,"中継":1,"中腹":1,"中身":3,"中途":2,"中間":2,"丸":3,"丸々":1,"丸い":5,"丸ごと":1,"丸める":1,"主":1,"主に":3,"主人":2,"主人公":1,"主任":1,"主体":1,"主催":1,"主婦":3,"主導":1,"主張":3,"主役":2,"主権":1,"主演":1,"主義":3,"主要":3,"主観":1,"主語":2,"主題":1,"主食":1,"丼":2,"乃至":1,"久しい":1,"久しぶり":4,"乏しい":1,"乗せる":3,"乗っ取る":1,"乗り換え":2,"乗り換える":4,"乗り物":4,"乗り越し":2,"乗り込む":1,"乗る":5,"乗客":3,"乗換":2,"乗車":2,"乙":1,"九":5,"九つ":5,"九日":5,"乱す":1,"乱れる":1,"乱暴":2,"乳":1,"乾かす":3,"乾く":4,"乾杯":2,"乾燥":3,"乾電池":2,"了承":1,"了解":1,"予て":1,"予め":1,"予備":2,"予報":3,"予定":4,"予想":3,"予感":1,"予期":3,"予測":3,"予算":3,"予約":4,"予習":4,"予言":1,"予防":3,"争い":1,"争う":3,"事":4,"事件":3,"事前":1,"事務所":4,"事実":3,"事情":3,"事故":4,"事柄":1,"事業":1,"事項":1,"二":5,"二つ":5,"二人":5,"二十日":5,"二十歳":5,"二日":5,"云々":1,"互い":3,"五":5,"五つ":5,"五十音":2,"五日":5,"井戸":2,"亡くす":3,"亡くなる":4,"交える":1,"交ざる":3,"交じる":3,"交す":1,"交ぜる":3,"交わる":1,"交互":1,"交付":1,"交代":2,"交差":2,"交差点":5,"交換":3,"交替":2,"交流":2,"交渉":1,"交番":5,"交通":4,"交通機関":2,"交際":3,"享受":3,"人":5,"人事":2,"人体":1,"人口":4,"人命":2,"人工":3,"人差指":2,"人形":4,"人影":1,"人文科学":2,"人材":1,"人柄":1,"人格":1,"人民":1,"人気":3,"人物":3,"人生":3,"人目":1,"人種":3,"人質":1,"人込み":3,"人通り":2,"人造":2,"人間":3,"人類":3,"今":5,"今に":3,"今にも":3,"今回":3,"今夜":4,"今年":5,"今度":4,"今後":3,"今日":5,"今晩":5,"今更":1,"今月":5,"今朝":5,"今週":5,"介入":1,"介抱":1,"介護":1,"仏":3,"仏像":1,"仕える":1,"仕上":1,"仕上がり":1,"仕上がる":2,"仕上げる":1,"仕事":5,"仕入れる":1,"仕切る":1,"仕掛":1,"仕掛ける":1,"仕方":4,"仕方がない":2,"仕様":3,"仕立てる":1,"仕組":1,"他":3,"他人":3,"他動詞":1,"他方":1,"付き合い":3,"付く":3,"付ける":3,"付け加える":1,"付合う":3,"付属":2,"付近":2,"付録":1,"代える":3,"代る":3,"代る代る":1,"代わり":4,"代名詞":2,"代弁":1,"代理":3,"代用":1,"代表":3,"代金":3,"以上":4,"以下":4,"以内":4,"以前":3,"以外":4,"以後":2,"以来":3,"以降":2,"仮名":2,"仮名遣い":2,"仮定":3,"仰ぐ":1,"仲":3,"仲人":1,"仲直り":2,"仲良し":2,"仲間":3,"件":3,"任す":1,"任せる":3,"任務":1,"任命":1,"企業":3,"企画":1,"休み":5,"休む":5,"休める":1,"休学":1,"休息":3,"休憩":3,"休戦":1,"休暇":3,"休業":2,"休講":2,"休養":2,"会う":5,"会合":3,"会員":3,"会場":4,"会社":5,"会見":1,"会計":3,"会話":4,"会談":1,"会議":4,"会議室":4,"会館":2,"伜":1,"伝える":4,"伝わる":3,"伝来":1,"伝染":2,"伝統":3,"伝言":3,"伝記":2,"伝説":1,"伝達":1,"伯母":2,"伯母さん":5,"伯父":5,"伯父さん":2,"伴う":1,"伸ばす":3,"伸びる":3,"伺う":4,"似る":4,"似合う":3,"似通う":1,"但し":2,"位":3,"位置":3,"低い":5,"低下":2,"住":3,"住まい":2,"住む":5,"住宅":3,"住居":2,"住所":4,"住民":3,"体":5,"体付き":1,"体制":2,"体力":1,"体操":2,"体格":1,"体温":3,"体積":2,"体系":2,"体育":3,"体裁":1,"体重":3,"体験":1,"何":5,"何々":2,"何か":3,"何しろ":2,"何だか":1,"何で":3,"何でも":3,"何とか":3,"何とも":2,"何分":2,"何気ない":1,"余り":5,"余る":2,"余分":3,"余地":1,"余所":2,"余所見":1,"余暇":1,"余程":1,"余興":1,"余裕":3,"余計":2,"作":3,"作り":1,"作る":5,"作品":3,"作家":3,"作成":2,"作戦":1,"作文":5,"作曲":3,"作業":3,"作法":3,"作物":3,"作用":1,"作者":2,"作製":2,"使い道":1,"使う":5,"使命":1,"使用":3,"使用人":1,"例":3,"例え":3,"例えば":4,"例える":2,"例外":3,"侍":1,"供":3,"供給":3,"依存":1,"依然":3,"依頼":3,"価値":3,"価格":3,"侮辱":1,"侵す":1,"侵入":2,"侵略":1,"便":3,"便り":3,"便利":5,"便宜":1,"便所":2,"便箋":2,"係":3,"係わる":2,"促す":1,"促進":1,"俄":2,"保つ":1,"保健":2,"保存":3,"保守":1,"保温":1,"保管":1,"保育":1,"保証":3,"保護":3,"保険":1,"保障":3,"保養":1,"信じる":3,"信ずる":2,"信仰":3,"信任":1,"信号":3,"信用":3,"信者":1,"信頼":3,"修士":1,"修学":1,"修正":3,"修理":3,"修繕":2,"修行":1,"修飾":3,"俳優":3,"俳句":2,"俺":1,"倉庫":2,"個々":3,"個人":3,"個体":2,"個別":1,"個性":1,"倍":4,"倍率":1,"倒す":3,"倒れる":4,"倒産":3,"候補":3,"借り":3,"借りる":5,"借金":3,"倣う":2,"値":3,"値する":1,"値引き":1,"値打ち":1,"値段":4,"倹約":1,"偉い":2,"偉大":3,"偏見":1,"停止":2,"停滞":1,"停留所":3,"停車":2,"停電":3,"健やか":1,"健全":1,"健在":1,"健康":3,"側面":1,"偶":3,"偶々":3,"偶数":2,"偶然":3,"偽造":1,"傍ら":1,"傑作":2,"傘":5,"備える":3,"備え付ける":1,"備わる":1,"催し":2,"催す":1,"催促":2,"傷":3,"傷める":3,"傷付く":1,"傷付ける":1,"傾く":2,"傾ける":1,"傾らか":2,"傾向":3,"傾斜":1,"僅か":3,"働き":3,"働く":5,"像":3,"僕":4,"僧":3,"儀式":2,"億":4,"優":3,"優しい":4,"優れる":3,"優位":1,"優先":1,"優勝":3,"優勢":1,"優秀":3,"優美":1,"優越":1,"儲かる":2,"儲ける":2,"元":3,"元々":2,"元年":1,"元日":2,"元来":1,"元気":5,"元素":1,"元首":1,"兄":5,"兄弟":5,"充実":1,"兆":1,"先":5,"先々月":2,"先々週":2,"先だって":1,"先代":1,"先天的":1,"先日":3,"先月":5,"先生":5,"先着":1,"先祖":2,"先程":2,"先端":2,"先行":3,"先輩":4,"先週":5,"先頭":2,"光":4,"光る":4,"光景":3,"光沢":1,"光熱費":1,"光線":2,"克服":3,"免れる":1,"免税":2,"免許":3,"免除":1,"兎":3,"児童":3,"党":3,"入る":5,"入れる":5,"入れ物":2,"入口":5,"入場":3,"入学":4,"入手":1,"入浴":1,"入社":2,"入賞":1,"入院":4,"全":3,"全く":3,"全て":3,"全体":3,"全力":2,"全員":3,"全国":3,"全快":1,"全滅":1,"全然":4,"全盛":1,"全般":2,"全身":3,"全部":5,"全集":2,"八":5,"八つ":5,"八日":5,"八百屋":5,"公":1,"公共":2,"公務":2,"公務員":4,"公募":1,"公団":1,"公園":5,"公害":2,"公平":3,"公式":2,"公正":3,"公演":3,"公然":1,"公用":1,"公立":1,"公衆":2,"公表":2,"公認":1,"六":5,"六つ":5,"六日":5,"共に":3,"共働き":1,"共同":3,"共和":1,"共存":1,"共学":1,"共感":1,"共稼ぎ":1,"共通":3,"共鳴":1,"兵器":1,"兵士":1,"兵隊":2,"具える":3,"具わる":1,"具体":3,"具合":4,"典型":3,"兼ねる":2,"兼業":1,"兼用":1,"内":4,"内乱":1,"内容":3,"内心":1,"内科":2,"内緒":1,"内線":2,"内蔵":1,"内訳":1,"内部":1,"内閣":1,"内陸":1,"円":3,"円い":5,"円周":2,"円満":1,"円滑":1,"再び":3,"再三":2,"再会":1,"再建":1,"再来月":4,"再来週":4,"再現":1,"再生":1,"再発":1,"冒険":3,"冒頭":1,"冗談":3,"写し":1,"写す":4,"写る":3,"写生":2,"写真":5,"冠":2,"冬":5,"冬眠":1,"冴える":1,"冷える":4,"冷たい":5,"冷ます":3,"冷める":3,"冷やかす":1,"冷やす":3,"冷凍":2,"冷房":4,"冷淡":1,"冷蔵":1,"冷蔵庫":5,"冷酷":1,"冷静":3,"凄い":4,"凌ぐ":1,"凍える":2,"凍る":3,"凝らす":1,"凝る":1,"几帳面":1,"処分":1,"処理":3,"処置":1,"処罰":1,"凭れる":2,"凶作":1,"凸凹":2,"凹む":2,"出":3,"出かける":5,"出くわす":1,"出す":5,"出る":5,"出世":1,"出会い":3,"出会う":3,"出入り":2,"出入り口":2,"出入口":2,"出動":1,"出勤":2,"出口":5,"出合い":3,"出品":1,"出場":3,"出席":4,"出張":2,"出来上がり":2,"出来上がる":2,"出来事":3,"出演":1,"出版":3,"出現":1,"出生":1,"出産":1,"出発":4,"出直し":1,"出社":1,"出血":1,"出費":1,"出身":3,"出迎え":2,"出迎える":2,"出題":1,"刀":3,"刃":1,"分":3,"分かる":5,"分かれる":3,"分ける":3,"分子":1,"分布":2,"分担":1,"分散":1,"分数":2,"分析":3,"分業":1,"分母":1,"分裂":1,"分解":2,"分配":1,"分野":3,"分量":2,"分離":1,"分類":2,"切っ掛け":2,"切ない":1,"切り":3,"切る":5,"切れ":3,"切れる":3,"切れ目":1,"切実":1,"切手":5,"切替":1,"切符":5,"切開":1,"刈る":3,"刊行":3,"刑":3,"刑事":3,"刑罰":1,"列":3,"列島":2,"列車":3,"初め":5,"初めて":5,"初めに":2,"初旬":2,"初歩":2,"初版":1,"初級":2,"初耳":1,"判":3,"判事":2,"判子":2,"判定":1,"判断":3,"判決":1,"別":4,"別々":2,"別に":3,"別れ":3,"別れる":4,"別荘":2,"利口":3,"利子":1,"利害":2,"利息":1,"利潤":1,"利点":1,"利用":4,"利益":3,"到底":1,"到着":3,"到達":1,"制する":1,"制作":2,"制定":1,"制度":3,"制服":1,"制約":1,"制裁":1,"制限":3,"刷る":3,"券":3,"刺さる":3,"刺す":3,"刺激":3,"刺繍":1,"刺身":2,"刻む":2,"剃る":2,"剃刀":2,"削る":2,"削減":1,"削除":2,"前":5,"前もって":3,"前例":1,"前売":1,"前後":2,"前提":1,"前置き":1,"前者":3,"前途":1,"前進":3,"剥がす":2,"剥く":3,"剥ぐ":1,"剥げる":1,"剥す":2,"副":1,"副詞":2,"割と":2,"割る":3,"割れる":4,"割合":4,"割合に":2,"割引":2,"割当":1,"割算":2,"割込む":1,"創作":2,"創刊":1,"創立":1,"創造":3,"劇":3,"劇団":1,"劇場":3,"力":4,"力強い":2,"功績":2,"加える":3,"加わる":3,"加入":1,"加味":3,"加工":1,"加減":3,"加熱":2,"加速":2,"加速度":2,"劣る":3,"助かる":3,"助け":1,"助ける":3,"助動詞":1,"助手":3,"助教授":2,"助言":1,"助詞":3,"努めて":1,"努める":2,"努力":3,"励ます":1,"励む":1,"労働":3,"労力":1,"効き目":1,"効く":3,"効力":2,"効果":3,"効率":1,"勇ましい":2,"勇敢":1,"勇気":3,"勉強":5,"動かす":3,"動き":1,"動く":4,"動作":2,"動力":1,"動向":1,"動員":1,"動揺":3,"動機":1,"動物":5,"動物園":4,"動的":1,"動詞":3,"勘":3,"勘定":3,"勘弁":1,"勘違い":2,"務まる":1,"務め":3,"務める":2,"勝ち":3,"勝つ":4,"勝る":1,"勝利":1,"勝手":1,"勝手に":2,"勝敗":2,"勝負":2,"募る":1,"募金":1,"募集":2,"勢い":3,"勢力":1,"勤め":3,"勤める":5,"勤め先":1,"勤労":1,"勤勉":1,"勤務":1,"勧める":3,"勧告":1,"勧誘":1,"匂い":4,"匂う":2,"包み":3,"包む":4,"包丁":2,"包帯":2,"包装":3,"化ける":1,"化合":1,"化学":3,"化石":1,"化粧":3,"化繊":1,"北":5,"北極":2,"匙":2,"匹敵":1,"区分":2,"区切り":1,"区切る":2,"区別":3,"区域":2,"区画":1,"区間":1,"医学":4,"医師":3,"医療":3,"医者":5,"医院":3,"十":5,"十分":4,"十字路":1,"十日":5,"千":5,"午前":5,"午後":5,"半":5,"半ば":3,"半分":5,"半島":2,"半径":2,"半端":1,"卑しい":1,"卑怯":2,"卒業":4,"卒直":2,"協会":1,"協力":3,"協定":1,"協調":3,"協議":3,"南":5,"南北":2,"南極":2,"南米":2,"単なる":3,"単に":3,"単一":1,"単位":3,"単数":2,"単独":1,"単純":3,"単語":3,"単調":1,"博士":3,"博物館":3,"占う":2,"占める":3,"占領":1,"印":3,"印刷":3,"印象":3,"印鑑":1,"危うい":2,"危ない":5,"危ぶむ":1,"危害":1,"危機":1,"危険":4,"即する":1,"即座に":1,"却って":2,"卵":5,"卸す":3,"厄介":3,"厚い":5,"厚かましい":2,"原":3,"原っぱ":1,"原作":1,"原典":1,"原則":1,"原因":4,"原型":1,"原始":2,"原子":1,"原形":1,"原文":1,"原料":2,"原書":1,"原油":1,"原点":1,"原爆":1,"原理":2,"原産":2,"原稿":2,"厳か":1,"厳しい":4,"厳密":1,"厳重":2,"去る":3,"去年":5,"参る":4,"参上":1,"参加":3,"参照":1,"参考":3,"参議院":1,"及び":1,"及ぶ":1,"及ぼす":3,"友":3,"友人":3,"友好":3,"友情":3,"友達":5,"双子":3,"反する":1,"反る":3,"反乱":1,"反対":4,"反射":1,"反応":1,"反感":1,"反抗":3,"反撃":1,"反映":2,"反発":1,"反省":3,"反響":1,"収まる":1,"収める":3,"収入":3,"収容":1,"収支":1,"収益":1,"収穫":3,"収集":1,"叔母":2,"叔母さん":5,"叔父":2,"叔父さん":5,"取り上げる":3,"取り付ける":1,"取り入れる":2,"取り出す":2,"取り寄せる":1,"取り巻く":1,"取り戻す":1,"取り扱う":1,"取り替え":1,"取り替える":4,"取り次ぐ":1,"取り消す":2,"取り混ぜる":1,"取り立てる":1,"取り組む":1,"取り締まる":1,"取り調べる":1,"取り除く":1,"取る":5,"取れる":3,"取引":1,"取扱":1,"取材":1,"取締り":1,"受かる":1,"受ける":4,"受け付ける":1,"受け入れ":1,"受け入れる":1,"受け取る":3,"受け持つ":2,"受け止める":1,"受け継ぐ":1,"受付":4,"受取":2,"受持ち":1,"受話器":2,"受身":1,"受験":2,"口":5,"口吟む":1,"口実":2,"口紅":2,"口述":1,"口頭":1,"古い":5,"古代":1,"古典":2,"古里":2,"句":3,"句読点":2,"叩く":3,"只":3,"叫び":1,"叫ぶ":3,"召し上がる":4,"召す":1,"可":3,"可愛い":5,"可愛がる":2,"可愛そう":3,"可愛らしい":3,"可決":2,"可能":3,"台所":5,"台本":1,"台無し":1,"台詞":2,"台風":4,"叱る":4,"右":5,"叶う":1,"叶える":1,"司る":1,"司会":2,"司法":1,"各々":2,"各地":2,"各種":1,"各自":2,"合う":4,"合わす":1,"合わせる":3,"合併":1,"合同":2,"合唱":1,"合図":3,"合意":1,"合成":1,"合格":3,"合流":2,"合理":2,"合致":1,"合計":3,"合議":1,"合間":1,"吊す":2,"吊り革":1,"吊る":2,"同い年":1,"同じ":5,"同一":3,"同僚":3,"同士":3,"同封":1,"同居":1,"同志":3,"同情":1,"同意":1,"同感":1,"同時":3,"同格":2,"同様":3,"同盟":1,"同等":1,"同級":1,"同調":1,"名":3,"名人":3,"名付ける":1,"名作":2,"名刺":3,"名前":5,"名字":2,"名所":2,"名札":1,"名残":1,"名物":2,"名産":1,"名称":1,"名簿":1,"名詞":3,"名誉":1,"名高い":1,"吐き気":2,"吐く":3,"向かい":3,"向かう":4,"向く":3,"向ける":3,"向こう":5,"向上":1,"君":4,"君主":1,"吟味":1,"吠える":3,"否":3,"否定":3,"否決":1,"含む":3,"含める":3,"吸う":5,"吸収":3,"吹く":5,"吹奏":1,"吹雪":2,"呆れる":2,"呆気ない":1,"呆然":1,"告げる":1,"告白":1,"呑気":2,"呟く":1,"周り":4,"周囲":3,"周期":1,"周辺":2,"味":4,"味わい":1,"味わう":2,"味噌":4,"味方":3,"味覚":1,"呼び出す":2,"呼び掛ける":2,"呼び止める":1,"呼ぶ":5,"呼吸":3,"命":3,"命じる":3,"命ずる":2,"命中":1,"命令":3,"和やか":1,"和らげる":1,"和文":1,"和服":2,"和英":2,"咥える":3,"咲く":5,"咳":3,"哀れ":3,"品":3,"品物":4,"品種":1,"品質":1,"哲学":3,"唇":2,"唯":3,"唯一":3,"唱える":1,"唾":1,"商人":3,"商品":3,"商売":3,"商店":2,"商業":2,"商社":2,"問い":3,"問い合わせ":2,"問い合わせる":1,"問う":3,"問屋":1,"問答":2,"問題":5,"善":3,"善し悪し":1,"善良":1,"喉":4,"喜び":3,"喜ぶ":4,"喜劇":1,"喧しい":2,"喫茶店":5,"営む":1,"営業":3,"嗅ぐ":3,"嗜好":1,"嘆く":1,"嘗める":1,"嘘":4,"嘘つき":1,"嘲笑う":1,"嘴":1,"噂":3,"噛み切る":1,"噛む":4,"器":1,"器具":2,"器官":3,"器械":3,"器用":3,"噴出":1,"噴水":2,"噴火":2,"囁く":2,"四":5,"四つ":5,"四つ角":2,"四季":3,"四捨五入":2,"四日":5,"四角":3,"四角い":2,"回り道":2,"回る、回す":4,"回収":1,"回復":3,"回数":2,"回数券":2,"回答":2,"回覧":1,"回路":1,"回転":2,"回送":1,"因る":3,"団体":3,"団地":2,"団扇":1,"団結":1,"困る":5,"困難":3,"囲む":3,"図":3,"図々しい":2,"図る":3,"図形":2,"図書":3,"図書館":5,"図表":2,"図鑑":2,"固い":4,"固まる":2,"固める":1,"固定":1,"固有":1,"国":5,"国交":1,"国会":3,"国境":3,"国定":1,"国家":3,"国有":1,"国民":3,"国王":2,"国産":1,"国立":2,"国籍":3,"国語":3,"国連":1,"国防":1,"国際":4,"園芸":2,"土":3,"土俵":1,"土台":1,"土地":3,"土手":1,"土曜日":5,"土木":1,"土産":3,"圧倒":1,"圧力":1,"圧縮":2,"圧迫":1,"在る":5,"在学":2,"在庫":1,"地":3,"地下":3,"地下水":2,"地下鉄":5,"地主":1,"地位":3,"地元":1,"地区":3,"地名":2,"地味":3,"地図":5,"地域":3,"地帯":2,"地平線":3,"地形":1,"地方":3,"地点":2,"地獄":1,"地球":3,"地理":4,"地盤":2,"地質":2,"地震":4,"地面":2,"坂":4,"均衡":1,"坊さん":2,"坊っちゃん":2,"坊や":2,"垂れる":1,"垂直":2,"型":3,"垢":1,"垣根":2,"埃":3,"埋まる":3,"埋める":3,"埋め込む":1,"埋蔵":1,"城":3,"城下":1,"執着":1,"執筆":2,"基":3,"基づく":3,"基地":2,"基本":3,"基準":2,"基盤":2,"基礎":2,"基金":1,"堀":3,"堂々":1,"堅":4,"堅い":3,"堤防":1,"堪える":2,"報じる":1,"報ずる":1,"報告":3,"報道":1,"報酬":1,"場":3,"場合":4,"場所":4,"場面":3,"塀":3,"塊":2,"塔":3,"塗る":4,"塞がる":2,"塞ぐ":2,"塩":5,"塩辛":2,"塩辛い":2,"塵":3,"塵取り":1,"塵紙":2,"塾":1,"境":3,"境界":2,"境遇":1,"墓":3,"墓地":1,"増える":4,"増す":3,"増やす":3,"増加":3,"増大":2,"増強":1,"増減":2,"増進":1,"墜落":1,"墨":3,"壁":4,"壊す":4,"壊れる":4,"壮大":1,"声":5,"声明":3,"売り上げ":2,"売り出し":1,"売り出す":1,"売り切れ":2,"売り切れる":2,"売り場":4,"売る":5,"売れる":3,"売れ行き":2,"売上":2,"売店":2,"売行き":2,"売買":2,"壷":1,"変":4,"変える":4,"変わる":4,"変動":1,"変化":3,"変更":3,"変遷":1,"変革":1,"夏":5,"夏休み":5,"夕刊":2,"夕方":5,"夕日":2,"夕暮れ":1,"夕焼け":1,"夕立":2,"夕飯":5,"外":5,"外す":3,"外れる":3,"外交":3,"外出":3,"外国":5,"外国人":5,"外方":1,"外来":1,"外相":1,"外科":2,"外観":1,"外貨":1,"外部":2,"多い":5,"多分":5,"多少":3,"多忙":1,"多数決":1,"多様":1,"夜":5,"夜中":3,"夜具":1,"夜明け":3,"夜更け":1,"夜更し":1,"夜行":2,"夜間":2,"夢":4,"夢中":3,"大":3,"大いに":3,"大きい":5,"大きな":5,"大した":3,"大して":2,"大丈夫":5,"大事":4,"大人":5,"大人しい":3,"大会":3,"大体":4,"大使":3,"大使館":5,"大便":1,"大凡":2,"大分":4,"大切":5,"大勢":5,"大半":3,"大変":5,"大好き":5,"大学":5,"大学生":4,"大学院":2,"大家":3,"大小":2,"大層":2,"大工":2,"大幅":1,"大戦":3,"大抵":4,"大方":1,"大木":2,"大柄":1,"大概":1,"大気":3,"大水":1,"大空":1,"大筋":1,"大統領":3,"大胆":1,"大臣":3,"大衆":1,"大通り":2,"大部":1,"大部分":3,"大金":1,"大陸":3,"天":1,"天下":1,"天体":1,"天候":3,"天国":1,"天地":1,"天才":1,"天気":5,"天気予報":4,"天災":1,"天然":3,"天皇":2,"太い":5,"太る":4,"太陽":3,"太鼓":2,"夫":4,"夫人":3,"夫妻":2,"夫婦":3,"失う":3,"失恋":2,"失敗":4,"失望":3,"失格":1,"失業":3,"失礼":4,"失脚":1,"失調":1,"奇妙":3,"奉る":1,"奉仕":1,"契機":3,"契約":3,"奥":3,"奥さん":5,"奨励":1,"奨学金":3,"奪う":3,"奮闘":1,"女":5,"女の人":2,"女の子":5,"女優":3,"女史":3,"女子":3,"女性":4,"女房":2,"女王":3,"奴":1,"好き":5,"好き好き":2,"好き嫌い":2,"好ましい":1,"好み":3,"好む":3,"好意":1,"好況":1,"好評":1,"好調":1,"妊娠":1,"妙":3,"妥協":1,"妥当":2,"妥結":1,"妨げる":2,"妨害":1,"妬む":1,"妹":5,"妻":4,"姉":5,"姉妹":3,"始まり":3,"始まる":5,"始め":5,"始めに":2,"始める":4,"始末":1,"始発":1,"始終":2,"姓":3,"姓名":3,"委員":3,"委託":1,"姪":2,"姿":3,"姿勢":2,"威力":1,"威張る":2,"娘":4,"娯楽":2,"婉曲":1,"婚約":3,"婦人":3,"婿":1,"嫁":3,"嫉妬":1,"嫌":5,"嫌々":1,"嫌い":5,"嫌う":3,"嫌がる":2,"嬉しい":4,"子":4,"子供":5,"子孫":2,"子息":1,"字":4,"字体":3,"字引":5,"存じる":2,"存ずる":2,"存在":3,"存続":1,"孝行":2,"季刊":3,"季節":4,"孤児":1,"孤独":1,"孤立":1,"学":3,"学ぶ":3,"学会":2,"学力":2,"学問":3,"学士":1,"学年":2,"学期":3,"学校":5,"学歴":3,"学生":5,"学科":2,"学級":2,"学習":3,"学者":3,"学芸":1,"学術":2,"学説":1,"学部":2,"孫":3,"宅":3,"宇宙":3,"守る":3,"守備":1,"守衛":1,"安い":5,"安っぽい":1,"安全":4,"安定":3,"安心":4,"安易":2,"安静":1,"完ぺき":1,"完了":3,"完全":3,"完成":3,"宗教":3,"官僚":3,"官庁":2,"宙返り":1,"定まる":1,"定める":1,"定休日":2,"定価":2,"定員":2,"定年":1,"定期":3,"定期券":2,"定義":1,"定規":2,"定食":1,"宛てる":3,"宛名":2,"宝":3,"宝石":3,"実":3,"実に":3,"実は":3,"実る":2,"実例":2,"実力":3,"実家":1,"実感":2,"実態":1,"実施":3,"実業家":1,"実物":2,"実現":3,"実用":2,"実績":2,"実習":2,"実行":3,"実費":1,"実践":1,"実際":3,"実験":3,"客":4,"客席":2,"客観":1,"客間":2,"宣伝":3,"宣教":1,"宣言":1,"宮殿":1,"害":3,"害する":1,"宴会":2,"家":5,"家主":2,"家事":3,"家具":3,"家内":4,"家出":1,"家屋":2,"家庭":5,"家族":5,"家来":1,"家畜":1,"家計":1,"家賃":3,"容器":3,"容易":3,"容積":2,"宿":3,"宿命":1,"宿泊":3,"宿題":5,"寂しい":4,"寄せる":3,"寄り掛かる":1,"寄る":4,"寄与":1,"寄付":3,"寄贈":1,"密":3,"密か":1,"密度":1,"密接":1,"密集":1,"富":1,"富む":1,"富豪":1,"寒い":5,"寒帯":2,"寒気":1,"寛容":1,"寝かせる":1,"寝る":5,"寝台":2,"寝坊":4,"寝巻":2,"寝間着":2,"察する":1,"寧ろ":3,"審判":3,"審査":1,"審議":1,"寮":3,"寸法":2,"寺":4,"寺院":2,"対":3,"対する":3,"対処":1,"対応":1,"対抗":1,"対比":1,"対決":1,"対照":3,"対立":2,"対等":1,"対策":2,"対話":1,"対談":1,"対象":3,"対面":1,"寿命":2,"封":1,"封建":1,"封筒":5,"封鎖":1,"専ら":1,"専修":1,"専制":2,"専攻":3,"専用":1,"専門":4,"射す":3,"将来":4,"将棋":2,"尊い":1,"尊ぶ":1,"尊敬":3,"尊重":3,"尋ねる":4,"導く":1,"導入":1,"小":3,"小さい":5,"小さな":5,"小便":2,"小児科":1,"小切手":1,"小包":3,"小売":1,"小学校":4,"小学生":2,"小屋":3,"小指":2,"小数":2,"小柄":1,"小母さん":2,"小父さん":2,"小説":4,"小遣い":2,"小銭":3,"小鳥":4,"小麦":3,"少々":3,"少し":5,"少しも":3,"少ない":5,"少なくとも":2,"少女":3,"少年":3,"尖る":2,"尤も":3,"就く":3,"就任":2,"就業":1,"就職":3,"尻":3,"尽きる":1,"尽くす":1,"尾":3,"尿":1,"局":3,"局限":1,"居る":5,"居住":1,"居眠り":3,"居間":3,"屈折":1,"届":1,"届く":3,"届ける":4,"屋上":4,"屋外":2,"屋敷":1,"屋根":3,"屎尿":1,"屑":2,"展望":1,"展示":1,"展覧会":4,"展開":2,"属する":2,"履歴":1,"山":5,"山岳":1,"山林":2,"山脈":1,"山腹":1,"岩":3,"岩石":1,"岬":2,"岸":3,"峠":2,"峰":1,"島":4,"崇拝":1,"崖":1,"崩す":2,"崩れる":2,"崩壊":1,"嵐":3,"川":5,"州":3,"巡る":2,"巡査":2,"巣":3,"工事":2,"工作":1,"工員":2,"工場":4,"工夫":2,"工学":1,"工業":4,"工芸":2,"左":5,"左利き":1,"左右":3,"巧み":1,"巧妙":1,"巨大":3,"差":3,"差し上げる":4,"差し出す":1,"差し引き":2,"差し掛かる":1,"差し支え":2,"差し支える":1,"差す":5,"差別":3,"差額":1,"巻く":3,"市":4,"市場":3,"市民":4,"布":3,"布告":1,"布団":4,"布巾":1,"希望":3,"席":4,"帯":3,"帯びる":1,"帰す":3,"帰り":4,"帰る":5,"帰京":1,"帰宅":3,"常に":3,"常識":3,"帽子":5,"幅":3,"幕":3,"干し物":1,"干す":2,"干渉":1,"平たい":1,"平ら":3,"平仮名":5,"平凡":2,"平和":3,"平均":3,"平常":1,"平方":1,"平日":2,"平気":2,"平等":3,"平野":2,"年":5,"年中":3,"年代":3,"年号":1,"年寄":3,"年度":2,"年月":3,"年賀":1,"年輪":1,"年鑑":3,"年長":1,"年間":3,"年頃":1,"年齢":3,"幸い":3,"幸せ":3,"幸福":3,"幸運":3,"幹":1,"幹線":1,"幹部":1,"幼い":3,"幼児":2,"幼稚":2,"幼稚園":2,"幽霊":1,"幾分":2,"幾多":1,"広々":2,"広い":5,"広がる":3,"広げる":3,"広さ":2,"広まる":3,"広める":3,"広告":3,"広場":2,"庇う":1,"床":3,"床の間":2,"床屋":4,"底":3,"店":5,"店員":4,"店屋":2,"度":3,"度忘れ":1,"座る":5,"座布団":2,"座席":3,"座敷":2,"座標":1,"座談会":1,"庭":5,"庶務":1,"庶民":1,"廃棄":1,"廃止":1,"廊下":5,"延ばす":3,"延びる":3,"延べ":1,"延期":3,"延長":2,"建つ":3,"建て":4,"建てる":4,"建前":1,"建物":5,"建築":3,"建設":3,"弁償":1,"弁当":3,"弁解":1,"弁論":1,"弁護":1,"式場":1,"弓":1,"引きずる":1,"引き上げる":1,"引き出し":4,"引き出す":2,"引き分け":2,"引き止める":2,"引き起こす":1,"引き返す":2,"引く":5,"引っ張る":3,"引っ掛かる":2,"引っ掻く":1,"引っ繰り返す":2,"引っ繰り返る":2,"引っ越し":2,"引っ越す":4,"引っ込む":2,"引下げる":1,"引分け":2,"引力":2,"引取る":1,"引受る":2,"引用":3,"引算":2,"引越し":3,"引退":3,"弛み":1,"弛む":1,"弟":5,"弟子":2,"弱":1,"弱い":5,"弱まる":3,"弱める":3,"弱る":1,"弱点":2,"張り切る":2,"張り紙":1,"強":1,"強い":5,"強いて":1,"強いる":1,"強まる":3,"強める":3,"強制":1,"強力":3,"強化":2,"強引":2,"強気":2,"強烈":1,"強盗":3,"強硬":1,"強行":1,"強調":3,"弾":3,"弾く":5,"弾む":1,"弾力":1,"当たり前":3,"当たる":3,"当て":1,"当てはまる":2,"当てはめる":2,"当てる":3,"当て字":1,"当り":3,"当人":1,"当日":2,"当時":3,"当然":3,"当番":2,"当選":1,"形":4,"形勢":1,"形容動詞":2,"形容詞":2,"形式":2,"形態":3,"形成":1,"彫る":2,"彫刻":2,"影":3,"影響":3,"役":3,"役に立つ":4,"役人":2,"役割":3,"役場":1,"役所":2,"役目":2,"役者":2,"役職":1,"彼":4,"彼ら":4,"彼女":4,"往復":2,"往診":1,"征服":1,"待ち合わせ":1,"待ち合わせる":2,"待ち望む":1,"待ち遠しい":1,"待つ":5,"待合室":2,"待望":1,"待遇":1,"後":5,"後ろ":5,"後回し":1,"後悔":3,"後者":3,"後輩":3,"後退":1,"徐々に":3,"徐行":1,"徒歩":1,"従う":3,"従事":1,"従兄弟":3,"従姉妹":3,"従来":1,"従業員":1,"得る":3,"得意":3,"得点":1,"御世辞":1,"御中":2,"御免":2,"御無沙汰":2,"御覧":2,"御飯":5,"復旧":1,"復活":1,"復習":4,"復興":1,"循環":2,"微か":1,"微塵":1,"微妙":3,"微笑":1,"微笑む":3,"微量":1,"徴収":1,"徹する":1,"徹夜":3,"徹底":3,"心":4,"心中":1,"心地":1,"心強い":1,"心当たり":2,"心得":1,"心得る":2,"心情":1,"心掛け":1,"心掛ける":1,"心理":3,"心細い":1,"心臓":3,"心身":2,"心配":4,"必ず":4,"必ずしも":3,"必修":1,"必死":3,"必然":1,"必要":4,"必需品":2,"志":1,"志す":1,"志向":1,"志望":3,"忘れる":5,"忘れ物":4,"忙しい":5,"応じる":3,"応ずる":2,"応募":1,"応対":2,"応急":1,"応接":2,"応援":3,"応用":2,"忠告":1,"快い":1,"快晴":2,"快適":3,"念":1,"念願":1,"怒り":3,"怒る":4,"怒鳴る":2,"怖い":4,"思いっきり":2,"思いっ切り":2,"思い付き":1,"思い付く":3,"思い出":3,"思い出す":4,"思い切り":2,"思い掛けない":2,"思い込む":2,"思う":4,"思わず":3,"思想":3,"思考":1,"怠ける":3,"怠る":2,"怠慢":1,"急":4,"急かす":1,"急ぐ":4,"急に":3,"急激":3,"急行":4,"急速":3,"性":3,"性別":2,"性格":3,"性能":2,"性質":3,"怪しい":2,"怪獣":1,"怯える":1,"恋":3,"恋しい":2,"恋する":1,"恋人":3,"恋愛":1,"恐らく":3,"恐れ":1,"恐れる":3,"恐れ入る":1,"恐ろしい":3,"恐怖":3,"恐縮":2,"恥":1,"恥じらう":1,"恥じる":1,"恥ずかしい":4,"恨み":2,"恨む":2,"恩":3,"恩恵":2,"息":3,"息子":4,"恵まれる":2,"恵み":1,"恵む":1,"悔しい":3,"悔やむ":2,"悟る":1,"悠々":2,"患者":3,"悩ましい":1,"悩ます":1,"悩み":1,"悩む":3,"悪":3,"悪い":5,"悪しからず":1,"悪化":1,"悪口":3,"悪者":1,"悪魔":3,"悲しい":4,"悲しむ":3,"悲劇":3,"悲惨":1,"悲観":1,"悲鳴":1,"情":3,"情け":1,"情勢":1,"情報":3,"情深い":1,"情無い":1,"情熱":1,"情緒":1,"惑星":1,"惚ける":1,"惜しい":2,"惜しむ":1,"惨めな":2,"想像":3,"愉快":3,"意":3,"意向":1,"意味":5,"意図":1,"意地":3,"意地悪":3,"意外":3,"意志":3,"意思":3,"意欲":1,"意気込む":1,"意義":2,"意見":4,"意識":3,"愚か":1,"愚痴":1,"愛":3,"愛する":3,"愛情":3,"愛想":1,"感じ":3,"感じる":3,"感ずる":2,"感動":3,"感度":1,"感心":3,"感情":3,"感想":3,"感染":1,"感激":2,"感無量":1,"感覚":3,"感触":1,"感謝":3,"態勢":1,"態度":3,"慌ただしい":2,"慌てる":3,"慎重":3,"慕う":1,"慣らす":3,"慣れ":1,"慣れる":4,"慣例":1,"慣習":1,"慣行":3,"慰める":2,"慶ぶ":2,"憂鬱":1,"憎い":2,"憎しみ":1,"憎む":2,"憎らしい":2,"憤慨":1,"憧れ":1,"憧れる":2,"憲法":3,"懐かしい":2,"懐く":1,"懲りる":1,"懸命":2,"懸賞":1,"成り立つ":1,"成人":3,"成分":2,"成功":3,"成年":3,"成果":1,"成熟":1,"成立":2,"成績":3,"成育":1,"成長":3,"我":1,"我々":3,"我慢":3,"或":3,"戦い":3,"戦う":3,"戦争":4,"戦力":1,"戦災":1,"戦術":1,"戦闘":1,"戯曲":1,"戸":5,"戸棚":2,"戸籍":1,"戸締り":1,"戻す":3,"戻る":4,"所":5,"所々":2,"所在":1,"所定":1,"所属":1,"所得":1,"所持":1,"所有":1,"所為":3,"扇ぐ":2,"扇子":2,"扇風機":2,"扉":1,"手":5,"手ごろ":2,"手伝い":3,"手伝う":4,"手元":1,"手入れ":2,"手分け":1,"手前":2,"手品":3,"手回し":1,"手帳":2,"手引":1,"手当":1,"手拭い":2,"手掛かり":1,"手掛ける":1,"手数":1,"手本":1,"手段":3,"手法":1,"手洗い":2,"手筈":1,"手紙":5,"手続き":2,"手芸":1,"手術":3,"手袋":4,"手軽":1,"手近":1,"手遅れ":1,"手配":1,"手錠":1,"手間":3,"手際":1,"手頃":2,"手順":1,"手首":2,"才能":3,"打ち切る":1,"打ち明ける":1,"打ち消し":1,"打ち消す":2,"打ち込む":1,"打つ":4,"打合せ":2,"打撃":1,"打開":1,"払い戻す":2,"払い込む":2,"払う":4,"扱い":1,"扱う":3,"扶養":1,"批判":3,"批評":3,"承る":2,"承知":4,"承認":3,"承諾":1,"技":1,"技師":3,"技能":1,"技術":4,"把握":1,"抑制":1,"抑圧":1,"投げる":4,"投げ出す":1,"投入":1,"投書":2,"投票":3,"投資":1,"抗争":1,"抗議":1,"折":1,"折り返す":1,"折る":4,"折れる":4,"折衷":1,"折角":2,"抜かす":1,"抜く":3,"抜ける":3,"抜け出す":1,"抱える":3,"抱く":3,"抱っこ":1,"抵抗":3,"押える":3,"押さえる":2,"押し入れ":4,"押し切る":1,"押し寄せる":1,"押し込む":1,"押す":5,"抽象":2,"抽選":1,"担う":1,"担ぐ":2,"担当":3,"担架":1,"拍手":3,"拒否":1,"拒絶":1,"拘束":3,"招き":1,"招く":3,"招待":4,"拝む":2,"拝借":1,"拝啓":1,"拝見":4,"拡充":2,"拡大":3,"拡張":2,"拡散":1,"括弧":2,"拭く":3,"拾う":4,"持ち上げる":3,"持ち切り":1,"持つ":5,"持参":2,"持続":1,"指":4,"指す":3,"指令":1,"指図":1,"指定":2,"指導":3,"指差す":1,"指揮":3,"指摘":1,"指輪":4,"挑む":1,"挑戦":3,"挙げる":3,"挟まる":2,"挟む":2,"挨拶":4,"振り":3,"振り仮名":2,"振り出し":1,"振り向く":2,"振り返る":1,"振る":3,"振動":1,"振興":3,"振舞う":2,"挿す":3,"捕える":2,"捕まえる":4,"捕まる":3,"捕る":2,"捕獲":1,"捕虜":1,"捕鯨":1,"捗る":1,"捜す":2,"捜査":3,"捜索":1,"捧げる":1,"捨てる":4,"捩る":2,"捩れる":1,"据える":1,"据え付ける":1,"捲る":3,"捻る":2,"掃く":3,"掃除":5,"授ける":1,"授業":5,"掌":1,"排水":1,"排除":1,"掘る":2,"掛ける":5,"掛け算":2,"採る":2,"採択":1,"採掘":1,"採決":1,"採点":2,"採用":1,"採算":1,"採集":3,"探す":4,"探る":2,"探検":1,"接ぐ":3,"接する":2,"接続":2,"接続詞":1,"接触":1,"接近":2,"控える":1,"控室":1,"控除":1,"推定":2,"推測":1,"推理":1,"推薦":3,"推進":1,"措置":1,"掲げる":1,"掲示":3,"掲載":1,"掴む":3,"掻き回す":1,"掻く":3,"揃い":1,"揃う":3,"揃える":3,"揉む":2,"描く":3,"描写":1,"提供":1,"提出":3,"提携":1,"提案":3,"提示":1,"揚げる":3,"換える":3,"換気":2,"換算":1,"握る":3,"握手":3,"援助":3,"揺さぶる":1,"揺らぐ":1,"揺れる":4,"損":3,"損う":1,"損失":1,"損害":3,"損得":2,"携わる":1,"携帯":3,"摘む":3,"摩する":1,"摩擦":2,"撃つ":3,"撒く":3,"撫でる":2,"撮る":5,"撮影":2,"操る":1,"操作":3,"操縦":3,"擦る":3,"擦れる":1,"支える":3,"支出":3,"支店":3,"支度":4,"支払":3,"支払う":3,"支持":1,"支給":3,"支配":3,"改まる":1,"改めて":2,"改める":2,"改修":1,"改善":3,"改定":1,"改悪":1,"改札":2,"改正":2,"改良":1,"改訂":1,"改造":2,"改革":1,"攻め":1,"攻める":3,"攻撃":3,"放す":3,"放り出す":1,"放り込む":1,"放る":2,"放れる":3,"放出":1,"放射":1,"放射能":1,"放置":1,"放送":4,"政党":2,"政府":3,"政権":1,"政治":4,"政策":1,"故":1,"故人":3,"故郷":3,"故障":4,"敏感":1,"救い":1,"救う":3,"救助":3,"救援":1,"救済":1,"敗北":1,"敗戦":1,"教え":3,"教える":5,"教わる":3,"教会":4,"教室":5,"教授":3,"教材":1,"教科":1,"教科書":3,"教習":1,"教職":1,"教育":4,"教訓":1,"教養":2,"敢えて":1,"散らかす":2,"散らかる":2,"散らす":3,"散る":3,"散歩":5,"敬う":2,"敬具":1,"敬意":3,"敬語":2,"数":3,"数える":3,"数字":3,"数学":4,"数詞":1,"整う":2,"整える":1,"整備":2,"整列":1,"整数":2,"整然":1,"整理":3,"敵":3,"敷く":2,"敷地":2,"文":3,"文体":2,"文化":4,"文化財":1,"文句":3,"文字":3,"文学":4,"文房具":2,"文明":3,"文書":1,"文法":4,"文献":2,"文章":5,"文脈":2,"文芸":2,"文語":1,"斑":1,"料理":5,"料金":3,"斜":2,"斜め":2,"斜面":1,"斡旋":1,"斬る":2,"断える":1,"断つ":3,"断る":3,"断定":2,"断水":2,"断然":1,"断言":1,"断面":1,"新しい":5,"新た":3,"新人":1,"新入生":1,"新婚":1,"新幹線":2,"新築":1,"新聞":5,"新聞社":4,"新興":3,"新鮮":3,"方":5,"方々":3,"方向":3,"方式":1,"方法":3,"方程式":2,"方策":1,"方角":2,"方言":2,"方針":2,"方面":2,"於いて":1,"施す":1,"施行":1,"施設":1,"旅":3,"旅券":1,"旅客":1,"旅行":5,"旅館":4,"旗":3,"既に":3,"既婚":1,"日":4,"日にち":2,"日の丸":1,"日の入り":2,"日の出":2,"日中":3,"日付":3,"日光":3,"日取り":1,"日向":1,"日夜":1,"日差し":2,"日帰り":2,"日常":3,"日当たり":2,"日日":2,"日時":2,"日曜日":5,"日本":3,"日焼け":1,"日用品":2,"日程":2,"日記":4,"日課":2,"日陰":2,"日頃":1,"旦那":1,"旧":3,"旧知":1,"早い":5,"早める":1,"早口":2,"早急":1,"早速":2,"昆虫":1,"昇る":3,"昇進":1,"明かす":1,"明かり":3,"明ける":3,"明け方":2,"明らか":3,"明るい":5,"明後日":5,"明日":5,"明明後日":2,"明朗":1,"明白":1,"明瞭":1,"明確":3,"易しい":5,"昔":4,"星":4,"星座":1,"映える":3,"映す":3,"映る":3,"映像":1,"映写":1,"映画":5,"映画館":5,"春":5,"昨":3,"昨夜":5,"昨日":5,"是正":1,"是非":4,"昼":5,"昼休み":4,"昼寝":2,"昼御飯":5,"昼間":4,"昼食":3,"昼飯":1,"時々":5,"時代":4,"時刻":3,"時刻表":1,"時差":1,"時折":1,"時期":3,"時計":5,"時速":2,"時間":5,"時間割":2,"晩":5,"晩年":1,"晩御飯":5,"普及":2,"普段":3,"普通":4,"普遍":1,"景気":3,"景色":4,"晴れ":5,"晴れる":5,"晴天":1,"暇":5,"暑い":5,"暖かい":5,"暖まる":3,"暖める":3,"暖房":4,"暗い":5,"暗殺":1,"暗示":1,"暗算":1,"暗記":3,"暦":1,"暮らし":3,"暮らす":3,"暮れ":3,"暮れる":4,"暴れる":2,"暴力":1,"暴動":1,"暴露":1,"暴風":1,"曇り":5,"曇る":5,"曜日":3,"曲げる":2,"曲る":5,"曲線":2,"更ける":2,"更に":3,"書き取る":1,"書く":5,"書取":2,"書店":2,"書斎":3,"書物":3,"書留":2,"書籍":2,"書評":1,"書道":2,"書類":3,"替える":3,"最も":4,"最中":3,"最低":3,"最初":4,"最善":1,"最後":4,"最終":3,"最近":4,"最高":3,"月":4,"月並":1,"月日":2,"月曜日":5,"月末":2,"月給":2,"月謝":1,"月賦":1,"有する":1,"有り様":1,"有る":5,"有利":3,"有力":1,"有効":3,"有名":5,"有料":2,"有望":1,"有機":3,"有無":3,"有益":1,"有能":3,"有難い":2,"服":5,"服装":3,"朗らか":2,"朗読":1,"望ましい":1,"望み":3,"望む":3,"望遠鏡":2,"朝":5,"朝寝坊":2,"朝御飯":5,"期待":3,"期日":1,"期末":1,"期間":3,"期限":3,"木":5,"木曜日":5,"木材":2,"木綿":4,"未だ":1,"未婚":1,"未定":1,"未来":3,"未満":2,"未熟":1,"未知":1,"未練":1,"未開":1,"末":3,"末っ子":2,"末期":1,"本":5,"本人":3,"本体":1,"本名":1,"本国":1,"本場":1,"本当":5,"本文":1,"本来":2,"本格":1,"本棚":5,"本気":1,"本物":3,"本能":1,"本質":1,"本部":2,"本音":1,"本館":1,"札":3,"机":5,"朽ちる":1,"杉":2,"材料":3,"材木":2,"村":5,"杖":1,"束":3,"束ねる":1,"束縛":1,"条件":3,"条約":1,"来":3,"来る":5,"来場":1,"来年":5,"来日":2,"来月":5,"来週":5,"杯":1,"東":5,"東洋":3,"東西":2,"松":3,"板":3,"枕":2,"林":4,"林業":1,"枚数":2,"果して":2,"果たして":2,"果たす":1,"果て":1,"果てる":1,"果実":2,"果物":5,"枝":4,"枠":3,"枯れる":2,"架空":2,"柄":3,"染まる":1,"染みる":1,"染める":1,"柔らかい":4,"柔軟":1,"柔道":4,"柵":3,"栄える":1,"栄養":3,"栓":2,"校庭":2,"校舎":3,"校長":4,"株":3,"株式":1,"核":3,"根":3,"根回し":1,"根底":1,"根拠":1,"根本":1,"根気":1,"格":3,"格別":2,"格好":4,"格差":1,"栽培":1,"桁":2,"案":3,"案じる":1,"案の定":1,"案内":4,"案外":3,"桜":3,"桟橋":1,"梅":3,"梅干し":1,"梅雨":3,"梢":1,"梯子":2,"棄権":1,"棒":3,"棚":4,"棟":3,"森":4,"森林":2,"椀":3,"椅子":5,"植える":4,"植わる":1,"植木":2,"植民地":1,"植物":3,"検事":1,"検査":3,"検討":3,"楕円":2,"業務":1,"業績":1,"業者":1,"極":3,"極めて":1,"極楽":1,"極端":1,"楽":3,"楽しい":5,"楽しみ":4,"楽む":4,"楽器":3,"楽観":1,"楽譜":1,"概念":1,"概略":1,"概説":1,"概論":2,"構いません":2,"構える":1,"構想":1,"構成":3,"構造":2,"様":4,"様々":3,"様子":3,"様式":1,"様相":1,"標本":2,"標準":2,"標語":1,"標識":2,"模倣":1,"模型":1,"模様":3,"模範":1,"模索":1,"権利":3,"権力":1,"権威":1,"権限":1,"横":5,"横切る":3,"横断":3,"横綱":1,"樹木":1,"樹立":1,"橋":5,"橋渡し":1,"機会":4,"機嫌":3,"機械":3,"機構":3,"機能":3,"機関":3,"機関車":2,"檻":1,"櫛":2,"欄":2,"欠く":3,"欠ける":3,"欠乏":1,"欠席":3,"欠点":3,"欠陥":3,"次":5,"次々":3,"次ぐ":3,"次第":3,"欧米":2,"欲":1,"欲しい":5,"欲張り":2,"欲望":1,"欲深い":1,"欺く":1,"歌":5,"歌う":5,"歌手":3,"歌謡":3,"歓声":3,"歓迎":3,"止す":3,"止まる":5,"止む":4,"止める":4,"正":3,"正しい":4,"正体":3,"正午":3,"正味":2,"正常":1,"正式":3,"正当":1,"正方形":2,"正月":4,"正直":3,"正確":3,"正義":1,"正規":3,"正解":1,"正門":2,"正面":2,"武力":1,"武器":3,"武士":2,"武装":1,"歩く":5,"歩み":1,"歩む":1,"歩道":3,"歪む":1,"歯":5,"歯医者":4,"歯磨き":2,"歯科":1,"歯車":2,"歴史":4,"死":3,"死ぬ":5,"死亡":3,"死体":2,"死刑":1,"殊に":1,"残す":3,"残らず":2,"残り":3,"残る":4,"残念":4,"残酷":1,"残金":1,"残高":1,"殖やす":3,"殴る":3,"段":3,"段々":5,"段階":2,"殺す":3,"殺人":1,"殻":3,"殿":2,"殿様":1,"母":5,"母国":1,"母校":1,"母親":3,"毎年":5,"毎度":2,"毎日":5,"毎晩":5,"毎月":5,"毎朝":5,"毎週":5,"毒":3,"比べる":4,"比例":1,"比率":1,"比較":3,"比較的":2,"比重":1,"毛":4,"毛布":3,"毛皮":2,"毛糸":2,"氏":3,"氏名":2,"民俗":1,"民宿":1,"民族":1,"民謡":2,"民間":2,"気":4,"気に入る":3,"気の毒":3,"気まぐれ":1,"気を付ける":2,"気付く":3,"気体":3,"気候":3,"気兼ね":1,"気分":4,"気味":3,"気品":1,"気圧":2,"気持ち":4,"気流":1,"気温":3,"気立て":1,"気象":1,"気質":1,"気軽":1,"気配":2,"気障":1,"気風":1,"水":5,"水分":2,"水平":2,"水平線":2,"水曜":2,"水曜日":5,"水気":1,"水泳":4,"水洗":3,"水源":1,"水準":3,"水滴":2,"水産":2,"水田":1,"水着":2,"水筒":2,"水素":2,"水蒸気":2,"水道":4,"水面":2,"氷":3,"永久":3,"永遠":3,"氾濫":1,"汁":2,"求める":3,"汗":3,"汚い":5,"汚す":3,"汚れ":1,"汚れる":4,"汚染":3,"池":5,"汲む":3,"決":1,"決して":4,"決まり":3,"決まる":4,"決める":4,"決勝":1,"決定":3,"決心":3,"決意":1,"決断":1,"決算":1,"決行":3,"決議":1,"汽船":1,"汽車":4,"沈む":3,"沈める":1,"沈殿":1,"沈没":1,"沈黙":1,"沖":3,"没収":1,"没落":1,"沢山":5,"河":5,"河川":1,"沸かす":4,"沸く":4,"沸騰":1,"油":3,"油断":2,"油絵":1,"治まる":1,"治める":3,"治る":4,"治安":1,"治療":3,"沼":1,"沿う":3,"沿岸":1,"沿線":1,"泉":3,"泊まる":4,"泊める":3,"法":3,"法則":2,"法学":1,"法廷":1,"法律":4,"法案":1,"泡":3,"波":3,"泣く":4,"泥":3,"泥棒":4,"注":3,"注ぐ":3,"注す":3,"注射":4,"注意":4,"注文":3,"注目":3,"泳ぎ":3,"泳ぐ":5,"洋品店":2,"洋服":5,"洋風":1,"洒落":2,"洒落る":1,"洗う":5,"洗剤":3,"洗濯":5,"洗面":2,"津波":1,"洪水":1,"活ける":1,"活力":2,"活動":3,"活字":2,"活気":3,"活用":3,"活発":1,"活躍":3,"派手":3,"派遣":1,"流し":1,"流す":3,"流れ":3,"流れる":3,"流域":2,"流石":2,"流行":3,"流行る":3,"流通":1,"浅い":4,"浅ましい":1,"浜":1,"浜辺":1,"浪費":1,"浮かべる":2,"浮く":2,"浮ぶ":2,"浮力":1,"浮気":1,"浴びる":5,"浴室":1,"浴衣":2,"海":5,"海外":3,"海岸":4,"海峡":1,"海抜":1,"海水浴":2,"海洋":2,"海流":1,"海路":1,"海運":1,"浸す":1,"消える":5,"消しゴム":4,"消す":5,"消化":2,"消去":1,"消息":1,"消極的":2,"消毒":2,"消耗":2,"消費":3,"消防":3,"消防署":2,"涙":3,"液":1,"液体":2,"涼しい":5,"涼む":2,"淑やか":1,"淡水":2,"深い":4,"深まる":3,"深める":3,"深刻":3,"深夜":2,"混ざる":3,"混じる":3,"混ぜる":3,"混乱":3,"混合":2,"混同":1,"混血":1,"混雑":3,"添う":3,"添える":1,"清い":2,"清ます":1,"清む":3,"清らか":1,"清掃":2,"清書":2,"清潔":3,"清濁":1,"清純":1,"渇く":3,"済ます":1,"済ませる":3,"済む":4,"渋滞":3,"渚":1,"減らす":3,"減る":3,"減少":3,"渡す":5,"渡り鳥":1,"渡る":5,"渦":3,"温い":5,"温かい":3,"温まる":3,"温める":3,"温和":1,"温室":2,"温帯":2,"温度":3,"温暖":3,"温泉":2,"測る":3,"測定":2,"測量":2,"港":4,"湖":4,"湧く":3,"湯":4,"湯気":2,"湯飲":2,"湯飲み":2,"湾":3,"湿る":3,"湿度":3,"湿気":3,"湿気る":1,"満たす":1,"満ちる":3,"満員":2,"満場":1,"満月":1,"満点":2,"満足":3,"源":1,"準じる":1,"準備":4,"準急":1,"溜まり":1,"溜まる":3,"溜める":3,"溜息":2,"溝":1,"溶かす":2,"溶く":3,"溶ける":3,"溶け込む":2,"溶岩":2,"溶液":1,"溺れる":3,"滅びる":1,"滅ぼす":1,"滅亡":1,"滅多に":3,"滑らか":1,"滑る":4,"滑稽":1,"滝":2,"滞る":1,"滞在":3,"滞納":1,"滲む":1,"漁師":2,"漁村":1,"漁業":2,"漁船":1,"漂う":1,"漏らす":1,"漏る":1,"漏れる":1,"演じる":1,"演ずる":1,"演出":1,"演劇":2,"演奏":3,"演技":3,"演説":3,"漠然":1,"漢和":2,"漢字":5,"漢語":1,"漫画":4,"漬ける":4,"漸く":2,"潜る":2,"潜入":1,"潜水":1,"潤う":1,"潮":1,"潰す":2,"潰れる":2,"澄ます":1,"澄む":3,"激しい":3,"激励":1,"激増":2,"濁る":2,"濃い":3,"濃度":2,"濠":3,"濡らす":3,"濡れる":4,"濫用":1,"濯ぐ":1,"瀬戸物":2,"灌漑":1,"火":4,"火事":4,"火傷":2,"火口":2,"火山":2,"火星":1,"火曜日":5,"火災":3,"火花":1,"灯":3,"灯台":2,"灯油":2,"灰":3,"灰皿":5,"灰色":2,"災害":1,"災難":2,"炊く":3,"炊事":2,"炎":3,"炒める":3,"炒る":2,"炭素":1,"炭鉱":2,"点":4,"点々":2,"点く":4,"点数":2,"点検":1,"点線":1,"為":4,"為す":2,"為る":3,"為替":2,"焚く":3,"焚火":1,"無":3,"無くす":5,"無くなる":4,"無し":3,"無事":3,"無効":1,"無口":1,"無地":2,"無念":1,"無意味":1,"無数":2,"無料":3,"無断":1,"無沙汰":2,"無理":4,"無用":1,"無知":1,"無礼":1,"無線":1,"無能":1,"無茶":1,"無茶苦茶":1,"無視":3,"無言":1,"無論":1,"無邪気":1,"無闇に":1,"無限":2,"無難":1,"無駄":3,"無駄遣い":1,"焦がす":2,"焦げる":2,"焦げ茶":1,"焦る":1,"焦点":2,"焼く":4,"焼ける":4,"煉瓦":2,"煌々と":1,"煎る":2,"煙":3,"煙い":2,"煙たい":1,"煙る":1,"煙突":2,"照らす":2,"照り返す":1,"照る":2,"照合":1,"照明":3,"煩わしい":1,"煮える":3,"煮る":3,"熟語":2,"熱":4,"熱い":5,"熱する":2,"熱中":3,"熱帯":3,"熱心":4,"熱意":1,"熱湯":1,"熱量":1,"燃える":3,"燃やす":3,"燃料":1,"燃焼":1,"爆弾":1,"爆発":3,"爆破":1,"爪":2,"父":5,"父母":2,"父親":3,"片付く":3,"片付け":3,"片付ける":4,"片仮名":5,"片寄る":2,"片言":1,"片道":2,"版":3,"版画":1,"牛":3,"牛乳":5,"牛肉":5,"牧場":2,"牧師":1,"牧畜":2,"物":5,"物事":3,"物体":1,"物価":3,"物凄い":2,"物好き":1,"物差し":2,"物理":3,"物置":2,"物語":3,"物語る":2,"物議":1,"物資":1,"物質":3,"物足りない":1,"物音":3,"物騒":2,"特に":4,"特別":4,"特売":2,"特定":2,"特徴":3,"特急":4,"特技":1,"特有":1,"特権":1,"特殊":2,"特派":1,"特産":1,"特色":2,"特許":1,"特長":3,"特集":1,"犠牲":1,"犬":5,"犯す":1,"犯人":3,"犯罪":3,"状態":3,"状況":3,"狂う":3,"狙い":2,"狙う":2,"狡い":2,"狩り":3,"独り":3,"独り言":2,"独創":1,"独占":1,"独特":3,"独立":3,"独自":1,"独裁":1,"独身":3,"狭い":5,"猛烈":1,"猫":5,"献立":2,"猿":3,"獣":1,"獲得":1,"獲物":1,"玄人":1,"玄関":5,"率":3,"率いる":1,"率直":2,"玉":3,"王":3,"王女":2,"王子":3,"王様":3,"玩具":1,"珍しい":4,"班":3,"現す":3,"現に":2,"現れ":3,"現れる":3,"現代":3,"現像":1,"現在":3,"現地":1,"現場":3,"現実":3,"現状":3,"現行":1,"現象":3,"現金":3,"球":3,"球根":1,"理屈":1,"理性":1,"理想":3,"理由":4,"理科":2,"理解":3,"理論":1,"琴":3,"環境":3,"瓦":2,"瓶":3,"瓶詰":2,"甘い":5,"甘える":1,"甘やかす":2,"甘口":1,"甚だ":1,"甚だしい":2,"生":3,"生える":3,"生かす":1,"生きる":4,"生き物":3,"生き生き":2,"生き甲斐":1,"生け花":2,"生じる":3,"生ずる":2,"生まれ":3,"生まれつき":1,"生まれる":5,"生やす":3,"生る":3,"生命":3,"生地":3,"生存":2,"生年月日":3,"生徒":5,"生意気":2,"生意気な":2,"生死":1,"生活":4,"生涯":3,"生温い":1,"生物":3,"生理":3,"生産":4,"生真面目":1,"生育":1,"生臭い":1,"生計":1,"生身":1,"生長":3,"産む":3,"産休":1,"産出":1,"産地":2,"産婦人科":1,"産後":1,"産業":4,"産物":1,"用":4,"用いる":3,"用事":4,"用件":1,"用品":1,"用心":3,"用意":4,"用法":1,"用紙":1,"用語":2,"用途":2,"田":3,"田ぼ":2,"田園":1,"田植え":2,"田舎":4,"甲":1,"申し上げる":4,"申し入れる":1,"申し出る":1,"申し分":1,"申し訳":3,"申し訳ない":2,"申し込む":3,"申す":4,"申出":1,"申告":3,"申請":2,"申込":1,"男":5,"男の人":3,"男の子":5,"男子":3,"男性":4,"町":5,"画家":3,"畑":3,"留まる":2,"留める":3,"留学":3,"留学生":5,"留守":4,"留守番":2,"畜生":1,"畜産":1,"略す":2,"略奪":1,"略語":1,"番号":5,"番地":2,"番組":4,"異":3,"異なる":3,"異動":3,"異常":3,"異性":1,"異見":1,"異論":1,"異議":1,"畳":4,"畳む":3,"疑う":3,"疑問":3,"疑惑":1,"疲れ":3,"疲れる":5,"疲労":1,"病む":1,"病気":5,"病院":5,"症状":3,"痛い":5,"痛み":3,"痛切":1,"痛感":1,"痩せる":4,"癌":3,"癖":3,"発":2,"発作":1,"発売":2,"発射":3,"発展":3,"発想":2,"発掘":1,"発揮":2,"発明":3,"発生":1,"発病":1,"発育":1,"発芽":1,"発行":3,"発表":3,"発見":3,"発言":1,"発足":1,"発車":3,"発達":3,"発電":2,"発音":4,"登る":5,"登場":2,"登山":3,"登校":1,"登録":1,"白":5,"白い":5,"白状":1,"白髪":2,"百":5,"百科事典":2,"的確":2,"皆":4,"皆さん":5,"皇居":1,"皮":3,"皮肉":2,"皮膚":2,"皿":3,"盆":2,"盆地":2,"盗む":4,"盗難":2,"盛り":3,"盛り上がる":1,"盛る":2,"盛ん":4,"盛大":1,"盛装":1,"監督":3,"監視":1,"目":5,"目上":3,"目下":2,"目付き":1,"目印":2,"目安":2,"目指す":2,"目方":1,"目標":3,"目次":2,"目的":3,"目盛":1,"目立つ":2,"目覚し":2,"目覚しい":1,"目覚める":1,"目論見":1,"目途":1,"目録":1,"盲点":1,"直":3,"直す":4,"直ちに":3,"直に":3,"直る":4,"直前":2,"直径":2,"直後":2,"直感":1,"直接":3,"直流":2,"直線":2,"直角":2,"直通":2,"直面":1,"相":3,"相互":2,"相場":1,"相変わらず":3,"相対":1,"相当":3,"相応":1,"相手":3,"相撲":2,"相続":3,"相談":4,"相違":2,"盾":3,"省く":3,"省みる":1,"省略":3,"眉":1,"看板":2,"看病":2,"看護":1,"看護婦":4,"県":3,"県庁":2,"真っ二つ":1,"真っ先":2,"真っ暗":2,"真っ白":2,"真っ赤":3,"真っ青":2,"真っ黒":2,"真ん丸い":1,"真ん円い":1,"真ん前":1,"真上":1,"真下":1,"真中":4,"真似":3,"真似る":2,"真剣":3,"真実":1,"真心":1,"真珠":1,"真理":3,"真相":1,"真空":2,"真面目":4,"眠い":4,"眠たい":1,"眠る":4,"眺め":3,"眺める":3,"眼球":1,"眼科":1,"眼鏡":5,"着々":2,"着く":5,"着ける":3,"着せる":2,"着る":5,"着工":1,"着席":1,"着手":1,"着替え":2,"着替える":2,"着物":4,"着目":1,"着色":1,"着陸":1,"着飾る":1,"睡眠":3,"睨む":2,"瞬き":1,"瞬間":3,"瞳":2,"矛盾":2,"矢":1,"矢印":2,"知らせ":3,"知らせる":4,"知り合い":2,"知る":5,"知事":3,"知人":2,"知合い":3,"知性":1,"知恵":3,"知的":1,"知能":3,"知識":3,"短い":5,"短大":1,"短所":2,"短期":2,"短歌":1,"短気":1,"短波":1,"短編":2,"短縮":1,"石":4,"石油":3,"石炭":3,"石鹸":5,"砂":4,"砂利":1,"砂漠":3,"砂糖":5,"研ぐ":1,"研修":2,"研究":4,"研究室":4,"砕く":2,"砕ける":2,"破く":2,"破る":3,"破れる":3,"破壊":1,"破損":1,"破棄":1,"破片":2,"破産":3,"破裂":1,"硬":4,"硬い":3,"硬貨":3,"碁":3,"碁盤":1,"碑":3,"碗":3,"確か":4,"確かめる":3,"確保":1,"確信":1,"確定":1,"確実":3,"確率":2,"確立":1,"確認":3,"磁器":3,"磁気":3,"磁石":2,"磨く":5,"示す":3,"礼":3,"礼儀":3,"社交":1,"社会":4,"社会科学":2,"社宅":1,"社説":2,"社長":4,"祈り":1,"祈る":4,"祖先":2,"祖母":4,"祖父":4,"祝い":3,"祝う":3,"祝日":2,"祝賀":1,"神":3,"神様":2,"神殿":1,"神社":4,"神秘":1,"神経":3,"神聖":1,"神話":2,"票":3,"祭":3,"祭る":2,"祭日":2,"禁じる":1,"禁止":3,"禁煙":3,"禁物":1,"禅":3,"福":3,"福祉":1,"私":5,"私有":1,"私物":1,"私用":3,"私立":2,"私鉄":2,"秋":5,"科学":4,"科目":3,"秒":3,"秘密":3,"秘書":1,"秤":2,"秩序":1,"称する":1,"移る":4,"移住":1,"移動":3,"移民":1,"移行":1,"移転":2,"稀":2,"程":4,"程度":3,"税":3,"税務署":1,"税金":3,"税関":2,"種":3,"種々":1,"種類":3,"稲":3,"稲光":1,"稼ぐ":3,"稽古":2,"穀物":3,"穂":1,"積む":3,"積もる":3,"積極的":3,"穏やか":3,"穴":3,"究極":1,"空":5,"空き":3,"空く":4,"空しい":1,"空っぽ":2,"空ろ":1,"空中":2,"空想":2,"空気":4,"空港":4,"空腹":1,"空間":1,"突き当たり":2,"突き当たる":2,"突く":3,"突っ張る":1,"突っ突く":1,"突っ込む":2,"突如":1,"突然":3,"突破":1,"窒息":1,"窓":5,"窓口":2,"窮乏":1,"窮屈":1,"立ち上がる":3,"立ち去る":1,"立ち寄る":1,"立ち止まる":2,"立つ":5,"立てる":4,"立て替える":1,"立体":1,"立場":3,"立方":1,"立法":1,"章":3,"童話":2,"童謡":3,"端":3,"競争":4,"競技":3,"競馬":2,"竹":2,"竿":1,"笑い":3,"笑う":4,"笑顔":3,"笛":3,"符号":2,"筆":3,"筆者":2,"筆記":2,"等しい":3,"等分":2,"等級":1,"筋":3,"筋肉":3,"筒":1,"答":4,"答える":5,"答案":3,"策":3,"箇所":2,"箇条書":1,"箒":2,"算数":2,"算盤":2,"管":3,"管理":3,"箱":5,"箸":5,"節":3,"節約":3,"範囲":3,"築く":3,"簡単":4,"簡易":1,"簡潔":1,"簡素":1,"籠":3,"籠もる":1,"米":4,"粉":3,"粉々":1,"粉末":1,"粋":3,"粒":2,"粗":3,"粗い":2,"粗末":3,"粗筋":2,"粘り":1,"粘る":1,"粥":1,"精々":3,"精密":1,"精巧":3,"精神":3,"精算":3,"糊":2,"糸":4,"系統":2,"約":3,"約束":4,"紅茶":5,"紅葉":2,"納まる":1,"納める":3,"納入":1,"納得":3,"紐":3,"純情":2,"純粋":2,"紙":5,"紙屑":2,"紙幣":2,"級":3,"紛らわしい":1,"紛れる":1,"紛争":1,"紛失":1,"素":3,"素っ気無い":1,"素人":2,"素早い":1,"素晴らしい":4,"素朴":1,"素材":1,"素直":2,"素質":2,"紡績":1,"索引":2,"紫":2,"細い":5,"細かい":4,"細やか":1,"細工":1,"細胞":1,"細菌":1,"紳士":1,"紹介":4,"紺":2,"終える":3,"終る":5,"終わり":4,"終了":2,"終始":1,"終日":1,"終点":2,"組":3,"組み合わせる":1,"組み立てる":2,"組み込む":1,"組む":3,"組合":3,"組合せ":2,"組織":3,"経つ":3,"経る":3,"経営":3,"経度":2,"経歴":1,"経済":4,"経由":3,"経緯":3,"経費":1,"経路":1,"経過":1,"経験":4,"結び":1,"結び付き":1,"結び付く":1,"結び付ける":1,"結ぶ":3,"結合":1,"結婚":5,"結局":3,"結成":1,"結晶":1,"結束":1,"結果":3,"結核":1,"結構":5,"結論":3,"絞る":2,"絡む":1,"給う":1,"給与":2,"給仕":1,"給料":3,"給食":1,"統一":2,"統制":1,"統合":1,"統治":1,"統率":1,"統計":2,"絵":5,"絵の具":2,"絵画":3,"絶えず":2,"絶える":1,"絶対":3,"絶滅":3,"絶版":1,"絹":4,"継ぐ":3,"継目":1,"継続":2,"続々":2,"続き":3,"続く":4,"続ける":4,"維持":3,"綱":2,"網":1,"綴じる":3,"綺麗":5,"綻びる":1,"綿":3,"緊張":3,"緊急":1,"総会":1,"総合":1,"総理大臣":2,"緑":5,"線":4,"線路":2,"締める":5,"締め切り":2,"締め切る":2,"締切":2,"編み物":2,"編む":2,"編集":2,"緩い":2,"緩む":1,"緩める":1,"緩やか":1,"緩和":1,"緯度":2,"練る":1,"練習":5,"縁":3,"縁側":1,"縁談":1,"縄":3,"縛る":2,"縞":2,"縫う":2,"縮まる":1,"縮む":2,"縮める":2,"縮れる":2,"縮小":2,"繁栄":1,"繁殖":1,"繁盛":1,"繊維":1,"繋がり":2,"繋がる":3,"繋ぐ":3,"繋げる":3,"織る":3,"織物":1,"繕う":1,"繰り返す":3,"纏まり":1,"纏め":1,"缶":3,"缶詰":2,"罪":3,"置く":5,"罰":1,"罰する":3,"署名":3,"罵る":1,"罹る":3,"羊毛":2,"美":1,"美しい":4,"美人":3,"美味しい":5,"美容":2,"美術":1,"美術館":4,"群":3,"群がる":1,"群れ":2,"群衆":1,"群集":1,"羨ましい":3,"羨む":2,"義務":3,"義理":1,"羽":3,"羽根":3,"習う":5,"習字":2,"習慣":4,"翻訳":4,"翼":3,"老い":3,"老いる":1,"老ける":1,"老人":3,"老衰":1,"考え":3,"考える":4,"考古学":1,"考慮":3,"者":3,"耐える":1,"耕す":2,"耕作":1,"耕地":2,"耳":5,"耳鼻科":1,"耽る":1,"聖書":1,"聞き取り":1,"聞く":5,"聞こえる":4,"聳える":1,"聴覚":1,"聴診器":1,"聴講":1,"職":3,"職人":2,"職務":1,"職員":1,"職場":2,"職業":3,"肉":5,"肉体":1,"肉親":1,"肌":3,"肌着":2,"肘":2,"肝心":1,"肝腎":1,"股":3,"肩":3,"肯定":2,"育ち":1,"育つ":3,"育てる":4,"育児":2,"育成":1,"肺":3,"胃":3,"背":5,"背く":1,"背中":4,"背広":5,"背後":1,"背景":1,"背負う":2,"胡椒":3,"胴":1,"胸":3,"能":3,"能力":3,"能率":2,"脂":3,"脂肪":3,"脅かす":2,"脅す":1,"脅迫":1,"脆い":1,"脇":3,"脈":1,"脚":5,"脚本":1,"脚色":1,"脱ぐ":5,"脱する":1,"脱出":1,"脱線":2,"脱退":1,"脳":3,"腐る":3,"腐敗":1,"腕":4,"腕前":1,"腫れる":1,"腰":3,"腰掛":2,"腰掛け":2,"腰掛ける":2,"腸":1,"腹":3,"腹立ち":1,"腿":1,"膜":3,"膝":3,"膨らます":2,"膨らむ":2,"膨れる":1,"膨大":2,"膨張":1,"膳":3,"臆病":1,"臨む":3,"臨時":2,"自ずから":1,"自ら":2,"自主":1,"自分":5,"自動":3,"自動車":5,"自在":1,"自宅":2,"自尊心":1,"自己":3,"自慢":3,"自我":1,"自殺":3,"自治":2,"自然":3,"自然科学":2,"自由":4,"自立":1,"自習":2,"自衛":2,"自覚":1,"自身":3,"自転":1,"自転車":5,"自首":1,"臭い":3,"至る":3,"至急":3,"致す":4,"興じる":1,"興味":4,"興奮":3,"興業":1,"舌":3,"舗装":1,"舞う":1,"舞台":3,"舟":4,"航海":3,"航空":3,"船便":2,"船舶":1,"良い":3,"良し":1,"良好":1,"良心":1,"良識":1,"良質":1,"色":5,"色々":5,"色彩":1,"艶":2,"芝":1,"芝居":3,"芝生":3,"芯":2,"花":5,"花びら":1,"花壇":1,"花嫁":2,"花火":2,"花瓶":5,"花粉":1,"花見":4,"芸":1,"芸能":2,"芸術":3,"芽":3,"苗":1,"若々しい":2,"若い":5,"若干":1,"苦":3,"苦い":4,"苦しい":3,"苦しむ":3,"苦労":3,"苦心":2,"苦情":2,"苦手":3,"苦痛":3,"英和":2,"英字":1,"英文":2,"英語":5,"英雄":1,"茂る":2,"茎":1,"茶":3,"茶の湯":1,"茶の間":1,"茶碗":5,"茶色":5,"茶色い":2,"茹でる":3,"草":4,"草履":2,"荒い":2,"荒っぽい":1,"荒らす":1,"荒れる":2,"荒廃":3,"荷":1,"荷物":5,"荷造り":1,"莫大":3,"菌":3,"菓子":3,"華々しい":1,"華やか":1,"華奢":1,"萎びる":1,"萎む":2,"落し物":2,"落す":4,"落ち着き":1,"落ち込む":1,"落る":4,"落下":1,"落着く":2,"落第":2,"落葉":1,"葉":4,"葉書":5,"著しい":1,"著す":3,"著名":1,"著書":1,"著者":3,"葬る":1,"葬式":2,"蒔く":3,"蒸し暑い":3,"蒸す":3,"蒸気":2,"蒸溜":1,"蒸発":2,"蓄える":2,"蓄積":1,"蓋":2,"蔵":1,"蔵相":1,"蕎麦":3,"蕾":1,"薄い":5,"薄める":2,"薄弱":1,"薄暗い":2,"薬":5,"薬品":2,"薬局":2,"薬指":2,"藁":1,"蘇る":2,"虎":3,"虫":4,"虫歯":3,"虹":2,"蚊":3,"蛇口":2,"蛋白質":1,"蛍光灯":2,"蜂蜜":1,"蝶":1,"融資":1,"融通":1,"血":4,"血圧":2,"血液":3,"血管":3,"衆":3,"衆議院":1,"行い":1,"行う":4,"行き":3,"行き違い":1,"行く":5,"行っていらっしゃい":2,"行ってらっしゃい":2,"行事":2,"行儀":3,"行列":2,"行動":3,"行政":1,"行方":2,"行為":1,"行進":1,"街":3,"街角":2,"街道":1,"街頭":1,"衛星":3,"衝撃":1,"衝突":3,"衣料":3,"衣服":3,"衣装":1,"衣類":1,"衣食住":2,"表":4,"表す":3,"表情":3,"表現":3,"表示":3,"表紙":2,"表面":3,"衰える":1,"袋":3,"袖":3,"被せる":2,"被る":3,"被害":3,"裁く":3,"裁判":3,"裁縫":2,"裂く":3,"裂ける":3,"装備":1,"装置":3,"装飾":1,"裏":4,"裏切る":3,"裏口":2,"裏返し":1,"裏返す":2,"補う":2,"補償":3,"補充":1,"補助":1,"補強":1,"補給":1,"補足":1,"裸":3,"裸足":1,"製作":2,"製品":3,"製法":1,"製造":3,"製鉄":1,"裾":1,"複写":2,"複合":1,"複数":2,"複雑":4,"褒める":4,"褒美":1,"襖":2,"襟":1,"襲う":1,"襲撃":1,"西":5,"西日":1,"西暦":2,"西洋":4,"要する":1,"要するに":3,"要る":5,"要因":1,"要旨":2,"要望":1,"要求":3,"要点":3,"要素":3,"要請":1,"要領":2,"覆う":3,"覆す":1,"覆面":1,"見える":4,"見せびらかす":1,"見せる":5,"見せ物":1,"見つかる":4,"見つける":4,"見なす":1,"見る":5,"見上げる":2,"見下ろす":2,"見事":3,"見出し":2,"見合い":1,"見合わせる":1,"見地":1,"見学":2,"見当":3,"見慣れる":2,"見掛け":2,"見掛ける":3,"見晴らし":1,"見本":2,"見渡す":1,"見物":4,"見直す":2,"見積もり":1,"見習う":1,"見舞い":3,"見舞う":2,"見苦しい":1,"見落とす":1,"見解":3,"見計らう":1,"見詰める":2,"見込み":1,"見送り":3,"見送る":2,"見逃す":1,"見通し":1,"規制":3,"規則":4,"規定":1,"規律":2,"規格":1,"規模":1,"規準":2,"規範":1,"規約":1,"視察":1,"視点":3,"視覚":3,"視野":1,"覗く":3,"覚え":1,"覚える":5,"覚ます":3,"覚める":3,"覚悟":3,"親":4,"親しい":3,"親しむ":1,"親切":4,"親友":3,"親善":1,"親戚":3,"親指":2,"親父":1,"親類":2,"観光":3,"観客":3,"観察":3,"観念":2,"観測":2,"観点":1,"観衆":1,"観覧":1,"角":5,"角度":2,"解く":3,"解ける":3,"解剖":1,"解放":2,"解散":2,"解決":3,"解答":2,"解説":2,"解釈":3,"解除":1,"触る":4,"触れる":3,"言い付ける":2,"言い出す":2,"言い訳":1,"言う":5,"言わば":3,"言付け":1,"言付ける":2,"言葉":5,"言葉遣い":2,"言語":3,"言論":1,"訂正":1,"計":3,"計る":3,"計器":3,"計画":4,"計算":3,"討つ":3,"討論":1,"討議":1,"訓":3,"訓練":3,"記す":1,"記事":3,"記入":3,"記号":2,"記名":1,"記念":3,"記憶":3,"記者":3,"記載":1,"記述":1,"記録":3,"訪ねる":4,"訪れる":1,"訪問":3,"設ける":1,"設備":3,"設定":1,"設立":1,"設置":1,"設計":3,"許す":3,"許可":3,"許容":1,"訳":4,"訳す":3,"訴え":1,"訴える":3,"訴訟":1,"診る":3,"診察":3,"診断":2,"診療":1,"証拠":1,"証明":3,"証言":1,"詐欺":1,"評価":3,"評判":3,"評論":2,"試し":3,"試す":3,"試み":1,"試みる":1,"試合":4,"試験":4,"詩":3,"詩人":3,"詫び":1,"詫びる":2,"詰まる":2,"詰める":3,"詰る":1,"話":5,"話し合い":2,"話し合う":3,"話し掛ける":2,"話す":5,"話中":2,"話合い":2,"話題":3,"該当":1,"詳しい":3,"詳細":1,"誇り":3,"誇る":1,"誇張":1,"認める":3,"認識":1,"誓う":2,"誕生":3,"誕生日":5,"誘う":3,"誘導":1,"誘惑":1,"語る":3,"語句":3,"語学":3,"語彙":1,"語源":1,"誠":1,"誠に":1,"誠実":1,"誤り":3,"誤る":1,"誤差":1,"誤解":3,"説":3,"説く":3,"説得":1,"説明":4,"読み":3,"読み上げる":1,"読む":5,"読書":3,"誰":5,"誰か":5,"課":3,"課外":1,"課程":3,"課税":2,"課長":4,"課題":3,"調べ":1,"調べる":4,"調停":1,"調印":1,"調味料":2,"調和":1,"調子":3,"調整":2,"調査":3,"調理":1,"調節":2,"請求":3,"論じる":3,"論ずる":2,"論争":3,"論文":3,"論理":1,"論議":1,"諦め":1,"諦める":3,"諮る":3,"諸君":1,"諺":3,"謎":3,"謎謎":2,"謙虚":2,"謙遜":2,"講堂":4,"講師":2,"講演":3,"講義":4,"講習":1,"講読":1,"謝る":4,"謝絶":1,"謹む":1,"警備":2,"警告":3,"警官":5,"警察":4,"警戒":1,"警部":1,"議事堂":1,"議会":3,"議員":3,"議案":1,"議決":1,"議論":3,"議長":3,"議題":1,"譲る":3,"譲歩":1,"護衛":1,"谷":3,"豆":3,"豊か":3,"豊作":1,"豊富":3,"豚肉":5,"象":3,"象徴":1,"豪華":3,"貝":3,"貝殻":1,"負う":3,"負かす":1,"負け":3,"負ける":4,"負債":1,"負傷":1,"負担":1,"財":1,"財布":5,"財政":1,"財源":1,"財産":3,"貢献":3,"貧しい":3,"貧乏":1,"貧困":1,"貧弱":1,"貨幣":1,"貨物":2,"販売":3,"貫く":1,"貫禄":1,"責める":3,"責任":3,"責務":1,"貯蓄":1,"貯蔵":2,"貯金":3,"貴い":1,"貴族":1,"貴重":3,"買い物":5,"買う":5,"貸し":3,"貸し出し":2,"貸す":5,"貸家":2,"貸間":2,"費やす":1,"費用":3,"貼る":5,"貿易":4,"賃金":1,"賄う":1,"資料":2,"資本":3,"資格":3,"資源":3,"資産":1,"資金":1,"賑わう":1,"賛成":3,"賛美":1,"賜る":1,"賞":3,"賞品":3,"賞金":2,"賠償":1,"賢い":3,"賢明":1,"質":3,"質問":5,"質疑":1,"質素":1,"賭":1,"賭ける":3,"購入":1,"購読":1,"購買":1,"贅沢":3,"贈り物":4,"贈る":3,"赤":5,"赤い":5,"赤ちゃん":4,"赤らむ":1,"赤ん坊":4,"赤字":1,"赤道":2,"走る":5,"走行":1,"赴く":1,"赴任":1,"起きる":5,"起こす":4,"起こる":3,"起伏":1,"起床":2,"起源":3,"起点":1,"超":1,"超える":3,"超す":3,"超過":2,"越える":3,"越す":3,"趣":1,"趣味":4,"趣旨":1,"足":5,"足し算":1,"足す":4,"足りる":4,"足る":2,"足元":2,"足袋":3,"足跡":2,"跡":3,"跡継ぎ":1,"跨ぐ":2,"跳ねる":2,"踊り":4,"踊る":4,"踏まえる":1,"踏み込む":1,"踏む":4,"踏切":2,"蹴る":3,"蹴飛ばす":1,"躓く":2,"身":3,"身なり":1,"身の上":1,"身の回り":1,"身体":3,"身分":2,"身振り":1,"身近":1,"身長":3,"躾":1,"躾ける":1,"車":5,"車庫":2,"車掌":2,"車輪":2,"軌道":1,"軍":3,"軍事":1,"軍備":1,"軍服":1,"軍艦":1,"軍隊":3,"軒":3,"軒並":1,"軟らかい":2,"転々":2,"転がす":2,"転がる":2,"転じる":1,"転ずる":1,"転ぶ":3,"転任":1,"転勤":1,"転回":1,"転居":1,"転換":1,"転校":3,"転落":1,"軸":1,"軽い":5,"軽快":1,"軽減":1,"軽率":1,"軽蔑":1,"載せる":3,"載る":3,"輝く":3,"輪":3,"輸入":4,"輸出":4,"輸血":2,"輸送":2,"辛い":5,"辛抱":1,"辞める":3,"辞典":4,"辞書":5,"辞職":1,"辞退":3,"辟易":1,"農地":1,"農場":1,"農家":3,"農村":2,"農業":3,"農民":3,"農産物":2,"農耕":1,"農薬":2,"辺":5,"辺り":3,"込む":4,"込める":1,"辿り着く":1,"辿る":1,"迅速":1,"迎え":3,"迎える":4,"近々":2,"近い":5,"近く":5,"近付ける":2,"近代":3,"近寄る":2,"近所":4,"近眼":1,"近視":3,"近郊":1,"近頃":3,"返す":5,"返事":4,"返済":1,"返答":1,"返還":1,"迫る":2,"迫害":1,"述べる":3,"述語":2,"迷う":3,"迷信":2,"迷子":3,"迷惑":3,"追いかける":2,"追い付く":3,"追い出す":1,"追い越す":2,"追い込む":1,"追う":3,"追加":2,"追及":1,"追放":1,"追跡":1,"退く":3,"退ける":2,"退化":1,"退学":3,"退屈":3,"退治":1,"退職":1,"退院":4,"送り仮名":2,"送る":4,"送別":2,"送料":2,"送金":1,"逃がす":2,"逃げる":4,"逃げ出す":1,"逃す":1,"逃れる":1,"逃亡":1,"逃走":1,"逆":3,"逆さ":2,"逆らう":3,"逆様":2,"逆立ち":1,"逆転":1,"透き通る":2,"透明":2,"途上":1,"途中":4,"途端":3,"途絶える":1,"這う":2,"通う":4,"通じる":3,"通す":3,"通ずる":2,"通り":4,"通り掛かる":2,"通り過ぎる":3,"通る":4,"通信":3,"通勤":3,"通学":3,"通帳":2,"通常":1,"通用":2,"通知":2,"通行":3,"通訳":3,"通貨":3,"通路":2,"通過":3,"速い":5,"速力":2,"速度":3,"速達":2,"造り":1,"造船":2,"連なる":1,"連ねる":1,"連れ":3,"連れる":4,"連中":1,"連休":1,"連合":2,"連帯":1,"連想":3,"連日":1,"連盟":1,"連絡":4,"連続":3,"連邦":1,"逮捕":3,"週":3,"進み":1,"進む":4,"進める":3,"進出":1,"進化":1,"進呈":1,"進学":3,"進展":1,"進度":1,"進歩":3,"進行":3,"逸れる":2,"遂げる":1,"遂に":3,"遅い":5,"遅くとも":1,"遅らす":1,"遅れ":3,"遅れる":4,"遅刻":3,"遊び":4,"遊ぶ":5,"遊園地":2,"遊牧":1,"運":3,"運ぶ":4,"運動":4,"運命":1,"運営":1,"運搬":1,"運河":2,"運用":1,"運賃":1,"運転":4,"運転手":4,"運輸":1,"運送":1,"過ぎる":4,"過ごす":3,"過ち":1,"過剰":2,"過労":1,"過半数":2,"過去":3,"過失":2,"過密":1,"過疎":1,"過程":3,"道":5,"道具":4,"道場":1,"道徳":3,"道路":3,"道順":2,"達する":3,"達成":1,"達者":1,"違い":3,"違いない":3,"違う":5,"違える":1,"違反":3,"遠い":5,"遠く":4,"遠ざかる":1,"遠回り":1,"遠慮":4,"遠方":1,"遠足":2,"遡る":2,"遥か":1,"適する":3,"適切":3,"適宜":1,"適度":3,"適当":4,"適応":1,"適性":1,"適用":3,"適確":2,"遭う":3,"遭難":1,"遮る":1,"選ぶ":4,"選手":3,"選択":3,"選挙":3,"選考":3,"遺跡":1,"避ける":3,"避難":1,"還元":1,"還暦":1,"邪魔":4,"邸宅":1,"郊外":4,"郡":3,"部下":1,"部分":3,"部品":2,"部屋":5,"部長":4,"部門":1,"部首":2,"郵便":3,"郵便局":5,"郵送":2,"郷土":1,"郷愁":1,"郷里":1,"都":4,"都会":3,"都合":4,"都市":3,"都心":2,"酌む":3,"配る":2,"配偶者":1,"配分":1,"配列":1,"配布":1,"配慮":1,"配給":1,"配置":1,"配達":3,"酒":3,"酒場":2,"酔う":3,"酔っ払い":2,"酢":3,"酪農":1,"酸":1,"酸化":3,"酸性":3,"酸素":3,"醜い":2,"醤油":5,"重い":5,"重たい":2,"重なる":3,"重ねる":3,"重んじる":1,"重んずる":1,"重体":3,"重力":2,"重大":3,"重宝":1,"重役":2,"重点":2,"重複":1,"重要":3,"重視":3,"重量":2,"野":3,"野党":3,"野外":1,"野心":1,"野生":1,"野菜":5,"量":3,"量る":3,"金":3,"金属":3,"金庫":3,"金曜日":5,"金槌":1,"金融":3,"金銭":3,"金額":3,"金魚":2,"釘":2,"釜":2,"針":3,"針路":2,"針金":2,"釣":3,"釣り合う":2,"釣り鐘":1,"釣る":4,"鈍い":2,"鈍る":1,"鈍感":1,"鈴":2,"鉄":3,"鉄棒":1,"鉄橋":2,"鉄砲":2,"鉄道":3,"鉄鋼":1,"鉛":1,"鉛筆":5,"鉢":2,"鉱山":1,"鉱業":1,"鉱物":2,"銀":3,"銀行":5,"銃":3,"銅":2,"銅貨":3,"銘々":2,"鋭い":3,"錆":2,"錆びる":2,"錯誤":1,"録音":2,"鍋":3,"鍛える":1,"鍵":5,"鎖":3,"鏡":4,"鐘":3,"鑑賞":2,"長々":1,"長い":5,"長女":2,"長官":1,"長引く":2,"長所":2,"長方形":2,"長期":3,"長男":2,"長短":2,"長編":1,"門":5,"閉じる":3,"閉まる":5,"閉める":5,"閉会":2,"閉口":1,"閉鎖":1,"開く":5,"開ける":5,"開会":2,"開催":1,"開始":3,"開拓":1,"開放":2,"開発":1,"開通":2,"間":4,"間に合う":4,"間もなく":2,"間も無く":2,"間接":2,"間柄":1,"間違い":3,"間違える":4,"間隔":3,"関する":3,"関与":1,"関係":4,"関心":3,"関東":2,"関税":1,"関西":2,"関連":3,"閲覧":1,"闇":1,"防ぐ":3,"防止":2,"防火":1,"防犯":2,"防衛":1,"阻む":1,"阻止":1,"附属":2,"降りる":5,"降る":5,"降ろす":3,"降伏":3,"降水":1,"限り":2,"限る":3,"限定":1,"限度":2,"限界":3,"陣":1,"除く":3,"除外":1,"陰":3,"陰気":1,"陳列":1,"陶器":1,"陸":3,"険しい":2,"陽射":2,"陽気":3,"隅":4,"隊":3,"階層":1,"階段":5,"階級":1,"随分":4,"随筆":2,"隔たる":1,"隔てる":2,"隔週":1,"隙":2,"隙間":2,"際":3,"障る":1,"障子":2,"障害":3,"隠す":3,"隠れる":3,"隠居":1,"隣":5,"雄":1,"集まり":3,"集まる":4,"集める":4,"集中":3,"集会":2,"集合":2,"集団":3,"集計":1,"集金":2,"雇う":3,"雌":1,"雑":1,"雑巾":2,"雑木":1,"雑誌":5,"雑談":1,"雑貨":1,"雑音":2,"雛":1,"雛祭":1,"離す":3,"離れる":3,"離婚":3,"難":3,"難しい":5,"雨":5,"雨具":1,"雨天":1,"雨戸":2,"雪":5,"雪崩":1,"雫":1,"雰囲気":3,"雲":4,"零":5,"零点":2,"雷":3,"電力":2,"電報":4,"電子":3,"電柱":2,"電気":5,"電池":2,"電波":2,"電流":2,"電源":1,"電灯":4,"電球":2,"電話":5,"電車":5,"需要":3,"震える":3,"震わせる":1,"霜":3,"霞む":1,"霧":3,"霰":1,"露":3,"露骨":1,"青":5,"青い":5,"青少年":2,"青年":3,"青春":1,"青白い":2,"静か":5,"静まる":2,"静止":1,"静的":1,"非常":3,"非常に":4,"非行":3,"非難":1,"面":3,"面する":1,"面会":1,"面倒":3,"面倒臭い":2,"面接":3,"面白い":5,"面目":1,"面積":2,"革":3,"革命":1,"革新":1,"靴":5,"靴下":5,"鞠":1,"音":4,"音楽":5,"音色":1,"響き":2,"響く":2,"頂上":3,"頂点":2,"項目":2,"順":3,"順々":2,"順序":2,"順番":3,"順調":3,"預かる":3,"預ける":3,"預金":1,"頑丈":1,"頑固":1,"頑張る":4,"領事":2,"領収":2,"領土":1,"領地":1,"領域":1,"領海":1,"頬":3,"頭":5,"頭痛":3,"頭脳":2,"頻繁":1,"頼む":5,"頼もしい":2,"頼る":3,"題":3,"題する":1,"題名":3,"額":3,"顎":1,"顔":5,"顔付き":1,"顕微鏡":2,"願い":3,"願う":3,"願書":1,"類":1,"類似":1,"類推":1,"顧みる":1,"風":5,"風俗":1,"風呂敷":2,"風土":1,"風景":3,"風習":1,"風船":2,"風車":1,"風邪":5,"飛ばす":3,"飛び出す":3,"飛び込む":2,"飛ぶ":5,"飛行":3,"飛行場":4,"飛行機":5,"食い違う":1,"食う":3,"食べる":5,"食べ物":5,"食事":4,"食卓":3,"食品":3,"食器":2,"食堂":5,"食塩":2,"食料":3,"食料品":4,"食欲":3,"食物":3,"食糧":3,"飢える":2,"飢饉":2,"飯":3,"飲み物":5,"飲み込む":1,"飲む":5,"飴":5,"飼う":3,"飼育":1,"飽きる":3,"飽くまで":2,"飽和":1,"飾り":3,"飾る":4,"餅":2,"養う":1,"養分":2,"養護":1,"餌":3,"首":4,"首相":3,"首脳":1,"首輪":1,"首都":3,"首飾り":1,"香り":3,"香水":2,"香辛料":1,"馬":3,"馬鹿":3,"馴々しい":1,"馴らす":3,"馴れる":3,"駄作":1,"駅":5,"駆けっこ":1,"駆ける":3,"駆け足":1,"駐車":3,"駐車場":4,"騒々しい":2,"騒がしい":2,"騒ぎ":3,"騒ぐ":4,"騒動":1,"騒音":3,"騙す":3,"驚かす":2,"驚き":3,"驚く":4,"驚異":1,"骨":3,"骨折":3,"骨董品":1,"高い":5,"高まる":3,"高める":3,"高価":3,"高原":1,"高尚":1,"高層":2,"高度":2,"高校":4,"高校生":4,"高等":2,"高等学校":4,"高級":2,"高速":3,"髪":4,"髪の毛":3,"鬼":3,"魂":1,"魅力":3,"魚":5,"鮮やか":1,"鳥":5,"鳥居":1,"鳴く":5,"鳴らす":3,"鳴る":4,"鶏肉":5,"麓":2,"麻":1,"麻痺":1,"麻酔":1,"黄色":5,"黄色い":5,"黄金":1,"黒":5,"黒い":5,"黒字":1,"黒板":3,"黙る":3,"鼠":3,"鼻":5};

})();
