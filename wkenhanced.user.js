// ==UserScript==
// @name         WKEnhanced
// @namespace    https://github.com/jbrelly/wk-ik-examples
// @version      2.0.0
// @description  Example sentences (audio + image) inlaid into WaniKani vocab reviews, served from the WKEnhanced API.
// @author       jbrelly
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @connect      api.wkenhanced.dev
// @connect      localhost
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ---------- Constants ----------

    const SCRIPT_ID = 'wkenhanced';
    const SCRIPT_TITLE = 'WKEnhanced';
    const SCRIPT_VERSION = '2.0.0';

    // API server endpoints. Single source of truth for prod / dev URLs; lift
    // here when changing the deployed domain. Note: changing PROD_API_BASE
    // also requires updating the `@connect` directive in the metadata block
    // at the top of this file (Tampermonkey re-prompts the user when the
    // metadata changes).
    const PROD_API_BASE = 'https://api.wkenhanced.dev';
    const DEV_API_BASE = 'http://localhost:3000';

    const WKOF_VERSION_NEEDED = '1.0.52';

    const SELECTIONS_CACHE_KEY = `${SCRIPT_ID}.selections`;
    // Persistent map of per-word refresh-button selections: { <word>: { s, i, b } }.
    const TURBO_EVENTS_URL =
        'https://update.greasyfork.org/scripts/501980/Wanikani%20Open%20Framework%20Turbo%20Events.user.js';

    // ---------- API server cache ----------
    //
    // The userscript only talks to the wk-enhanced-api server; all upstream
    // resolution (ImmersionKit, DuckDuckGo, Google TTS, title decoding, JLPT
    // scoring) happens server-side. The direct-path code from v1.x lives in
    // legacy/ as a frozen fallback and is no longer maintained.
    //
    // Cache: payloads are stored under SERVER_CACHE_PREFIX keyed by the raw
    // (un-encoded) word. ETag round-trips: we send `If-None-Match` when
    // revisiting a word; the server 304s when fetchedAt hasn't moved, so
    // revisits are zero-byte.
    const SERVER_CACHE_PREFIX = `${SCRIPT_ID}.payload.`;
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

    // CSS class prefix is intentionally kept at 'wk-ik' — it's an
    // implementation-detail class namespace used by injectStyles; renaming
    // would touch ~140 hardcoded CSS rule strings in this file for zero
    // user-visible benefit. The user-facing rebrand happens via @name,
    // SCRIPT_TITLE, and the SCRIPT_ID-prefixed log lines.
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
        // Base URL of the wk-enhanced-api server. Defaults to PROD_API_BASE;
        // for local dev set to DEV_API_BASE in settings. Trailing slash is
        // stripped at use time. Empty disables data fetching entirely (cards
        // render empty) — use the legacy/ snapshot if you need a fallback
        // for a prolonged server outage.
        apiServerUrl: PROD_API_BASE,
        // On review-session entry, batch-fetch this many upcoming subjects
        // via POST /v1/vocab/batch so the next cards render instantly from
        // local cache. 0 disables; capped at SERVER_BATCH_MAX (50).
        prefetchCount: 10,
    };

    // ---------- WKOF presence + version check ----------

    // `@grant unsafeWindow` puts us in Tampermonkey's sandbox. WKOF is installed
    // by a separate userscript on the page's window (its own @grant is `none`),
    // so we reach it via unsafeWindow. Any global that needs to be reachable
    // from the devtools console (debug helpers, openWkEnhancedSettings) must
    // be set on PAGE_WIN, not window.
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
        .then(registerListeners)
        .then(() => {
            // Expose console-callable helpers in the page context.
            PAGE_WIN.openWkEnhancedSettings = openSettings;
            PAGE_WIN.debugWkEnhanced = debugWkEnhanced;
            PAGE_WIN.debugWkEnhancedApi = debugWkEnhancedApi;
            console.log(
                `[${SCRIPT_ID}] boot OK. Console: openWkEnhancedSettings() | debugWkEnhanced() | debugWkEnhancedApi('<word>')`
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
    // entries by our prefix. Read-only — purely informational for the settings
    // dialog's "Cache" section. Returns the raw counts and a sorted list of
    // cached vocab words so the user can see what's accumulated.
    function buildCacheSummary() {
        const dir = (wkof.file_cache && wkof.file_cache.dir) || {};
        const summary = {
            serverPayloads: 0,
            serverWords: [],
            selections: Object.keys(state.selections || {}).length,
        };
        for (const key of Object.keys(dir)) {
            if (key.startsWith(SERVER_CACHE_PREFIX)) {
                summary.serverPayloads++;
                try {
                    summary.serverWords.push(decodeURIComponent(key.slice(SERVER_CACHE_PREFIX.length)));
                } catch (_) { /* corrupt key — count but don't list */ }
            }
        }
        summary.serverWords.sort();
        return summary;
    }

    // Estimate the on-disk size of a single cache entry, in UTF-8 bytes.
    // Measures the JSON serialization via Blob to get the real UTF-8 length
    // (JSON.stringify().length only counts UTF-16 code units, which under-
    // estimates Japanese characters by a factor of ~3).
    function estimateEntrySize(entry) {
        if (!entry || typeof entry !== 'object') return 0;
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

    // Walk our cache entries and sum byte-estimates per category. Async —
    // each load is an IndexedDB read; runs in parallel to minimize wall-
    // clock time. Returns a buckets object + total. Safe to call on an
    // empty cache (returns all zeros). Never rejects — entries that fail
    // to load contribute 0.
    //
    // Only inspects keys under our SERVER_CACHE_PREFIX and the selections
    // key. Leftover entries from older versions of this userscript (the
    // `wk-ik-examples.*` prefixes from the v1.x direct path) sit in
    // IndexedDB until the user runs Clear cache, but they're not counted
    // or shown — this UI reflects our current footprint, not historical
    // leakage.
    function measureCacheSizes() {
        const dir = (wkof.file_cache && wkof.file_cache.dir) || {};
        const ourKeys = Object.keys(dir).filter((k) =>
            k.startsWith(SERVER_CACHE_PREFIX) || k === SELECTIONS_CACHE_KEY,
        );
        const buckets = {
            serverPayloads: 0,
            selections: 0,
        };
        const tasks = ourKeys.map((key) =>
            wkof.file_cache.load(key)
                .then((entry) => ({ key, size: estimateEntrySize(entry) }))
                .catch(() => ({ key, size: 0 }))
        );
        return Promise.all(tasks).then((results) => {
            for (const { key, size } of results) {
                if (key.startsWith(SERVER_CACHE_PREFIX)) buckets.serverPayloads += size;
                else if (key === SELECTIONS_CACHE_KEY) buckets.selections += size;
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
    // each row's size span is replaced as measureCacheSizes() resolves.
    function populateCacheInfo() {
        const el = document.getElementById(`${SCRIPT_ID}-cache-info`);
        if (!el) return;
        const s = buildCacheSummary();
        el.innerHTML = '';
        const bucketRows = [
            { key: 'serverPayloads', label: 'API server payloads', count: `${s.serverPayloads} word(s)` },
            { key: 'selections', label: 'Refresh-button selections', count: `${s.selections} word(s)` },
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

        if (s.serverWords.length) {
            const details = document.createElement('details');
            details.style.marginTop = '0.5em';
            details.style.paddingTop = '0.4em';
            details.style.borderTop = '1px solid rgba(0,0,0,0.1)';
            const summaryEl = document.createElement('summary');
            summaryEl.style.cursor = 'pointer';
            summaryEl.textContent = `Cached words (${s.serverWords.length})`;
            details.appendChild(summaryEl);
            const wordsBox = document.createElement('div');
            wordsBox.style.marginTop = '0.4em';
            wordsBox.style.fontSize = '0.95em';
            wordsBox.style.opacity = '0.85';
            wordsBox.style.maxHeight = '180px';
            wordsBox.style.overflowY = 'auto';
            wordsBox.style.lang = 'ja';
            wordsBox.textContent = s.serverWords.join(', ');
            details.appendChild(wordsBox);
            el.appendChild(details);
        } else {
            const hint = document.createElement('div');
            hint.style.marginTop = '0.5em';
            hint.style.fontSize = '0.95em';
            hint.style.opacity = '0.7';
            hint.textContent = '(no vocab cached yet — words will appear here as you review)';
            el.appendChild(hint);
        }
    }

    function openSettings() {
        const dialog = new wkof.Settings({
            script_id: SCRIPT_ID,
            title: SCRIPT_TITLE,
            on_save: () => {
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
                                'When on, display an illustration of the vocab word after you answer the meaning question. The image pool comes from the API server — a scene screenshot when one is available for that sentence, plus DuckDuckGo illustrations as fallbacks. Cycle through them with the refresh button.',
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
                                'Playback speed for the example sentence audio. Native voice-actor audio (anime/drama) is often too fast for intermediate listening — try 0.75x to parse morphology, then rebuild to 1x. Affects all audio sources; takes effect on the next card render.',
                        },
                        apiServer: {
                            type: 'section',
                            label: 'API server',
                        },
                        apiServerUrl: {
                            type: 'text',
                            label: 'API server URL',
                            default: DEFAULTS.apiServerUrl,
                            placeholder: DEV_API_BASE,
                            hover_tip:
                                `Base URL of the wk-enhanced-api server. Defaults to ${PROD_API_BASE}; for local dev set to ${DEV_API_BASE}. Trailing slash is stripped. Leave blank to disable data fetching entirely (cards render empty).`,
                        },
                        prefetchCount: {
                            type: 'number',
                            label: 'Prefetch upcoming subjects (0 = off)',
                            default: DEFAULTS.prefetchCount,
                            min: 0,
                            max: 50,
                            hover_tip:
                                'On review-session entry, batch-fetch this many upcoming subjects via POST /v1/vocab/batch so subsequent cards render instantly from local cache. Capped at 50 (the server batch endpoint limit).',
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
                                'When on, prefer examples that came with original voice-actor audio (anime/drama/games) over text-only literature. Voice-actor audio is the primary source — you only hear synthesized speech when the upstream had no recording for that line.',
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
                                'Hard filter — absolutely no sentences whose hardest surrounding word is above this level will be selected. Falls back to showing some sentence when no candidate qualifies. JLPT scoring is computed server-side; conjugated verbs and proper nouns are treated as unknown and don\'t block a sentence (fail-open).',
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
                            label: 'Cached payloads + selections + legacy entries',
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

    function clearCache() {
        // Wipe our current payload cache + selections, plus any leftover
        // entries from v1.x's direct-path prefixes (`wk-ik-examples.*`,
        // `wk-vocab-cache.*`). Users upgrading from v1.x will have those
        // sitting in IndexedDB until they hit this button.
        Promise.all([
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(SERVER_CACHE_PREFIX))),
            wkof.file_cache.delete(SELECTIONS_CACHE_KEY),
            // Best-effort cleanup of v1.x prefixes.
            wkof.file_cache.delete(/^wk-ik-examples\./).catch(() => 0),
            wkof.file_cache.delete(/^wk-vocab-cache\./).catch(() => 0),
        ])
            .then(() => {
                state.selections = {};
                // If the settings dialog is open, refresh the cache-info section
                // so the user sees the zeroed counts. No-op when the dialog is
                // closed (the element won't exist).
                populateCacheInfo();
                alert(`${SCRIPT_TITLE}: cache cleared (payloads + selections + legacy v1.x entries).`);
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
   the ~82px __content box (verified via debugWkEnhanced() DOM dump). Demote
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
   Modal-style backdrop with a centered panel listing all candidate sentences
   the server returned for the current word. Faded rows are above the JLPT
   ceiling but still clickable — picking one flips the per-card bypass flag so
   they stay reachable via ⟳. */
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
/* Loading placeholder shown between subject change and server-fetch
   completion. Tucked into the bottom-left like the empty-card message so it
   doesn't compete with the centered vocab character. Subtle white-on-purple
   spinner; the goal is "something is happening" not "look at me". */
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
            // Loading placeholder shown for the duration of the server fetch.
            // Replaced in place by renderCard / renderEmptyCard when the
            // promise resolves. Safe to render even on cache hits — getExamples
            // resolves via microtask before the next paint, so the spinner
            // never actually flashes when the answer is already in cache.
            renderLoadingCard();
            const renderT0 = Date.now();
            console.log(`[${SCRIPT_ID}] subject.start`, {
                word: subject.characters,
                subjectId: subject.id,
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
                    // Capped to SERVER_BATCH_MAX (the batch endpoint's limit).
                    const prefs = settings();
                    const prefetchN = Math.max(
                        0,
                        Math.min(SERVER_BATCH_MAX, prefs.prefetchCount | 0 || 0),
                    );
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
    // Warm the local payload cache for subjects WK is about to show, so the
    // next card render skips the server round-trip (no spinner, no fetch
    // latency). One POST /v1/vocab/batch covers up to SERVER_BATCH_MAX
    // upcoming words; batch-missing words fall back to individual GETs
    // (which lazy-warm server-side).
    //
    // WK doesn't publish an "upcoming items" API surface, so we read it out of
    // the live quiz-queue Stimulus controller's DOM. WK's Stimulus controllers
    // typically expose state via `data-<controller>-<name>-value` attributes
    // containing JSON — for the quiz queue we look for any value attribute
    // that parses as an array whose entries have a `characters` field.
    //
    // The whole thing is best-effort: if WK's queue isn't exposed in a shape
    // we recognize, we log once and skip — no harm done, just no prefetch
    // benefit. Call debugWkEnhanced() to dump the queue DOM if you want to
    // investigate what WK is actually exposing.
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
                    `(call debugWkEnhanced() to investigate the quiz-queue surface)`
                );
            }
            return;
        }
        // Skip words that already have a fresh local payload, then bulk-fetch
        // the rest in one round trip via POST /v1/vocab/batch. The batch
        // endpoint never lazy-warms — any words the server hasn't cached come
        // back in `missing`, and we fire individual GETs for them (which DO
        // lazy-warm) so the next visit hits a populated row.
        console.log(`[${SCRIPT_ID}] prefetch: ${chars.length} upcoming: ${chars.join(', ')}`);
        Promise.all(chars.map((c) => {
            return wkof.file_cache.load(serverCacheKey(c))
                .then((entry) => isServerCacheFresh(entry) ? c : null)
                .catch(() => null);
        })).then((cachedFlags) => {
            const toFetch = chars.filter((_, i) => cachedFlags[i] === null);
            if (!toFetch.length) return;
            fetchVocabBatch(toFetch).then(({ missing }) => {
                if (missing && missing.length) {
                    console.log(`[${SCRIPT_ID}] prefetch: ${missing.length} cold; lazy-warming individually`);
                    for (const w of missing) {
                        fetchVocab(w).catch(() => {});
                    }
                }
            });
        });
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

    // Ad-hoc DOM inspector — call `debugWkEnhanced()` from the console to dump the current
    // state of every panel/marker we know about. Useful when reveal detection misfires.
    function debugWkEnhanced() {
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

    // Diagnostic helper for the API-server path:
    // - reports the resolved API base URL,
    // - hits /v1/health and dumps the result,
    // - runs a raw GET /v1/vocab/{word} (default '食べる') and dumps response shape,
    // - dumps the local payload-cache size and the cached entry for that word.
    //
    // Exposed on PAGE_WIN so it's callable from devtools as `debugWkEnhancedApi()`
    // even though the userscript runs in the Tampermonkey sandbox.
    function debugWkEnhancedApi(word) {
        const tag = `--- debugWkEnhancedApi(${JSON.stringify(word || '食べる')}) ---`;
        console.log(tag);
        const prefs = settings();
        const base = getApiBase();
        console.log('settings:', {
            apiServerUrl: prefs.apiServerUrl,
            prefetchCount: prefs.prefetchCount,
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

    // Pick the example at the given index from the cached raw array.
    function pickFromCached(cached, index) {
        if (!cached || !cached.raw || !cached.raw.length) return null;
        return pickExample(cached.raw, settings(), index || 0);
    }

    // Refresh-button handlers: advance one index at a time and re-render the card.
    // Both indices wrap on overflow via modulo inside pickExample/loadImageAt.
    //
    // Sentence refresh ALSO resets imageIdx → the new sentence comes with its
    // own source screenshot, and that should become the default. If the user
    // wants a different image they can press the image-refresh button (which
    // cycles through the server-provided fallback pool).
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

    // ---------- API server path ----------
    //
    // The userscript only talks to the wk-enhanced-api server. The server
    // owns all upstream coordination (IK / DDG / Google TTS, JLPT scoring,
    // title decoding). serverPayloadToCacheEntry reshapes the server's
    // payload (camelCase, nested source, pre-resolved jlptMax + media URLs)
    // into IK-raw-lookalike entries so the picker / renderer / pool code
    // can stay shaped around IK's original field names — a historical
    // artifact of the migration that's harmless to leave in place.

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

    // Top-level entry point for the data layer:
    //   1. Try local cache. If fresh, adapt and return.
    //   2. Otherwise call fetchVocab(word) — which itself sends If-None-Match
    //      and may resolve 304 with cached payload.
    // Returns the cache-entry shape { fetchedAt, raw, chosen } that
    // pickExample / buildPool / renderCard consume.
    function getExamples(word) {
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
    // network error. Updates local cache on 200. Uses native fetch() — the
    // server's CORS is permissive (Access-Control-Allow-Origin: *) so we
    // don't need GM_xmlhttpRequest or any Tampermonkey @connect gates beyond
    // the api.wkenhanced.dev declaration in the metadata block.
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
    //   - server's camelCase fields → snake_case names that downstream reads
    //     (sentence_with_furigana, word_list, title) — these names are an
    //     artifact of the historical IK shape; cheaper to keep them than
    //     rename every consumer
    //   - server's pre-resolved jlptMax → _jlptMax (0..5 with 0 = unknown
    //     sentinel, fail-open in buildPool's ceiling filter)
    //   - server's hasOriginalAudio → a non-empty `sound` sentinel string so
    //     hasOriginalAudio(e) returns true for the buildPool requireAudio filter
    //   - server's pretty source title → stashed as _prettyTitle so the
    //     renderer / picker display it directly
    //   - server's pre-built audioUrl / imageUrl → stashed as _serverAudioUrl
    //     / _serverImageUrl; formatExample / resolveAudioBlobUrl read these
    //   - payload.fallbackImages → stashed on every entry as
    //     _serverFallbackImages so loadImageAt can render them
    function serverPayloadToCacheEntry(payload) {
        if (!payload || !Array.isArray(payload.examples)) {
            return { fetchedAt: Date.now(), raw: [], chosen: null };
        }
        const fallbacks = Array.isArray(payload.fallbackImages) ? payload.fallbackImages : [];
        const raw = payload.examples.map((e) => {
            const src = e.source || {};
            return {
                sentence: e.sentence || '',
                sentence_with_furigana: e.sentenceFurigana || '',
                translation: e.translation || '',
                word_list: Array.isArray(e.wordList) ? e.wordList : [],
                title: src.encodedTitle || '',
                deck_name: src.encodedTitle || '',
                sound: e.hasOriginalAudio ? '__server_audio__' : '',
                _jlptMax: typeof e.jlptMax === 'number' ? e.jlptMax : 0,
                _prettyTitle: src.title || '',
                _serverAudioUrl: e.audioUrl || null,
                _serverImageUrl: e.imageUrl || null,
                _serverFallbackImages: fallbacks,
                _serverExampleId: e.id || null,
            };
        });
        // Pre-pick `chosen` as a positive-hit signal; the renderer always
        // re-picks from `raw` at the current state.sentenceIdx anyway.
        const chosen = raw.length ? pickExample(raw, settings(), 0) : null;
        return {
            fetchedAt: typeof payload.fetchedAt === 'number' ? payload.fetchedAt : Date.now(),
            chosen,
            raw,
        };
    }

    // ---------- Audio + Image ----------

    // Server-resolved audio URL passthrough. The server has already decided
    // which source to serve (ImmersionKit voice-actor recording when one
    // exists upstream, pre-rendered Google TTS fallback otherwise) and
    // baked the result into its CDN; we just hand the URL to the <audio>
    // element. The server's `Cache-Control: max-age=31536000, immutable`
    // header lets the browser HTTP cache hold the bytes indefinitely.
    //
    // Returns a URL the <audio> element can play, or rejects if the
    // example has no audio URL (the renderer falls back to Web Speech
    // synthesis — see speakWithWebSpeech below).
    function resolveAudioBlobUrl(example) {
        const sentencePreview = (example && example.sentence || '').slice(0, 30);
        const url = example && example.ikAudioUrl;
        if (!url) {
            return Promise.reject(new Error('no_audio_url'));
        }
        console.log(`[${SCRIPT_ID}] audio.source server-cdn`, {
            sentence: sentencePreview,
            url,
        });
        return Promise.resolve(url);
    }

    // Last-resort fallback when the server CDN URL fails to play (network
    // error, CORS blip, content gone). Uses the browser's Web Speech API —
    // Kyoko on macOS, Microsoft Haruka / Sayaka on Windows. Synth quality
    // is rough but it's free and always available.
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

    // Resolve image #index from the combined pool:
    //   pool = [ikImageUrl (if non-null), ...serverFallbacks]
    // So index 0 is always the IK-source screenshot when the server resolved
    // one for this example; the fallback CDN URLs (DuckDuckGo illustrations
    // the server pre-fetched) fill positions 1..N. When the upstream had no
    // screenshot, fallbacks occupy the whole pool starting at index 0.
    // Index wraps via modulo so the refresh button cycles forever.
    //
    // Calls onSuccess(url, poolSize) or onError().
    function loadImageAt(word, ikImageUrl, index, onSuccess, onError, serverFallbacks) {
        const idx = Math.max(0, index | 0);
        const fallbackUrls = Array.isArray(serverFallbacks) ? serverFallbacks : [];
        const pool = ikImageUrl ? [ikImageUrl, ...fallbackUrls] : fallbackUrls;
        if (pool.length === 0) {
            console.warn(`[${SCRIPT_ID}] image.pool empty`, { word, hasIk: !!ikImageUrl });
            onError && onError();
            return;
        }
        const wrappedIdx = idx % pool.length;
        const chosenIsIk = !!ikImageUrl && wrappedIdx === 0;
        console.log(`[${SCRIPT_ID}] image.pool`, {
            word,
            hasIk: !!ikImageUrl,
            fallbacks: fallbackUrls.length,
            poolSize: pool.length,
            requestedIdx: index,
            wrappedIdx,
            chosen: chosenIsIk ? 'ik' : 'fallback',
        });
        onSuccess(pool[wrappedIdx], pool.length);
    }

    // Returns the encoded source title for an example. The server populates
    // this from upstream IK metadata; we use it as the key on _prettyTitle
    // lookups and as a fallback identifier for logging.
    function getTitle(e) {
        return (e && (e.title || e.deck_name)) || '';
    }

    // Display form of the source title. The server always pre-resolves the
    // pretty title (e.g. "Durarara!!", "God's Blessing on this Wonderful
    // World!") and stashes it as _prettyTitle on every example — see
    // serverPayloadToCacheEntry. For the rare case where _prettyTitle is
    // missing or empty (legacy cache, malformed payload), we fall through
    // to the raw encoded title rather than guessing.
    function prettifyTitle(title) {
        return title ? String(title) : '';
    }

    // `requireAudio` is a sentence-source filter: prefer examples that came
    // with original voice-actor audio (anime/drama/games) over text-only
    // literature. serverPayloadToCacheEntry sets `sound` to a sentinel
    // string when the upstream payload's hasOriginalAudio is true.
    function hasOriginalAudio(e) {
        return !!(e && (e.sound || e.sound_url));
    }

    // JLPT scoring (formerly scoreJlpt) is computed server-side and arrives
    // on every example as _jlptMax — 1..5 (5 = N5 easiest, 1 = N1 hardest)
    // when at least one surrounding token was classifiable, 0 as the
    // "unknown" sentinel otherwise. buildPool treats 0 as fail-open (passes
    // any ceiling) and the picker renders "?" instead of a misleading "N5".

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
    // sorted) array — same object references as input. Each filter step
    // "falls back" to the unfiltered pool if it would empty the pool: better
    // to show some sentence than none.
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
            // ties preserve the server's incoming order. When neither
            // preference is set (preferred='any' and sentencePreference=
            // 'first') we leave the pool in the server's order.
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

    // Format an example into the shape renderCard consumes. The server has
    // already resolved the CDN URLs for audio + image and the pretty title;
    // we just forward them under field names the renderer expects.
    function formatExample(e, poolSize) {
        return {
            sentence: e.sentence || '',
            sentence_with_furigana: e.sentence_with_furigana || '',
            translation: e.translation || '',
            title: getTitle(e),
            ikAudioUrl: e._serverAudioUrl || null,
            ikImageUrl: e._serverImageUrl || null,
            poolSize,
            _serverFallbackImages: e._serverFallbackImages || null,
            _prettyTitle: e._prettyTitle || '',
        };
    }

    // Pretty source-name for display. The server pre-resolves this for every
    // example; we just prefer the pre-resolved version and fall through to
    // the raw encoded title only for malformed payloads.
    function displayTitle(eOrRaw) {
        if (eOrRaw && eOrRaw._prettyTitle) return eOrRaw._prettyTitle;
        return prettifyTitle(getTitle(eOrRaw));
    }

    let loggedRawExample = false;

    function pickExample(examples, prefs, index) {
        if (!examples || !examples.length) return null;

        // One-time debug: log a raw example so field names can be verified against the live payload shape.
        if (!loggedRawExample && examples[0]) {
            loggedRawExample = true;
            console.log(`[${SCRIPT_ID}] raw example (first match):`, examples[0]);
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

        // Audio: every example carries a pre-resolved CDN URL the server
        // chose (ImmersionKit voice-actor recording when one exists upstream,
        // pre-rendered Google TTS otherwise). We hand the URL straight to the
        // <audio> element. Web Speech (Kyoko on macOS) is the last-resort
        // fallback if the CDN URL fails to load.
        if (example.sentence) {
            const audio = document.createElement('audio');
            // preload='auto' so the audio element starts decoding the server-
            // resolved CDN URL immediately — eliminates the ~tens-of-ms decode
            // delay on play() when the user answers quickly.
            audio.preload = 'auto';
            // User-configurable playback speed (0.5x — 1.25x). Set on the
            // element before src so the rate is already in place by the time
            // the URL attaches; the rate persists across .play() calls and
            // isn't reset on currentTime=0 (verified in HTMLMediaElement
            // spec). Re-reading settings() on every render means changing the
            // setting takes effect on the next card.
            audio.playbackRate = parseFloat(settings().playbackRate) || 1.0;
            audio.style.display = 'none';
            card.appendChild(audio);

            // Resolve the server-provided audio URL. Always synchronous —
            // resolveAudioBlobUrl just forwards example.ikAudioUrl or rejects
            // when the server's payload had none for this example. Web Speech
            // is the last-resort fallback if the CDN URL fails to load.
            const audioPromise = resolveAudioBlobUrl(example)
                .then((url) => {
                    audio.src = url;
                    return true;
                })
                .catch((err) => {
                    console.warn(`[${SCRIPT_ID}] audio URL unavailable, will use Web Speech:`, err);
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

            // Auto-fallback: if the resolved CDN URL itself 404s/empties out
            // (typically when the server's warm couldn't fetch a screenshot
            // for that example — sentence had no upstream image), silently
            // advance through the pool. Bounded by attempts so we don't spin
            // forever when every URL is broken.
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

    // Open the picker overlay listing every candidate sentence the server
    // returned for the current word. Triggered by right-click or long-press
    // on the ⟳ sentence button. The local payload cache is already hot by
    // the time the user can interact (renderCard requires cached examples),
    // so getExamples here is a synchronous-feeling read.
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
    // "default" means the server's incoming order, not the buildPool compound
    // sort.
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

        // Full unfiltered pool: every candidate the server returned, with
        // audio filter applied but no JLPT filter and no buildPool sort (the
        // picker controls its own sort below). Above-ceiling rows still render here
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
        // New sentence → reset image cycle so its source screenshot becomes
        // the default (same rule as the ⟳ refresh button).
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

    // Placeholder card shown between subject change and server-fetch
    // completion. Replaced in place by renderCard / renderEmptyCard once
    // getExamples resolves — both call removeCard at the top, so this is just
    // a "something is loading" hint that fills the otherwise-empty card area
    // for ~100-500ms.
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
    // the server fetch completes) so the header doesn't visibly collapse and
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
        if (state.cardEl && state.cardEl.parentNode) {
            state.cardEl.parentNode.removeChild(state.cardEl);
        }
        state.cardEl = null;
        // NOTE: we deliberately do NOT clear host styling here. Host lifecycle
        // is governed by subject type (vocab vs not) in handleDomChange — see
        // applyHostStyling/clearHostStyling. Keeping the host expanded across
        // vocab-to-vocab transitions avoids the visible header collapse/expand
        // during the server-fetch window.
    }

    // ---------- Utilities ----------

    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

})();
