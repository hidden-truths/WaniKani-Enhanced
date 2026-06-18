// 歌 / Songs — YouTube IFrame Player API wrapper. Lazy-loads the API on first use: a NECESSARY
// external dependency (embedding is the copyright posture — we never re-host the master audio), and
// it degrades gracefully — if it fails to load, Read + Mine still work; only audio sync / slice
// replay is lost. One player at a time; the song view mounts/destroys it. See SONGS.md.

let apiReady = null; // Promise<void> — resolves when window.YT.Player is available (or the load failed)
let player = null; // the live YT.Player
let endTimer = null; // 250ms poll that drives the synced-highlight onTime callback while playing
let sliceTimer = null; // 80ms poll that pauses a [start,end] per-line slice — kept SEPARATE from endTimer
                       // so the PLAYING→startPoll(onTime) handler (fired when a slice starts from a paused
                       // player) can't clear the slice's stop and let it overrun into the next line

// Lazy-load https://www.youtube.com/iframe_api ONCE. Resolves when YT.Player is ready, or on a load
// error (the caller checks the returned player for null and degrades).
function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) { try { prev(); } catch (e) { /* ignore */ } } resolve(); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => resolve(); // degrade — window.YT stays undefined, caller falls back
    document.head.appendChild(tag);
  });
  return apiReady;
}

// Mount a player on `el` for `videoId`. Returns the YT.Player, or null if the API failed to load.
// `onTime(seconds)` (optional) fires ~4×/s while playing — drives synced highlight. `autoplay` starts
// playback on mount (used by Read's "Play with video" — a user gesture, so sound autoplay is allowed).
export async function mountPlayer(el, videoId, { onTime, autoplay } = {}) {
  destroyPlayer();
  await loadApi();
  if (!(window.YT && window.YT.Player) || !el) return null;
  player = new window.YT.Player(el, {
    videoId,
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1, autoplay: autoplay ? 1 : 0 },
    events: {
      onStateChange: (e) => {
        if (e.data === window.YT.PlayerState.PLAYING && onTime) startPoll(onTime);
        else if (e.data !== window.YT.PlayerState.PLAYING) stopTimer();
      },
    },
  });
  return player;
}

function startPoll(onTime) {
  stopTimer();
  endTimer = setInterval(() => { try { onTime(player.getCurrentTime()); } catch (e) { stopTimer(); } }, 250);
}
function stopTimer() { if (endTimer) { clearInterval(endTimer); endTimer = null; } }
function stopSlice() { if (sliceTimer) { clearInterval(sliceTimer); sliceTimer = null; } }

export function getPlayer() { return player; }

export function destroyPlayer() {
  stopTimer();
  stopSlice();
  if (player) { try { player.destroy(); } catch (e) { /* ignore */ } player = null; }
}

// Play a [startSec, endSec] slice by ear (per-line replay / Listen line audio / the YouTube-slice
// Shadow reference). Seeks + plays, then pauses at `end` (compared in MEDIA time, so a slowed slice
// still stops at the right lyric). `rate` (<1) drives the slow replay via setPlaybackRate; omitted/1
// resets to normal speed. No player (untimed / API down) → no-op; the caller falls back to a synth
// play of the line. Returns true if a slice was actually started.
export function playSlice(start, end, rate) {
  if (!player || start == null) return false;
  try {
    if (player.setPlaybackRate) player.setPlaybackRate(rate || 1);
    player.seekTo(start, true);
    player.playVideo();
    stopSlice();
    if (end != null) {
      sliceTimer = setInterval(() => {
        try { if (player.getCurrentTime() >= end) { player.pauseVideo(); stopSlice(); } } catch (e) { stopSlice(); }
      }, 80);
    }
    return true;
  } catch (e) {
    return false;
  }
}
