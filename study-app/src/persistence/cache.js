// Read-through localStorage cache — the one place the "warm from the last good fetch, degrade on
// failure" storage primitive lives. Callers (selftalk phrases/templates, songs library, the deck's
// example sentences) layer their own server refresh on top of it: on a successful fetch they `write`
// the fresh value; on a failure they keep the in-memory copy and fall back to `read()`. Both methods
// swallow every error (quota exceeded, private-mode `localStorage` access throwing, corrupt JSON) so
// a storage hiccup degrades gracefully instead of blanking the UI — that resilience was previously
// re-implemented (with subtly varying try/catch) in four places.
//
//   const cache = createReadThroughCache({ key: 'jpverbs_songs_cache' });
//   cache.read();            // [] on miss/invalid/error, else the parsed array
//   cache.write(songs);      // best-effort persist
//
// `validate(parsed)` guards the stored shape (default: an array — the common case; an object map
// passes `{ validate: o => !!o && typeof o === 'object' }`). `fallback` is what `read()` returns on a
// miss/invalid/error — a FUNCTION so each call gets a fresh empty value (callers mutate the result, so
// they must never share one instance). Defaults to a new empty array per call.
export function createReadThroughCache({ key, validate = Array.isArray, fallback = () => [] }) {
  const empty = typeof fallback === 'function' ? fallback : () => fallback;
  return {
    read() {
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        if (validate(parsed)) return parsed;
      } catch (e) { /* corrupt JSON / no localStorage — fall through to the empty value */ }
      return empty();
    },
    write(value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota / private mode — best-effort */ }
    },
  };
}
