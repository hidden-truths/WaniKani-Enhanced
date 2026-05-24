// ==UserScript==
// @name         WK Vocab Review — ImmersionKit Examples
// @namespace    https://github.com/jbrelly/wk-ik-examples
// @version      0.16.1
// @description  Shows one ImmersionKit example sentence (with IK / Google TTS audio + IK / DDG image) during WaniKani vocab reviews.
// @author       jbrelly
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @connect      apiv2.immersionkit.com
// @connect      duckduckgo.com
// @connect      translate.googleapis.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ---------- Constants ----------

    const SCRIPT_ID = 'wk-ik-examples';
    const SCRIPT_TITLE = 'WK Vocab Review — ImmersionKit';
    const SCRIPT_VERSION = '0.16.1';

    // Bump this when on-disk cache shape or sourcing logic changes in a way that
    // makes stale entries actively wrong (vs. just suboptimal). Boot will clear
    // examples/images/audio caches once when this differs from the stored value.
    // Selections (the per-word refresh-button state) are NOT cleared.
    const CACHE_SCHEMA_VERSION = 2;
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

    const CSS_PREFIX = 'wk-ik';
    const CARD_CLASS = `${CSS_PREFIX}-card`;

    const DEFAULTS = {
        autoPlayAudio: false,
        showImage: true,
        showFurigana: true,
        playHotkey: 'p',
        sentencePreference: 'shortest',
        requireAudio: true,
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

    // Canonical encoded-title map from IK's /index_meta endpoint. Populated by
    // loadIndexMeta() during boot. Null while uninitialized; an object even when
    // the fetch fails (just empty), so lookup code can treat null as "still
    // loading" and a present-but-missing key as "fall back to heuristic".
    let indexMeta = null;

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
        .then(loadIndexMeta) // canonical encoded-title → pretty-title map from IK
        .then(registerListeners)
        .then(() => {
            // Expose console-callable helpers in the page context.
            PAGE_WIN.openWkIkSettings = openSettings;
            PAGE_WIN.debugWkIk = debugWkIk;
            PAGE_WIN.debugWkIkTitle = debugWkIkTitle;
            console.log(
                `[${SCRIPT_ID}] boot OK. Console: openWkIkSettings() | debugWkIk() | debugWkIkTitle('<encoded_title>')`
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
                                'When on, only use IK examples that came with original audio (i.e. sourced from anime/drama/games rather than text-only literature). The audio you hear is Google TTS regardless.',
                        },
                        maintenance: {
                            type: 'section',
                            label: 'Maintenance',
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
                ])
                    .then(() => wkof.file_cache.save(SCHEMA_VERSION_KEY, { version: CACHE_SCHEMA_VERSION }))
                    .catch((err) => console.warn(`[${SCRIPT_ID}] cache upgrade failed:`, err));
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
            wkof.file_cache.delete(SELECTIONS_CACHE_KEY),
            wkof.file_cache.delete(INDEX_META_CACHE_KEY),
        ])
            .then(() => {
                state.selections = {};
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
.${CARD_CLASS} .${CSS_PREFIX}-refresh-sentence,
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
    /* Size to the image's natural aspect ratio. Height is capped by the
       header's vertical budget (280px host minus ~13px card padding top/bottom
       leaves ~254px); width is capped by the right panel's max-width above so
       a runaway-wide grab cannot crowd the centered vocab character.
       Note: no fixed dimensions, so there is a brief layout shift when the
       image finishes loading — acceptable because the figure has [hidden]
       until reveal, by which time the img is usually loaded.
       pointer-events: none on the figure (and img) is the fix for WK's
       top-right stats (like/check/inbox) being unclickable — at 240px tall
       the figure's bounding box overlaps the corner where WK pins those.
       The refresh-image button re-enables pointer-events: auto on itself
       so it still catches clicks. */
    position: relative;
    display: inline-block;
    margin: 0;
    max-height: 240px;
    max-width: 100%;
    pointer-events: none;
}
.${CARD_CLASS} .${CSS_PREFIX}-image img {
    display: block;
    max-height: 240px;
    max-width: 100%;
    width: auto;
    height: auto;
    border-radius: 4px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    pointer-events: none;
}
.${CARD_CLASS} .${CSS_PREFIX}-refresh-image {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 1.8em;
    height: 1.8em;
    line-height: 1.5em;
    text-align: center;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #bbb;
    border-radius: 50%;
    color: #444;
    cursor: pointer;
    font-size: 0.85em;
    padding: 0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
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
            state.currentSubjectId = null;
            state.currentCharacters = null;
            state.answered = false;
            state.currentQuestionType = null;
            state.meaningAnswered = false;
            state.readingAnswered = false;
            state.furiganaVisible = false;
            return;
        }

        const isNewSubject = subject.id !== state.currentSubjectId;

        if (isNewSubject) {
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
            removeCard();
            getExamples(subject.characters)
                .then((cached) => {
                    if (fetchToken !== state.currentFetchToken) return; // Stale
                    const chosen = pickFromCached(cached, state.sentenceIdx);
                    if (!chosen) renderEmptyCard();
                    else renderCard(chosen);
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
            console.log('indexMeta is null — boot may still be in progress. Try again in a moment.');
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

    function readText(el) {
        if (!el) return null;
        const t = (el.textContent || '').trim();
        return t || null;
    }

    // ---------- Fetch + cache ----------

    function cacheKey(slug) {
        return `${CACHE_PREFIX}${encodeURIComponent(slug)}`;
    }

    function getExamples(slug) {
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

    // Apply the saved selection for a vocab word (or default to 0,0) to state.
    function applySavedSelection(word) {
        const sel = (word && state.selections[word]) || null;
        state.sentenceIdx = (sel && Number.isFinite(sel.s)) ? sel.s : 0;
        state.imageIdx = (sel && Number.isFinite(sel.i)) ? sel.i : 0;
    }

    // Persist the current state.sentenceIdx/imageIdx for the current word.
    function persistCurrentSelection() {
        const word = state.currentCharacters;
        if (!word) return;
        state.selections[word] = {
            s: state.sentenceIdx || 0,
            i: state.imageIdx || 0,
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
                const raw = examples.slice(0, 10);
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
            limit: '10',
        });
        if (prefs.sentencePreference === 'shortest') {
            params.set('sort', 'sentence_length:asc');
        } else if (prefs.sentencePreference === 'longest') {
            params.set('sort', 'sentence_length:desc');
        }
        return `${IK_API_BASE}?${params.toString()}`;
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
    // /index_meta mapping (loaded once at boot) and falls back to the regex
    // heuristic when the map is unavailable or the title isn't yet listed.
    function resolveIkFolderAndCategory(e) {
        if (!e || !e.title) return null;
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

    // Orchestrator: try the IK proxy first (real human audio when available), then
    // fall back to Google TTS (synthesized but always works). Returns a blob URL.
    function resolveAudioBlobUrl(example) {
        const ikUrl = example && example.ikAudioUrl;
        if (ikUrl) {
            return fetchIkAudioBlobUrl(ikUrl)
                .then((url) => {
                    console.log(`[${SCRIPT_ID}] using IK proxy audio`);
                    return url;
                })
                .catch((err) => {
                    console.warn(
                        `[${SCRIPT_ID}] IK audio failed (${err && err.message}); falling back to Google TTS`
                    );
                    return fetchTtsBlobUrl(example.sentence);
                });
        }
        return fetchTtsBlobUrl(example.sentence);
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
    //   pool = [ikImageUrl (if non-null), ...DDG urls]
    // So index 0 is always the IK screenshot when one exists, with DDG illustrations
    // filling positions 1..N. When IK has no `image` field (text-only sources),
    // DDG occupies the whole pool starting at index 0. Index wraps via modulo so
    // the refresh button cycles forever. Calls onSuccess(url, poolSize) or onError().
    function loadImageAt(word, ikImageUrl, index, onSuccess, onError) {
        const idx = Math.max(0, index | 0);
        fetchDdgImagesCached(word).then((ddgUrls) => {
            const pool = ikImageUrl ? [ikImageUrl, ...ddgUrls] : ddgUrls;
            if (pool.length === 0) {
                onError && onError();
                return;
            }
            const wrappedIdx = idx % pool.length;
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

    // We no longer build IK media URLs — the legacy bucket is offline (Aug 2025) and the
    // V2 API gives us filenames that no longer resolve. Audio is synthesized via the
    // Web Speech API; the source title is shown for attribution.
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
    // `requireAudio` is now a sentence-source filter: we treat IK examples that came
    // with an audio file in the original API response (i.e. anime/drama/games scenes)
    // as preferred over text-only literature. The audio itself is always TTS.
    function hasOriginalAudio(e) {
        return !!(e && (e.sound || e.sound_url));
    }

    let loggedRawExample = false;

    function pickExample(examples, prefs, index) {
        if (!examples || !examples.length) return null;
        let pool = examples.slice();

        // One-time debug: log a raw example so field names can be verified against the live API.
        if (!loggedRawExample && pool[0]) {
            loggedRawExample = true;
            console.log(`[${SCRIPT_ID}] raw IK example (first match):`, pool[0]);
        }

        if (prefs.requireAudio) {
            const withAudio = pool.filter(hasOriginalAudio);
            if (withAudio.length) pool = withAudio;
        }
        if (prefs.sentencePreference === 'shortest') {
            pool.sort((a, b) => (a.sentence || '').length - (b.sentence || '').length);
        } else if (prefs.sentencePreference === 'longest') {
            pool.sort((a, b) => (b.sentence || '').length - (a.sentence || '').length);
        }
        if (!pool.length) return null;
        const idx = Math.max(0, index | 0) % pool.length;
        const e = pool[idx];
        if (!e) return null;
        return {
            sentence: e.sentence || '',
            sentence_with_furigana: e.sentence_with_furigana || '',
            translation: e.translation || '',
            title: getTitle(e),
            // Pre-compute the IK proxy URLs (null when any required field is missing).
            // resolveAudioBlobUrl uses ikAudioUrl as the primary source, falling back
            // to Google TTS on failure or absence. loadImageAt uses ikImageUrl as
            // image #0 in the pool, with DDG results filling positions 1..N.
            ikAudioUrl: buildIkAudioUrl(e),
            ikImageUrl: buildIkImageUrl(e),
            poolSize: pool.length,
        };
    }

    // ---------- Render ----------

    function renderCard(example) {
        removeCard();
        const prefs = settings();
        const target = state.currentCharacters || '';

        const card = document.createElement('aside');
        card.className = CARD_CLASS;
        card.setAttribute('data-revealed', 'false');

        // LEFT panel: sentence (always visible) + play/refresh controls + translation
        // (revealed) + source attribution. Sits to the left of the vocab character.
        const leftPanel = document.createElement('div');
        leftPanel.className = `${CSS_PREFIX}-left`;

        const sentenceEl = document.createElement('div');
        sentenceEl.className = `${CSS_PREFIX}-sentence`;
        sentenceEl.setAttribute('lang', 'ja');
        renderSentence(
            sentenceEl,
            example.sentence,
            example.sentence_with_furigana,
            target,
            !!(state.furiganaVisible && state.readingAnswered)
        );
        leftPanel.appendChild(sentenceEl);

        const leftControls = document.createElement('div');
        leftControls.className = `${CSS_PREFIX}-left-controls`;

        // Audio: Google Translate TTS, fetched via GM_xmlhttpRequest with a spoofed
        // Referer (Google rejects requests from wanikani.com origin via direct <audio>).
        // We convert the response to a blob URL and play that. On failure we fall back
        // to the browser's built-in Web Speech (Kyoko on macOS) so audio always works.
        if (example.sentence) {
            const audio = document.createElement('audio');
            audio.preload = 'none';
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
        // The button stays disabled until the reading question for this subject is
        // graded — revealAll flips disabled=false and re-renders. Click handler
        // toggles state.furiganaVisible and re-renders the sentence in place.
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
                rerenderSentence(card, card._example);
            });
            leftControls.appendChild(furiganaBtn);
            card._furiganaBtn = furiganaBtn;
        }

        // Stash the example on the card so revealAll / rerenderSentence can pick
        // it up later without needing to thread it through state.
        card._example = example;

        const sentenceRefreshBtn = document.createElement('button');
        sentenceRefreshBtn.className = `${CSS_PREFIX}-refresh-sentence`;
        sentenceRefreshBtn.type = 'button';
        const total = example.poolSize || 1;
        const sIdx = ((state.sentenceIdx || 0) % total) + 1;
        sentenceRefreshBtn.title = `Get a different sentence (${sIdx}/${total})`;
        sentenceRefreshBtn.setAttribute('aria-label', 'Get a different sentence');
        sentenceRefreshBtn.textContent = '⟳';
        sentenceRefreshBtn.addEventListener('click', refreshSentence);
        leftControls.appendChild(sentenceRefreshBtn);

        leftPanel.appendChild(leftControls);

        const translationEl = document.createElement('div');
        translationEl.className = `${CSS_PREFIX}-translation`;
        translationEl.textContent = example.translation || '';
        translationEl.hidden = true;
        leftPanel.appendChild(translationEl);

        if (example.title) {
            const src = document.createElement('div');
            src.className = `${CSS_PREFIX}-source`;
            src.textContent = `— ${prettifyTitle(example.title)}`;
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
            fig.hidden = true;
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            fig.appendChild(img);

            const imageRefreshBtn = document.createElement('button');
            imageRefreshBtn.className = `${CSS_PREFIX}-refresh-image`;
            imageRefreshBtn.type = 'button';
            imageRefreshBtn.setAttribute('aria-label', 'Get a different image');
            imageRefreshBtn.textContent = '⟳';
            imageRefreshBtn.addEventListener('click', refreshImage);
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
                        const iIdx = (idx % poolSize) + 1;
                        imageRefreshBtn.title = `Get a different image (${iIdx}/${poolSize})`;
                        img.onerror = () => {
                            if (poolSize <= 1) {
                                fig.remove();
                            } else {
                                console.warn(`[${SCRIPT_ID}] image idx ${idx} failed to load; trying ${idx + 1}`);
                                tryLoadAt(idx + 1, attemptsLeft - 1);
                            }
                        };
                    },
                    () => fig.remove()
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

    // Replace the sentence content of an existing card in place, used by the
    // ふ toggle button and the reading-reveal handler. Reads state.furiganaVisible
    // and state.readingAnswered — furigana only renders when BOTH are true.
    function rerenderSentence(card, example) {
        if (!card || !example) return;
        const sentenceEl = card.querySelector(`.${CSS_PREFIX}-sentence`);
        if (!sentenceEl) return;
        const withFurigana = !!(state.furiganaVisible && state.readingAnswered);
        renderSentence(
            sentenceEl,
            example.sentence,
            example.sentence_with_furigana,
            state.currentCharacters || '',
            withFurigana
        );
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

    // Question-type-aware reveal. WK doesn't expose a "subject complete" hook,
    // so we derive it: the user is considered "done" with a subject once they've
    // been graded on BOTH meaning AND reading in this session (order and
    // correctness don't matter — submission is the trigger). Until then, the
    // supplementary content stays hidden so it can't spoil the other question.
    //
    //   * Meaning submit → set meaningAnswered. Reveal translation + image
    //                      ONLY if readingAnswered is also true. Otherwise
    //                      we're still waiting on the reading question to be
    //                      tested. Plays audio if autoPlayAudio is on.
    //   * Reading submit → set readingAnswered, unlock the ふ furigana toggle,
    //                      re-render the sentence so furigana can render now
    //                      that the reading is no longer a secret. Reveal
    //                      translation + image ONLY if meaningAnswered is also
    //                      true. Always autoplays the sentence audio (queued
    //                      after WK's vocab pronunciation so they don't overlap).
    //
    // This symmetric gating gives identical timing regardless of question
    // order: whichever question is answered second is the one that reveals.
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
            rerenderSentence(card, card._example);
        }

        // Reveal once the subject is complete in this session — both questions
        // submitted. Sticky for the rest of the subject (no re-hiding if the
        // second question's reveal triggers more mutations).
        if (state.meaningAnswered && state.readingAnswered) {
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
            // Free any blob URL we allocated for TTS audio.
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
})();
