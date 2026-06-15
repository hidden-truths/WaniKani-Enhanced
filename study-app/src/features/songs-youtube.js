// 歌 / Songs — YouTube IFrame Player API wrapper. Lazy-loads the API on first use: a NECESSARY
// external dependency (embedding is the copyright posture — we never re-host the master audio), and
// it degrades gracefully — if it fails to load, Read + Mine still work; only audio sync / slice
// replay is lost. One player at a time; the song view mounts/destroys it. See SONGS.md.

let apiReady = null; // Promise<void> — resolves when window.YT.Player is available (or the load failed)
let player = null; // the live YT.Player
let endTimer = null; // interval that pauses a [start,end] slice / drives onTime

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
// `onTime(seconds)` (optional) fires ~4×/s while playing — drives synced highlight.
export async function mountPlayer(el, videoId, { onTime } = {}) {
  destroyPlayer();
  await loadApi();
  if (!(window.YT && window.YT.Player) || !el) return null;
  player = new window.YT.Player(el, {
    videoId,
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
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

export function getPlayer() { return player; }

export function destroyPlayer() {
  stopTimer();
  if (player) { try { player.destroy(); } catch (e) { /* ignore */ } player = null; }
}

// Play a [startSec, endSec] slice by ear (per-line replay / the YouTube-slice Shadow reference).
// Seeks + plays, then pauses at `end`. No player (untimed / API down) → no-op; the caller falls
// back to a synth play of the line. Returns true if a slice was actually started.
export function playSlice(start, end) {
  if (!player || start == null) return false;
  try {
    player.seekTo(start, true);
    player.playVideo();
    stopTimer();
    if (end != null) {
      endTimer = setInterval(() => {
        try { if (player.getCurrentTime() >= end) { player.pauseVideo(); stopTimer(); } } catch (e) { stopTimer(); }
      }, 80);
    }
    return true;
  } catch (e) {
    return false;
  }
}
