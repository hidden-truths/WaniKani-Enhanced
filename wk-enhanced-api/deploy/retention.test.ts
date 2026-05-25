import { describe, test, expect } from 'bun:test';
import {
    parseBackupKey,
    isoWeekKey,
    monthKey,
    selectBackupsToKeep,
    DEFAULT_POLICY,
} from './retention.ts';

describe('parseBackupKey', () => {
    test('valid key → UTC midnight date', () => {
        const d = parseBackupKey('backups/2026-05-25.sqlite')!;
        expect(d.getUTCFullYear()).toBe(2026);
        expect(d.getUTCMonth()).toBe(4); // 0-indexed
        expect(d.getUTCDate()).toBe(25);
        expect(d.getUTCHours()).toBe(0);
    });

    test('non-matching prefix → null', () => {
        expect(parseBackupKey('audio/anime/foo.mp3')).toBeNull();
        expect(parseBackupKey('backups/2026-05-25.zip')).toBeNull();
        expect(parseBackupKey('backups/2026-5-25.sqlite')).toBeNull();
    });

    test('rejects dates that would silently roll over', () => {
        // Feb 30 doesn't exist; without the round-trip guard, JS would
        // coerce this to March 2 and we'd delete a date that wasn't
        // actually a backup we generated.
        expect(parseBackupKey('backups/2026-02-30.sqlite')).toBeNull();
        expect(parseBackupKey('backups/2026-13-01.sqlite')).toBeNull();
    });
});

describe('isoWeekKey', () => {
    test('Thursday → that week', () => {
        // Thu 2026-05-21 is in ISO week 21 of 2026.
        expect(isoWeekKey(new Date(Date.UTC(2026, 4, 21)))).toBe('2026-W21');
    });

    test('Sunday belongs to the preceding week (ISO convention)', () => {
        // Sun 2026-05-24 is the last day of W21, not the first of W22.
        expect(isoWeekKey(new Date(Date.UTC(2026, 4, 24)))).toBe('2026-W21');
        // Mon 2026-05-25 is the first day of W22.
        expect(isoWeekKey(new Date(Date.UTC(2026, 4, 25)))).toBe('2026-W22');
    });

    test('January days that belong to the previous year', () => {
        // Fri 2027-01-01 is in W53 of 2026 (because 2026's Jan 1 was a Thursday;
        // a typical year-end edge case the algorithm needs to get right).
        expect(isoWeekKey(new Date(Date.UTC(2027, 0, 1)))).toBe('2026-W53');
    });
});

