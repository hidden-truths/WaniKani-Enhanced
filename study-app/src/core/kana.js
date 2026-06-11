// Kana normalization + romaji→hiragana for the typed-reading field — all pure.
//
// normKana folds katakana→hiragana, drops spaces/separators, unifies long-vowel marks.
// romajiToKana is a greedy longest-match Hepburn + wāpuro converter so a learner WITHOUT a
// Japanese IME can type "taberu" and have it graded against たべる. Anything not in the
// table — including already-kana — passes through untouched, so a kana IME and a romaji
// typist share one path. Feeds only the ADVISORY typed grade, never the SRS schedule.

export function normKana(s) {
  return (s || '').trim()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　・･、。.]/g, '')
    .replace(/[ー－―‐-―~～]/g, 'ー')
    .toLowerCase();
}

const ROMAJI = {
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ', gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ', shi: 'し', sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', chi: 'ち', cya: 'ちゃ', cyu: 'ちゅ', cyo: 'ちょ',
  tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ', tsu: 'つ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ', hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ', rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ', pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ', zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ',
  dya: 'ぢゃ', dyu: 'ぢゅ', dyo: 'ぢょ',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ', ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', si: 'し', su: 'す', se: 'せ', so: 'そ', za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', ti: 'ち', tu: 'つ', te: 'て', to: 'と', da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の', ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ', pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も', ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ', wa: 'わ', wo: 'を', wi: 'うぃ', we: 'うぇ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ',
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
};
export function romajiToKana(input) {
  const s = (input || '').toLowerCase();
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i], c2 = s[i + 1];
    if (c === 'n' && c2 === "'") { out += 'ん'; i += 2; continue; }                       // n' → ん (explicit boundary)
    if (c === 'n' && c2 === 'n') { out += 'ん'; i += 1; continue; }                       // nn → ん, the 2nd n starts the next syllable
    if (c === 't' && c2 === 'c') { out += 'っ'; i += 1; continue; }                       // tch → っ + ch (matcha → まっちゃ)
    if (c === c2 && 'bcdfghjkmpqrstvwz'.indexOf(c) >= 0) { out += 'っ'; i += 1; continue; } // doubled consonant → っ (kitte → きって)
    const t3 = s.substr(i, 3), t2 = s.substr(i, 2), t1 = s[i];
    if (ROMAJI[t3]) { out += ROMAJI[t3]; i += 3; }
    else if (ROMAJI[t2]) { out += ROMAJI[t2]; i += 2; }
    else if (ROMAJI[t1]) { out += ROMAJI[t1]; i += 1; }
    else if (t1 === 'n') { out += 'ん'; i += 1; }                                          // bare n (word end / before a consonant)
    else { out += t1; i += 1; }                                                            // unknown / already-kana → pass through
  }
  return out;
}
