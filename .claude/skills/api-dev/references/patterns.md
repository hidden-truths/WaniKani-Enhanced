# Worked example: adding an endpoint to wk-enhanced-api

The scenario: **`GET /v1/sessions` — return the signed-in user's most recent 50 study sessions.** This is a real anticipated follow-up (the "Accounts + study app" section of `wk-enhanced-api/CLAUDE.md` notes "A GET to list/aggregate is a future add"), and `/v1/sessions` already exists as a POST-only group — so it exercises every layer without inventing anything. If you are actually implementing this for real (not just learning the pattern), check `ROADMAP.html` for an owning record first (see the `roadmap` skill).

Every skeleton below is written in the codebase's live idiom and names the real file it was modeled on. Copy the shape, not the exact code — re-read the model file first; it may have evolved past this document.

The layers, in build order:

1. Schema → `src/schemas/progress.ts`
2. Repo function → `src/db/repos/studySessions.ts`
3. Route → `src/routes/sessions.ts`
4. Repo test → `src/db/repos/studySessions.test.ts`
5. Route test → in-process `app.fetch()`, modeled on `src/routes/integration.test.ts`
6. Finishing checklist

---

## 1. Schema (in `src/schemas/progress.ts`)

Session shapes live in the `progress` domain file (it already holds `SessionPostRequestSchema` / `SessionPostResponseSchema`). Add response schemas there — never to the barrel `src/schemas.ts`. Import `z` from `@hono/zod-openapi` (NOT plain `zod`) so `.openapi()` exists; register every object with `.openapi('Name')` so it appears in `/openapi.json`.

```ts
// One row of the durable session log, as returned by GET /v1/sessions.
export const SessionListItemSchema = z
    .object({
        id: z.number().int(),
        endedAt: z.number().int().openapi({ description: 'Epoch ms when the session finished.' }),
        right: z.number().int(),
        total: z.number().int(),
        mode: z.string().nullable(),
        details: z.any().nullable(),
    })
    .openapi('SessionListItem');

export const SessionListResponseSchema = z
    .object({
        sessions: z.array(SessionListItemSchema).openapi({ description: 'Newest first, capped at 50.' }),
        count: z.number().int().openapi({ description: 'Lifetime session count (uncapped).' }),
    })
    .openapi('SessionListResponse');
```

Style notes (visible throughout `src/schemas/*`): comments explain intent; `.openapi({ description })` on anything a client would wonder about; request params/bodies get `.openapi({ param: ... })` / examples (see `AppParamSchema` in `src/routes/progress.ts` for a path-param enum done right).

## 2. Repo (in `src/db/repos/studySessions.ts`)

SQL lives here and only here. The idiom is `getDb().query(sql).get/.all/.run(...)` with snake_case columns mapped to camelCase at the boundary. The `study_sessions` columns (from `insertSession` in the same file): `id, user_id, ended_at, right_count, total_count, mode, details, idempotency_key` — `details` is stored as a JSON string, so parse it on the way out.

```ts
// The user's most recent sessions, newest first. Caller owns the limit policy.
export function listSessions(
    userId: number,
    limit: number,
): { id: number; endedAt: number; right: number; total: number; mode: string | null; details: unknown }[] {
    const rows = getDb()
        .query(
            `SELECT id, ended_at, right_count, total_count, mode, details
             FROM study_sessions
             WHERE user_id = ?
             ORDER BY ended_at DESC, id DESC
             LIMIT ?`,
        )
        .all(userId, limit) as {
        id: number; ended_at: number; right_count: number; total_count: number;
        mode: string | null; details: string | null;
    }[];
    return rows.map((r) => ({
        id: r.id,
        endedAt: r.ended_at,
        right: r.right_count,
        total: r.total_count,
        mode: r.mode,
        details: r.details == null ? null : JSON.parse(r.details),
    }));
}
```

This file is already re-exported by the `src/db/client.ts` barrel, so callers get it via `import * as db from '../db/client.ts'` with no barrel change. A **new** aggregate would need its own `src/db/repos/<name>.ts` plus one `export * from './repos/<name>.ts'` line in `client.ts` (keep the barrel's one-way layering comment honest).

## 3. Route (in `src/routes/sessions.ts`)

The router already exists with the required constructor — `export const sessionsRouter = new OpenAPIHono({ defaultHook: zodHook });`. **If you were creating a new route file, that `{ defaultHook: zodHook }` is mandatory** (per-instance, not inherited; without it validation failures leak Zod's raw shape instead of `{code,error,detail}`).

```ts
const listRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Accounts'],
    summary: "List the current user's most recent study sessions",
    responses: {
        200: {
            description: 'Newest-first sessions + lifetime count.',
            content: { 'application/json': { schema: SessionListResponseSchema } },
        },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

sessionsRouter.openapi(listRoute, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c, 'Log in to read session history.');
    c.header('Cache-Control', 'no-store'); // per-user data — never let an edge cache it
    const sessions = db.listSessions(user.id, 50);
    const count = db.countSessions(user.id);
    return c.json({ sessions, count }, 200);
});
```

Imports match the file's existing ones: `OpenAPIHono, createRoute` from `@hono/zod-openapi`; `* as db` from `../db/client.ts`; `unauthorized` from `../lib/httpErrors.ts`; `currentUser` from `../lib/auth.ts`; schemas from `../schemas.ts`; `zodHook` from `../lib/zodHook.ts`; `log` from `../lib/log.ts` if you emit an event.

Compare the real POST handler in the same file, and `src/routes/progress.ts` for: a path-param enum, a validated body (`c.req.valid('json')`), a hand-rolled 400 (size guard), and a 409 conflict response — between the two files you can see almost every response pattern the server uses.

**Wiring for a NEW route group** (not needed here, `/v1/sessions` is already mounted):

- `app.route('/v1/<group>', <group>Router)` in `src/index.ts`.
- If the study app calls it with credentials: add the group to the `STUDY_ROUTE` regex alternation in `src/index.ts`. Skip this and the endpoint works in curl but is CORS-rejected in the browser (the study app always sends `credentials: 'include'`).
- Query params: define them in the `createRoute` request schema (`request: { query: z.object({...}) }`) rather than reading `c.req.query()` raw, so validation + docs stay generated. (The legacy `/v1/tts` handler in `index.ts` reads raw queries — it predates the pattern; don't copy it.)

## 4. Repo test (in `src/db/repos/studySessions.test.ts`)

One test file per repo, beside it. The in-memory seam gives full isolation with zero mocking:

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from '../connection.ts';
import * as db from '../client.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');     // full schema.sql applied to a fresh in-memory DB
    _useDbForTesting(mem);        // every repo call now hits it
});

