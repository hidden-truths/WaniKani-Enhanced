// Storage abstraction. Two drivers:
//   - "local": writes to LOCAL_MEDIA_DIR, served via the /media/* static route.
//     Zero infrastructure to set up; good for dev and self-hosting on a tiny VPS.
//   - "s3":    uploads to any S3-compatible bucket (DO Spaces, MinIO, AWS). Used
//     in prod or when local storage isn't viable.
//
// Both drivers return a public URL string suitable for putting straight into
// the API response payload — clients fetch the media URL directly with no
// further round trip through us (except in local mode where the /media route
// is still our own process).

import { mkdir, writeFile, stat, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { config } from '../config.ts';
import { log } from '../lib/log.ts';

// Per-object write options. `acl` defaults to 'public-read' so every existing
// caller (the warm pipeline's media, the Minna native-audio cache) is unchanged.
// 'private' is for personal data — user voice recordings — that must NOT get a
// public URL: the object is served only through an auth-gated route via get().
export interface PutOptions {
    acl?: 'public-read' | 'private';
}

export interface Storage {
    // Idempotent: writing the same key twice is fine; latest write wins.
    // Returns the public URL the client should fetch.
    put(key: string, body: ArrayBuffer | Uint8Array, contentType: string, opts?: PutOptions): Promise<string>;
    // True if an object exists. Used by the warmer to skip already-uploaded
    // media without re-downloading from the source.
    exists(key: string): Promise<boolean>;
    // Read an object's bytes, or null if it doesn't exist. Used by the Minna
    // audio proxy to serve a cached MP3 without re-fetching from vnjpclub.
    get(key: string): Promise<ArrayBuffer | null>;
    // Remove an object. Idempotent — deleting a missing key is a no-op, not an
    // error. Used to drop pruned/deleted voice recordings so storage stays bounded.
    delete(key: string): Promise<void>;
    publicUrl(key: string): string;
}

// Shared URL builder for both drivers. Hoisted to a free function so the two
// drivers can't drift in URL-encoding behavior. publicBase is expected to
// have no trailing slash (config.ts strips it). Each path segment is
// percent-encoded individually so slashes between segments stay literal
// while Japanese / spaces / parens in a single segment get encoded.
export function publicUrlFor(publicBase: string, key: string): string {
    return `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

// Cache-Control we want on every served media object. Object keys are
// content-addressed (each example's MP3/JPG is keyed by its IK exampleId,
// stable forever; DDG fallbacks are keyed by sentence index in a fixed
// pool), so the bytes for any given URL never change once written. That
// makes `immutable` correct: the browser HTTP cache holds for a year
// without ever revalidating. Saves a round-trip per audio playback /
// image render after the first one.
//
// Used in two places:
//   - S3Storage.put sets it as object metadata on upload so DO Spaces'
//     CDN returns it on every response.
//   - The dev-mode /media/* static route in src/index.ts returns it
//     directly. Both paths read this same constant so they can't drift.
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

class LocalStorage implements Storage {
    constructor(private readonly rootDir: string, private readonly publicBase: string) {}

    async put(key: string, body: ArrayBuffer | Uint8Array, _contentType: string, _opts?: PutOptions): Promise<string> {
        // ACL is a no-op for the local driver: the dev /media/* route is the only
        // way out and it's localhost-only, so there's no public-bucket exposure to
        // gate. Recordings are served via the auth-gated /v1/minna/recordings route
        // (storage.get), never via their publicUrl, in every driver.
        const path = join(this.rootDir, key);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, body instanceof ArrayBuffer ? new Uint8Array(body) : body);
        return this.publicUrl(key);
    }

    async exists(key: string): Promise<boolean> {
        try {
            const s = await stat(join(this.rootDir, key));
            return s.isFile();
        } catch {
            return false;
        }
    }

    async get(key: string): Promise<ArrayBuffer | null> {
        try {
            const buf = await readFile(join(this.rootDir, key));
            // Copy out of the Node Buffer's (possibly pooled) backing store.
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        } catch {
            return null;
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await unlink(join(this.rootDir, key));
        } catch {
            /* already gone — idempotent */
        }
    }

    publicUrl(key: string): string {
        return publicUrlFor(this.publicBase, key);
    }
}

class S3Storage implements Storage {
    // Bun.S3Client is built-in; speaks the standard S3 API so it works
    // against AWS, DO Spaces, MinIO, R2, etc.
    private readonly client: any;

    constructor(private readonly publicBase: string) {
        const s = config.storage.s3;
        if (!s.bucket || !s.endpoint || !s.accessKeyId || !s.secretAccessKey) {
            throw new Error('S3 driver requires S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
        }
        this.client = new Bun.S3Client({
            accessKeyId: s.accessKeyId,
            secretAccessKey: s.secretAccessKey,
            bucket: s.bucket,
            endpoint: s.endpoint,
            region: s.region,
            // Bun's S3Client uses path-style automatically for non-AWS endpoints,
            // but we expose the flag so people can override for weird setups.
            virtualHostedStyle: !s.forcePathStyle,
        });
    }

    async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string, opts?: PutOptions): Promise<string> {
        const file = this.client.file(key);
        const acl = opts?.acl ?? 'public-read';
        // Per-object ACL is the canonical "make this public" mechanism on
        // DO Spaces. We tried two alternatives during the first prod deploy
        // (2026-05) and both failed:
        //   1. Limited Access key + inline `acl: 'public-read'` on PUT →
        //      AccessDenied. Limited Access scope (even R/W/D) doesn't
        //      grant `s3:PutObjectAcl`.
        //   2. Bucket policy via `s3cmd setpolicy` → 403 even with a
        //      Full Access key. DO Spaces appears not to expose
        //      `PutBucketPolicy` through their S3 API.
        // Solution: use a Full Access Spaces key (single-tenant droplet =
        // marginal risk delta vs Limited Access), keep the inline ACL.
        // The `acl: 'public-read'` param works fine with Full Access.
        //
        // cacheControl is stored as S3 object metadata and returned by
        // the DO Spaces CDN as the Cache-Control response header. The
        // userscript loads media via plain <audio>/<img> src= so the
        // browser HTTP cache picks it up automatically — no IndexedDB
        // layer needed on the server path.
        await file.write(body, {
            type: contentType,
            // 'private' for personal data (voice recordings): no public ACL, and a
            // private Cache-Control so no shared/CDN cache can hold it. The bytes are
            // served only via the auth-gated route reading get(). Default stays
            // 'public-read' + immutable for content-addressed media.
            acl,
            cacheControl: acl === 'private' ? 'private, max-age=31536000, immutable' : MEDIA_CACHE_CONTROL,
        });
        return this.publicUrl(key);
    }

    async exists(key: string): Promise<boolean> {
        try {
            const file = this.client.file(key);
            return await file.exists();
        } catch {
            return false;
        }
    }

    async get(key: string): Promise<ArrayBuffer | null> {
        try {
            const file = this.client.file(key);
            if (!(await file.exists())) return null;
            return await file.arrayBuffer();
        } catch {
            return null;
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await this.client.file(key).delete();
        } catch {
            /* already gone / transient — idempotent best-effort */
        }
    }

    publicUrl(key: string): string {
        return publicUrlFor(this.publicBase, key);
    }
}

let _storage: Storage | null = null;
export function getStorage(): Storage {
    if (_storage) return _storage;
    if (config.storage.driver === 's3') {
        log.info('storage.init', { driver: 's3', bucket: config.storage.s3.bucket });
        _storage = new S3Storage(config.storage.publicBase);
    } else {
        log.info('storage.init', { driver: 'local', dir: config.storage.localDir });
        _storage = new LocalStorage(config.storage.localDir, config.storage.publicBase);
    }
    return _storage;
}

// Object-key conventions. Mirror the layout we'd want in DO Spaces so the
// switch is invisible.
export const keys = {
    audio: (category: string, encodedTitle: string, exampleId: string) =>
        `audio/${category}/${encodedTitle}/${exampleId}.mp3`,
    image: (category: string, encodedTitle: string, exampleId: string) =>
        `image/${category}/${encodedTitle}/${exampleId}.jpg`,
    ddg: (word: string, idx: number) =>
        `ddg/${word}/${idx}.jpg`,
    // Cache key for a proxied Minna native-audio file. `vnjpPath` is the
    // vnjpclub path (e.g. /Audio/minnamoi/bai23/<id>.mp3); drop the leading
    // /Audio/ and namespace under minna/audio/ so the on-disk / Spaces layout
    // stays tidy and collision-free.
    minnaAudio: (vnjpPath: string) =>
        `minna/audio/${vnjpPath.replace(/^\/Audio\//, '')}`,
    // Per-user voice recording (Phase 2 record-and-compare). PRIVATE object —
    // written with acl:'private' and served only through the auth-gated route.
    // `token` is a random uuid generated at upload time, so each take has a
    // unique key (no id round-trip). `itemKey` is sanitized to a safe path
    // segment (it contains ':' — 'mnn:23:conv:2'); the authoritative key is
    // stored in the DB row, so this layout is purely internal.
    minnaRecording: (userId: number, lesson: number, itemKey: string, token: string) =>
        `recording/${userId}/${lesson}/${itemKey.replace(/[^A-Za-z0-9_-]+/g, '_')}/${token}.webm`,
};
