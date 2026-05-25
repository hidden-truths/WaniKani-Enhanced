// Backup retention policy for the wk-enhanced-api SQLite snapshots.
//
// Backups are uploaded as `backups/YYYY-MM-DD.sqlite`. The policy is the
// grandfather-father-son scheme: keep the N most recent daily backups,
// then one per ISO week for the M weeks behind that, then one per
// calendar month for the K months behind that. Everything older is
// pruned. The newest backup in each (week, month) slot wins because we
// iterate newest-first.
//
// This is a pure helper — backup.ts wires it to S3. Tested in retention.test.ts.

export interface RetentionPolicy {
    daily: number;
    weekly: number;
    monthly: number;
}

export interface RetentionDecision {
    keep: string[];
    remove: string[];
}

export const DEFAULT_POLICY: RetentionPolicy = { daily: 7, weekly: 4, monthly: 12 };

const KEY_RE = /^backups\/(\d{4})-(\d{2})-(\d{2})\.sqlite$/;

// Parse a backup key into a UTC Date at midnight of the encoded day.
// Returns null if the key doesn't match the expected shape — the script
// will leave such keys untouched rather than risk deleting things it
// doesn't recognize.
export function parseBackupKey(key: string): Date | null {
    const m = KEY_RE.exec(key);
    if (!m) return null;
    const [, y, mo, d] = m;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (Number.isNaN(date.getTime())) return null;
    // Reject dates that JS silently coerced (e.g. "2026-02-30" → March 2).
    if (
        date.getUTCFullYear() !== Number(y) ||
        date.getUTCMonth() !== Number(mo) - 1 ||
        date.getUTCDate() !== Number(d)
    ) return null;
    return date;
}

// ISO-8601 year + week, e.g. "2026-W21". Sunday belongs to the previous
// week (ISO convention; Thursday-anchored week numbering).
export function isoWeekKey(d: Date): string {
    const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function monthKey(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function selectBackupsToKeep(
    keys: string[],
    policy: RetentionPolicy = DEFAULT_POLICY,
): RetentionDecision {
    // Partition into parseable vs opaque. Opaque keys (anything under the
    // prefix that doesn't match the YYYY-MM-DD pattern) are always kept —
    // we never delete things we can't identify.
    const parsed: Array<{ key: string; date: Date }> = [];
    const opaque: string[] = [];
    for (const key of keys) {
        const date = parseBackupKey(key);
        if (date) parsed.push({ key, date });
        else opaque.push(key);
    }

    parsed.sort((a, b) => b.date.getTime() - a.date.getTime());

    const keep = new Set<string>();
    let dailyCount = 0;
    const weeklyKeeps = new Set<string>();
    const monthlyKeeps = new Set<string>();

    for (const entry of parsed) {
        if (dailyCount < policy.daily) {
            keep.add(entry.key);
            dailyCount++;
            continue;
        }
        const wk = isoWeekKey(entry.date);
        if (weeklyKeeps.size < policy.weekly && !weeklyKeeps.has(wk)) {
            keep.add(entry.key);
            weeklyKeeps.add(wk);
            continue;
        }
        const mk = monthKey(entry.date);
        if (monthlyKeeps.size < policy.monthly && !monthlyKeeps.has(mk)) {
            keep.add(entry.key);
            monthlyKeeps.add(mk);
            continue;
        }
    }

    const remove = parsed.filter((e) => !keep.has(e.key)).map((e) => e.key);
    return {
        keep: [...keep, ...opaque],
        remove,
    };
}
