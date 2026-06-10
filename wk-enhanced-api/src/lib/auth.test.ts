// Unit tests for the pure / self-contained auth helpers. Cookie + session
// wiring (startSession/currentUser) is exercised via the DB repo tests and
// manual curl; here we cover password hashing and email normalization.

import { describe, test, expect } from 'bun:test';
import { hashPassword, verifyPassword, normalizeEmail } from './auth.ts';

describe('password hashing', () => {
    test('verify accepts the correct password', async () => {
        const hash = await hashPassword('correct horse battery staple');
        expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    });

    test('verify rejects a wrong password', async () => {
        const hash = await hashPassword('correct horse battery staple');
        expect(await verifyPassword('wrong password', hash)).toBe(false);
    });

    test('hashing the same password twice yields different hashes (salted)', async () => {
        const a = await hashPassword('samePass123');
        const b = await hashPassword('samePass123');
        expect(a).not.toBe(b);
        expect(await verifyPassword('samePass123', a)).toBe(true);
        expect(await verifyPassword('samePass123', b)).toBe(true);
    });
});

describe('normalizeEmail', () => {
    test('lowercases and trims', () => {
        expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    });
    test('idempotent on already-normal input', () => {
        expect(normalizeEmail('a@b.com')).toBe('a@b.com');
    });
});
