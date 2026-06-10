import { describe, expect, test } from 'bun:test';
import { isValidMinnaAudioPath } from './minnaAudio.ts';

describe('isValidMinnaAudioPath', () => {
    test('accepts real vnjpclub audio paths across roots', () => {
        expect(isValidMinnaAudioPath('/Audio/minnamoi/bai23/00010101011101110.mp3')).toBe(true);
        expect(isValidMinnaAudioPath('/Audio/minnahonsatsu1/78.mp3')).toBe(true);
        expect(isValidMinnaAudioPath('/Audio/minnarenshuc/10000010110.mp3')).toBe(true);
        expect(isValidMinnaAudioPath('/Audio/FD1/01.mp3')).toBe(true);
    });
    test('rejects path traversal, other hosts, and non-mp3 (SSRF guard)', () => {
        expect(isValidMinnaAudioPath('/Audio/../etc/passwd.mp3')).toBe(false);
        expect(isValidMinnaAudioPath('/Audio/minnamoi/bai23/x.mp3?evil=1')).toBe(false);
        expect(isValidMinnaAudioPath('https://evil.example/Audio/x.mp3')).toBe(false);
        expect(isValidMinnaAudioPath('/Other/minnamoi/x.mp3')).toBe(false);
        expect(isValidMinnaAudioPath('/Audio/minnamoi/x.jpg')).toBe(false);
        expect(isValidMinnaAudioPath('/Audio/minna moi/x.mp3')).toBe(false);
    });
    test('rejects non-strings', () => {
        expect(isValidMinnaAudioPath(undefined)).toBe(false);
        expect(isValidMinnaAudioPath(42)).toBe(false);
    });
});
