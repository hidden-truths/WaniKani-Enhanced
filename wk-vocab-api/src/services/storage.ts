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

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { config } from '../config.ts';
import { log } from '../lib/log.ts';

export interface Storage {
    // Idempotent: writing the same key twice is fine; latest write wins.
    // Returns the public URL the client should fetch.
    put(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<string>;
    // True if an object exists. Used by the warmer to skip already-uploaded
    // media without re-downloading from the source.
    exists(key: string): Promise<boolean>;
    publicUrl(key: string): string;
}

class LocalStorage implements Storage {
    constructor(private readonly rootDir: string, private readonly publicBase: string) {}

    async put(key: string, body: ArrayBuffer | Uint8Array, _contentType: string): Promise<string> {
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

    publicUrl(key: string): string {
        return `${this.publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
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

    async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<string> {
        const file = this.client.file(key);
        // Intentionally no `acl: 'public-read'` here. Setting per-object ACLs
        // requires `s3:PutObjectAcl`, which DO Spaces "Limited Access" keys
        // don't grant — even with Read/Write/Delete scope. Attempting it
        // returns AccessDenied (discovered during the first production deploy
        // in 2026-05). Public-read is instead achieved via a bucket policy
        // that allows anonymous `s3:GetObject` on the whole bucket; see
        // deploy/bucket-policy.json + deploy/README.md "Bucket policy" for
        // the one-time setup. Local-storage driver isn't affected.
        await file.write(body, { type: contentType });
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

    publicUrl(key: string): string {
        return `${this.publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
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
};
