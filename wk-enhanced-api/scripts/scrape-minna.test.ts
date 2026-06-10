import { describe, expect, test } from 'bun:test';
import { clean, parseVocab, parsePairs, collectAudio } from './scrape-minna.ts';

describe('clean', () => {
    test('strips tags + ruby readings, keeps the base text', () => {
        expect(clean('<span>こうさ<rp>(</rp><rt>てん</rt><rp>)</rp>てん</span>')).toBe('こうさてん');
        expect(clean('ask&nbsp;(the&nbsp;teacher)')).toBe('ask (the teacher)');
    });
});

describe('parseVocab', () => {
    const html = `
      <table class="search_result"><thead><tr><th>V</th><th>K</th><th>A</th><th>M</th></tr></thead><tbody>
      <tr><td>ききます[せんせいに～]</td><td>聞きます</td>
        <td class="td_center"><audio class="tvplay" src="/Audio/minnamoi/bai23/00010101011101110.mp3" controls></audio></td>
        <td>ask (the teacher)</td></tr>
      <tr><td>サイズ</td><td></td>
        <td class="td_center"><audio class="tvplay" src="/Audio/minnamoi/bai23/00010101011111010.mp3" controls></audio></td>
        <td>size</td></tr>
      </tbody></table>`;
    const rows = parseVocab(html);

    test('extracts a row per <tr>, skipping the <th> header', () => {
        expect(rows).toHaveLength(2);
    });
    test('keeps kana (with [context]), kanji, meaning, and the audio path', () => {
        expect(rows[0]).toEqual({
            kana: 'ききます[せんせいに～]',
            kanji: '聞きます',
            mean: 'ask (the teacher)',
            audio: '/Audio/minnamoi/bai23/00010101011101110.mp3',
        });
    });
    test('tolerates an empty kanji cell', () => {
        expect(rows[1].kanji).toBe('');
        expect(rows[1].audio).toBe('/Audio/minnamoi/bai23/00010101011111010.mp3');
    });
    test('returns [] when there is no vocab table', () => {
        expect(parseVocab('<p>no table here</p>')).toEqual([]);
    });
});

describe('parsePairs', () => {
    test('pairs candich (JP) with the following nddich (EN)', () => {
        const html = `
          <div class="candich"><strong><span>どうやって 行きますか</span></strong></div>
          <div class="kqdich" style="opacity:0"><div class="nddich i18n" data-i18n="x">How do I get there?</div></div>`;
        expect(parsePairs(html)).toEqual([{ jp: 'どうやって 行きますか', en: 'How do I get there?' }]);
    });
    test('drops entries with no Japanese', () => {
        expect(parsePairs('<div class="nddich">orphan english</div>')).toEqual([]);
    });
});

describe('collectAudio', () => {
    test('finds every distinct /Audio/*.mp3, across roots', () => {
        const html = `src="/Audio/minnahonsatsu1/78.mp3" ... /Audio/minnamoi/bai23/0001.mp3 ... /Audio/minnamoi/bai23/0001.mp3`;
        expect(collectAudio(html)).toEqual(['/Audio/minnahonsatsu1/78.mp3', '/Audio/minnamoi/bai23/0001.mp3']);
    });
});
