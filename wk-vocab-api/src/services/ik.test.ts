// Unit tests for the pure URL-builder in ik.ts. The IK fetch functions
// themselves are integration-only — we don't hit live IK in unit tests.

import { describe, test, expect } from 'bun:test';
import { buildDownloadMediaUrl } from './ik.ts';

describe('buildDownloadMediaUrl', () => {
    test('standard path', () => {
        expect(buildDownloadMediaUrl('anime', 'Fate Zero', 'foo.mp3')).toBe(
            'https://apiv2.immersionkit.com/download_media?path=media/anime/Fate%20Zero/media/foo.mp3',
        );
    });

    test('non-ASCII folder is percent-encoded segment-wise', () => {
        // The "×" in "Hunter × Hunter" must round-trip through IK's proxy.
        expect(buildDownloadMediaUrl('anime', 'Hunter × Hunter', '001.mp3')).toBe(
            'https://apiv2.immersionkit.com/download_media?path=media/anime/Hunter%20%C3%97%20Hunter/media/001.mp3',
        );
    });

    test('slashes stay literal between path segments', () => {
        // The five segments (media / category / folder / media / filename)
        // are joined with literal "/" — the encoding is per-segment, not
        // applied to the joined string.
        const url = buildDownloadMediaUrl('anime', 'Fate Zero', 'a.mp3');
        // Path part after `?path=` should have exactly 4 slashes for the 5 segments.
        const path = new URL(url).searchParams.get('path')!;
        expect(path.split('/').length).toBe(5);
    });

    test('special chars in filename are escaped', () => {
        expect(buildDownloadMediaUrl('anime', 'Foo', "a b&c.mp3")).toContain(
            'a%20b%26c.mp3',
        );
    });
});
