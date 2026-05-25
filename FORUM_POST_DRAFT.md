# Forum post draft — WKEnhanced v2.0.0 (rebrand + server-only)

Draft for the WaniKani Community forum announcing the rename + v2.0.0 ship. Polish to taste before posting; the structure is reasonable but the tone might want softening or tightening depending on the venue.

Replace every `<REPO_URL>` and `<MAINTAINER_HANDLE>` placeholder before posting.

---

## Suggested title

> **WKEnhanced v2.0 — rebrand + faster cold loads (replaces "WK Vocab Review ImmersionKit Examples")**

## Suggested category / tags

API and Third-Party Apps → Userscript / Open Framework. Tag with `wkof`, `userscript`, `immersionkit`.

---

## Body

**TL;DR:** The userscript formerly known as *WK Vocab Review ImmersionKit Examples* is now **WKEnhanced v2.0**, installed as a different file (`wkenhanced.user.js`). It does the same thing — drops an example sentence, audio, and image into the purple character header on vocab reviews — but now talks to one small backing API (`api.wkenhanced.dev`) instead of hitting ImmersionKit / DuckDuckGo / Google Translate TTS from your browser. **Cold loads are faster, fewer cross-origin permission prompts, and the lossy title-decoding workaround happens once on the server instead of on every install.**

If you don't want a server dependency at all, there's a frozen **Legacy Direct** snapshot at v1.1.1 in [`legacy/`](<REPO_URL>/blob/main/legacy/wk-vocab-review-ik-direct.user.js) that keeps the old direct-fetch path.

### What changed

- **New name + new file.** The script's `@name` and filename are now `WKEnhanced` / `wkenhanced.user.js`. The old `wk-vocab-review-ik.user.js` is gone from the repo root.
- **Server-backed.** Every lookup goes through one endpoint we control. The server runs at `https://api.wkenhanced.dev` and pre-warms the WaniKani vocab corpus into a small DigitalOcean droplet + Spaces CDN.
- **`@grant GM_xmlhttpRequest` dropped.** The script now uses plain `fetch()` against the one server. Tampermonkey re-prompts you for `@connect api.wkenhanced.dev` on install.
- **`useApiServer` setting removed.** It was a toggle during the migration; in v2.0 there's only one path, so the toggle is gone. If you had it stored, it's silently ignored.
- **Settings dialog stays where it was**, reachable from the WKOF avatar-dropdown link or via `openWkEnhancedSettings()` in the devtools console.

### Why it's worth installing

- **Cold loads are faster** — pre-warmed examples mean the first time you see a new word, the audio + image are already at our CDN. The direct-path version was hitting IK / DDG / Google in series from your browser; that's ~15–25 round-trips per new word vs. one round-trip now.
- **Lossy IK title encoding is finally fixed.** The old direct-fetch path heuristically guessed the source title from IK's encoded folder name. This worked for most words but produced wrong attribution + broken media URLs for cases like `durarara__` → "Durarara" (real: "Durarara!!"). The server resolves titles via IK's official `/index_meta` map, so attribution is correct everywhere it's possible to know.
- **Fewer cross-origin permission prompts.** One `@connect` host instead of three.
- **JLPT scoring stays current.** The bundled JLPT word list lives on the server now and gets refreshed without you needing to reinstall.

### Why you might not want to install

- **You depend on the userscript working offline / through a strict corporate proxy.** The new version hard-requires `api.wkenhanced.dev`. If our server is down, your cards will be empty until it's back. (See "Legacy fallback" below.)
- **You want to audit every byte your browser fetches.** The direct-fetch path was easier to reason about in that sense — every call went to the obvious third-party service. The new version routes through one extra hop.
- **You're already on v1.x and it works fine.** Nothing forces you to upgrade. The old version will keep working as long as ImmersionKit / DDG / Google don't change their URL shapes — they haven't in years, so this is a comfortable position to sit in.

### How to install (the main script)

