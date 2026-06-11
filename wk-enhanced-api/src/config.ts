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
    databaseFile: process.env.DATABASE_FILE || './dev-data/wk-enhanced-api.sqlite',
    wkApiToken: process.env.WK_API_TOKEN || '',
    warmRefreshDays: num('WARM_REFRESH_DAYS', 30),
    indexMetaRefreshDays: num('INDEX_META_REFRESH_DAYS', 7),
    // Accounts / study-app config.
    auth: {
        // How long a login session stays valid. Sliding expiry is not
        // implemented (kept simple); the cookie + DB row both carry this TTL.
        sessionTtlDays: num('SESSION_TTL_DAYS', 30),
        // Set true in prod (HTTPS via Cloudflare) so the session cookie carries
        // the Secure flag. MUST be false for local http://localhost dev or the
        // browser silently drops the cookie and login appears to "not stick".
        cookieSecure: bool('COOKIE_SECURE', false),
        // Cookie Domain. Empty (default) = a HOST-ONLY cookie — correct for dev
        // (localhost) and any same-origin deploy. In the two-container prod topology
        // (study app at wkenhanced.dev, this API at api.wkenhanced.dev), set
        // COOKIE_DOMAIN=.wkenhanced.dev so a session minted by the API also reaches
        // the apex study-app origin (the two are same-site). See the CORS branch in index.ts.
        cookieDomain: process.env.COOKIE_DOMAIN || '',
    },
    // Cross-origin allowlist for the study-app routes. These origins may make
    // CREDENTIALED (cookie) requests to /v1/auth, /v1/progress, /v1/sessions, /v1/minna.
    // Cross-origin + credentials requires the server to echo an EXPLICIT origin (the
    // wildcard '*' is illegal with credentials), so it only does so for origins listed
    // here. Dev defaults to the Vite dev server; prod set to https://wkenhanced.dev.
    // Comma-separated. (The userscript's vocab routes stay blanket-'*', no credentials.)
    studyApp: {
        allowedOrigins: (process.env.STUDY_APP_ORIGINS || 'http://localhost:5173')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    },
    // みんなの日本語 dashboard access control.
    minna: {
        // Comma-separated allowlist of account emails permitted to load the
        // copyrighted Minna no Nihongo content + native audio. Empty = any
        // signed-in user. Set this to the owner's email in prod to keep the
        // material private to them.
        ownerEmails: (process.env.MINNA_OWNER_EMAILS || '')
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
    },
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
