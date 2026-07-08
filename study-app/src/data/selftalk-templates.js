// 独り言 SELF-TALK — slot-swap sentence TEMPLATES (P3). This file is the git-tracked AUTHORING +
// SEED SOURCE: as of Slice 1 the template STRUCTURE lives in the server `sentence_template` table
// (curator-seeded from here via scripts/seed-sentences.ts, served by GET /v1/templates) and the
// client FETCHES it instead of importing this bundle at runtime. A template has no single fixed
// text/hash/furigana, so it isn't a `sentence` row — hence its own table. After editing a template
// here, re-run scripts/seed-sentences.ts to push it to the store.
//
// PLANNED (Slice 2, not yet built): realizations get lazily materialized as `sentence` rows on first
// request so the store tooling (NLP/TTS/grammar/export) covers the combos people use. Until then a
// realization is still derived client-side (below) + renders plain ruby. Design + plan + status:
// the repo-root ROADMAP.html (store: slot-swap templates).
//
// A template is a JP skeleton string with `{slot}` markers + a `slots` array of fillers. Picking a
// filler per slot REALIZES a concrete sentence (core/selftalk.js `realizeTemplate`) whose reading /
// English / plainText are DERIVED with the same helpers a phrase uses — so a realized template
// renders + plays exactly like a phrase. Synth audio keys on the realized plainText (any text, lazily
// cached by /v1/audio/tts — no pre-gen needed or possible). Record-compare keys on the SKELETON id
// (one practiceable item; the reference uses whatever's currently realized). Templates render PLAIN
// ruby (no GiNZA tap-to-lookup over the unbounded combo space — same graceful degradation as
// user-authored phrases).
//
// A template carries `topic` (+ optional `thought`) so it slots into the SAME taxonomy as phrases and
// renders inside that topic's thought cluster. `grammar` is the skeleton's fixed teaching point.
//
// AUTHORING RULE: each filler's `jp` must stay grammatical in the skeleton's surrounding text (the
// skeleton supplies the conjugation tail). Every kanji — in fixed parts AND fillers — needs ruby, or
// the derived reading drifts. MODEL-GENERATED → proofread (esp. that every combo reads naturally).

