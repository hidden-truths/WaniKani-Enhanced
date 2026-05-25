// Env-var loading + validation. Bun auto-loads .env; we just normalize and
// surface a typed shape so the rest of the code doesn't read process.env.

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

export const config = {
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
