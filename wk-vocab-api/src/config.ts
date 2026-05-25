// Env-var loading + validation. Bun auto-loads .env; we just normalize and
// surface a typed shape so the rest of the code doesn't read process.env.

import pkg from '../package.json' with { type: 'json' };

function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

function num(name: string, fallback: number): number {
    const v = process.env[name];
    if (!v) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number, got: ${v}`);
    return n;
}

function bool(name: string, fallback: boolean): boolean {
    const v = process.env[name];
    if (v === undefined) return fallback;
    return v === '1' || v.toLowerCase() === 'true';
}

const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
if (driver !== 'local' && driver !== 's3') {
    throw new Error(`STORAGE_DRIVER must be "local" or "s3", got: ${driver}`);
}

// Driver-specific env validation. Run at boot rather than lazily inside
// the Storage constructor so misconfigured prod envs kill the service
// at startup instead of on the first warm — typically hours after
// deploy. S3Storage still has its own constructor check as
// belt-and-suspenders. Exported for unit testing.
export function validateStorageEnv(
    driver: 'local' | 's3',
    env: Record<string, string | undefined>,
): void {
    if (driver !== 's3') return;
    const required = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
    const missing = required.filter((k) => !env[k]);
    if (missing.length) {
        throw new Error(
            `STORAGE_DRIVER=s3 requires the following env vars: ${missing.join(', ')}. ` +
                `See .env.example for the full set.`,
        );
    }
}

validateStorageEnv(driver, process.env);

export const config = {
    // Single source of truth for the server version: package.json. Routes
    // and OpenAPI docs read this; bumping the package.json version
    // propagates everywhere automatically.
    version: pkg.version,
    port: num('PORT', 3000),
    adminToken: required('ADMIN_TOKEN'),
    databaseFile: process.env.DATABASE_FILE || './dev-data/wk-vocab.sqlite',
    wkApiToken: process.env.WK_API_TOKEN || '',
    warmRefreshDays: num('WARM_REFRESH_DAYS', 30),
    indexMetaRefreshDays: num('INDEX_META_REFRESH_DAYS', 7),
    storage: {
        driver: driver as 'local' | 's3',
        localDir: process.env.LOCAL_MEDIA_DIR || './dev-data/media',
        publicBase: (process.env.MEDIA_PUBLIC_BASE || 'http://localhost:3000/media').replace(/\/$/, ''),
        s3: {
            endpoint: process.env.S3_ENDPOINT || '',
            region: process.env.S3_REGION || 'us-east-1',
            bucket: process.env.S3_BUCKET || '',
            accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
            forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
        },
    },
} as const;

export type Config = typeof config;