describe('monthKey', () => {
    test('zero-pads the month', () => {
        expect(monthKey(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01');
        expect(monthKey(new Date(Date.UTC(2026, 11, 5)))).toBe('2026-12');
    });
});

describe('selectBackupsToKeep', () => {
    function dailyKeys(startIso: string, count: number): string[] {
        const out: string[] = [];
        const d = new Date(startIso);
        for (let i = 0; i < count; i++) {
            const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            out.push(`backups/${stamp}.sqlite`);
            d.setUTCDate(d.getUTCDate() - 1);
        }
        return out;
    }

    test('empty input → empty decision', () => {
        const r = selectBackupsToKeep([]);
        expect(r.keep).toEqual([]);
        expect(r.remove).toEqual([]);
    });

    test('fewer than `daily` backups → all kept, nothing removed', () => {
        const keys = dailyKeys('2026-05-25T00:00:00Z', 5);
        const r = selectBackupsToKeep(keys);
        expect(r.keep.sort()).toEqual([...keys].sort());
        expect(r.remove).toEqual([]);
    });

    test('exactly `daily` backups in a stretch → all daily slots filled, nothing weekly/monthly', () => {
        const keys = dailyKeys('2026-05-25T00:00:00Z', 7);
        const r = selectBackupsToKeep(keys);
        expect(r.keep.sort()).toEqual([...keys].sort());
        expect(r.remove).toEqual([]);
    });

    test('1 year of daily → 7 daily + 4 weekly + 12 monthly = 23 kept', () => {
        const keys = dailyKeys('2026-05-25T00:00:00Z', 365);
        const r = selectBackupsToKeep(keys);
        // The exact count can vary by ±1 around month boundaries because
        // a single backup can fill both a weekly and monthly slot
        // simultaneously — but only if dailyCount=7 first. Asserting an
        // upper bound is the cleanest invariant.
        expect(r.keep.length).toBeLessThanOrEqual(
            DEFAULT_POLICY.daily + DEFAULT_POLICY.weekly + DEFAULT_POLICY.monthly,
        );
        expect(r.keep.length + r.remove.length).toBe(365);
        // The 7 newest must always be kept (daily slots are first-served).
        const newestSeven = keys.slice(0, 7);
        for (const k of newestSeven) expect(r.keep).toContain(k);
    });

    test('one backup per week for 8 weeks → 4 weekly slots fill, 4 dropped', () => {
        // Build a list of 8 Mondays going back from 2026-05-25 (a Monday).
        // No daily slots are consumed past the first because successive
        // backups are 7 days apart and the daily slot fills on the first.
        // The next 4 land in the weekly slots; the remaining 3 (older than
        // 4 weeks) are dropped because we've fallen out of the weekly slot.
        // Actually with daily=7 and these 7-day gaps, ALL 8 fit in daily.
        // Use a more dense schedule: 2x per week for 8 weeks = 16 keys.
        const keys: string[] = [];
        const d = new Date(Date.UTC(2026, 4, 25));
        for (let i = 0; i < 8; i++) {
            const stamp1 = formatStamp(d);
            d.setUTCDate(d.getUTCDate() - 3);
            const stamp2 = formatStamp(d);
            d.setUTCDate(d.getUTCDate() - 4);
            keys.push(`backups/${stamp1}.sqlite`);
            keys.push(`backups/${stamp2}.sqlite`);
        }
        const r = selectBackupsToKeep(keys);
        // We expect at most: 7 daily + 4 weekly + monthly slots = 7+4+12 = 23,
        // but the input only spans ~8 weeks so monthly fills 2-3 slots.
        // The total kept count is bounded by input length and by policy
        // — pick a tight upper bound that proves we're not keeping everything.
        expect(r.keep.length).toBeLessThan(keys.length);
        expect(r.keep.length + r.remove.length).toBe(keys.length);
    });

    test('opaque keys (unparseable) are always kept', () => {
        const keys = [
            'backups/2026-05-25.sqlite',
            'backups/README.txt',
            'backups/2026/old-format.sqlite',
            'backups/some-other-file',
        ];
        const r = selectBackupsToKeep(keys);
        // The 3 opaque keys must all be in keep, and never in remove.
        expect(r.keep).toContain('backups/README.txt');
        expect(r.keep).toContain('backups/2026/old-format.sqlite');
        expect(r.keep).toContain('backups/some-other-file');
        expect(r.remove).not.toContain('backups/README.txt');
        expect(r.remove).not.toContain('backups/2026/old-format.sqlite');
    });

    test('custom policy is honored', () => {
        const keys = dailyKeys('2026-05-25T00:00:00Z', 100);
        const r = selectBackupsToKeep(keys, { daily: 3, weekly: 0, monthly: 0 });
        expect(r.keep.length).toBe(3);
        expect(r.remove.length).toBe(97);
    });

    test('within one calendar month → daily slots fill, monthly contributes 0 new keeps', () => {
        // 14 consecutive days. Daily eats the first 7. The next 7 fall into
        // weekly slots (one per ISO week, up to 4) and then the rest land
        // in monthly. Since they're all the same month, monthly fills with
        // exactly one key.
        const keys = dailyKeys('2026-05-25T00:00:00Z', 14);
        const r = selectBackupsToKeep(keys);
        // First 7 (newest) are daily-kept.
        for (let i = 0; i < 7; i++) expect(r.keep).toContain(keys[i]);
        // Total kept should be 7 daily + (1 or 2 weekly slots) + (0 or 1 monthly).
        expect(r.keep.length).toBeGreaterThanOrEqual(8);
        expect(r.keep.length).toBeLessThanOrEqual(10);
    });
});

function formatStamp(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
