import { test, expect, beforeEach } from 'bun:test';
import { rateHit, _resetRateLimit } from './rateLimit.ts';

beforeEach(() => _resetRateLimit());

test('allows up to max hits within the window, then limits', () => {
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) {
        expect(rateHit('login:1.2.3.4', t, 60_000, 5).limited).toBe(false);
    }
    const over = rateHit('login:1.2.3.4', t, 60_000, 5);
    expect(over.limited).toBe(true);
    expect(over.retryAfter).toBeGreaterThan(0);
    expect(over.retryAfter).toBeLessThanOrEqual(60);
});

test('window resets after it expires', () => {
    const t = 2_000_000;
    for (let i = 0; i < 5; i++) rateHit('login:a', t, 60_000, 5);
    expect(rateHit('login:a', t, 60_000, 5).limited).toBe(true);
    // jump past the window → counter resets
    expect(rateHit('login:a', t + 60_001, 60_000, 5).limited).toBe(false);
});

test('buckets are independent per key (ip + endpoint namespace)', () => {
    const t = 3_000_000;
    for (let i = 0; i < 5; i++) rateHit('login:ip1', t, 60_000, 5);
    expect(rateHit('login:ip1', t, 60_000, 5).limited).toBe(true);   // ip1 maxed
    expect(rateHit('login:ip2', t, 60_000, 5).limited).toBe(false);  // different ip
    expect(rateHit('register:ip1', t, 60_000, 5).limited).toBe(false); // different endpoint
});

test('retryAfter counts down within the window', () => {
    const t = 4_000_000;
    for (let i = 0; i < 5; i++) rateHit('login:x', t, 60_000, 5);
    const early = rateHit('login:x', t + 1_000, 60_000, 5);   // ~59s left
    const late = rateHit('login:x', t + 50_000, 60_000, 5);   // ~10s left
    expect(early.retryAfter).toBeGreaterThan(late.retryAfter);
});