export const SELFTALK_TEMPLATES = [
  // ==== Minecraft (5) — covering both the resources and night thought clusters ====
  {
    id: 'tpl-minecraft-gather', topic: 'minecraft', thought: 'resources', grammar: ['volitional'],
    en: "I'm running low on {material} — let me go {action}.",
    jp: 'もうすぐ{material}が<ruby>足<rt>た</rt></ruby>りない、{action}に<ruby>行<rt>い</rt></ruby>こう。',
    slots: [
      { id: 'material', label: 'material', fillers: [
        { jp: '<ruby>木<rt>き</rt></ruby>', en: 'wood' },
        { jp: '<ruby>鉄<rt>てつ</rt></ruby>', en: 'iron' },
        { jp: '<ruby>石<rt>いし</rt></ruby>', en: 'stone' },
        { jp: '<ruby>食料<rt>しょくりょう</rt></ruby>', en: 'food' },
      ] },
      { id: 'action', label: 'verb', fillers: [
        { jp: '<ruby>集<rt>あつ</rt></ruby>め', en: 'gather some' },
        { jp: '<ruby>掘<rt>ほ</rt></ruby>り', en: 'go mine some' },
        { jp: '<ruby>探<rt>さが</rt></ruby>し', en: 'look for some' },
      ] },
    ],
  },
  {
    id: 'tpl-minecraft-craft', topic: 'minecraft', thought: 'resources', grammar: ['volitional'],
    en: "Let me make {item} out of {material}.",
    jp: '{material}で{item}を<ruby>作<rt>つく</rt></ruby>ろう。',
    slots: [
      { id: 'material', label: 'material', fillers: [
        { jp: '<ruby>木<rt>き</rt></ruby>', en: 'wood' },
        { jp: '<ruby>鉄<rt>てつ</rt></ruby>', en: 'iron' },
        { jp: '<ruby>石<rt>いし</rt></ruby>', en: 'stone' },
      ] },
      { id: 'item', label: 'item', fillers: [
        { jp: '<ruby>道具<rt>どうぐ</rt></ruby>', en: 'tools' },
        { jp: '<ruby>武器<rt>ぶき</rt></ruby>', en: 'a weapon' },
        { jp: '<ruby>防具<rt>ぼうぐ</rt></ruby>', en: 'armor' },
      ] },
    ],
  },
  {
    id: 'tpl-minecraft-store', topic: 'minecraft', thought: 'resources', grammar: ['te-oku'],
    en: "Let me stash {item} in {place}.",
    jp: '{item}を{place}に<ruby>入<rt>い</rt></ruby>れておこう。',
    slots: [
      { id: 'item', label: 'item', fillers: [
        { jp: '<ruby>道具<rt>どうぐ</rt></ruby>', en: 'the tools' },
        { jp: '<ruby>食料<rt>しょくりょう</rt></ruby>', en: 'the food' },
        { jp: '<ruby>宝石<rt>ほうせき</rt></ruby>', en: 'the gems' },
      ] },
      { id: 'place', label: 'place', fillers: [
        { jp: 'チェスト', en: 'the chest' },
        { jp: '<ruby>倉庫<rt>そうこ</rt></ruby>', en: 'storage' },
      ] },
    ],
  },
  {
    id: 'tpl-minecraft-defend', topic: 'minecraft', thought: 'night', grammar: ['te-oku'],
    en: "Let me prep {defense} before the {enemy} show up.",
    jp: '{enemy}が<ruby>来<rt>く</rt></ruby>る<ruby>前<rt>まえ</rt></ruby>に{defense}を<ruby>準備<rt>じゅんび</rt></ruby>しておこう。',
    slots: [
      { id: 'enemy', label: 'enemy', fillers: [
        { jp: 'クリーパー', en: 'creepers' },
        { jp: 'ゾンビ', en: 'zombies' },
        { jp: '<ruby>敵<rt>てき</rt></ruby>', en: 'enemies' },
      ] },
      { id: 'defense', label: 'defense', fillers: [
        { jp: '<ruby>壁<rt>かべ</rt></ruby>', en: 'walls' },
        { jp: '<ruby>武器<rt>ぶき</rt></ruby>', en: 'weapons' },
        { jp: 'たいまつ', en: 'torches' },
      ] },
    ],
  },
  {
    id: 'tpl-minecraft-shelter', topic: 'minecraft', thought: 'night', grammar: ['volitional'],
    en: "When {time} comes, let me head back to {place}.",
    jp: '{time}になったら{place}に<ruby>戻<rt>もど</rt></ruby>ろう。',
    slots: [
      { id: 'time', label: 'when', fillers: [
        { jp: '<ruby>夜<rt>よる</rt></ruby>', en: 'night' },
        { jp: '<ruby>朝<rt>あさ</rt></ruby>', en: 'morning' },
      ] },
      { id: 'place', label: 'place', fillers: [
        { jp: '<ruby>家<rt>いえ</rt></ruby>', en: 'home' },
        { jp: '<ruby>拠点<rt>きょてん</rt></ruby>', en: 'base' },
        { jp: '<ruby>洞窟<rt>どうくつ</rt></ruby>', en: 'the cave' },
      ] },
    ],
  },

  // ==== Incremental games (5) ====
  {
    id: 'tpl-incremental-upgrade', topic: 'incremental', grammar: ['volitional'],
    en: "Once {currency} builds up, let me buy {upgrade}.",
    jp: '{currency}が<ruby>貯<rt>た</rt></ruby>まったら{upgrade}を<ruby>買<rt>か</rt></ruby>おう。',
    slots: [
      { id: 'currency', label: 'currency', fillers: [
        { jp: 'ポイント', en: 'points' },
        { jp: 'お<ruby>金<rt>かね</rt></ruby>', en: 'money' },
        { jp: '<ruby>資源<rt>しげん</rt></ruby>', en: 'resources' },
      ] },
      { id: 'upgrade', label: 'upgrade', fillers: [
        { jp: '<ruby>強化<rt>きょうか</rt></ruby>', en: 'an upgrade' },
        { jp: '<ruby>自動化<rt>じどうか</rt></ruby>', en: 'automation' },
        { jp: '<ruby>新<rt>あたら</rt></ruby>しいの', en: 'a new one' },
      ] },
    ],
  },
  {
    id: 'tpl-incremental-idle', topic: 'incremental', grammar: ['sou'],
    en: "If I idle {time}, it looks like I'll get {result}.",
    jp: '{time}<ruby>放置<rt>ほうち</rt></ruby>したら{result}になりそう。',
    slots: [
      { id: 'time', label: 'how long', fillers: [
        { jp: '<ruby>一晩<rt>ひとばん</rt></ruby>', en: 'overnight' },
        { jp: '<ruby>数時間<rt>すうじかん</rt></ruby>', en: 'a few hours' },
        { jp: '<ruby>一日<rt>いちにち</rt></ruby>', en: 'all day' },
      ] },
      { id: 'result', label: 'result', fillers: [
        { jp: '<ruby>大量<rt>たいりょう</rt></ruby>', en: 'a ton' },
        { jp: 'いい<ruby>感<rt>かん</rt></ruby>じ', en: 'good shape' },
        { jp: '<ruby>満<rt>まん</rt></ruby>タン', en: 'maxed out' },
      ] },
    ],
  },
  {
    id: 'tpl-incremental-reset', topic: 'incremental', grammar: ['tai'],
    en: "I want to reset once more and go for {goal}.",
    jp: 'もう<ruby>一回<rt>いっかい</rt></ruby>リセットして{goal}を<ruby>狙<rt>ねら</rt></ruby>いたい。',
    slots: [
      { id: 'goal', label: 'goal', fillers: [
        { jp: '<ruby>記録<rt>きろく</rt></ruby>', en: 'a record' },
        { jp: '<ruby>高<rt>たか</rt></ruby>いスコア', en: 'a high score' },
        { jp: '<ruby>実績<rt>じっせき</rt></ruby>', en: 'an achievement' },
      ] },
    ],
  },
  {
    id: 'tpl-incremental-automate', topic: 'incremental', grammar: ['te-oku', 'nakya'],
    en: "I've gotta automate {task}.",
    jp: '{task}を<ruby>自動化<rt>じどうか</rt></ruby>しておかないと。',
    slots: [
      { id: 'task', label: 'task', fillers: [
        { jp: '<ruby>生産<rt>せいさん</rt></ruby>', en: 'production' },
        { jp: 'クリック', en: 'clicking' },
        { jp: '<ruby>収集<rt>しゅうしゅう</rt></ruby>', en: 'collecting' },
      ] },
    ],
  },
  {
    id: 'tpl-incremental-check', topic: 'incremental', grammar: ['te-iru'],
    en: "I keep checking {thing} every {time}.",
    jp: '{time}ごとに{thing}を<ruby>確認<rt>かくにん</rt></ruby>している。',
    slots: [
      { id: 'time', label: 'interval', fillers: [
        { jp: '<ruby>数分<rt>すうふん</rt></ruby>', en: 'few minutes' },
        { jp: '<ruby>一時間<rt>いちじかん</rt></ruby>', en: 'hour' },
        { jp: '<ruby>一日<rt>いちにち</rt></ruby>', en: 'day' },
      ] },
      { id: 'thing', label: 'thing', fillers: [
        { jp: '<ruby>進<rt>すす</rt></ruby>み<ruby>具合<rt>ぐあい</rt></ruby>', en: 'my progress' },
        { jp: '<ruby>数字<rt>すうじ</rt></ruby>', en: 'the numbers' },
        { jp: 'スコア', en: 'the score' },
      ] },
    ],
  },

  // ==== The Sims (5) ====
  {
    id: 'tpl-sims-need', topic: 'sims', grammar: ['nakya'],
    en: "I've gotta make {who} {action}.",
    jp: '{who}に{action}させないと。',
    slots: [
      { id: 'who', label: 'who', fillers: [
        { jp: 'シム', en: 'my Sim' },
        { jp: '<ruby>子供<rt>こども</rt></ruby>', en: 'the kid' },
        { jp: '<ruby>家族<rt>かぞく</rt></ruby>', en: 'the family' },
      ] },
      { id: 'action', label: 'action', fillers: [
        { jp: '<ruby>料理<rt>りょうり</rt></ruby>', en: 'cook' },
        { jp: '<ruby>掃除<rt>そうじ</rt></ruby>', en: 'clean' },
        { jp: '<ruby>勉強<rt>べんきょう</rt></ruby>', en: 'study' },
      ] },
    ],
  },
  {
    id: 'tpl-sims-build', topic: 'sims', grammar: ['tai'],
    en: "I want to build {thing}.",
    jp: '{thing}を<ruby>作<rt>つく</rt></ruby>りたい。',
    slots: [
      { id: 'thing', label: 'thing', fillers: [
        { jp: '<ruby>庭<rt>にわ</rt></ruby>', en: 'a garden' },
        { jp: '<ruby>新<rt>あたら</rt></ruby>しい<ruby>部屋<rt>へや</rt></ruby>', en: 'a new room' },
        { jp: '<ruby>大<rt>おお</rt></ruby>きいキッチン', en: 'a big kitchen' },
      ] },
    ],
  },
  {
    id: 'tpl-sims-routine', topic: 'sims', grammar: ['te-oku', 'volitional'],
    en: "Let me get them to {action} by {time}.",
    jp: '{time}までに{action}させておこう。',
    slots: [
      { id: 'time', label: 'by when', fillers: [
        { jp: '<ruby>朝<rt>あさ</rt></ruby>', en: 'morning' },
        { jp: '<ruby>夜<rt>よる</rt></ruby>', en: 'night' },
        { jp: '<ruby>出<rt>で</rt></ruby>かける<ruby>前<rt>まえ</rt></ruby>', en: 'they head out' },
      ] },
      { id: 'action', label: 'action', fillers: [
        { jp: '<ruby>食事<rt>しょくじ</rt></ruby>', en: 'eat' },
        { jp: '<ruby>掃除<rt>そうじ</rt></ruby>', en: 'tidy up' },
        { jp: '<ruby>準備<rt>じゅんび</rt></ruby>', en: 'get ready' },
      ] },
    ],
  },
  {
    id: 'tpl-sims-career', topic: 'sims', grammar: ['sou'],
    en: "{who} looks about to {event} soon.",
    jp: 'そろそろ{who}が{event}しそう。',
    slots: [
      { id: 'who', label: 'who', fillers: [
        { jp: 'シム', en: 'my Sim' },
        { jp: '<ruby>彼<rt>かれ</rt></ruby>', en: 'he' },
        { jp: '<ruby>彼女<rt>かのじょ</rt></ruby>', en: 'she' },
      ] },
      { id: 'event', label: 'event', fillers: [
        { jp: '<ruby>結婚<rt>けっこん</rt></ruby>', en: 'get married' },
        { jp: '<ruby>昇進<rt>しょうしん</rt></ruby>', en: 'get promoted' },
        { jp: '<ruby>転職<rt>てんしょく</rt></ruby>', en: 'change jobs' },
      ] },
    ],
  },
  {
    id: 'tpl-sims-mood', topic: 'sims', grammar: ['te-iru'],
    en: "{who} is getting {mood}.",
    jp: '{who}が{mood}になってきている。',
    slots: [
      { id: 'who', label: 'who', fillers: [
        { jp: 'シム', en: 'my Sim' },
        { jp: '<ruby>子供<rt>こども</rt></ruby>', en: 'the kid' },
        { jp: 'みんな', en: 'everyone' },
      ] },
      { id: 'mood', label: 'mood', fillers: [
        { jp: '<ruby>元気<rt>げんき</rt></ruby>', en: 'energetic' },
        { jp: '<ruby>不機嫌<rt>ふきげん</rt></ruby>', en: 'grumpy' },
        { jp: '<ruby>退屈<rt>たいくつ</rt></ruby>', en: 'bored' },
      ] },
    ],
  },

  // ==== Conversations by register (one per register) ====
  {
    id: 'tpl-friend-invite', topic: 'friend', grammar: ['volitional'],
    en: "Let's go {place} {time}.",
    jp: '{time}、{place}<ruby>行<rt>い</rt></ruby>こうよ。',
    slots: [
      { id: 'time', label: 'when', fillers: [
        { jp: '<ruby>今度<rt>こんど</rt></ruby>', en: 'sometime' },
        { jp: '<ruby>今週末<rt>こんしゅうまつ</rt></ruby>', en: 'this weekend' },
        { jp: '<ruby>明日<rt>あした</rt></ruby>', en: 'tomorrow' },
      ] },
      { id: 'place', label: 'where', fillers: [
        { jp: 'カラオケに', en: 'to karaoke' },
        { jp: '<ruby>映画<rt>えいが</rt></ruby>に', en: 'to a movie' },
        { jp: 'ご<ruby>飯<rt>はん</rt></ruby>に', en: 'out to eat' },
      ] },
    ],
  },
  {
    id: 'tpl-coworker-plan', topic: 'coworker', grammar: ['volitional'],
    en: "Let's prepare {task} by {time}.",
    jp: '{time}までに{task}を<ruby>準備<rt>じゅんび</rt></ruby>しましょう。',
    slots: [
      { id: 'time', label: 'by when', fillers: [
        { jp: '<ruby>明日<rt>あした</rt></ruby>', en: 'tomorrow' },
        { jp: '<ruby>会議<rt>かいぎ</rt></ruby>', en: 'the meeting' },
        { jp: '<ruby>午後<rt>ごご</rt></ruby>', en: 'this afternoon' },
      ] },
      { id: 'task', label: 'task', fillers: [
        { jp: '<ruby>資料<rt>しりょう</rt></ruby>', en: 'the materials' },
        { jp: '<ruby>報告書<rt>ほうこくしょ</rt></ruby>', en: 'the report' },
        { jp: '<ruby>計画<rt>けいかく</rt></ruby>', en: 'the plan' },
      ] },
    ],
  },
  {
    id: 'tpl-boyfriend-plan', topic: 'boyfriend', grammar: ['tai'],
    en: "I want to {activity} {time}.",
    jp: '{time}、{activity}したいな。',
    slots: [
      { id: 'time', label: 'when', fillers: [
        { jp: '<ruby>今度<rt>こんど</rt></ruby>', en: 'sometime' },
        { jp: '<ruby>週末<rt>しゅうまつ</rt></ruby>', en: 'this weekend' },
        { jp: '<ruby>今夜<rt>こんや</rt></ruby>', en: 'tonight' },
      ] },
      { id: 'activity', label: 'activity', fillers: [
        { jp: 'デート', en: 'go on a date' },
        { jp: '<ruby>外食<rt>がいしょく</rt></ruby>', en: 'eat out' },
        { jp: 'ドライブ', en: 'go for a drive' },
      ] },
    ],
  },
];
