// ==UserScript==
// @name         WK Vocab Review — ImmersionKit Examples
// @namespace    https://github.com/jbrelly/wk-ik-examples
// @version      0.12.3
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
    const SCRIPT_VERSION = '0.12.3';

    // Bump this when on-disk cache shape or sourcing logic changes in a way that
    // makes stale entries actively wrong (vs. just suboptimal). Boot will clear
    // examples/images/audio caches once when this differs from the stored value.
    // Selections (the per-word refresh-button state) are NOT cleared.
    const CACHE_SCHEMA_VERSION = 2;
    const SCHEMA_VERSION_KEY = 'wk-ik-examples.schema-version';
    const WKOF_VERSION_NEEDED = '1.0.52';

    const IK_API_BASE = 'https://apiv2.immersionkit.com/search';
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
        // Once translation/image are revealed (on meaning submit), keep them
        // visible for the rest of the subject. Reset on new subject.
        translationRevealed: false,
    };

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
        .then(registerListeners)
        .then(() => {
            // Expose console-callable helpers in the page context.
            PAGE_WIN.openWkIkSettings = openSettings;
            PAGE_WIN.debugWkIk = debugWkIk;
            console.log(
                `[${SCRIPT_ID}] boot OK. Console: openWkIkSettings() | debugWkIk()`
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
        // Clear IK examples, DDG images, IK + TTS audio, and per-word selections.
        Promise.all([
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(CACHE_PREFIX))),
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(IMG_CACHE_PREFIX))),
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(AUDIO_CACHE_PREFIX))),
            wkof.file_cache.delete(new RegExp('^' + escapeRegExp(IK_AUDIO_CACHE_PREFIX))),
            wkof.file_cache.delete(SELECTIONS_CACHE_KEY),
        ])
            .then(() => {
                state.selections = {};
                alert(`${SCRIPT_TITLE}: cache cleared (examples + images + audio + selections).`);
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
.${CARD_CLASS} .${CSS_PREFIX}-refresh-sentence {
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
.${CARD_CLASS} .${CSS_PREFIX}-refresh-sentence:hover {
    background: rgba(255,255,255,0.35);
}
.${CARD_CLASS} .${CSS_PREFIX}-image[hidden] { display: none; }
.${CARD_CLASS} .${CSS_PREFIX}-image {
    /* Reserve a fixed 180x180 slot so loading the image doesn't reflow sibling
       layout. The actual image data is fit inside via object-fit: contain so
       portraits and landscapes both display correctly without stretching. */
    position: relative;
    display: inline-block;
    width: 180px;
    height: 180px;
    margin: 0;
}
.${CARD_CLASS} .${CSS_PREFIX}-image img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
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
        state.translationRevealed = false;
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
            state.translationRevealed = false;
            return;
        }

        const isNewSubject = subject.id !== state.currentSubjectId;

        if (isNewSubject) {
            state.currentSubjectId = subject.id;
            state.currentCharacters = subject.characters;
            state.answered = false;
            state.currentQuestionType = null;     // picked up on next mutation tick
            state.translationRevealed = false;    // reset per subject
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

    // Build an audio URL using the IK API's /download_media proxy. The site itself
    // serves audio from URLs like:
    //   https://apiv2.immersionkit.com/download_media?path=media/anime/Fate%20Zero/media/<sound>
    // The path components are derived from fields in the example object:
    //   <category> = first underscore-separated token of `id` (e.g. "anime", "games")
    //   <folder>   = `title` with underscores→spaces, lone "x" tokens→"×",
    //                other tokens capitalized (e.g. "hunter_x_hunter" → "Hunter × Hunter")
    //   <sound>    = `sound` field verbatim
    // Returns null if any required field is missing.
    function buildIkAudioUrl(e) {
        if (!e || !e.sound || !e.title || !e.id) return null;
        const category = String(e.id).split('_')[0];
        if (!category) return null;
        const folder = ikTitleToFolder(e.title);
        if (!folder) return null;
        // Encode each path segment individually so spaces, "×", etc. get percent-
        // encoded while the slashes between segments stay literal (matching the
        // exact format the IK website uses).
        const segments = ['media', category, folder, 'media', e.sound];
        const path = segments.map(encodeURIComponent).join('/');
        return `${IK_DOWNLOAD_MEDIA_BASE}?path=${path}`;
    }

    function ikTitleToFolder(title) {
        return String(title)
            .split('_')
            .filter(Boolean)
            .map((tok) => (tok === 'x' ? '×' : tok[0].toUpperCase() + tok.slice(1)))
            .join(' ');
    }

    // Same URL shape as buildIkAudioUrl but with the `image` field (a screenshot
    // from the source anime/drama/game frame). Returns null if `image` is missing
    // (e.g. text-only literature examples like Skyrim quest text).
    function buildIkImageUrl(e) {
        if (!e || !e.image || !e.title || !e.id) return null;
        const category = String(e.id).split('_')[0];
        if (!category) return null;
        const folder = ikTitleToFolder(e.title);
        if (!folder) return null;
        const segments = ['media', category, folder, 'media', e.image];
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

    // Turn IK's snake-case title (e.g. "hunter_x_hunter", "fate_zero") into something
    // pleasant for display ("Hunter Hunter", "Fate Zero"). Drops the standalone "x"
    // separator that IK uses for titles like Hunter × Hunter, replaces underscores
    // with spaces, and capitalizes only tokens longer than 3 chars (so English
    // function words like "of"/"the" stay lowercase, mimicking title case).
    function prettifyTitle(title) {
        if (!title) return '';
        return String(title)
            .split('_')
            .filter((tok) => tok && tok !== 'x')
            .map((tok) => tok.length > 3 ? tok[0].toUpperCase() + tok.slice(1) : tok)
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
        renderSentence(sentenceEl, example.sentence, target);
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

    function renderSentence(container, sentence, target) {
        container.textContent = ''; // clear
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

    // Question-type-aware reveal:
    //   * Meaning submit → uncover translation + image (sticky for the subject),
    //                      and play audio if the autoPlayAudio setting is on.
    //   * Reading submit → always autoplay the sentence audio (after WK's vocab
    //                      audio finishes), do NOT uncover translation/image
    //                      (those would spoil the meaning question if it's
    //                      coming next in the queue).
    // If translation/image were already uncovered earlier this subject (meaning
    // came first), they stay visible — state.translationRevealed is sticky for
    // the subject so reading-after-meaning doesn't re-hide them.
    function revealAll() {
        const card = state.cardEl;
        if (!card) return;
        const qtype = state.currentQuestionType || currentQuestionType() || 'meaning';

        if (qtype === 'meaning') {
            state.translationRevealed = true;
        }

        if (state.translationRevealed) {
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
