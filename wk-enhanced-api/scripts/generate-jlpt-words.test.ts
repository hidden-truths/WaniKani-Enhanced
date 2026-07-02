import { describe, expect, test } from 'bun:test';
import { generate, matchEntry, parseEntry, posTraits, priScore } from './generate-jlpt-words';

// A tiny JMdict_e-shaped fixture: entities stay literal (we never expand the DTD).
const FIXTURE = `<?xml version="1.0"?>
<JMdict>
<entry>
<ent_seq>1</ent_seq>
<k_ele><keb>泳ぐ</keb><ke_pri>ichi1</ke_pri><ke_pri>nf12</ke_pri></k_ele>
<r_ele><reb>およぐ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5g;</pos><pos>&vi;</pos><gloss>to swim</gloss></sense>
</entry>
<entry>
<ent_seq>2</ent_seq>
<k_ele><keb>勉強</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>べんきょう</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><pos>&vs;</pos><gloss>study</gloss><gloss>diligence</gloss><gloss>discount</gloss><gloss>fourth gloss</gloss></sense>
</entry>
<entry>
<ent_seq>3</ent_seq>
<k_ele><keb>食べる</keb></k_ele>
<r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><pos>&vt;</pos><gloss>to eat</gloss></sense>
</entry>
<entry>
<ent_seq>4</ent_seq>
<r_ele><reb>あっさり</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&adv;</pos><gloss>easily</gloss></sense>
</entry>
<entry>
<ent_seq>5</ent_seq>
<k_ele><keb>辛い</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>からい</reb><re_pri>ichi1</re_pri></r_ele>
<r_ele><reb>つらい</reb><re_restr>辛い</re_restr></r_ele>
<sense><pos>&adj-i;</pos><gloss>spicy</gloss></sense>
</entry>
<entry>
<ent_seq>6</ent_seq>
<r_ele><reb>あっさり</reb></r_ele>
<sense><pos>&n;</pos><gloss>wrong low-priority homograph</gloss></sense>
</entry>
</JMdict>`;

describe('posTraits', () => {
  test('maps verb classes to the deck taxonomy', () => {
    expect(posTraits(['v5g', 'vi'])).toEqual({ cat: 'verb', type: 'godan', trans: 'i' });
    expect(posTraits(['v1', 'vt'])).toEqual({ cat: 'verb', type: 'ichidan', trans: 't' });
    expect(posTraits(['vs-i'])).toEqual({ cat: 'verb', type: 'irregular', trans: '' });
  });
  test('bare vs (suru-noun) stays a noun; adverbs and expressions map', () => {
    expect(posTraits(['n', 'vs']).cat).toBe('noun');
    expect(posTraits(['adv']).cat).toBe('adverb');
    expect(posTraits(['exp']).cat).toBe('phrase');
    expect(posTraits(['adj-na'])).toEqual({ cat: 'adjective', type: 'na-adj', trans: '' });
  });
});

describe('priScore', () => {
  test('ichi1 beats ichi2 beats nothing; nf grades', () => {
    expect(priScore(['ichi1'])).toBeGreaterThan(priScore(['ichi2']));
    expect(priScore(['ichi2'])).toBeGreaterThan(priScore([]));
    expect(priScore(['nf01'])).toBeGreaterThan(priScore(['nf40']));
  });
});

describe('matchEntry', () => {
  const entries = FIXTURE.split('<entry>').slice(1).map((e) => parseEntry(e.split('</entry>')[0]));

  test('kanji headword: keb match, reading from first admissible reb', () => {
    const hit = matchEntry(entries[0], '泳ぐ')!;
    expect(hit.read).toBe('およぐ');
    expect(hit.mean).toBe('to swim');
    expect(hit.cat).toBe('verb');
    expect(hit.type).toBe('godan');
    expect(hit.trans).toBe('i');
  });
  test('glosses cap at 3', () => {
    expect(matchEntry(entries[1], '勉強')!.mean).toBe('study; diligence; discount');
  });
  test('kana headword: reb match, read = jp', () => {
    const hit = matchEntry(entries[3], 'あっさり')!;
    expect(hit.read).toBe('あっさり');
    expect(hit.cat).toBe('adverb');
  });
  test('re_restr admits the restricted reading for its keb', () => {
    // からい is the unrestricted first reading; 辛い resolves to it (first admissible).
    expect(matchEntry(entries[4], '辛い')!.read).toBe('からい');
  });
  test('no match → null', () => {
    expect(matchEntry(entries[0], '走る')).toBeNull();
  });
});

describe('generate', () => {
  test('levels bucket + frequency order + best-priority homograph wins + misses reported', () => {
    const vocab = { 食べる: 5, 泳ぐ: 4, あっさり: 1, 存在しない語: 3 };
    const { byLevel, misses } = generate(FIXTURE, vocab);
    expect(byLevel.N5.map((r: any) => r.jp)).toEqual(['食べる']);
    expect(byLevel.N4.map((r: any) => r.jp)).toEqual(['泳ぐ']);
    // The ichi1 homograph (entry 4) must beat the no-priority one (entry 6).
    expect(byLevel.N1[0].hit.mean).toBe('easily');
    expect(misses.N3).toEqual(['存在しない語']);
  });
});
