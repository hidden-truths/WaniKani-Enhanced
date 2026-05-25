# Legacy direct-path userscript

This directory holds a **frozen snapshot** of the userscript from the era before it migrated to a backing API server. Everyone should be running the main userscript at the repo root ([../wkenhanced.user.js](../wkenhanced.user.js)) — install something from here **only** if the API server at `https://api.wkenhanced.dev` is unreachable for an extended period and you'd rather have working reviews than wait.

## What's in here

| File | What it is |
| --- | --- |
| [wk-vocab-review-ik-direct.user.js](wk-vocab-review-ik-direct.user.js) | Frozen v1.1.1-legacy. Calls ImmersionKit, DuckDuckGo, and Google Translate TTS directly from your browser. Same UX as the pre-Phase-2 version of the live script; no backing server involvement. |

## When you'd want this

The main userscript depends on the API server at `api.wkenhanced.dev` for every vocab lookup. If that server is down — or you'd prefer to never depend on it — this snapshot is a working fallback. Trade-offs vs the main userscript:

- **Slower cold loads.** Each new word triggers ~15 IK calls from your browser. The main script gets the same data in one round-trip from a pre-warmed cache.
- **More bandwidth from your machine.** Audio MP3s, screenshot JPGs, DDG illustrations all download to your browser instead of being served from our CDN.
- **More cross-origin permissions.** Tampermonkey will prompt for `GM_xmlhttpRequest` against `apiv2.immersionkit.com`, `duckduckgo.com`, and `translate.googleapis.com`.
- **Brittle on lossy IK title encoding.** The hard cases (`durarara__`, `god_s_blessing_on_this_wonderful_world_`) fall through to TTS + DDG illustrations instead of the source-anime audio + screenshot.
- **No JLPT scoring improvements.** Whatever shipped in v1.1.1 is what you get, forever.

The main script avoids all of that by talking to one endpoint we control.

## How to install

Same as any userscript:

1. Open the file in this directory, click "Raw" (or save it locally).
2. Tampermonkey prompts to install — accept.
3. Make sure **WaniKani Open Framework** is also installed and ordered first (Tampermonkey dashboard → drag WKOF above this script).
4. Reload a WaniKani review page; check the devtools console for `[wk-ik-examples] booting v1.1.1-legacy`.

If you have the main `wkenhanced.user.js` installed too, they will both attempt to render a card. **Disable one of them** in the Tampermonkey dashboard to avoid duplicates — the names are distinct so you can flip between them without uninstalling.

## What's *not* in here

- **No auto-updates.** This file has no `@updateURL` directive. It will stay frozen forever. If the upstream services it talks to (IK / DDG / Google) change their URL shapes or block our request patterns, this file will silently degrade — there is no plan to maintain it.
- **No new features.** The maintenance focus is on the main userscript + API server. Bug fixes here would be a one-off.

## Cache layout

This script writes to the same `wkof.file_cache` prefixes it always did (`wk-ik-examples.*`). The main `wkenhanced.user.js` uses a different prefix (`wkenhanced.*`), so the two caches don't fight if both happen to run.

## See also

- [../CLAUDE.md](../CLAUDE.md) — current project architecture (main userscript + API server).
- [../CLIENT_MIGRATION.md](../CLIENT_MIGRATION.md) — the migration plan that produced this snapshot. The "Phase 3" section is where it was decided to preserve rather than delete this code.
