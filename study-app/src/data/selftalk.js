// 独り言 SELF-TALK — built-in starter phrases for output/speaking practice.
//
// Unlike the Minna textbook content, these are original, model-authored lines (no copyright),
// so they ship offline-first and work for anonymous visitors. Each phrase is a short everyday
// utterance — the running monologue of a day — chosen to drill the spoken grammar that
// reading-only drills miss (〜ている, 〜なきゃ/〜ないと, 〜たい, volitional 〜よう, 〜ておく, 〜そう).
//
// A phrase is { id, jp, read, mean, topic, grammar }:
//   - `jp`   the sentence with <ruby>漢字<rt>かな</rt></ruby> furigana on every kanji (CARDS.md
//            format; the global data-furigana flip hides <rt> when off). This carries the reading.
//   - `read` the full hiragana reading (for furigana-off display / aria). TTS uses plainText(jp).
//   - `mean` natural English.
//   - `topic` one of SELFTALK_TAXONOMY's topic ids (its CATEGORY is derived from the registry);
//            `grammar` an array of SELFTALK_GRAMMAR ids. (`topic` was `scene` pre-grid — the store
//            tag is now sentence_tag(kind='topic'); reads still fall back to a legacy `scene` tag.)
// No per-phrase `accent`: pitch accent is a per-WORD property — a single drop number is
// meaningless over a whole sentence — so phrases rely on the furigana + the synth audio's prosody.
//
// MODEL-GENERATED → proofread grammar/furigana before trusting (same caveat as examples.js/Minna).
// The user also authors their own lines at runtime; those are first-class PRIVATE rows in the
// server sentence store (written via POST /v1/sentences), not here.
//
// SEED SOURCE, NOT A RUNTIME READER: as of the unified sentence store, the Self-Talk tab fetches
// these built-ins from GET /v1/sentences (seeded as public rows by wk-enhanced-api's
// scripts/seed-sentences.ts). This SELFTALK constant is the git-tracked curator authoring source
// the seed reads — features/selftalk.js no longer reads it at runtime. Edit a phrase here, then
// re-run the seed to push it to the store.

import { grammarLabel } from './grammar.js';

// Two-level taxonomy: CATEGORY → TOPIC. A phrase's `topic` is one of the topic ids below; its
// CATEGORY is DERIVED from this registry (the single source of truth for labels / kicker / icon /
// display order), never stored on the phrase. The grid renders a cell per topic grouped under its
// category; clicking a cell drills into that topic's phrases. New categories (Gaming, Conversations
// by register, …) and finer topics slot in here without a schema change — `topic` is a
// sentence_tag(kind='topic'); category lives only in this file. `register` (optional, per topic) is
// the conversation politeness axis (plain / です・ます / intimate), surfaced as a badge in the topic
// view. Daily life's 7 topics are the original time-of-day "scenes", re-homed under one category.
export const SELFTALK_TAXONOMY = [
  {
    id: 'daily-life', label: 'Daily life', jp: '日常', icon: 'i-clock',
    topics: [
      { id: 'morning', label: 'Morning routine', jp: '朝' },
      { id: 'commute', label: 'Commute', jp: '通勤' },
      { id: 'meals', label: 'Meals', jp: '食事' },
      { id: 'chores', label: 'Chores', jp: '家事' },
      { id: 'work', label: 'Work', jp: '仕事' },
      { id: 'feelings', label: 'Feelings & intentions', jp: '気持ち' },
      { id: 'evening', label: 'Evening', jp: '夜' },
    ],
  },
  {
    id: 'gaming', label: 'Gaming', jp: 'ゲーム', icon: 'i-gamepad',
    topics: [
      { id: 'minecraft', label: 'Minecraft', jp: 'マイクラ' },
      { id: 'incremental', label: 'Incremental games', jp: '放置ゲー' },
      { id: 'sims', label: 'The Sims', jp: 'シムズ' },
    ],
  },
  {
    // Conversations grouped by REGISTER — each topic carries the politeness level it drills (`register`
    // ∈ plain | polite | intimate), surfaced as a badge in the topic view. Lines are addressed
    // utterances (output practice for real conversations), not 独り言, so they're written in-register.
    id: 'conversations', label: 'Conversations by register', jp: '会話', icon: 'i-chat',
    topics: [
      { id: 'coworker', label: 'With a coworker', jp: '同僚', register: 'polite' },
      { id: 'friend', label: 'With a friend', jp: '友達', register: 'plain' },
      { id: 'boyfriend', label: 'With my boyfriend', jp: '彼氏', register: 'intimate' },
    ],
  },
];

