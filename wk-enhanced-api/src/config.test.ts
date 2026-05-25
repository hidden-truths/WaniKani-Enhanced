// Unit tests for boot-time config validation. The full config object
// is loaded once at module-import time from process.env, so we can't
// re-trigger that path inside a test — instead we extract the
// validation logic and exercise it in isolation.

import { describe, test, expect } from 'bun:test';
import { validateStorageEnv } from './config.ts';

describe('validateStorageEnv', () => {
    test('passes for driver=local regardless of S3 envs', () => {
        expect(() => validateStorageEnv('local', {})).not.toThrow();
        expect(() => validateStorageEnv('local', { S3_ENDPOINT: 'x' })).not.toThrow();
    });

    test('throws for driver=s3 with empty env', () => {
        expect(() => validateStorageEnv('s3', {})).toThrow(/S3_ENDPOINT/);
    });

    test('error message lists every missing var', () => {
        try {
            validateStorageEnv('s3', {});
            throw new Error('expected throw');
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toContain('S3_ENDPOINT');
            expect(msg).toContain('S3_BUCKET');
            expect(msg).toContain('S3_ACCESS_KEY_ID');
            expect(msg).toContain('S3_SECRET_ACCESS_KEY');
        }
    });

    test('passes for driver=s3 with all required vars', () => {
        expect(() =>
            validateStorageEnv('s3', {
                S3_ENDPOINT: 'https://sfo3.digitaloceanspaces.com',
                S3_BUCKET: 'wk-enhanced-api-media',
                S3_ACCESS_KEY_ID: 'KEY',
                S3_SECRET_ACCESS_KEY: 'SECRET',
            }),
        ).not.toThrow();
    });

    test('passes for driver=s3 even if optional vars (region, force-path-style) missing', () => {
        expect(() =>
            validateStorageEnv('s3', {
                S3_ENDPOINT: 'x',
                S3_BUCKET: 'x',
                S3_ACCESS_KEY_ID: 'x',
                S3_SECRET_ACCESS_KEY: 'x',
            }),
        ).not.toThrow();
    });

    test('treats empty string as missing', () => {
        expect(() =>
            validateStorageEnv('s3', {
                S3_ENDPOINT: '',
                S3_BUCKET: 'x',
                S3_ACCESS_KEY_ID: 'x',
                S3_SECRET_ACCESS_KEY: 'x',
            }),
        ).toThrow(/S3_ENDPOINT/);
    });
});