1. Open [`wkenhanced.user.js`](<REPO_URL>/blob/main/wkenhanced.user.js) — click **Raw**.
2. Tampermonkey will prompt to install. Accept.
3. **Make sure [WaniKani Open Framework](https://community.wanikani.com/t/instructions-installation-of-wanikani-open-framework-developer-version-recommended-for-most-users/28549) is installed and ordered above this script** in your Tampermonkey dashboard.
4. Tampermonkey will prompt for `@connect api.wkenhanced.dev` the first time. Allow it — that's how the script talks to the backing server.
5. Open a WaniKani review and check the devtools console for `[wkenhanced] booting v2.0.0`.

**If you were running v1.x previously:** disable the old script in the Tampermonkey dashboard (or delete it) so the two don't both try to render a card. They have different `@name` values, so they coexist in the dashboard without auto-replacing each other.

**Old IndexedDB cache won't auto-wipe** — v1.x cached blobs under `wk-ik-examples.*` / `wk-vocab-cache.*` keys; v2.0 writes to `wkenhanced.*`. The old keys are harmless but waste ~5–10 MB. Click **Clear cache** in the settings dialog if you want to reclaim that space.

### Legacy fallback (Legacy Direct, v1.1.1)

If you'd rather not depend on `api.wkenhanced.dev` at all:

- Install [`legacy/wk-vocab-review-ik-direct.user.js`](<REPO_URL>/blob/main/legacy/wk-vocab-review-ik-direct.user.js) instead. It's a frozen v1.1.1 snapshot with `serverPathEnabled()` hardcoded `false`.
- Different `@name` than the main script, so they can coexist in Tampermonkey (disable one).
- **No auto-updates.** This file is intentionally frozen. If IK / DDG / Google ever change their URL shapes, this version will silently degrade and won't be fixed. It exists as a working escape hatch, not a maintained product.
- All the v1.x trade-offs apply: slower cold loads, more cross-origin permissions, brittle on lossy IK titles. The repo's [`legacy/README.md`](<REPO_URL>/blob/main/legacy/README.md) has the full list.

### Where things are

- **Main userscript:** [`wkenhanced.user.js`](<REPO_URL>/blob/main/wkenhanced.user.js)
- **Legacy direct-path:** [`legacy/wk-vocab-review-ik-direct.user.js`](<REPO_URL>/blob/main/legacy/wk-vocab-review-ik-direct.user.js)
- **Server source + deploy notes:** [`wk-enhanced-api/`](<REPO_URL>/tree/main/wk-enhanced-api)
- **Architecture + dead-end warnings:** [`CLAUDE.md`](<REPO_URL>/blob/main/CLAUDE.md) and [`wk-enhanced-api/CLAUDE.md`](<REPO_URL>/blob/main/wk-enhanced-api/CLAUDE.md)
- **Issue / bug reports:** open an issue at [<REPO_URL>/issues](<REPO_URL>/issues) or reply on this thread.

### Acknowledgements

ImmersionKit is doing the heavy lifting on the example-sentence side — the v2.0 architecture still routes every example through them, just via a polite (≥500 ms gap, exponential backoff on 429) cached proxy instead of every browser hitting them individually. Same gratitude to DuckDuckGo for the illustration fallback pool, and to Google for the TTS fallback when IK doesn't have voice-actor audio for a sentence.

Thanks to anyone who tested through the Phase 1/2 toggle period and surfaced the edge cases that became the deploy-day fixes (idleTimeout, ETag exposure via CORS, Cloudflare weak-ETag tolerance).

— <MAINTAINER_HANDLE>

---

## Notes for the maintainer (not part of the post)

- **Length:** ~700 words in the body. Feels right for an announcement post; trim the "Where things are" section if posting on a venue with link previews that handle the repo URL.
- **Reply-worthy questions to anticipate:**
  - "Why a backing server instead of staying direct?" — server-side title resolution + faster cold loads + fewer permission prompts + politer client to IK.
  - "Is the server open-source / can I self-host?" — yes, repo is public; `wk-enhanced-api/README.md` has the deploy walkthrough.
  - "What happens to my reviews if your server goes down?" — empty cards until it's back. The userscript handles it gracefully (the rest of WK still works). For people who want zero dependency, the legacy script is the answer.
  - "How is this funded?" — DO droplet ($6) + Spaces ($5) + Cloudflare Tunnel (free) ≈ $11/mo, paid out of pocket. No keys, no accounts, no per-user data.
  - "Does it work with [other userscript X]?" — should, as long as WKOF is loaded first. Same as v1.x.
- **If you want a shorter version**, you can drop "Why you might not want to install" + "Acknowledgements" and shorten "Where things are" — that gets you to ~400 words.
- **The legacy direct-path link in the post** assumes the GitHub repo has gone public — double-check the URL resolves before posting.
- **Forum etiquette:** WK community is friendly + technical. Lead with the user benefit (faster cold loads) before the why; don't bury install steps below long architectural prose.