// Flat views derived from the taxonomy (the registry above stays the single source of truth):
// each topic tagged with its category id, plus the display-order id list groupByTopic / the grid
// iterate. Keep lookups going through these so a taxonomy edit can't drift from the feature code.
export const SELFTALK_TOPICS = SELFTALK_TAXONOMY.flatMap((c) => c.topics.map((t) => ({ ...t, category: c.id })));
export const SELFTALK_TOPIC_IDS = SELFTALK_TOPICS.map((t) => t.id);

// Target grammar points for Self-Talk, in teaching order. Labels come from the shared grammar
// registry (data/grammar.js ← patterns.py) so the Self-Talk chips, the auto-detected example tags,
// and the Browse grammar filter are ONE vocabulary and can't drift. Same {id,label} shape the
// chips/filters expect, so the feature code is unchanged.
export const SELFTALK_GRAMMAR = ['te-iru', 'nakya', 'tai', 'volitional', 'te-oku', 'sou']
  .map((id) => ({ id, label: grammarLabel(id) }));

export const SELFTALK = [
  // ---- morning ----
  { id: 'st-morning-1', jp: '<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>いている。', read: 'はをみがいている。', mean: "I'm brushing my teeth.", topic: 'morning', grammar: ['te-iru'] },
  { id: 'st-morning-2', jp: 'そろそろ<ruby>起<rt>お</rt></ruby>きないと。', read: 'そろそろおきないと。', mean: "I've got to get up soon.", topic: 'morning', grammar: ['nakya'] },
  { id: 'st-morning-3', jp: '<ruby>顔<rt>かお</rt></ruby>を<ruby>洗<rt>あら</rt></ruby>ってからコーヒーを<ruby>淹<rt>い</rt></ruby>れよう。', read: 'かおをあらってからコーヒーをいれよう。', mean: 'After I wash my face, let me make some coffee.', topic: 'morning', grammar: ['volitional'] },
  { id: 'st-morning-4', jp: '<ruby>今日<rt>きょう</rt></ruby>は<ruby>早<rt>はや</rt></ruby>く<ruby>家<rt>いえ</rt></ruby>を<ruby>出<rt>で</rt></ruby>たい。', read: 'きょうははやくいえをでたい。', mean: 'I want to leave the house early today.', topic: 'morning', grammar: ['tai'] },
  { id: 'st-morning-5', jp: '<ruby>出<rt>で</rt></ruby>かける<ruby>前<rt>まえ</rt></ruby>に<ruby>天気<rt>てんき</rt></ruby>を<ruby>調<rt>しら</rt></ruby>べておこう。', read: 'でかけるまえにてんきをしらべておこう。', mean: 'Let me check the weather before I head out.', topic: 'morning', grammar: ['te-oku', 'volitional'] },
  { id: 'st-morning-6', jp: 'まだ<ruby>眠<rt>ねむ</rt></ruby>い、<ruby>二度寝<rt>にどね</rt></ruby>しそう。', read: 'まだねむい、にどねしそう。', mean: "I'm still sleepy; feels like I'll fall back asleep.", topic: 'morning', grammar: ['sou'] },

  // ---- commute ----
  { id: 'st-commute-1', jp: '<ruby>電車<rt>でんしゃ</rt></ruby>を<ruby>待<rt>ま</rt></ruby>っている。', read: 'でんしゃをまっている。', mean: "I'm waiting for the train.", topic: 'commute', grammar: ['te-iru'] },
  { id: 'st-commute-2', jp: '<ruby>急<rt>いそ</rt></ruby>がないと<ruby>遅刻<rt>ちこく</rt></ruby>する。', read: 'いそがないとちこくする。', mean: "If I don't hurry, I'll be late.", topic: 'commute', grammar: ['nakya'] },
  { id: 'st-commute-3', jp: '<ruby>座<rt>すわ</rt></ruby>りたいけど<ruby>混<rt>こ</rt></ruby>んでいる。', read: 'すわりたいけどこんでいる。', mean: "I want to sit, but it's crowded.", topic: 'commute', grammar: ['tai', 'te-iru'] },
  { id: 'st-commute-4', jp: '<ruby>次<rt>つぎ</rt></ruby>の<ruby>駅<rt>えき</rt></ruby>で<ruby>降<rt>お</rt></ruby>りよう。', read: 'つぎのえきでおりよう。', mean: 'Let me get off at the next station.', topic: 'commute', grammar: ['volitional'] },
  { id: 'st-commute-5', jp: '<ruby>雨<rt>あめ</rt></ruby>が<ruby>降<rt>ふ</rt></ruby>りそうだから<ruby>傘<rt>かさ</rt></ruby>を<ruby>持<rt>も</rt></ruby>ってきた。', read: 'あめがふりそうだからかさをもってきた。', mean: 'It looks like rain, so I brought an umbrella.', topic: 'commute', grammar: ['sou'] },
  { id: 'st-commute-6', jp: '<ruby>音楽<rt>おんがく</rt></ruby>を<ruby>聞<rt>き</rt></ruby>きながら<ruby>歩<rt>ある</rt></ruby>いている。', read: 'おんがくをききながらあるいている。', mean: "I'm walking while listening to music.", topic: 'commute', grammar: ['te-iru'] },

  // ---- meals ----
  { id: 'st-meals-1', jp: 'お<ruby>昼<rt>ひる</rt></ruby>は<ruby>何<rt>なに</rt></ruby>を<ruby>食<rt>た</rt></ruby>べようかな。', read: 'おひるはなにをたべようかな。', mean: 'I wonder what I should eat for lunch.', topic: 'meals', grammar: ['volitional'] },
  { id: 'st-meals-2', jp: 'お<ruby>腹<rt>なか</rt></ruby>が<ruby>空<rt>す</rt></ruby>いてきた。', read: 'おなかがすいてきた。', mean: "I'm getting hungry.", topic: 'meals', grammar: ['te-iru'] },
  { id: 'st-meals-3', jp: '<ruby>野菜<rt>やさい</rt></ruby>も<ruby>食<rt>た</rt></ruby>べないと。', read: 'やさいもたべないと。', mean: 'I should eat vegetables too.', topic: 'meals', grammar: ['nakya'] },
  { id: 'st-meals-4', jp: 'このラーメン、<ruby>美味<rt>おい</rt></ruby>しそう。', read: 'このラーメン、おいしそう。', mean: 'This ramen looks delicious.', topic: 'meals', grammar: ['sou'] },
  { id: 'st-meals-5', jp: '<ruby>夜<rt>よる</rt></ruby>ご<ruby>飯<rt>はん</rt></ruby>を<ruby>作<rt>つく</rt></ruby>っておこう。', read: 'よるごはんをつくっておこう。', mean: 'Let me make dinner ahead of time.', topic: 'meals', grammar: ['te-oku', 'volitional'] },
  { id: 'st-meals-6', jp: '<ruby>甘<rt>あま</rt></ruby>いものが<ruby>食<rt>た</rt></ruby>べたい。', read: 'あまいものがたべたい。', mean: 'I want to eat something sweet.', topic: 'meals', grammar: ['tai'] },

  // ---- chores ----
  { id: 'st-chores-1', jp: '<ruby>洗濯<rt>せんたく</rt></ruby>しなきゃ。', read: 'せんたくしなきゃ。', mean: "I've got to do laundry.", topic: 'chores', grammar: ['nakya'] },
  { id: 'st-chores-2', jp: '<ruby>部屋<rt>へや</rt></ruby>を<ruby>片付<rt>かたづ</rt></ruby>けている。', read: 'へやをかたづけている。', mean: "I'm cleaning up the room.", topic: 'chores', grammar: ['te-iru'] },
  { id: 'st-chores-3', jp: 'ゴミを<ruby>出<rt>だ</rt></ruby>しておかないと。', read: 'ゴミをだしておかないと。', mean: 'I have to take the trash out (ahead of time).', topic: 'chores', grammar: ['te-oku', 'nakya'] },
  { id: 'st-chores-4', jp: 'お<ruby>皿<rt>さら</rt></ruby>を<ruby>洗<rt>あら</rt></ruby>おう。', read: 'おさらをあらおう。', mean: 'Let me wash the dishes.', topic: 'chores', grammar: ['volitional'] },
  { id: 'st-chores-5', jp: '<ruby>床<rt>ゆか</rt></ruby>が<ruby>汚<rt>よご</rt></ruby>れているから<ruby>掃除<rt>そうじ</rt></ruby>したい。', read: 'ゆかがよごれているからそうじしたい。', mean: "The floor's dirty, so I want to clean.", topic: 'chores', grammar: ['te-iru', 'tai'] },
  { id: 'st-chores-6', jp: '<ruby>買<rt>か</rt></ruby>い<ruby>物<rt>もの</rt></ruby>に<ruby>行<rt>い</rt></ruby>かなきゃいけない。', read: 'かいものにいかなきゃいけない。', mean: 'I have to go shopping.', topic: 'chores', grammar: ['nakya'] },

  // ---- work ----
  { id: 'st-work-1', jp: '<ruby>今<rt>いま</rt></ruby>メールを<ruby>書<rt>か</rt></ruby>いている。', read: 'いまメールをかいている。', mean: "I'm writing an email right now.", topic: 'work', grammar: ['te-iru'] },
  { id: 'st-work-2', jp: '<ruby>会議<rt>かいぎ</rt></ruby>の<ruby>前<rt>まえ</rt></ruby>に<ruby>資料<rt>しりょう</rt></ruby>を<ruby>準備<rt>じゅんび</rt></ruby>しておこう。', read: 'かいぎのまえにしりょうをじゅんびしておこう。', mean: 'Let me prepare the materials before the meeting.', topic: 'work', grammar: ['te-oku', 'volitional'] },
  { id: 'st-work-3', jp: '<ruby>締<rt>し</rt></ruby>め<ruby>切<rt>き</rt></ruby>りに<ruby>間<rt>ま</rt></ruby>に<ruby>合<rt>あ</rt></ruby>わせないと。', read: 'しめきりにまにあわせないと。', mean: 'I have to make the deadline.', topic: 'work', grammar: ['nakya'] },
  { id: 'st-work-4', jp: '<ruby>少<rt>すこ</rt></ruby>し<ruby>休憩<rt>きゅうけい</rt></ruby>したい。', read: 'すこしきゅうけいしたい。', mean: 'I want to take a short break.', topic: 'work', grammar: ['tai'] },
  { id: 'st-work-5', jp: '<ruby>仕事<rt>しごと</rt></ruby>が<ruby>終<rt>お</rt></ruby>わりそうにない。', read: 'しごとがおわりそうにない。', mean: "It doesn't look like work will end.", topic: 'work', grammar: ['sou'] },
  { id: 'st-work-6', jp: '<ruby>先<rt>さき</rt></ruby>に<ruby>返信<rt>へんしん</rt></ruby>しておこう。', read: 'さきにへんしんしておこう。', mean: 'Let me reply first and get it out of the way.', topic: 'work', grammar: ['te-oku', 'volitional'] },

  // ---- feelings & intentions ----
  { id: 'st-feelings-1', jp: 'なんだか<ruby>疲<rt>つか</rt></ruby>れている。', read: 'なんだかつかれている。', mean: "Somehow I'm worn out.", topic: 'feelings', grammar: ['te-iru'] },
  { id: 'st-feelings-2', jp: '<ruby>今日<rt>きょう</rt></ruby>は<ruby>頑張<rt>がんば</rt></ruby>ろう。', read: 'きょうはがんばろう。', mean: 'Let me give it my all today.', topic: 'feelings', grammar: ['volitional'] },
  { id: 'st-feelings-3', jp: '<ruby>泣<rt>な</rt></ruby>きそうだ。', read: 'なきそうだ。', mean: 'I feel like crying.', topic: 'feelings', grammar: ['sou'] },
  { id: 'st-feelings-4', jp: 'もっとリラックスしたい。', read: 'もっとリラックスしたい。', mean: 'I want to relax more.', topic: 'feelings', grammar: ['tai'] },
  { id: 'st-feelings-5', jp: '<ruby>気持<rt>きも</rt></ruby>ちを<ruby>切<rt>き</rt></ruby>り<ruby>替<rt>か</rt></ruby>えないと。', read: 'きもちをきりかえないと。', mean: 'I need to switch my mindset.', topic: 'feelings', grammar: ['nakya'] },
  { id: 'st-feelings-6', jp: '<ruby>楽<rt>たの</rt></ruby>しみにしている。', read: 'たのしみにしている。', mean: "I'm looking forward to it.", topic: 'feelings', grammar: ['te-iru'] },
  { id: 'st-feelings-7', jp: '<ruby>今日<rt>きょう</rt></ruby>はよく<ruby>眠<rt>ねむ</rt></ruby>れそう。', read: 'きょうはよくねむれそう。', mean: 'I feel like I could sleep well tonight.', topic: 'feelings', grammar: ['sou'] },

  // ---- evening ----
  { id: 'st-evening-1', jp: 'お<ruby>風呂<rt>ふろ</rt></ruby>に<ruby>入<rt>はい</rt></ruby>ろう。', read: 'おふろにはいろう。', mean: 'Let me take a bath.', topic: 'evening', grammar: ['volitional'] },
  { id: 'st-evening-2', jp: '<ruby>明日<rt>あした</rt></ruby>の<ruby>準備<rt>じゅんび</rt></ruby>をしておかないと。', read: 'あしたのじゅんびをしておかないと。', mean: 'I have to get ready for tomorrow (ahead of time).', topic: 'evening', grammar: ['te-oku', 'nakya'] },
  { id: 'st-evening-3', jp: 'テレビを<ruby>見<rt>み</rt></ruby>ながらくつろいでいる。', read: 'テレビをみながらくつろいでいる。', mean: "I'm relaxing while watching TV.", topic: 'evening', grammar: ['te-iru'] },
  { id: 'st-evening-4', jp: 'もう<ruby>寝<rt>ね</rt></ruby>たい。', read: 'もうねたい。', mean: 'I want to sleep already.', topic: 'evening', grammar: ['tai'] },
  { id: 'st-evening-5', jp: '<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>いてから<ruby>寝<rt>ね</rt></ruby>よう。', read: 'はをみがいてからねよう。', mean: 'Let me brush my teeth and then go to sleep.', topic: 'evening', grammar: ['volitional'] },
  { id: 'st-evening-6', jp: '<ruby>今日<rt>きょう</rt></ruby>も<ruby>一日<rt>いちにち</rt></ruby><ruby>終<rt>お</rt></ruby>わりそう。', read: 'きょうもいちにちおわりそう。', mean: 'Looks like another day is coming to an end.', topic: 'evening', grammar: ['sou'] },
  { id: 'st-evening-7', jp: '<ruby>電気<rt>でんき</rt></ruby>を<ruby>消<rt>け</rt></ruby>しておこう。', read: 'でんきをけしておこう。', mean: 'Let me turn off the lights.', topic: 'evening', grammar: ['te-oku', 'volitional'] },

  // ==== Gaming ====
  // ---- Minecraft ----
  { id: 'st-minecraft-1', jp: '<ruby>鉄<rt>てつ</rt></ruby>が<ruby>足<rt>た</rt></ruby>りないから、もっと<ruby>掘<rt>ほ</rt></ruby>らないと。', read: 'てつがたりないから、もっとほらないと。', mean: "I don't have enough iron — I need to mine more.", topic: 'minecraft', grammar: ['nakya'] },
  { id: 'st-minecraft-2', jp: '<ruby>夜<rt>よる</rt></ruby>になる<ruby>前<rt>まえ</rt></ruby>に<ruby>家<rt>いえ</rt></ruby>を<ruby>建<rt>た</rt></ruby>てておこう。', read: 'よるになるまえにいえをたてておこう。', mean: 'Let me build a house before it gets dark.', topic: 'minecraft', grammar: ['te-oku', 'volitional'] },
  { id: 'st-minecraft-3', jp: 'クリーパーが<ruby>近<rt>ちか</rt></ruby>づいてきている。', read: 'クリーパーがちかづいてきている。', mean: 'A creeper is coming this way.', topic: 'minecraft', grammar: ['te-iru'] },
  { id: 'st-minecraft-4', jp: 'ダイヤモンドが<ruby>見<rt>み</rt></ruby>つかりそう。', read: 'ダイヤモンドがみつかりそう。', mean: "Looks like I'm about to find a diamond.", topic: 'minecraft', grammar: ['sou'] },
  { id: 'st-minecraft-5', jp: '<ruby>新<rt>あたら</rt></ruby>しい<ruby>村<rt>むら</rt></ruby>を<ruby>探<rt>さが</rt></ruby>しに<ruby>行<rt>い</rt></ruby>きたい。', read: 'あたらしいむらをさがしにいきたい。', mean: 'I want to go look for a new village.', topic: 'minecraft', grammar: ['tai'] },

  // ---- Incremental games ----
  { id: 'st-incremental-1', jp: '<ruby>放置<rt>ほうち</rt></ruby>している<ruby>間<rt>あいだ</rt></ruby>にポイントが<ruby>貯<rt>た</rt></ruby>まっている。', read: 'ほうちしているあいだにポイントがたまっている。', mean: 'Points are piling up while I leave it idle.', topic: 'incremental', grammar: ['te-iru'] },
  { id: 'st-incremental-2', jp: '<ruby>次<rt>つぎ</rt></ruby>のアップグレードまで<ruby>貯<rt>た</rt></ruby>めておこう。', read: 'つぎのアップグレードまでためておこう。', mean: 'Let me save up until the next upgrade.', topic: 'incremental', grammar: ['te-oku', 'volitional'] },
  { id: 'st-incremental-3', jp: 'もう<ruby>一回<rt>いっかい</rt></ruby>だけリセットしたい。', read: 'もういっかいだけリセットしたい。', mean: 'I want to reset just one more time.', topic: 'incremental', grammar: ['tai'] },
  { id: 'st-incremental-4', jp: 'そろそろ<ruby>上限<rt>じょうげん</rt></ruby>に<ruby>達<rt>たっ</rt></ruby>しそう。', read: 'そろそろじょうげんにたっしそう。', mean: "I'm about to hit the cap soon.", topic: 'incremental', grammar: ['sou'] },
  { id: 'st-incremental-5', jp: '<ruby>課金<rt>かきん</rt></ruby>しないように<ruby>我慢<rt>がまん</rt></ruby>しないと。', read: 'かきんしないようにがまんしないと。', mean: "I have to hold back so I don't spend money.", topic: 'incremental', grammar: ['nakya'] },

  // ---- The Sims ----
  { id: 'st-sims-1', jp: 'シムがお<ruby>腹<rt>なか</rt></ruby>を<ruby>空<rt>す</rt></ruby>かせている。', read: 'シムがおなかをすかせている。', mean: 'My Sim is getting hungry.', topic: 'sims', grammar: ['te-iru'] },
  { id: 'st-sims-2', jp: '<ruby>新<rt>あたら</rt></ruby>しい<ruby>部屋<rt>へや</rt></ruby>を<ruby>作<rt>つく</rt></ruby>りたい。', read: 'あたらしいへやをつくりたい。', mean: 'I want to build a new room.', topic: 'sims', grammar: ['tai'] },
  { id: 'st-sims-3', jp: '<ruby>仕事<rt>しごと</rt></ruby>に<ruby>行<rt>い</rt></ruby>く<ruby>前<rt>まえ</rt></ruby>にトイレに<ruby>行<rt>い</rt></ruby>かせておこう。', read: 'しごとにいくまえにトイレにいかせておこう。', mean: 'Let me send them to the bathroom before work.', topic: 'sims', grammar: ['te-oku', 'volitional'] },
  { id: 'st-sims-4', jp: 'このシム、そろそろ<ruby>昇進<rt>しょうしん</rt></ruby>しそう。', read: 'このシム、そろそろしょうしんしそう。', mean: 'This Sim looks about to get promoted.', topic: 'sims', grammar: ['sou'] },
  { id: 'st-sims-5', jp: '<ruby>家<rt>いえ</rt></ruby>を<ruby>片付<rt>かたづ</rt></ruby>けさせないと。', read: 'いえをかたづけさせないと。', mean: 'I need to make them clean the house.', topic: 'sims', grammar: ['nakya'] },

  // ==== Conversations by register ====
  // ---- With a coworker (pol/ です・ます) ----
  { id: 'st-coworker-1', jp: '<ruby>今<rt>いま</rt></ruby>、<ruby>資料<rt>しりょう</rt></ruby>を<ruby>確認<rt>かくにん</rt></ruby>しています。', read: 'いま、しりょうをかくにんしています。', mean: "I'm checking the documents right now.", topic: 'coworker', grammar: ['te-iru'] },
  { id: 'st-coworker-2', jp: '<ruby>会議<rt>かいぎ</rt></ruby>の<ruby>前<rt>まえ</rt></ruby>に<ruby>準備<rt>じゅんび</rt></ruby>しておきます。', read: 'かいぎのまえにじゅんびしておきます。', mean: "I'll get things ready before the meeting.", topic: 'coworker', grammar: ['te-oku'] },
  { id: 'st-coworker-3', jp: '<ruby>少<rt>すこ</rt></ruby>し<ruby>休憩<rt>きゅうけい</rt></ruby>したいです。', read: 'すこしきゅうけいしたいです。', mean: "I'd like to take a short break.", topic: 'coworker', grammar: ['tai'] },
  { id: 'st-coworker-4', jp: 'そろそろ<ruby>始<rt>はじ</rt></ruby>めましょう。', read: 'そろそろはじめましょう。', mean: "Let's get started soon.", topic: 'coworker', grammar: ['volitional'] },
  { id: 'st-coworker-5', jp: '<ruby>締<rt>し</rt></ruby>め<ruby>切<rt>き</rt></ruby>りに<ruby>間<rt>ま</rt></ruby>に<ruby>合<rt>あ</rt></ruby>わせないといけません。', read: 'しめきりにまにあわせないといけません。', mean: 'We have to make the deadline.', topic: 'coworker', grammar: ['nakya'] },

  // ---- With a friend (plain) ----
  { id: 'st-friend-1', jp: '<ruby>今度<rt>こんど</rt></ruby><ruby>一緒<rt>いっしょ</rt></ruby>に<ruby>遊<rt>あそ</rt></ruby>びに<ruby>行<rt>い</rt></ruby>きたい。', read: 'こんどいっしょにあそびにいきたい。', mean: 'I want to go hang out together sometime.', topic: 'friend', grammar: ['tai'] },
  { id: 'st-friend-2', jp: '<ruby>週末<rt>しゅうまつ</rt></ruby>、<ruby>暇<rt>ひま</rt></ruby>してる？', read: 'しゅうまつ、ひましてる？', mean: 'Are you free this weekend?', topic: 'friend', grammar: ['te-iru'] },
  { id: 'st-friend-3', jp: '<ruby>今度<rt>こんど</rt></ruby>カラオケ<ruby>行<rt>い</rt></ruby>こうよ。', read: 'こんどカラオケいこうよ。', mean: "Let's go to karaoke sometime!", topic: 'friend', grammar: ['volitional'] },
  { id: 'st-friend-4', jp: 'その<ruby>映画<rt>えいが</rt></ruby>、<ruby>面白<rt>おもしろ</rt></ruby>そうだね。', read: 'そのえいが、おもしろそうだね。', mean: 'That movie looks fun, huh.', topic: 'friend', grammar: ['sou'] },
  { id: 'st-friend-5', jp: 'そろそろ<ruby>帰<rt>かえ</rt></ruby>らないと。', read: 'そろそろかえらないと。', mean: 'I should get going soon.', topic: 'friend', grammar: ['nakya'] },

  // ---- With my boyfriend (intimate) ----
  { id: 'st-boyfriend-1', jp: '<ruby>早<rt>はや</rt></ruby>く<ruby>会<rt>あ</rt></ruby>いたいな。', read: 'はやくあいたいな。', mean: 'I want to see you soon.', topic: 'boyfriend', grammar: ['tai'] },
  { id: 'st-boyfriend-2', jp: '<ruby>今<rt>いま</rt></ruby>、<ruby>何<rt>なに</rt></ruby>してるの？', read: 'いま、なにしてるの？', mean: 'What are you up to right now?', topic: 'boyfriend', grammar: ['te-iru'] },
  { id: 'st-boyfriend-3', jp: '<ruby>週末<rt>しゅうまつ</rt></ruby>どこか<ruby>行<rt>い</rt></ruby>こうよ。', read: 'しゅうまつどこかいこうよ。', mean: "Let's go somewhere this weekend.", topic: 'boyfriend', grammar: ['volitional'] },
  { id: 'st-boyfriend-4', jp: '<ruby>晩<rt>ばん</rt></ruby>ご<ruby>飯<rt>はん</rt></ruby>、<ruby>作<rt>つく</rt></ruby>っておくね。', read: 'ばんごはん、つくっておくね。', mean: "I'll make dinner for us.", topic: 'boyfriend', grammar: ['te-oku'] },
  { id: 'st-boyfriend-5', jp: 'そろそろ<ruby>寝<rt>ね</rt></ruby>ないと。', read: 'そろそろねないと。', mean: 'We should get to sleep soon.', topic: 'boyfriend', grammar: ['nakya'] },
];
