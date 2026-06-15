// Shared JSON error responses for the cookie-gated study-app routes, so the {code, error}
// shape + status code can't drift across routers (sentences / templates / progress / sessions).
// `detail` carries the route-specific hint. (c is `any` — these are returned from OpenAPIHono
// handlers whose strict response unions reject a concretely-typed Response; this matches the
// per-route helpers they replace.)

export const unauthorized = (c: any, detail: string) =>
    c.json({ code: 'unauthorized' as const, error: 'not logged in', detail }, 401);

export const notFound = (c: any, detail: string) =>
    c.json({ code: 'not_found' as const, error: 'not found', detail }, 404);