afterEach(() => {
    _useDbForTesting(null);       // next getDb() falls back to the configured file
    mem.close();
});

describe('listSessions', () => {
    test('returns newest-first, only the caller rows, capped by limit', () => {
        const u = db.createUser('a@example.com', 'hash');
        const other = db.createUser('b@example.com', 'hash');
        db.insertSession(u.id, 1000, 4, 6, 'meaning', null);
        db.insertSession(u.id, 2000, 2, 8, 'reading', { deck: 'leech' });
        db.insertSession(other.id, 3000, 5, 5, null, null); // must not leak into u's list
        const got = db.listSessions(u.id, 50);
        expect(got.map((s) => s.endedAt)).toEqual([2000, 1000]);
        expect(got[0].details).toEqual({ deck: 'leech' }); // JSON round-trips
        expect(db.listSessions(u.id, 1)).toHaveLength(1);
    });
});
```

The existing tests in this file also show the cascade-delete check (delete the user row, expect the log gone) and the idempotency-key semantics — mirror their thoroughness for anything with an invariant.

## 5. Route test (in-process, modeled on `src/routes/integration.test.ts`)

Route tests exercise the actual HTTP surface — status codes, headers, error shapes — with `app.fetch()` and no port. The cookie sign-in idiom is two repo calls plus a header; no auth router needed:

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { zodHook } from '../lib/zodHook.ts';
import { sessionsRouter } from './sessions.ts';
import { openDb, _useDbForTesting } from '../db/client.ts';
import * as db from '../db/client.ts';

let mem: ReturnType<typeof openDb>;
let app: OpenAPIHono;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
    app = new OpenAPIHono({ defaultHook: zodHook });
    app.route('/v1/sessions', sessionsRouter);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

function signIn(email: string, token: string): number {
    const u = db.createUser(email, 'h');
    db.createSession(token, u.id, Date.now() + 100_000);
    return u.id;
}

describe('GET /v1/sessions', () => {
    test('401 with the error contract when logged out', async () => {
        const res = await app.fetch(new Request('http://test.local/v1/sessions'));
        expect(res.status).toBe(401);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe('unauthorized'); // switch on code, never on error text
    });

    test('lists the signed-in user, newest first, with no-store', async () => {
        const uid = signIn('a@b.com', 'tok');
        db.insertSession(uid, 1000, 4, 6, 'meaning', null);
        db.insertSession(uid, 2000, 2, 8, 'reading', null);
        const res = await app.fetch(
            new Request('http://test.local/v1/sessions', { headers: { Cookie: 'wk_session=tok' } }),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const body = (await res.json()) as { sessions: { endedAt: number }[]; count: number };
        expect(body.count).toBe(2);
        expect(body.sessions.map((s) => s.endedAt)).toEqual([2000, 1000]);
    });
});
```

Rules the harness enforces by convention: never trigger `warmWord()` (pre-seed with `db.upsertVocab` or use `?nowarm=true` on vocab routes); never fetch-mock IK/DDG/Google/Claude (inject a client via a factory seam if a service genuinely needs a route test — `_setAnalysisClientForTesting` in `src/services/songAnalyze.ts` is the precedent).

## 6. Finishing checklist

- [ ] `bun test` green (your new tests included) and `bun run typecheck` clean.
- [ ] Endpoint visible at http://localhost:3000/docs; exercised once via "Try it" or curl.
- [ ] Invalid input returns `{code:'validation_error', ...}` (proves `defaultHook` wiring).
- [ ] Per-user responses send `Cache-Control: no-store`.
- [ ] New route group only: mounted in `src/index.ts`; added to `STUDY_ROUTE` if the study app calls it credentialed; verified from the app via `./dev.sh` (curl cannot catch CORS misses).
- [ ] `wk-enhanced-api/CLAUDE.md`: row added/updated in the API-surface table; parity-table row if you added an env var.
- [ ] Client side updated if anyone consumes it (userscript → `userscript-dev` skill; study app → `study-app-dev`).
- [ ] Roadmap record updated + one logical commit — see the `roadmap` and `land-a-change` skills.
