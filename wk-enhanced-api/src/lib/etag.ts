// Shared ETag helpers. Every endpoint whose payload changes only on a
// well-defined "version" (a fetchedAt timestamp, in our case) uses these
// to do conditional GETs — clients store the ETag, send it back as
// If-None-Match, we 304 No-Content until the version moves.

// ETag derivation: fetchedAt is a stable identifier — it only changes
// when we re-warm/refresh, and re-warming replaces the payload atomically.
// So fetchedAt is effectively a content version. We base36-encode it for
// compactness and wrap in standard double-quotes (strong validator).
export function etagFor(fetchedAt: number): string {
    return `"${fetchedAt.toString(36)}"`;
}

// Strip an optional leading `W/` weak-validator prefix from an ETag value
// so we can compare opaque tags by string equality. Per RFC 7232 §2.3.2,
// `If-None-Match` uses weak comparison: `W/"abc"` and `"abc"` are
// equivalent for cache validation. Cloudflare (and any CDN that
// re-compresses responses) routinely downgrades strong ETags to weak by
// prepending `W/`, so a client revisit that pipes through Cloudflare
// sends back `W/"<tag>"` while our origin still holds `"<tag>"`. Without
// this normalization the strict-equality check below misses every cache
// validation and we re-serve the full payload on every hit.
export function normalizeEtag(value: string | undefined): string | undefined {
    if (!value) return value;
    return value.startsWith('W/') ? value.slice(2) : value;
}
