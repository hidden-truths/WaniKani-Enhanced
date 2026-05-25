// Shared defaultHook for every OpenAPIHono instance. Reformats Zod validation
// failures into our documented ErrorSchema shape: { error, detail } with a
// flattened summary of the bad fields.

import type { Hook } from '@hono/zod-openapi';

export const zodHook: Hook<any, any, any, any> = (result, c) => {
    if (!result.success) {
        const issues = result.error.issues.map((i) => {
            // Zod 4's path is PropertyKey[] (can include symbol); coerce.
            const path = i.path.map((p) => String(p)).join('.') || '(root)';
            return `${path}: ${i.message}`;
        });
        return c.json(
            {
                code: 'validation_error' as const,
                error: 'invalid request',
                detail: issues.join('; '),
            },
            400,
        );
    }
};
