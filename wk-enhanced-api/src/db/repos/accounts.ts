// users + sessions — account identity and login. A session row points at a user
// (ON DELETE CASCADE); the token is the wk_session httpOnly cookie. Pruned lazily
// on expired-token access + hourly via deleteExpiredSessions().

import { getDb } from '../connection.ts';

export interface UserRow {
    id: number;
    email: string;
    passwordHash: string;
    createdAt: number;
}

// Public-facing user shape (never leaks the password hash to a response).
export interface PublicUser {
    id: number;
    email: string;
    createdAt: number;
}

// Thrown by createUser when the email is already registered. Callers map this
// to a 409 conflict. We detect the UNIQUE-constraint failure rather than doing
// a pre-check SELECT so the uniqueness check stays atomic with the insert.
export class EmailTakenError extends Error {
    constructor() {
        super('email already registered');
        this.name = 'EmailTakenError';
    }
}

export function createUser(email: string, passwordHash: string): PublicUser {
    const now = Date.now();
    try {
        const r = getDb()
            .query('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?) RETURNING id')
            .get(email, passwordHash, now) as { id: number };
        return { id: r.id, email, createdAt: now };
    } catch (err) {
        // bun:sqlite surfaces UNIQUE violations as an error whose message
        // contains "UNIQUE constraint failed". Narrow to email-taken; rethrow
        // anything else (disk full, etc.).
        if (err instanceof Error && /UNIQUE constraint failed: users\.email/i.test(err.message)) {
            throw new EmailTakenError();
        }
        throw err;
    }
}

export function getUserByEmail(email: string): UserRow | null {
    const row = getDb()
        .query('SELECT id, email, password_hash, created_at FROM users WHERE email = ?')
        .get(email) as { id: number; email: string; password_hash: string; created_at: number } | null;
    if (!row) return null;
    return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
}

export function getUserById(id: number): PublicUser | null {
    const row = getDb()
        .query('SELECT id, email, created_at FROM users WHERE id = ?')
        .get(id) as { id: number; email: string; created_at: number } | null;
    if (!row) return null;
    return { id: row.id, email: row.email, createdAt: row.created_at };
}

export function createSession(token: string, userId: number, expiresAt: number): void {
    const now = Date.now();
    getDb()
        .query('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(token, userId, now, expiresAt);
}

// Resolve a session token to its user, enforcing expiry. Expired (or missing)
// tokens return null; an expired token is also deleted as lazy housekeeping so
// the table doesn't accumulate dead rows between the periodic sweep.
export function getValidSession(token: string): PublicUser | null {
    const row = getDb()
        .query(
            `SELECT s.expires_at AS expires_at, u.id AS id, u.email AS email, u.created_at AS created_at
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?`,
        )
        .get(token) as { expires_at: number; id: number; email: string; created_at: number } | null;
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
        deleteSession(token);
        return null;
    }
    return { id: row.id, email: row.email, createdAt: row.created_at };
}

export function deleteSession(token: string): void {
    getDb().query('DELETE FROM sessions WHERE token = ?').run(token);
}

// Housekeeping: drop all expired sessions. Called on a timer from index.ts.
// Returns the number of rows removed (for logging).
export function deleteExpiredSessions(): number {
    const r = getDb().query('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    return r.changes;
}
