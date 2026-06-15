// Leveled example sentences. ES module exporting `EXAMPLES` — now the SEED SOURCE
// for the server sentence store (seed-sentences.ts), not read at runtime.
//
// Keyed by verb rank. Each verb has five JLPT tiers (N5 -> N1) of increasing
// vocabulary + grammar complexity; each tier is [japanese_with_<ruby>_furigana,
// english]. The headword verb appears (conjugated as needed) in every sentence.
// Built-in verbs only. seed-sentences.ts loads these into the sentence store; the
// app then fetches them and attachLevels() sets each card's `v.levels`, picking a
// tier with exampleForLevel() (graceful fallback to the nearest tier / `ex`).
export const EXAMPLES = {
1: {
  N5: ["<ruby>毎日<rt>まいにち</rt></ruby><ruby>日本語<rt>にほんご</rt></ruby>を<ruby>勉強<rt>べんきょう</rt></ruby>する。","I study Japanese every day."],
  N4: ["<ruby>宿題<rt>しゅくだい</rt></ruby>をしてから、テレビを<ruby>見<rt>み</rt></ruby>ます。","I watch TV after I do my homework."],
  N3: ["<ruby>彼<rt>かれ</rt></ruby>は<ruby>毎朝<rt>まいあさ</rt></ruby>ジョギングをするようにしている。","He makes a point of jogging every morning."],
  N2: ["そんなことをするわけにはいかない。","I can't possibly do such a thing."],
  N1: ["<ruby>事情<rt>じじょう</rt></ruby>が<ruby>事情<rt>じじょう</rt></ruby>だけに、そうせざるを<ruby>得<rt>え</rt></ruby>ない。","Given the circumstances, I have no choice but to do so."]
},
2: {
  N5: ["<ruby>名前<rt>なまえ</rt></ruby>を<ruby>言<rt>い</rt></ruby>ってください。","Please say your name."],
  N4: ["<ruby>先生<rt>せんせい</rt></ruby>は「<ruby>明日<rt>あした</rt></ruby><ruby>来<rt>き</rt></ruby>てください」と<ruby>言<rt>い</rt></ruby>いました。","The teacher said, “Please come tomorrow.”"],
  N3: ["<ruby>親<rt>おや</rt></ruby>に<ruby>言<rt>い</rt></ruby>われたとおりに、<ruby>部屋<rt>へや</rt></ruby>を<ruby>片付<rt>かたづ</rt></ruby>けた。","I cleaned my room just as my parents told me to."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>の<ruby>言<rt>い</rt></ruby>うことには、<ruby>会議<rt>かいぎ</rt></ruby>は<ruby>延期<rt>えんき</rt></ruby>になったそうだ。","According to what he says, the meeting has been postponed."],
  N1: ["いくら<ruby>説明<rt>せつめい</rt></ruby>したところで、<ruby>言<rt>い</rt></ruby>わんとしていることは<ruby>伝<rt>つた</rt></ruby>わらないだろう。","No matter how much I explain, what I'm trying to say probably won't get across."]
},
3: {
  N5: ["<ruby>机<rt>つくえ</rt></ruby>の<ruby>上<rt>うえ</rt></ruby>に<ruby>本<rt>ほん</rt></ruby>がある。","There is a book on the desk."],
  N4: ["<ruby>近<rt>ちか</rt></ruby>くにコンビニがあるから、とても<ruby>便利<rt>べんり</rt></ruby>です。","There's a convenience store nearby, so it's very convenient."],
  N3: ["<ruby>調<rt>しら</rt></ruby>べてみると、その<ruby>話<rt>はなし</rt></ruby>には<ruby>根拠<rt>こんきょ</rt></ruby>があることが<ruby>分<rt>わ</rt></ruby>かった。","When I looked into it, I found that there was a basis to that story."],
  N2: ["<ruby>努力<rt>どりょく</rt></ruby>した<ruby>甲斐<rt>かい</rt></ruby>があって、<ruby>試験<rt>しけん</rt></ruby>に<ruby>合格<rt>ごうかく</rt></ruby>した。","My efforts paid off and I passed the exam."],
  N1: ["<ruby>困難<rt>こんなん</rt></ruby>はあるにせよ、<ruby>計画<rt>けいかく</rt></ruby>を<ruby>進<rt>すす</rt></ruby>めるほかない。","Even if there are difficulties, there's nothing for it but to push the plan forward."]
},
4: {
  N5: ["<ruby>春<rt>はる</rt></ruby>になると<ruby>暖<rt>あたた</rt></ruby>かくなる。","When spring comes, it gets warm."],
  N4: ["<ruby>勉強<rt>べんきょう</rt></ruby>したので、<ruby>日本語<rt>にほんご</rt></ruby>が<ruby>上手<rt>じょうず</rt></ruby>になりたい。","Because I studied, I want to become good at Japanese."],
  N3: ["<ruby>毎日<rt>まいにち</rt></ruby><ruby>練習<rt>れんしゅう</rt></ruby>すれば、<ruby>泳<rt>およ</rt></ruby>げるようになる。","If you practice every day, you'll become able to swim."],
  N2: ["<ruby>努力<rt>どりょく</rt></ruby>したからこそ、<ruby>彼<rt>かれ</rt></ruby>はプロになれたわけだ。","It is precisely because he made an effort that he was able to become a pro."],
  N1: ["<ruby>不景気<rt>ふけいき</rt></ruby>のため、<ruby>会社<rt>かいしゃ</rt></ruby>は<ruby>店<rt>みせ</rt></ruby>を<ruby>閉<rt>と</rt></ruby>じざるを<ruby>得<rt>え</rt></ruby>ない<ruby>状況<rt>じょうきょう</rt></ruby>になった。","Due to the recession, the company ended up in a situation where it had no choice but to close the store."]
},
5: {
  N5: ["わたしはそれがいいと<ruby>思<rt>おも</rt></ruby>う。","I think that's good."],
  N4: ["<ruby>明日<rt>あした</rt></ruby>は<ruby>雨<rt>あめ</rt></ruby>が<ruby>降<rt>ふ</rt></ruby>ると<ruby>思<rt>おも</rt></ruby>うから、<ruby>傘<rt>かさ</rt></ruby>を<ruby>持<rt>も</rt></ruby>っていく。","I think it'll rain tomorrow, so I'll take an umbrella."],
  N3: ["<ruby>彼<rt>かれ</rt></ruby>が<ruby>言<rt>い</rt></ruby>ったことは<ruby>本当<rt>ほんとう</rt></ruby>だと<ruby>思<rt>おも</rt></ruby>うようになった。","I came to think that what he said was true."],
  N2: ["この<ruby>結果<rt>けっか</rt></ruby>を<ruby>見<rt>み</rt></ruby>る<ruby>限<rt>かぎ</rt></ruby>り、<ruby>計画<rt>けいかく</rt></ruby>は<ruby>失敗<rt>しっぱい</rt></ruby>だったと<ruby>思<rt>おも</rt></ruby>わざるを<ruby>得<rt>え</rt></ruby>ない。","As far as one can see from this result, one cannot help but think the plan was a failure."],
  N1: ["<ruby>困難<rt>こんなん</rt></ruby>を<ruby>乗<rt>の</rt></ruby>り<ruby>越<rt>こ</rt></ruby>えてきたからこそ、<ruby>今<rt>いま</rt></ruby>の<ruby>幸<rt>しあわ</rt></ruby>せをありがたく<ruby>思<rt>おも</rt></ruby>うのだ。","It is precisely because I have overcome hardships that I feel grateful for my present happiness."]
},
6: {
  N5: ["<ruby>明日<rt>あした</rt></ruby><ruby>学校<rt>がっこう</rt></ruby>へ<ruby>行<rt>い</rt></ruby>く。","Tomorrow I'll go to school."],
  N4: ["<ruby>友<rt>とも</rt></ruby>だちと<ruby>映画<rt>えいが</rt></ruby>を<ruby>見<rt>み</rt></ruby>に<ruby>行<rt>い</rt></ruby>きたいです。","I want to go to see a movie with my friends."],
  N3: ["<ruby>親<rt>おや</rt></ruby>に<ruby>行<rt>い</rt></ruby>かされた<ruby>塾<rt>じゅく</rt></ruby>が、<ruby>意外<rt>いがい</rt></ruby>と<ruby>楽<rt>たの</rt></ruby>しかった。","The cram school I was made to go to by my parents was unexpectedly fun."],
  N2: ["せっかく<ruby>東京<rt>とうきょう</rt></ruby>まで<ruby>来<rt>き</rt></ruby>たのだから、<ruby>博物館<rt>はくぶつかん</rt></ruby>にも<ruby>行<rt>い</rt></ruby>っておくべきだ。","Since I've come all the way to Tokyo, I really ought to go to the museum too."],
  N1: ["<ruby>体調<rt>たいちょう</rt></ruby>が<ruby>悪<rt>わる</rt></ruby>かったが、<ruby>責任者<rt>せきにんしゃ</rt></ruby>として<ruby>会議<rt>かいぎ</rt></ruby>に<ruby>行<rt>い</rt></ruby>かざるを<ruby>得<rt>え</rt></ruby>なかった。","Although I felt unwell, as the person in charge I had no choice but to go to the meeting."]
},
7: {
  N5: ["<ruby>友<rt>とも</rt></ruby>だちが<ruby>家<rt>いえ</rt></ruby>に<ruby>来<rt>く</rt></ruby>る。","A friend is coming to my house."],
  N4: ["<ruby>電車<rt>でんしゃ</rt></ruby>が<ruby>遅<rt>おく</rt></ruby>れたので、<ruby>遅<rt>おそ</rt></ruby>く<ruby>来<rt>き</rt></ruby>てしまった。","The train was late, so I ended up coming late."],
  N3: ["<ruby>遠<rt>とお</rt></ruby>くから<ruby>来<rt>く</rt></ruby>る<ruby>客<rt>きゃく</rt></ruby>のために、<ruby>部屋<rt>へや</rt></ruby>をきれいに<ruby>掃除<rt>そうじ</rt></ruby>しておいた。","I cleaned the room beforehand for the guests coming from far away."],
  N2: ["<ruby>連絡<rt>れんらく</rt></ruby>がないところを<ruby>見<rt>み</rt></ruby>ると、<ruby>彼<rt>かれ</rt></ruby>は<ruby>来<rt>こ</rt></ruby>ないに<ruby>違<rt>ちが</rt></ruby>いない。","Judging from the lack of contact, he must surely not be coming."],
  N1: ["<ruby>恩師<rt>おんし</rt></ruby>が<ruby>遠路<rt>えんろ</rt></ruby>はるばる<ruby>来<rt>き</rt></ruby>てくださったことに、<ruby>感謝<rt>かんしゃ</rt></ruby>の<ruby>念<rt>ねん</rt></ruby>を<ruby>禁<rt>きん</rt></ruby>じ<ruby>得<rt>え</rt></ruby>ない。","I cannot suppress my feelings of gratitude that my mentor came all that long way."]
},
8: {
  N5: ["<ruby>毎晩<rt>まいばん</rt></ruby>テレビを<ruby>見<rt>み</rt></ruby>ます。","I watch TV every evening."],
  N4: ["<ruby>富士山<rt>ふじさん</rt></ruby>を<ruby>見<rt>み</rt></ruby>たことがありますか。","Have you ever seen Mt. Fuji?"],
  N3: ["<ruby>母<rt>はは</rt></ruby>に<ruby>見<rt>み</rt></ruby>られて、<ruby>恥<rt>は</rt></ruby>ずかしくなってしまった。","I was seen by my mother and became embarrassed."],
  N2: ["<ruby>専門家<rt>せんもんか</rt></ruby>でない<ruby>私<rt>わたし</rt></ruby>が<ruby>見<rt>み</rt></ruby>ても、その<ruby>絵<rt>え</rt></ruby>は<ruby>素晴<rt>すば</rt></ruby>らしいと<ruby>言<rt>い</rt></ruby>える。","Even seen through my eyes, who am no expert, that painting can be called wonderful."],
  N1: ["その<ruby>惨状<rt>さんじょう</rt></ruby>は、とても<ruby>正視<rt>せいし</rt></ruby>するに<ruby>見<rt>み</rt></ruby>るに<ruby>堪<rt>た</rt></ruby>えないものであった。","That ghastly scene was something too painful to even watch directly."]
},
9: {
  N5: ["<ruby>宿題<rt>しゅくだい</rt></ruby>をやる。","I'll do my homework."],
  N4: ["<ruby>疲<rt>つか</rt></ruby>れたけど、さいごまでやるつもりだ。","I'm tired, but I intend to do it to the end."],
  N3: ["<ruby>難<rt>むずか</rt></ruby>しい<ruby>仕事<rt>しごと</rt></ruby>をやらされて、<ruby>泣<rt>な</rt></ruby>きたくなってしまった。","I was made to do difficult work and felt like crying."],
  N2: ["やると<ruby>決<rt>き</rt></ruby>めたからには、<ruby>最後<rt>さいご</rt></ruby>まで<ruby>責任<rt>せきにん</rt></ruby>を<ruby>持<rt>も</rt></ruby>ってやるべきだ。","Once you've decided to do it, you should do it responsibly to the very end."],
  N1: ["<ruby>誰<rt>だれ</rt></ruby>もやりたがらない<ruby>仕事<rt>しごと</rt></ruby>ともなると、<ruby>結局<rt>けっきょく</rt></ruby><ruby>私<rt>わたし</rt></ruby>がやらざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to work nobody wants to do, in the end I have no choice but to do it."]
},
10: {
  N5: ["<ruby>部屋<rt>へや</rt></ruby>に<ruby>猫<rt>ねこ</rt></ruby>がいる。","There is a cat in the room."],
  N4: ["<ruby>姉<rt>あね</rt></ruby>はアメリカにいるから、なかなか<ruby>会<rt>あ</rt></ruby>えない。","My older sister is in America, so I can't easily meet her."],
  N3: ["<ruby>困<rt>こま</rt></ruby>っている<ruby>人<rt>ひと</rt></ruby>がいたら、<ruby>助<rt>たす</rt></ruby>けてあげるようにしている。","I make a point of helping people who are in trouble."],
  N2: ["<ruby>会場<rt>かいじょう</rt></ruby>には<ruby>子供<rt>こども</rt></ruby>ばかりでなく、<ruby>大人<rt>おとな</rt></ruby>もたくさんいた。","At the venue there were not only children but also many adults."],
  N1: ["<ruby>最後<rt>さいご</rt></ruby>まで<ruby>味方<rt>みかた</rt></ruby>でいてくれる<ruby>友<rt>とも</rt></ruby>がいればこそ、<ruby>困難<rt>こんなん</rt></ruby>に<ruby>立<rt>た</rt></ruby>ち<ruby>向<rt>む</rt></ruby>かえる。","It is precisely because I have a friend who stays by my side to the end that I can face hardship."]
},
11: {
  N5: ["<ruby>私<rt>わたし</rt></ruby>は<ruby>料理<rt>りょうり</rt></ruby>ができる。","I can cook."],
  N4: ["<ruby>練習<rt>れんしゅう</rt></ruby>したから、<ruby>漢字<rt>かんじ</rt></ruby>が<ruby>少<rt>すこ</rt></ruby>しできるようになった。","Because I practiced, I became able to do kanji a little."],
  N3: ["<ruby>静<rt>しず</rt></ruby>かな<ruby>場所<rt>ばしょ</rt></ruby>でなら、<ruby>集中<rt>しゅうちゅう</rt></ruby>することができる。","If it's in a quiet place, I can concentrate."],
  N2: ["<ruby>努力<rt>どりょく</rt></ruby>さえすれば、<ruby>誰<rt>だれ</rt></ruby>にでもできるというわけではない。","It is not the case that anyone can do it as long as they just try hard."],
  N1: ["<ruby>限<rt>かぎ</rt></ruby>られた<ruby>時間<rt>じかん</rt></ruby>の<ruby>中<rt>なか</rt></ruby>で、できる<ruby>限<rt>かぎ</rt></ruby>りのことをやり<ruby>遂<rt>と</rt></ruby>げざるを<ruby>得<rt>え</rt></ruby>なかった。","Within the limited time, I had no choice but to accomplish everything I possibly could."]
},
12: {
  N5: ["かばんを<ruby>持<rt>も</rt></ruby>つ。","I hold the bag."],
  N4: ["<ruby>荷物<rt>にもつ</rt></ruby>が<ruby>重<rt>おも</rt></ruby>いので、いっしょに<ruby>持<rt>も</rt></ruby>ってくれませんか。","The luggage is heavy, so could you carry it together with me?"],
  N3: ["<ruby>夢<rt>ゆめ</rt></ruby>を<ruby>持<rt>も</rt></ruby>つようになってから、<ruby>毎日<rt>まいにち</rt></ruby>が<ruby>楽<rt>たの</rt></ruby>しくなった。","Ever since I came to have a dream, every day has become enjoyable."],
  N2: ["リーダーである<ruby>以上<rt>いじょう</rt></ruby>、<ruby>結果<rt>けっか</rt></ruby>に<ruby>責任<rt>せきにん</rt></ruby>を<ruby>持<rt>も</rt></ruby>つべきだ。","As long as you are the leader, you should take responsibility for the results."],
  N1: ["<ruby>確<rt>たし</rt></ruby>かな<ruby>信念<rt>しんねん</rt></ruby>を<ruby>持<rt>も</rt></ruby>っていればこそ、<ruby>批判<rt>ひはん</rt></ruby>にも<ruby>動<rt>どう</rt></ruby>じずにいられるのだ。","It is precisely because one holds firm convictions that one can remain unshaken even by criticism."]
},
13: {
  N5: ["<ruby>七時<rt>しちじ</rt></ruby>に<ruby>家<rt>いえ</rt></ruby>を<ruby>出<rt>で</rt></ruby>る。","I leave home at seven o'clock."],
  N4: ["<ruby>朝<rt>あさ</rt></ruby><ruby>早<rt>はや</rt></ruby>く<ruby>出<rt>で</rt></ruby>たから、<ruby>会議<rt>かいぎ</rt></ruby>に<ruby>間<rt>ま</rt></ruby>に<ruby>合<rt>あ</rt></ruby>った。","I left early in the morning, so I made it to the meeting in time."],
  N3: ["<ruby>勇気<rt>ゆうき</rt></ruby>を<ruby>出<rt>だ</rt></ruby>して、みんなの<ruby>前<rt>まえ</rt></ruby>で<ruby>意見<rt>いけん</rt></ruby>を<ruby>言<rt>い</rt></ruby>えるようになった。","I summoned up courage and became able to state my opinion in front of everyone."],
  N2: ["<ruby>結論<rt>けつろん</rt></ruby>を<ruby>出<rt>だ</rt></ruby>す<ruby>前<rt>まえ</rt></ruby>に、もう<ruby>一度<rt>いちど</rt></ruby><ruby>事実<rt>じじつ</rt></ruby>を<ruby>確認<rt>かくにん</rt></ruby>しておくべきだ。","Before drawing a conclusion, you ought to confirm the facts once more."],
  N1: ["<ruby>長年<rt>ながねん</rt></ruby><ruby>勤<rt>つと</rt></ruby>めた<ruby>会社<rt>かいしゃ</rt></ruby>に<ruby>辞表<rt>じひょう</rt></ruby>を<ruby>出<rt>だ</rt></ruby>すという<ruby>苦渋<rt>くじゅう</rt></ruby>の<ruby>決断<rt>けつだん</rt></ruby>を<ruby>余儀<rt>よぎ</rt></ruby>なくされた。","I was forced into the agonizing decision of submitting my resignation to the company I had served for many years."]
},
14: {
  N5: ["<ruby>将来<rt>しょうらい</rt></ruby>のことを<ruby>考<rt>かんが</rt></ruby>える。","I think about the future."],
  N4: ["<ruby>答<rt>こた</rt></ruby>えがわからないので、もっと<ruby>考<rt>かんが</rt></ruby>えてみたい。","I don't know the answer, so I want to try thinking about it more."],
  N3: ["<ruby>子供<rt>こども</rt></ruby>のころから、よく<ruby>物事<rt>ものごと</rt></ruby>を<ruby>深<rt>ふか</rt></ruby>く<ruby>考<rt>かんが</rt></ruby>えるようになった。","Since childhood, I came to think about things deeply."],
  N2: ["<ruby>環境<rt>かんきょう</rt></ruby><ruby>問題<rt>もんだい</rt></ruby>は、<ruby>政府<rt>せいふ</rt></ruby>ばかりでなく<ruby>一人一人<rt>ひとりひとり</rt></ruby>が<ruby>考<rt>かんが</rt></ruby>えるべきだ。","Environmental problems should be thought about not only by the government but by each individual."],
  N1: ["<ruby>多<rt>おお</rt></ruby>くの<ruby>命<rt>いのち</rt></ruby>がかかっている<ruby>以上<rt>いじょう</rt></ruby>、あらゆる<ruby>可能性<rt>かのうせい</rt></ruby>を<ruby>慎重<rt>しんちょう</rt></ruby>に<ruby>考<rt>かんが</rt></ruby>えざるを<ruby>得<rt>え</rt></ruby>ない。","Since many lives are at stake, we have no choice but to carefully consider every possibility."]
},
15: {
  N5: ["へやに<ruby>入<rt>はい</rt></ruby>る。","I enter the room."],
  N4: ["<ruby>靴<rt>くつ</rt></ruby>を<ruby>脱<rt>ぬ</rt></ruby>いでから、<ruby>部屋<rt>へや</rt></ruby>に<ruby>入<rt>はい</rt></ruby>ってください。","Please take off your shoes and then enter the room."],
  N3: ["<ruby>許可<rt>きょか</rt></ruby>がなければ<ruby>入<rt>はい</rt></ruby>れない<ruby>部屋<rt>へや</rt></ruby>が、<ruby>校内<rt>こうない</rt></ruby>にいくつかある。","There are several rooms on campus that you can't enter without permission."],
  N2: ["<ruby>大学<rt>だいがく</rt></ruby>に<ruby>入<rt>はい</rt></ruby>ったとたん、<ruby>遊<rt>あそ</rt></ruby>んでばかりいるわけにはいかない。","The moment you enter university, you can't just keep playing around."],
  N1: ["<ruby>厳<rt>きび</rt></ruby>しい<ruby>審査<rt>しんさ</rt></ruby>を<ruby>経<rt>へ</rt></ruby>てこそ、この<ruby>研究所<rt>けんきゅうじょ</rt></ruby>に<ruby>入<rt>はい</rt></ruby>ることが<ruby>許<rt>ゆる</rt></ruby>される。","Only after passing a rigorous screening is one permitted to enter this research institute."]
},
16: {
  N5: ["はしを<ruby>使<rt>つか</rt></ruby>う。","I use chopsticks."],
  N4: ["この<ruby>機械<rt>きかい</rt></ruby>は<ruby>便利<rt>べんり</rt></ruby>だから、よく<ruby>使<rt>つか</rt></ruby>っています。","This machine is convenient, so I use it often."],
  N3: ["<ruby>祖母<rt>そぼ</rt></ruby>に<ruby>買<rt>か</rt></ruby>ってもらった<ruby>辞書<rt>じしょ</rt></ruby>を、<ruby>今<rt>いま</rt></ruby>でも<ruby>大切<rt>たいせつ</rt></ruby>に<ruby>使<rt>つか</rt></ruby>っている。","I still carefully use the dictionary my grandmother bought for me."],
  N2: ["<ruby>新<rt>あたら</rt></ruby>しい<ruby>技術<rt>ぎじゅつ</rt></ruby>を<ruby>使<rt>つか</rt></ruby>えば<ruby>使<rt>つか</rt></ruby>うほど、<ruby>仕事<rt>しごと</rt></ruby>の<ruby>効率<rt>こうりつ</rt></ruby>は<ruby>上<rt>あ</rt></ruby>がるわけだ。","The more you use the new technology, the more your work efficiency naturally rises."],
  N1: ["<ruby>限<rt>かぎ</rt></ruby>られた<ruby>予算<rt>よさん</rt></ruby>を<ruby>無駄<rt>むだ</rt></ruby>にせず、<ruby>有効<rt>ゆうこう</rt></ruby>に<ruby>使<rt>つか</rt></ruby>わずにはいられない<ruby>状況<rt>じょうきょう</rt></ruby>だ。","It is a situation where one simply must use the limited budget effectively without wasting it."]
},
17: {
  N5: ["<ruby>私<rt>わたし</rt></ruby>はその<ruby>人<rt>ひと</rt></ruby>を<ruby>知<rt>し</rt></ruby>っています。","I know that person."],
  N4: ["<ruby>道<rt>みち</rt></ruby>が<ruby>分<rt>わ</rt></ruby>からなかったので、<ruby>駅<rt>えき</rt></ruby>の<ruby>場所<rt>ばしょ</rt></ruby>を<ruby>知<rt>し</rt></ruby>りたいです。","I didn't know the way, so I want to find out where the station is."],
  N3: ["その<ruby>事故<rt>じこ</rt></ruby>のことは、ニュースを<ruby>見<rt>み</rt></ruby>て<ruby>初<rt>はじ</rt></ruby>めて<ruby>知<rt>し</rt></ruby>るようになった。","It was only after watching the news that I came to know about that accident."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>は<ruby>専門家<rt>せんもんか</rt></ruby>であるばかりでなく、<ruby>現場<rt>げんば</rt></ruby>のことも<ruby>誰<rt>だれ</rt></ruby>よりよく<ruby>知<rt>し</rt></ruby>っているわけだ。","Not only is he an expert, but he also knows the field better than anyone — that explains it."],
  N1: ["<ruby>真実<rt>しんじつ</rt></ruby>を<ruby>知<rt>し</rt></ruby>ればこそ、<ruby>彼<rt>かれ</rt></ruby>はあえて<ruby>沈黙<rt>ちんもく</rt></ruby>を<ruby>選<rt>えら</rt></ruby>ざるを<ruby>得<rt>え</rt></ruby>なかったのだろう。","It is precisely because he knew the truth that he had no choice but to dare to choose silence."]
},
18: {
  N5: ["<ruby>意味<rt>いみ</rt></ruby>が<ruby>分<rt>わ</rt></ruby>かりますか。","Do you understand the meaning?"],
  N4: ["<ruby>先生<rt>せんせい</rt></ruby>の<ruby>説明<rt>せつめい</rt></ruby>は<ruby>易<rt>やさ</rt></ruby>しかったので、よく<ruby>分<rt>わ</rt></ruby>かりました。","The teacher's explanation was easy, so I understood it well."],
  N3: ["<ruby>練習<rt>れんしゅう</rt></ruby>を<ruby>続<rt>つづ</rt></ruby>けたら、<ruby>難<rt>むずか</rt></ruby>しい<ruby>文章<rt>ぶんしょう</rt></ruby>も<ruby>分<rt>わ</rt></ruby>かるようになった。","After I kept practicing, I came to understand even difficult passages."],
  N2: ["<ruby>説明書<rt>せつめいしょ</rt></ruby>のとおりに<ruby>操作<rt>そうさ</rt></ruby>すれば、<ruby>誰<rt>だれ</rt></ruby>でも<ruby>仕組<rt>しく</rt></ruby>みが<ruby>分<rt>わ</rt></ruby>かるはずだ。","If you operate it exactly as the manual says, anyone should be able to understand the mechanism."],
  N1: ["<ruby>当事者<rt>とうじしゃ</rt></ruby>の<ruby>苦<rt>くる</rt></ruby>しみは、<ruby>同<rt>おな</rt></ruby>じ<ruby>経験<rt>けいけん</rt></ruby>を<ruby>経<rt>へ</rt></ruby>た<ruby>者<rt>もの</rt></ruby>でなければ<ruby>到底<rt>とうてい</rt></ruby><ruby>分<rt>わ</rt></ruby>かり<ruby>得<rt>え</rt></ruby>ない。","The suffering of those directly involved simply cannot be understood by anyone other than someone who has gone through the same experience."]
},
19: {
  N5: ["<ruby>右手<rt>みぎて</rt></ruby>でペンを<ruby>取<rt>と</rt></ruby>ります。","I take the pen with my right hand."],
  N4: ["<ruby>棚<rt>たな</rt></ruby>が<ruby>高<rt>たか</rt></ruby>かったので、<ruby>椅子<rt>いす</rt></ruby>に<ruby>乗<rt>の</rt></ruby>って<ruby>本<rt>ほん</rt></ruby>を<ruby>取<rt>と</rt></ruby>りました。","The shelf was high, so I got on a chair and took the book."],
  N3: ["<ruby>母<rt>はは</rt></ruby>に<ruby>頼<rt>たの</rt></ruby>まれて、<ruby>毎朝<rt>まいあさ</rt></ruby><ruby>新聞<rt>しんぶん</rt></ruby>を<ruby>取<rt>と</rt></ruby>ってくるようになった。","Having been asked by my mother, I started fetching the newspaper every morning."],
  N2: ["<ruby>責任者<rt>せきにんしゃ</rt></ruby>である<ruby>以上<rt>いじょう</rt></ruby>、<ruby>彼<rt>かれ</rt></ruby>がその<ruby>失敗<rt>しっぱい</rt></ruby>の<ruby>責任<rt>せきにん</rt></ruby>を<ruby>取<rt>と</rt></ruby>るのは<ruby>当然<rt>とうぜん</rt></ruby>のことだ。","Given that he is the person in charge, it is only natural that he takes responsibility for that failure."],
  N1: ["<ruby>事態<rt>じたい</rt></ruby>がここまで<ruby>悪化<rt>あっか</rt></ruby>したともなると、<ruby>社長<rt>しゃちょう</rt></ruby><ruby>自<rt>みずか</rt></ruby>ら<ruby>引責<rt>いんせき</rt></ruby>の<ruby>責任<rt>せきにん</rt></ruby>を<ruby>取<rt>と</rt></ruby>らざるを<ruby>得<rt>え</rt></ruby>ないだろう。","Once the situation has deteriorated to this extent, the president himself will have no choice but to take responsibility and resign."]
},
20: {
  N5: ["<ruby>友<rt>とも</rt></ruby>だちと<ruby>日本語<rt>にほんご</rt></ruby>で<ruby>話<rt>はな</rt></ruby>します。","I talk with my friend in Japanese."],
  N4: ["<ruby>緊張<rt>きんちょう</rt></ruby>していたけど、ゆっくり<ruby>話<rt>はな</rt></ruby>すことができました。","I was nervous, but I was able to speak slowly."],
  N3: ["<ruby>大勢<rt>おおぜい</rt></ruby>の<ruby>前<rt>まえ</rt></ruby>で<ruby>話<rt>はな</rt></ruby>させられて、とても<ruby>緊張<rt>きんちょう</rt></ruby>してしまった。","I was made to speak in front of a large crowd, and I got really nervous."],
  N2: ["<ruby>会議<rt>かいぎ</rt></ruby>が<ruby>長引<rt>ながび</rt></ruby>くうちに、<ruby>誰<rt>だれ</rt></ruby>も<ruby>本音<rt>ほんね</rt></ruby>を<ruby>話<rt>はな</rt></ruby>そうとしなくなってしまった。","As the meeting dragged on, no one would even try to speak their true feelings anymore."],
  N1: ["<ruby>記者<rt>きしゃ</rt></ruby>に<ruby>詰<rt>つ</rt></ruby>め<ruby>寄<rt>よ</rt></ruby>られ、<ruby>大臣<rt>だいじん</rt></ruby>は<ruby>不本意<rt>ふほんい</rt></ruby>ながらも<ruby>真相<rt>しんそう</rt></ruby>を<ruby>話<rt>はな</rt></ruby>さざるを<ruby>得<rt>え</rt></ruby>なかった。","Pressed hard by the reporters, the minister, however reluctantly, had no choice but to tell the truth."]
},
21: {
  N5: ["<ruby>毎日<rt>まいにち</rt></ruby><ruby>音楽<rt>おんがく</rt></ruby>を<ruby>聞<rt>き</rt></ruby>きます。","I listen to music every day."],
  N4: ["<ruby>道<rt>みち</rt></ruby>が<ruby>分<rt>わ</rt></ruby>からなかったから、<ruby>駅員<rt>えきいん</rt></ruby>さんに<ruby>聞<rt>き</rt></ruby>きました。","I didn't know the way, so I asked the station attendant."],
  N3: ["<ruby>子供<rt>こども</rt></ruby>のころ<ruby>祖母<rt>そぼ</rt></ruby>に<ruby>聞<rt>き</rt></ruby>かされた<ruby>話<rt>はなし</rt></ruby>を、<ruby>今<rt>いま</rt></ruby>でもよく<ruby>覚<rt>おぼ</rt></ruby>えている。","I still vividly remember the stories my grandmother used to tell me when I was a child."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>の<ruby>説明<rt>せつめい</rt></ruby>を<ruby>聞<rt>き</rt></ruby>けば<ruby>聞<rt>き</rt></ruby>くほど、<ruby>事態<rt>じたい</rt></ruby>は<ruby>深刻<rt>しんこく</rt></ruby>に<ruby>違<rt>ちが</rt></ruby>いないと<ruby>思<rt>おも</rt></ruby>えてきた。","The more I listened to his explanation, the more it seemed the situation must surely be serious."],
  N1: ["<ruby>被災者<rt>ひさいしゃ</rt></ruby>の<ruby>悲痛<rt>ひつう</rt></ruby>な<ruby>叫<rt>さけ</rt></ruby>びは、とても<ruby>聞<rt>き</rt></ruby>くに<ruby>堪<rt>た</rt></ruby>えないものであった。","The anguished cries of the disaster victims were truly unbearable to listen to."]
},
22: {
  N5: ["<ruby>母<rt>はは</rt></ruby>は<ruby>毎晩<rt>まいばん</rt></ruby><ruby>晩<rt>ばん</rt></ruby>ごはんを<ruby>作<rt>つく</rt></ruby>ります。","My mother makes dinner every evening."],
  N4: ["<ruby>料理<rt>りょうり</rt></ruby>が<ruby>好<rt>す</rt></ruby>きなので、<ruby>自分<rt>じぶん</rt></ruby>でケーキを<ruby>作<rt>つく</rt></ruby>ったことがあります。","I like cooking, so I have made a cake myself before."],
  N3: ["この<ruby>町<rt>まち</rt></ruby>で<ruby>作<rt>つく</rt></ruby>られた<ruby>野菜<rt>やさい</rt></ruby>は、<ruby>新鮮<rt>しんせん</rt></ruby>で<ruby>味<rt>あじ</rt></ruby>がいいと<ruby>評判<rt>ひょうばん</rt></ruby>だ。","The vegetables grown in this town have a reputation for being fresh and tasty."],
  N2: ["<ruby>新<rt>あたら</rt></ruby>しい<ruby>制度<rt>せいど</rt></ruby>を<ruby>作<rt>つく</rt></ruby>るには、<ruby>多<rt>おお</rt></ruby>くの<ruby>人<rt>ひと</rt></ruby>の<ruby>合意<rt>ごうい</rt></ruby>を<ruby>得<rt>え</rt></ruby>る<ruby>必要<rt>ひつよう</rt></ruby>があるわけだ。","To create a new system, you naturally need to obtain the agreement of many people."],
  N1: ["<ruby>限<rt>かぎ</rt></ruby>られた<ruby>予算<rt>よさん</rt></ruby>のもとで<ruby>理想<rt>りそう</rt></ruby>の<ruby>施設<rt>しせつ</rt></ruby>を<ruby>作<rt>つく</rt></ruby>るとなれば、<ruby>相当<rt>そうとう</rt></ruby>の<ruby>工夫<rt>くふう</rt></ruby>を<ruby>強<rt>し</rt></ruby>いられざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to building an ideal facility on a limited budget, one is inevitably forced into considerable ingenuity."]
},
23: {
  N5: ["<ruby>九時<rt>くじ</rt></ruby>に<ruby>勉強<rt>べんきょう</rt></ruby>を<ruby>始<rt>はじ</rt></ruby>めます。","I begin studying at nine o'clock."],
  N4: ["<ruby>運動<rt>うんどう</rt></ruby>が<ruby>体<rt>からだ</rt></ruby>にいいので、ジョギングを<ruby>始<rt>はじ</rt></ruby>めたいです。","Exercise is good for the body, so I want to start jogging."],
  N3: ["<ruby>先生<rt>せんせい</rt></ruby>に<ruby>勧<rt>すす</rt></ruby>められて、<ruby>毎朝<rt>まいあさ</rt></ruby><ruby>日記<rt>にっき</rt></ruby>を<ruby>書<rt>か</rt></ruby>き<ruby>始<rt>はじ</rt></ruby>めるようになった。","On my teacher's recommendation, I started writing a diary every morning."],
  N2: ["<ruby>準備<rt>じゅんび</rt></ruby>が<ruby>整<rt>ととの</rt></ruby>わないうちに<ruby>事業<rt>じぎょう</rt></ruby>を<ruby>始<rt>はじ</rt></ruby>めれば、<ruby>失敗<rt>しっぱい</rt></ruby>するのも<ruby>当然<rt>とうぜん</rt></ruby>というものだ。","If you start a business before the preparations are in order, failing is only to be expected."],
  N1: ["<ruby>市場<rt>しじょう</rt></ruby>の<ruby>急変<rt>きゅうへん</rt></ruby>を<ruby>受<rt>う</rt></ruby>け、<ruby>会社<rt>かいしゃ</rt></ruby>は<ruby>計画<rt>けいかく</rt></ruby>の<ruby>見直<rt>みなお</rt></ruby>しを<ruby>始<rt>はじ</rt></ruby>めることを<ruby>余儀<rt>よぎ</rt></ruby>なくされた。","In the wake of the sudden market shift, the company was forced to begin a review of its plans."]
},
24: {
  N5: ["ここで<ruby>友<rt>とも</rt></ruby>だちを<ruby>待<rt>ま</rt></ruby>ちます。","I will wait for my friend here."],
  N4: ["<ruby>雨<rt>あめ</rt></ruby>が<ruby>降<rt>ふ</rt></ruby>っていたので、<ruby>駅<rt>えき</rt></ruby>でバスを<ruby>待<rt>ま</rt></ruby>っていました。","It was raining, so I was waiting for the bus at the station."],
  N3: ["<ruby>長<rt>なが</rt></ruby>い<ruby>間<rt>あいだ</rt></ruby><ruby>待<rt>ま</rt></ruby>たされて、すっかり<ruby>疲<rt>つか</rt></ruby>れてしまった。","I was kept waiting for a long time and ended up completely exhausted."],
  N2: ["<ruby>結果<rt>けっか</rt></ruby>が<ruby>出<rt>で</rt></ruby>るのを<ruby>待<rt>ま</rt></ruby>つうちに、<ruby>不安<rt>ふあん</rt></ruby>がますます<ruby>大<rt>おお</rt></ruby>きくなっていった。","While waiting for the results to come out, my anxiety only grew larger and larger."],
  N1: ["<ruby>交渉<rt>こうしょう</rt></ruby>がこじれた<ruby>今<rt>いま</rt></ruby>となっては、<ruby>双方<rt>そうほう</rt></ruby>とも<ruby>歩<rt>あゆ</rt></ruby>み<ruby>寄<rt>よ</rt></ruby>りの<ruby>機会<rt>きかい</rt></ruby>を<ruby>待<rt>ま</rt></ruby>つほかあるまい。","Now that the negotiations have become tangled, both sides have no choice but to wait for a chance to come together."]
},
25: {
  N5: ["このペンはまだ<ruby>使<rt>つか</rt></ruby>えます。","This pen can still be used."],
  N4: ["<ruby>古<rt>ふる</rt></ruby>いパソコンですが、まだ<ruby>十分<rt>じゅうぶん</rt></ruby><ruby>使<rt>つか</rt></ruby>えるので<ruby>捨<rt>す</rt></ruby>てません。","It's an old computer, but it's still perfectly usable, so I won't throw it away."],
  N3: ["<ruby>修理<rt>しゅうり</rt></ruby>に<ruby>出<rt>だ</rt></ruby>したら、<ruby>壊<rt>こわ</rt></ruby>れていた<ruby>機械<rt>きかい</rt></ruby>がまた<ruby>使<rt>つか</rt></ruby>えるようになった。","After I sent it in for repairs, the broken machine became usable again."],
  N2: ["<ruby>無料<rt>むりょう</rt></ruby>のアプリといっても、<ruby>工夫<rt>くふう</rt></ruby>しだいで<ruby>仕事<rt>しごと</rt></ruby>に<ruby>十分<rt>じゅうぶん</rt></ruby><ruby>使<rt>つか</rt></ruby>え<ruby>得<rt>う</rt></ruby>るものだ。","Even though it's a free app, depending on how you use it, it can well be put to use for work."],
  N1: ["<ruby>限<rt>かぎ</rt></ruby>られた<ruby>資源<rt>しげん</rt></ruby>ともなれば、<ruby>使<rt>つか</rt></ruby>えるものはすべて<ruby>無駄<rt>むだ</rt></ruby>なく<ruby>活用<rt>かつよう</rt></ruby>せざるを<ruby>得<rt>え</rt></ruby>ない。","When resources are limited, one has no choice but to make full, wasteless use of everything that is usable."]
},
26: {
  N5: ["<ruby>毎日<rt>まいにち</rt></ruby><ruby>手紙<rt>てがみ</rt></ruby>を<ruby>書<rt>か</rt></ruby>きます。","I write a letter every day."],
  N4: ["<ruby>漢字<rt>かんじ</rt></ruby>が<ruby>難<rt>むずか</rt></ruby>しいけど、<ruby>練習<rt>れんしゅう</rt></ruby>しながら<ruby>書<rt>か</rt></ruby>いています。","Kanji is difficult, but I'm writing while practicing."],
  N3: ["<ruby>有名<rt>ゆうめい</rt></ruby>な<ruby>作家<rt>さっか</rt></ruby>によって<ruby>書<rt>か</rt></ruby>かれた<ruby>小説<rt>しょうせつ</rt></ruby>を、<ruby>夢中<rt>むちゅう</rt></ruby>で<ruby>読<rt>よ</rt></ruby>んでしまった。","I got so absorbed in the novel written by the famous author that I read it all in one go."],
  N2: ["<ruby>締<rt>し</rt></ruby>め<ruby>切<rt>き</rt></ruby>りに<ruby>追<rt>お</rt></ruby>われているうちに、<ruby>報告書<rt>ほうこくしょ</rt></ruby>を<ruby>書<rt>か</rt></ruby>く<ruby>時間<rt>じかん</rt></ruby>がなくなってしまった。","While being chased by the deadline, I ran out of time to write the report."],
  N1: ["<ruby>恩師<rt>おんし</rt></ruby>への<ruby>感謝<rt>かんしゃ</rt></ruby>の<ruby>念<rt>ねん</rt></ruby>を<ruby>込<rt>こ</rt></ruby>めればこそ、<ruby>彼<rt>かれ</rt></ruby>はあの<ruby>長<rt>なが</rt></ruby>い<ruby>追悼文<rt>ついとうぶん</rt></ruby>を<ruby>書<rt>か</rt></ruby>き<ruby>上<rt>あ</rt></ruby>げたのだ。","It was precisely because he was filled with gratitude toward his late mentor that he managed to complete that long eulogy."]
},
27: {
  N5: ["<ruby>図書館<rt>としょかん</rt></ruby>で<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>みます。","I read books at the library."],
  N4: ["<ruby>面白<rt>おもしろ</rt></ruby>い<ruby>本<rt>ほん</rt></ruby>だったので、<ruby>一日<rt>いちにち</rt></ruby>で<ruby>全部<rt>ぜんぶ</rt></ruby><ruby>読<rt>よ</rt></ruby>んでしまいました。","It was an interesting book, so I read all of it in one day."],
  N3: ["<ruby>毎日<rt>まいにち</rt></ruby><ruby>新聞<rt>しんぶん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>むようになってから、<ruby>世<rt>よ</rt></ruby>の<ruby>中<rt>なか</rt></ruby>のことがよく<ruby>分<rt>わ</rt></ruby>かるようになった。","Since I started reading the newspaper every day, I've come to understand the world much better."],
  N2: ["<ruby>文章<rt>ぶんしょう</rt></ruby>を<ruby>表面<rt>ひょうめん</rt></ruby><ruby>通<rt>どお</rt></ruby>りに<ruby>読<rt>よ</rt></ruby>むだけでなく、<ruby>筆者<rt>ひっしゃ</rt></ruby>の<ruby>意図<rt>いと</rt></ruby>まで<ruby>読<rt>よ</rt></ruby>み<ruby>取<rt>と</rt></ruby>るべきだ。","You should not merely read the text at face value but also read into the author's intentions."],
  N1: ["<ruby>古典<rt>こてん</rt></ruby>を<ruby>原文<rt>げんぶん</rt></ruby>で<ruby>読<rt>よ</rt></ruby>むともなると、<ruby>相当<rt>そうとう</rt></ruby>な<ruby>語学力<rt>ごがくりょく</rt></ruby>と<ruby>忍耐<rt>にんたい</rt></ruby>が<ruby>求<rt>もと</rt></ruby>められざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to reading the classics in the original, considerable language ability and patience are inevitably required."]
},
28: {
  N5: ["スーパーで<ruby>野菜<rt>やさい</rt></ruby>を<ruby>買<rt>か</rt></ruby>います。","I buy vegetables at the supermarket."],
  N4: ["<ruby>安<rt>やす</rt></ruby>かったので、<ruby>新<rt>あたら</rt></ruby>しい<ruby>靴<rt>くつ</rt></ruby>を<ruby>二足<rt>にそく</rt></ruby><ruby>買<rt>か</rt></ruby>いました。","It was cheap, so I bought two pairs of new shoes."],
  N3: ["<ruby>店員<rt>てんいん</rt></ruby>に<ruby>勧<rt>すす</rt></ruby>められて、つい<ruby>高<rt>たか</rt></ruby>い<ruby>時計<rt>とけい</rt></ruby>を<ruby>買<rt>か</rt></ruby>ってしまった。","Pushed by the salesperson, I ended up buying an expensive watch despite myself."],
  N2: ["<ruby>値段<rt>ねだん</rt></ruby>が<ruby>安<rt>やす</rt></ruby>いうちに<ruby>買<rt>か</rt></ruby>っておけば、<ruby>後<rt>あと</rt></ruby>で<ruby>後悔<rt>こうかい</rt></ruby>することもないわけだ。","If you buy it while the price is still low, you naturally won't end up regretting it later."],
  N1: ["<ruby>限定品<rt>げんていひん</rt></ruby>ともなれば、<ruby>多少<rt>たしょう</rt></ruby><ruby>高<rt>たか</rt></ruby>くても<ruby>今<rt>いま</rt></ruby>のうちに<ruby>買<rt>か</rt></ruby>っておかざるを<ruby>得<rt>え</rt></ruby>ないだろう。","When it's a limited-edition item, however somewhat pricey, one has little choice but to buy it now while one still can."]
},
29: {
  N5: ["<ruby>朝<rt>あさ</rt></ruby>ごはんをたくさん<ruby>食<rt>た</rt></ruby>べます。","I eat a lot of breakfast."],
  N4: ["お<ruby>腹<rt>なか</rt></ruby>がすいていたから、ラーメンを<ruby>全部<rt>ぜんぶ</rt></ruby><ruby>食<rt>た</rt></ruby>べてしまいました。","I was hungry, so I ate up all the ramen."],
  N3: ["<ruby>子供<rt>こども</rt></ruby>のころは<ruby>嫌<rt>きら</rt></ruby>いだった<ruby>野菜<rt>やさい</rt></ruby>も、<ruby>今<rt>いま</rt></ruby>では<ruby>食<rt>た</rt></ruby>べられるようになった。","The vegetables I disliked as a child, I can now eat."],
  N2: ["<ruby>体<rt>からだ</rt></ruby>に<ruby>悪<rt>わる</rt></ruby>いと<ruby>分<rt>わ</rt></ruby>かっていても、<ruby>甘<rt>あま</rt></ruby>いものを<ruby>食<rt>た</rt></ruby>べずにはいられないものだ。","Even knowing it's bad for the body, one just can't help eating sweet things."],
  N1: ["<ruby>断食<rt>だんじき</rt></ruby>の<ruby>修行<rt>しゅぎょう</rt></ruby>ともなると、<ruby>何日<rt>なんにち</rt></ruby>も<ruby>何<rt>なに</rt></ruby>も<ruby>食<rt>た</rt></ruby>べずに<ruby>耐<rt>た</rt></ruby>え<ruby>抜<rt>ぬ</rt></ruby>かざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to the discipline of fasting, one is forced to endure for days without eating anything at all."]
},
30: {
  N5: ["<ruby>毎日<rt>まいにち</rt></ruby><ruby>水<rt>みず</rt></ruby>を<ruby>飲<rt>の</rt></ruby>みます。","I drink water every day."],
  N4: ["<ruby>薬<rt>くすり</rt></ruby>を<ruby>飲<rt>の</rt></ruby>んでから<ruby>寝<rt>ね</rt></ruby>たほうがいいですよ。","You'd better take your medicine before going to sleep."],
  N3: ["<ruby>医者<rt>いしゃ</rt></ruby>に<ruby>勧<rt>すす</rt></ruby>められた<ruby>薬<rt>くすり</rt></ruby>を<ruby>飲<rt>の</rt></ruby>むようになってから、<ruby>体調<rt>たいちょう</rt></ruby>がよくなった。","Ever since I started taking the medicine my doctor recommended, my health has improved."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>は<ruby>酒<rt>さけ</rt></ruby>を<ruby>飲<rt>の</rt></ruby>むばかりでなく、<ruby>飲<rt>の</rt></ruby>んだうちに<ruby>本音<rt>ほんね</rt></ruby>を<ruby>漏<rt>も</rt></ruby>らすこともある。","He not only drinks, but sometimes lets his true feelings slip while he's drinking."],
  N1: ["<ruby>付<rt>つ</rt></ruby>き<ruby>合<rt>あ</rt></ruby>い<ruby>上<rt>じょう</rt></ruby>、<ruby>飲<rt>の</rt></ruby>めない<ruby>酒<rt>さけ</rt></ruby>をも<ruby>飲<rt>の</rt></ruby>まざるを<ruby>得<rt>え</rt></ruby>ない<ruby>場面<rt>ばめん</rt></ruby>が<ruby>少<rt>すく</rt></ruby>なくない。","For the sake of social obligation, there are no few occasions on which one is compelled to drink alcohol one cannot even handle."]
},
31: {
  N5: ["<ruby>先生<rt>せんせい</rt></ruby>が<ruby>前<rt>まえ</rt></ruby>に<ruby>立<rt>た</rt></ruby>っています。","The teacher is standing at the front."],
  N4: ["<ruby>名前<rt>なまえ</rt></ruby>を<ruby>呼<rt>よ</rt></ruby>ばれたから、すぐに<ruby>立<rt>た</rt></ruby>ちました。","My name was called, so I stood up right away."],
  N3: ["みんなの<ruby>前<rt>まえ</rt></ruby>で<ruby>立<rt>た</rt></ruby>たされて、<ruby>恥<rt>は</rt></ruby>ずかしくてたまらなかった。","I was made to stand in front of everyone, and I was unbearably embarrassed."],
  N2: ["<ruby>長年<rt>ながねん</rt></ruby><ruby>努力<rt>どりょく</rt></ruby>してきたとおり、ついに<ruby>世界<rt>せかい</rt></ruby>の<ruby>舞台<rt>ぶたい</rt></ruby>に<ruby>立<rt>た</rt></ruby>つことができたわけだ。","Just as he had worked at it for years, he was finally able to stand on the world stage."],
  N1: ["<ruby>批判<rt>ひはん</rt></ruby>の<ruby>矢面<rt>やおもて</rt></ruby>に<ruby>立<rt>た</rt></ruby>たされる<ruby>覚悟<rt>かくご</rt></ruby>があればこそ、<ruby>彼<rt>かれ</rt></ruby>はその<ruby>改革<rt>かいかく</rt></ruby>を<ruby>断行<rt>だんこう</rt></ruby>できたのだ。","It was precisely because he was prepared to stand at the forefront of criticism that he could push the reform through."]
},
32: {
  N5: ["どうぞ、ここに<ruby>座<rt>すわ</rt></ruby>ってください。","Please, sit here."],
  N4: ["<ruby>疲<rt>つか</rt></ruby>れたので、ベンチに<ruby>座<rt>すわ</rt></ruby>って<ruby>休<rt>やす</rt></ruby>みたいです。","I'm tired, so I want to sit on the bench and rest."],
  N3: ["<ruby>子供<rt>こども</rt></ruby>のころよく<ruby>座<rt>すわ</rt></ruby>っていた<ruby>椅子<rt>いす</rt></ruby>を<ruby>見<rt>み</rt></ruby>つけて、つい<ruby>泣<rt>な</rt></ruby>いてしまった。","When I found the chair I used to sit in as a child, I ended up crying despite myself."],
  N2: ["<ruby>会議<rt>かいぎ</rt></ruby>が<ruby>長引<rt>ながび</rt></ruby>くうちに、<ruby>誰<rt>だれ</rt></ruby>もが<ruby>黙<rt>だま</rt></ruby>って<ruby>座<rt>すわ</rt></ruby>ったまま<ruby>疲<rt>つか</rt></ruby>れ<ruby>果<rt>は</rt></ruby>てていった。","As the meeting dragged on, everyone grew exhausted while sitting there in silence."],
  N1: ["<ruby>交渉<rt>こうしょう</rt></ruby>の<ruby>席<rt>せき</rt></ruby>に<ruby>座<rt>すわ</rt></ruby>るともなると、<ruby>一言<rt>ひとこと</rt></ruby>たりとも<ruby>気<rt>き</rt></ruby>を<ruby>抜<rt>ぬ</rt></ruby>くことは<ruby>許<rt>ゆる</rt></ruby>されない。","When it comes to sitting down at the negotiating table, one is not permitted to let one's guard down for even a single word."]
},
33: {
  N5: ["<ruby>毎朝<rt>まいあさ</rt></ruby><ruby>駅<rt>えき</rt></ruby>まで<ruby>歩<rt>ある</rt></ruby>きます。","I walk to the station every morning."],
  N4: ["<ruby>音楽<rt>おんがく</rt></ruby>を<ruby>聞<rt>き</rt></ruby>きながら<ruby>公園<rt>こうえん</rt></ruby>を<ruby>歩<rt>ある</rt></ruby>くのが<ruby>好<rt>す</rt></ruby>きです。","I like walking through the park while listening to music."],
  N3: ["<ruby>足<rt>あし</rt></ruby>を<ruby>怪我<rt>けが</rt></ruby>してから、ようやく<ruby>普通<rt>ふつう</rt></ruby>に<ruby>歩<rt>ある</rt></ruby>けるようになった。","After injuring my leg, I've finally become able to walk normally again."],
  N2: ["<ruby>慣<rt>な</rt></ruby>れない<ruby>道<rt>みち</rt></ruby>を<ruby>歩<rt>ある</rt></ruby>いているうちに、すっかり<ruby>方向<rt>ほうこう</rt></ruby><ruby>感覚<rt>かんかく</rt></ruby>を<ruby>失<rt>うしな</rt></ruby>ってしまった。","While walking along unfamiliar streets, I completely lost my sense of direction."],
  N1: ["<ruby>険<rt>けわ</rt></ruby>しい<ruby>山道<rt>やまみち</rt></ruby>を<ruby>独<rt>ひと</rt></ruby>りで<ruby>歩<rt>ある</rt></ruby>き<ruby>通<rt>とお</rt></ruby>した<ruby>彼女<rt>かのじょ</rt></ruby>の<ruby>不屈<rt>ふくつ</rt></ruby>の<ruby>精神<rt>せいしん</rt></ruby>には、<ruby>感嘆<rt>かんたん</rt></ruby>せざるを<ruby>得<rt>え</rt></ruby>ない。","One cannot but marvel at the indomitable spirit of a woman who walked the entire treacherous mountain path alone."]
},
34: {
  N5: ["<ruby>子供<rt>こども</rt></ruby>が<ruby>公園<rt>こうえん</rt></ruby>で<ruby>走<rt>はし</rt></ruby>っています。","The children are running in the park."],
  N4: ["<ruby>遅<rt>おく</rt></ruby>れそうだったから、<ruby>駅<rt>えき</rt></ruby>まで<ruby>急<rt>いそ</rt></ruby>いで<ruby>走<rt>はし</rt></ruby>りました。","It looked like I'd be late, so I hurried and ran to the station."],
  N3: ["<ruby>毎朝<rt>まいあさ</rt></ruby><ruby>走<rt>はし</rt></ruby>るようになってから、<ruby>体<rt>からだ</rt></ruby>がずいぶん<ruby>軽<rt>かる</rt></ruby>くなった。","Since I started running every morning, my body has felt much lighter."],
  N2: ["<ruby>監督<rt>かんとく</rt></ruby>に<ruby>言<rt>い</rt></ruby>われたとおり<ruby>全力<rt>ぜんりょく</rt></ruby>で<ruby>走<rt>はし</rt></ruby>ったからこそ、<ruby>優勝<rt>ゆうしょう</rt></ruby>できたわけだ。","It's precisely because he ran at full effort as the coach instructed that he was able to win."],
  N1: ["<ruby>限界<rt>げんかい</rt></ruby>を<ruby>超<rt>こ</rt></ruby>えてなお<ruby>走<rt>はし</rt></ruby>り<ruby>続<rt>つづ</rt></ruby>けるその<ruby>姿<rt>すがた</rt></ruby>は、もはや<ruby>正視<rt>せいし</rt></ruby>するに<ruby>堪<rt>た</rt></ruby>えないほど<ruby>痛々<rt>いたいた</rt></ruby>しかった。","The sight of him continuing to run even past his limits was so painful it was almost unbearable to watch."]
},
35: {
  N5: ["<ruby>毎日<rt>まいにち</rt></ruby>バスに<ruby>乗<rt>の</rt></ruby>って<ruby>学校<rt>がっこう</rt></ruby>へ<ruby>行<rt>い</rt></ruby>きます。","I take the bus to school every day."],
  N4: ["<ruby>新幹線<rt>しんかんせん</rt></ruby>に<ruby>乗<rt>の</rt></ruby>ったことがありますか。","Have you ever ridden the bullet train?"],
  N3: ["<ruby>友達<rt>ともだち</rt></ruby>に<ruby>勧<rt>すす</rt></ruby>められた<ruby>電車<rt>でんしゃ</rt></ruby>に<ruby>乗<rt>の</rt></ruby>ったら、<ruby>思<rt>おも</rt></ruby>ったより<ruby>早<rt>はや</rt></ruby>く<ruby>着<rt>つ</rt></ruby>いてしまった。","When I took the train my friend recommended, I arrived earlier than expected."],
  N2: ["<ruby>満員<rt>まんいん</rt></ruby><ruby>電車<rt>でんしゃ</rt></ruby>に<ruby>乗<rt>の</rt></ruby>るうちに、<ruby>都会<rt>とかい</rt></ruby>の<ruby>暮<rt>く</rt></ruby>らしにもすっかり<ruby>慣<rt>な</rt></ruby>れてしまった。","While riding packed trains day after day, I grew completely accustomed to city life."],
  N1: ["<ruby>時流<rt>じりゅう</rt></ruby>に<ruby>乗<rt>の</rt></ruby>るともなると、<ruby>従来<rt>じゅうらい</rt></ruby>の<ruby>方針<rt>ほうしん</rt></ruby>の<ruby>転換<rt>てんかん</rt></ruby>を<ruby>余儀<rt>よぎ</rt></ruby>なくされることもあろう。","When it comes to riding the tide of the times, one may well be forced into a reversal of one's long-standing policies."]
},
36: {
  N5: ["<ruby>次<rt>つぎ</rt></ruby>の<ruby>駅<rt>えき</rt></ruby>で<ruby>降<rt>お</rt></ruby>りてください。","Please get off at the next station."],
  N4: ["バスを<ruby>降<rt>お</rt></ruby>りてから、<ruby>少<rt>すこ</rt></ruby>し<ruby>歩<rt>ある</rt></ruby>かなければなりません。","After getting off the bus, you have to walk a little."],
  N3: ["<ruby>降<rt>お</rt></ruby>りるはずだった<ruby>駅<rt>えき</rt></ruby>を、うっかり<ruby>通<rt>とお</rt></ruby>り<ruby>過<rt>す</rt></ruby>ぎてしまった。","I carelessly rode past the station I was supposed to get off at."],
  N2: ["<ruby>慣<rt>な</rt></ruby>れない<ruby>土地<rt>とち</rt></ruby>でバスを<ruby>降<rt>お</rt></ruby>りたとたん、<ruby>方角<rt>ほうがく</rt></ruby>が<ruby>分<rt>わ</rt></ruby>からなくなるなどということもあり<ruby>得<rt>え</rt></ruby>る。","It's quite possible to lose your bearings the moment you get off the bus in unfamiliar territory."],
  N1: ["<ruby>役職<rt>やくしょく</rt></ruby>を<ruby>降<rt>お</rt></ruby>りるともなると、<ruby>後任<rt>こうにん</rt></ruby>への<ruby>引<rt>ひ</rt></ruby>き<ruby>継<rt>つ</rt></ruby>ぎに<ruby>万全<rt>ばんぜん</rt></ruby>を<ruby>期<rt>き</rt></ruby>さざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to stepping down from one's post, one has no choice but to ensure a flawless handover to one's successor."]
},
37: {
  N5: ["<ruby>今日<rt>きょう</rt></ruby>は<ruby>早<rt>はや</rt></ruby>く<ruby>家<rt>いえ</rt></ruby>に<ruby>帰<rt>かえ</rt></ruby>ります。","Today I'm going home early."],
  N4: ["<ruby>仕事<rt>しごと</rt></ruby>が<ruby>終<rt>お</rt></ruby>わったので、もう<ruby>帰<rt>かえ</rt></ruby>ってもいいですか。","My work is done, so may I go home now?"],
  N3: ["<ruby>雨<rt>あめ</rt></ruby>に<ruby>降<rt>ふ</rt></ruby>られて、<ruby>濡<rt>ぬ</rt></ruby>れたまま<ruby>家<rt>いえ</rt></ruby>に<ruby>帰<rt>かえ</rt></ruby>ってしまった。","I got caught in the rain and ended up going home soaking wet."],
  N2: ["<ruby>終電<rt>しゅうでん</rt></ruby>を<ruby>逃<rt>のが</rt></ruby>した<ruby>以上<rt>いじょう</rt></ruby>、<ruby>歩<rt>ある</rt></ruby>いて<ruby>帰<rt>かえ</rt></ruby>るほかないわけだ。","Now that I've missed the last train, there's nothing for it but to walk home."],
  N1: ["<ruby>故郷<rt>こきょう</rt></ruby>に<ruby>帰<rt>かえ</rt></ruby>るともなると、<ruby>幼<rt>おさな</rt></ruby><ruby>馴染<rt>なじ</rt></ruby>みとの<ruby>再会<rt>さいかい</rt></ruby>に<ruby>胸<rt>むね</rt></ruby>の<ruby>高鳴<rt>たかな</rt></ruby>りを<ruby>抑<rt>おさ</rt></ruby>えがたい。","When it comes to returning to one's hometown, one can scarcely suppress the pounding of one's heart at reuniting with childhood friends."]
},
38: {
  N5: ["<ruby>明日<rt>あした</rt></ruby><ruby>友達<rt>ともだち</rt></ruby>に<ruby>会<rt>あ</rt></ruby>います。","I'm meeting a friend tomorrow."],
  N4: ["<ruby>駅<rt>えき</rt></ruby>で<ruby>先生<rt>せんせい</rt></ruby>に<ruby>会<rt>あ</rt></ruby>ったことがあります。","I've run into my teacher at the station before."],
  N3: ["<ruby>長<rt>なが</rt></ruby>い<ruby>間<rt>あいだ</rt></ruby><ruby>会<rt>あ</rt></ruby>っていなかった<ruby>友人<rt>ゆうじん</rt></ruby>に、<ruby>偶然<rt>ぐうぜん</rt></ruby><ruby>駅<rt>えき</rt></ruby>で<ruby>会<rt>あ</rt></ruby>えてうれしかった。","I was happy to run into, by chance at the station, a friend I hadn't seen for a long time."],
  N2: ["<ruby>一度<rt>いちど</rt></ruby><ruby>会<rt>あ</rt></ruby>ったばかりでなく、<ruby>何度<rt>なんど</rt></ruby>も<ruby>食事<rt>しょくじ</rt></ruby>を<ruby>共<rt>とも</rt></ruby>にしたのだから、<ruby>親友<rt>しんゆう</rt></ruby>と<ruby>言<rt>い</rt></ruby>っても<ruby>過言<rt>かごん</rt></ruby>ではない。","We not only met once but dined together many times, so it's no exaggeration to call us close friends."],
  N1: ["<ruby>恩師<rt>おんし</rt></ruby>に<ruby>会<rt>あ</rt></ruby>うともなると、<ruby>当時<rt>とうじ</rt></ruby>の<ruby>未熟<rt>みじゅく</rt></ruby>な<ruby>自分<rt>じぶん</rt></ruby>を<ruby>顧<rt>かえり</rt></ruby>みて、<ruby>赤面<rt>せきめん</rt></ruby>せざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to meeting one's old mentor, one cannot help but blush, recalling one's immature self of those days."]
},
39: {
  N5: ["この<ruby>店<rt>みせ</rt></ruby>で<ruby>安<rt>やす</rt></ruby>く<ruby>買<rt>か</rt></ruby>えます。","You can buy it cheaply at this store."],
  N4: ["お<ruby>金<rt>かね</rt></ruby>がないから、<ruby>新<rt>あたら</rt></ruby>しいかばんが<ruby>買<rt>か</rt></ruby>えません。","I have no money, so I can't buy a new bag."],
  N3: ["<ruby>給料<rt>きゅうりょう</rt></ruby>が<ruby>上<rt>あ</rt></ruby>がってから、<ruby>欲<rt>ほ</rt></ruby>しかった<ruby>車<rt>くるま</rt></ruby>が<ruby>買<rt>か</rt></ruby>えるようになった。","After my salary went up, I became able to buy the car I'd wanted."],
  N2: ["<ruby>円安<rt>えんやす</rt></ruby>が<ruby>進<rt>すす</rt></ruby>むうちに、<ruby>以前<rt>いぜん</rt></ruby>なら<ruby>気軽<rt>きがる</rt></ruby>に<ruby>買<rt>か</rt></ruby>えたものまで<ruby>手<rt>て</rt></ruby>が<ruby>届<rt>とど</rt></ruby>かなくなってしまった。","As the yen weakened, even things I could once buy without a thought slipped beyond my reach."],
  N1: ["<ruby>金<rt>かね</rt></ruby>さえあれば<ruby>何<rt>なん</rt></ruby>でも<ruby>買<rt>か</rt></ruby>えるという<ruby>風潮<rt>ふうちょう</rt></ruby>には、<ruby>嫌悪<rt>けんお</rt></ruby><ruby>感<rt>かん</rt></ruby>を<ruby>禁<rt>きん</rt></ruby>じ<ruby>得<rt>え</rt></ruby>ない。","I cannot suppress my revulsion at the prevailing notion that anything can be bought so long as one has money."]
},
40: {
  N5: ["かばんから<ruby>本<rt>ほん</rt></ruby>を<ruby>出<rt>だ</rt></ruby>しました。","I took the book out of my bag."],
  N4: ["<ruby>明日<rt>あした</rt></ruby>までにレポートを<ruby>出<rt>だ</rt></ruby>さなければなりません。","I have to submit the report by tomorrow."],
  N3: ["<ruby>先生<rt>せんせい</rt></ruby>に<ruby>出<rt>だ</rt></ruby>すように<ruby>言<rt>い</rt></ruby>われた<ruby>書類<rt>しょるい</rt></ruby>を、うっかり<ruby>忘<rt>わす</rt></ruby>れてしまった。","I carelessly forgot the documents the teacher told me to hand in."],
  N2: ["<ruby>勇気<rt>ゆうき</rt></ruby>を<ruby>出<rt>だ</rt></ruby>して<ruby>意見<rt>いけん</rt></ruby>を<ruby>述<rt>の</rt></ruby>べたからこそ、<ruby>議論<rt>ぎろん</rt></ruby>が<ruby>前<rt>まえ</rt></ruby>に<ruby>進<rt>すす</rt></ruby>んだわけだ。","It's precisely because he mustered the courage to voice his opinion that the discussion moved forward."],
  N1: ["<ruby>退職届<rt>たいしょくとどけ</rt></ruby>を<ruby>出<rt>だ</rt></ruby>すともなると、<ruby>長年<rt>ながねん</rt></ruby><ruby>世話<rt>せわ</rt></ruby>になった<ruby>上司<rt>じょうし</rt></ruby>への<ruby>挨拶<rt>あいさつ</rt></ruby>を<ruby>怠<rt>おこた</rt></ruby>るわけにはいかない。","When it comes to submitting one's resignation, one cannot neglect to pay respects to the superior who looked after one for many years."]
},
41: {
  N5: ["コーヒーに<ruby>砂糖<rt>さとう</rt></ruby>を<ruby>入<rt>い</rt></ruby>れます。","I put sugar in my coffee."],
  N4: ["<ruby>寒<rt>さむ</rt></ruby>いから、ポケットに<ruby>手<rt>て</rt></ruby>を<ruby>入<rt>い</rt></ruby>れて<ruby>歩<rt>ある</rt></ruby>きました。","It was cold, so I walked with my hands in my pockets."],
  N3: ["<ruby>母<rt>はは</rt></ruby>に<ruby>入<rt>い</rt></ruby>れてもらったお<ruby>茶<rt>ちゃ</rt></ruby>を<ruby>飲<rt>の</rt></ruby>むと、いつも<ruby>気持<rt>きも</rt></ruby>ちが<ruby>落<rt>お</rt></ruby>ち<ruby>着<rt>つ</rt></ruby>く。","Whenever I drink the tea my mother made for me, my mind always settles."],
  N2: ["<ruby>新<rt>あたら</rt></ruby>しい<ruby>意見<rt>いけん</rt></ruby>を<ruby>取<rt>と</rt></ruby>り<ruby>入<rt>い</rt></ruby>れるばかりでなく、<ruby>古<rt>ふる</rt></ruby>い<ruby>慣習<rt>かんしゅう</rt></ruby>も<ruby>見直<rt>みなお</rt></ruby>すべきだ。","We should not only take in new ideas but also reexamine old customs."],
  N1: ["<ruby>外部<rt>がいぶ</rt></ruby>の<ruby>人材<rt>じんざい</rt></ruby>を<ruby>受<rt>う</rt></ruby>け<ruby>入<rt>い</rt></ruby>れるともなると、<ruby>組織<rt>そしき</rt></ruby><ruby>全体<rt>ぜんたい</rt></ruby>の<ruby>意識<rt>いしき</rt></ruby><ruby>改革<rt>かいかく</rt></ruby>を<ruby>迫<rt>せま</rt></ruby>られるのは<ruby>必至<rt>ひっし</rt></ruby>である。","When it comes to bringing in outside talent, it is inevitable that a reform of the entire organization's mindset will be demanded."]
},
42: {
  N5: ["<ruby>映画<rt>えいが</rt></ruby>は<ruby>七時<rt>しちじ</rt></ruby>に<ruby>始<rt>はじ</rt></ruby>まります。","The movie starts at seven o'clock."],
  N4: ["<ruby>授業<rt>じゅぎょう</rt></ruby>が<ruby>始<rt>はじ</rt></ruby>まったから、<ruby>静<rt>しず</rt></ruby>かにしてください。","Class has started, so please be quiet."],
  N3: ["<ruby>先生<rt>せんせい</rt></ruby>が<ruby>来<rt>く</rt></ruby>ると、ようやく<ruby>会議<rt>かいぎ</rt></ruby>が<ruby>始<rt>はじ</rt></ruby>まるようになった。","Once the teacher arrived, the meeting finally got under way."],
  N2: ["<ruby>準備<rt>じゅんび</rt></ruby>が<ruby>整<rt>ととの</rt></ruby>ったとおり、<ruby>計画<rt>けいかく</rt></ruby>は<ruby>予定<rt>よてい</rt></ruby><ruby>通<rt>どお</rt></ruby>りに<ruby>始<rt>はじ</rt></ruby>まったわけだ。","Just as the preparations had been completed, the project began exactly on schedule."],
  N1: ["<ruby>世論<rt>よろん</rt></ruby>の<ruby>反発<rt>はんぱつ</rt></ruby>が<ruby>高<rt>たか</rt></ruby>まればこそ、<ruby>抜本<rt>ばっぽん</rt></ruby><ruby>的<rt>てき</rt></ruby>な<ruby>制度<rt>せいど</rt></ruby><ruby>改革<rt>かいかく</rt></ruby>がようやく<ruby>始<rt>はじ</rt></ruby>まったと<ruby>言<rt>い</rt></ruby>えよう。","It is precisely because public backlash mounted that one may say fundamental institutional reform has at last begun."]
},
43: {
  N5: ["<ruby>授業<rt>じゅぎょう</rt></ruby>は<ruby>三時<rt>さんじ</rt></ruby>に<ruby>終<rt>お</rt></ruby>わる。","Class ends at three o'clock."],
  N4: ["<ruby>仕事<rt>しごと</rt></ruby>が<ruby>終<rt>お</rt></ruby>わってから、<ruby>友達<rt>ともだち</rt></ruby>と<ruby>飲<rt>の</rt></ruby>みに<ruby>行<rt>い</rt></ruby>きたい。","After work is over, I want to go out drinking with my friends."],
  N3: ["<ruby>長<rt>なが</rt></ruby>く<ruby>続<rt>つづ</rt></ruby>いていた<ruby>試合<rt>しあい</rt></ruby>がやっと<ruby>終<rt>お</rt></ruby>わってしまった。","The long-running match has finally come to an end."],
  N2: ["<ruby>会議<rt>かいぎ</rt></ruby>が<ruby>予定<rt>よてい</rt></ruby>どおりに<ruby>終<rt>お</rt></ruby>わったので、<ruby>残<rt>のこ</rt></ruby>りの<ruby>時間<rt>じかん</rt></ruby>を<ruby>資料<rt>しりょう</rt></ruby>づくりに<ruby>充<rt>あ</rt></ruby>てられるわけだ。","Since the meeting ended on schedule, that means I can devote the remaining time to preparing materials."],
  N1: ["<ruby>数年<rt>すうねん</rt></ruby>がかりの<ruby>大事業<rt>だいじぎょう</rt></ruby>が、<ruby>関係者<rt>かんけいしゃ</rt></ruby>の<ruby>尽力<rt>じんりょく</rt></ruby>があればこそ<ruby>無事<rt>ぶじ</rt></ruby>に<ruby>終<rt>お</rt></ruby>わったと<ruby>言<rt>い</rt></ruby>えよう。","It could be said that the years-long undertaking was completed without incident precisely because of the dedicated efforts of everyone involved."]
},
44: {
  N5: ["<ruby>父<rt>ちち</rt></ruby>は<ruby>銀行<rt>ぎんこう</rt></ruby>で<ruby>働<rt>はたら</rt></ruby>いている。","My father works at a bank."],
  N4: ["お<ruby>金<rt>かね</rt></ruby>がほしいので、<ruby>夏休<rt>なつやす</rt></ruby>みもアルバイトで<ruby>働<rt>はたら</rt></ruby>いている。","I want money, so I'm working a part-time job over summer vacation too."],
  N3: ["<ruby>新<rt>あたら</rt></ruby>しい<ruby>上司<rt>じょうし</rt></ruby>のおかげで、<ruby>楽<rt>たの</rt></ruby>しく<ruby>働<rt>はたら</rt></ruby>けるようになった。","Thanks to my new boss, I've come to be able to work happily."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>は<ruby>給料<rt>きゅうりょう</rt></ruby>のためばかりでなく、<ruby>社会<rt>しゃかい</rt></ruby>の<ruby>役<rt>やく</rt></ruby>に<ruby>立<rt>た</rt></ruby>ちたいという<ruby>思<rt>おも</rt></ruby>いから<ruby>働<rt>はたら</rt></ruby>いている。","He works not just for the salary, but out of a desire to be useful to society."],
  N1: ["<ruby>家計<rt>かけい</rt></ruby>を<ruby>支<rt>ささ</rt></ruby>えるため、<ruby>病<rt>やまい</rt></ruby>を<ruby>押<rt>お</rt></ruby>してでも<ruby>働<rt>はたら</rt></ruby>かざるを<ruby>得<rt>え</rt></ruby>なかった。","To support the household finances, he had no choice but to keep working even while pushing through his illness."]
},
45: {
  N5: ["<ruby>私<rt>わたし</rt></ruby>は<ruby>東京<rt>とうきょう</rt></ruby>に<ruby>住<rt>す</rt></ruby>んでいます。","I live in Tokyo."],
  N4: ["<ruby>大学<rt>だいがく</rt></ruby>に<ruby>近<rt>ちか</rt></ruby>いので、この<ruby>町<rt>まち</rt></ruby>に<ruby>住<rt>す</rt></ruby>みたいと<ruby>思<rt>おも</rt></ruby>っている。","It's close to the university, so I'm thinking I'd like to live in this town."],
  N3: ["<ruby>田舎<rt>いなか</rt></ruby>に<ruby>住<rt>す</rt></ruby>むようになってから、<ruby>毎日<rt>まいにち</rt></ruby>がとても<ruby>静<rt>しず</rt></ruby>かになった。","Ever since I started living in the countryside, every day has become very quiet."],
  N2: ["<ruby>長年<rt>ながねん</rt></ruby><ruby>都会<rt>とかい</rt></ruby>に<ruby>住<rt>す</rt></ruby>んでいるうちに、<ruby>自然<rt>しぜん</rt></ruby>のありがたさを<ruby>忘<rt>わす</rt></ruby>れてしまっていた。","While living in the city for many years, I had ended up forgetting the preciousness of nature."],
  N1: ["<ruby>異国<rt>いこく</rt></ruby>に<ruby>住<rt>す</rt></ruby>んでみてこそ、<ruby>母国<rt>ぼこく</rt></ruby>の<ruby>文化<rt>ぶんか</rt></ruby>の<ruby>奥深<rt>おくぶか</rt></ruby>さに<ruby>気<rt>き</rt></ruby>づかされるものだ。","It's only by actually living in a foreign country that you come to realize the profound depth of your own homeland's culture."]
},
46: {
  N5: ["<ruby>明日<rt>あした</rt></ruby>、お<ruby>弁当<rt>べんとう</rt></ruby>を<ruby>持<rt>も</rt></ruby>っていく。","Tomorrow I'll bring a boxed lunch."],
  N4: ["<ruby>雨<rt>あめ</rt></ruby>が<ruby>降<rt>ふ</rt></ruby>りそうだから、<ruby>傘<rt>かさ</rt></ruby>を<ruby>持<rt>も</rt></ruby>っていったほうがいい。","It looks like it's going to rain, so you'd better take an umbrella."],
  N3: ["<ruby>友達<rt>ともだち</rt></ruby>に<ruby>借<rt>か</rt></ruby>りた<ruby>本<rt>ほん</rt></ruby>を<ruby>持<rt>も</rt></ruby>っていくのを<ruby>忘<rt>わす</rt></ruby>れてしまった。","I forgot to bring the book I borrowed from my friend."],
  N2: ["<ruby>会場<rt>かいじょう</rt></ruby>には<ruby>身分証明書<rt>みぶんしょうめいしょ</rt></ruby>を<ruby>持<rt>も</rt></ruby>っていかないと、<ruby>入<rt>はい</rt></ruby>れないに<ruby>違<rt>ちが</rt></ruby>いない。","There's no doubt that if you don't bring an ID to the venue, you won't be able to get in."],
  N1: ["<ruby>遺族<rt>いぞく</rt></ruby>の<ruby>気持<rt>きも</rt></ruby>ちを<ruby>思<rt>おも</rt></ruby>えば、<ruby>形見<rt>かたみ</rt></ruby>の<ruby>品<rt>しな</rt></ruby>を<ruby>墓前<rt>ぼぜん</rt></ruby>まで<ruby>持<rt>も</rt></ruby>っていかずにはいられなかった。","Thinking of the bereaved family's feelings, I couldn't help but carry the keepsake all the way to the grave."]
},
47: {
  N5: ["あと<ruby>五分<rt>ごふん</rt></ruby>なら<ruby>待<rt>ま</rt></ruby>てる。","If it's just five more minutes, I can wait."],
  N4: ["<ruby>用事<rt>ようじ</rt></ruby>があるので、これ<ruby>以上<rt>いじょう</rt></ruby>は<ruby>待<rt>ま</rt></ruby>てないと<ruby>言<rt>い</rt></ruby>われた。","I was told that since they had things to do, they couldn't wait any longer."],
  N3: ["<ruby>急<rt>いそ</rt></ruby>がされたが、<ruby>準備<rt>じゅんび</rt></ruby>ができるまでは<ruby>待<rt>ま</rt></ruby>てるはずだ。","I was rushed, but surely they can wait until I'm ready."],
  N2: ["<ruby>結果<rt>けっか</rt></ruby>が<ruby>気<rt>き</rt></ruby>になって<ruby>仕方<rt>しかた</rt></ruby>がないが、<ruby>発表<rt>はっぴょう</rt></ruby>の<ruby>日<rt>ひ</rt></ruby>まで<ruby>待<rt>ま</rt></ruby>てるかどうかは<ruby>本人<rt>ほんにん</rt></ruby>の<ruby>忍耐<rt>にんたい</rt></ruby>しだいだ。","I can't stop worrying about the results, but whether one can wait until the day of the announcement depends on that person's patience."],
  N1: ["<ruby>納期<rt>のうき</rt></ruby>が<ruby>迫<rt>せま</rt></ruby>るともなると、<ruby>顧客<rt>こきゃく</rt></ruby>がいつまでも<ruby>待<rt>ま</rt></ruby>てるとは<ruby>到底<rt>とうてい</rt></ruby><ruby>考<rt>かんが</rt></ruby>えられない。","Once the delivery deadline draws near, it's simply unthinkable that the client would wait indefinitely."]
},
48: {
  N5: ["<ruby>写真<rt>しゃしん</rt></ruby>を<ruby>見<rt>み</rt></ruby>せてください。","Please show me the photo."],
  N4: ["<ruby>新<rt>あたら</rt></ruby>しいかばんを<ruby>友達<rt>ともだち</rt></ruby>に<ruby>見<rt>み</rt></ruby>せたかった。","I wanted to show my new bag to my friends."],
  N3: ["<ruby>恥<rt>は</rt></ruby>ずかしくて、なかなか<ruby>本当<rt>ほんとう</rt></ruby>の<ruby>気持<rt>きも</rt></ruby>ちを<ruby>見<rt>み</rt></ruby>せられない。","I'm too embarrassed to readily show my true feelings."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>は<ruby>弱<rt>よわ</rt></ruby>みを<ruby>人<rt>ひと</rt></ruby>に<ruby>見<rt>み</rt></ruby>せまいとして、いつも<ruby>平気<rt>へいき</rt></ruby>なふりをしているわけだ。","He's always pretending to be unfazed in an effort not to show his weaknesses to others."],
  N1: ["<ruby>長年<rt>ながねん</rt></ruby>の<ruby>研究<rt>けんきゅう</rt></ruby>の<ruby>成果<rt>せいか</rt></ruby>を、<ruby>恩師<rt>おんし</rt></ruby>に<ruby>見<rt>み</rt></ruby>せずして<ruby>世<rt>よ</rt></ruby>を<ruby>去<rt>さ</rt></ruby>るのは、<ruby>無念<rt>むねん</rt></ruby>と<ruby>言<rt>い</rt></ruby>うほかない。","To pass away from this world without showing the fruits of many years of research to one's mentor can only be described as deeply regrettable."]
},
49: {
  N5: ["<ruby>新<rt>あたら</rt></ruby>しい<ruby>言葉<rt>ことば</rt></ruby>を<ruby>覚<rt>おぼ</rt></ruby>えた。","I learned a new word."],
  N4: ["<ruby>漢字<rt>かんじ</rt></ruby>を<ruby>覚<rt>おぼ</rt></ruby>えるのは<ruby>大変<rt>たいへん</rt></ruby>だけど、<ruby>毎日<rt>まいにち</rt></ruby><ruby>練習<rt>れんしゅう</rt></ruby>している。","Memorizing kanji is tough, but I practice every day."],
  N3: ["<ruby>歌<rt>うた</rt></ruby>を<ruby>聞<rt>き</rt></ruby>きながら<ruby>勉強<rt>べんきょう</rt></ruby>すれば、<ruby>単語<rt>たんご</rt></ruby>を<ruby>覚<rt>おぼ</rt></ruby>えやすくなる。","If you study while listening to songs, vocabulary becomes easier to remember."],
  N2: ["<ruby>説明<rt>せつめい</rt></ruby>を<ruby>一度<rt>いちど</rt></ruby><ruby>聞<rt>き</rt></ruby>いただけで<ruby>手順<rt>てじゅん</rt></ruby>をすべて<ruby>覚<rt>おぼ</rt></ruby>えるとは、<ruby>記憶力<rt>きおくりょく</rt></ruby>がよほどいいに<ruby>違<rt>ちが</rt></ruby>いない。","To memorize all the steps after hearing the explanation just once—his memory must be extraordinarily good."],
  N1: ["<ruby>幼少期<rt>ようしょうき</rt></ruby>に<ruby>覚<rt>おぼ</rt></ruby>えた<ruby>方言<rt>ほうげん</rt></ruby>は、<ruby>年月<rt>としつき</rt></ruby>を<ruby>経<rt>へ</rt></ruby>てもなお<ruby>身<rt>み</rt></ruby>に<ruby>染<rt>し</rt></ruby>みついて<ruby>離<rt>はな</rt></ruby>れないものだ。","The dialect one learns in early childhood stays ingrained and never leaves you, even after the passage of many years."]
},
50: {
  N5: ["<ruby>宿題<rt>しゅくだい</rt></ruby>を<ruby>忘<rt>わす</rt></ruby>れた。","I forgot my homework."],
  N4: ["<ruby>傘<rt>かさ</rt></ruby>を<ruby>電車<rt>でんしゃ</rt></ruby>の<ruby>中<rt>なか</rt></ruby>に<ruby>忘<rt>わす</rt></ruby>れてしまったので、<ruby>濡<rt>ぬ</rt></ruby>れて<ruby>帰<rt>かえ</rt></ruby>った。","I left my umbrella on the train, so I got soaked on the way home."],
  N3: ["<ruby>緊張<rt>きんちょう</rt></ruby>のあまり、<ruby>準備<rt>じゅんび</rt></ruby>していたことをすっかり<ruby>忘<rt>わす</rt></ruby>れてしまった。","I was so nervous that I completely forgot everything I had prepared."],
  N2: ["<ruby>恩師<rt>おんし</rt></ruby>に<ruby>受<rt>う</rt></ruby>けた<ruby>恩<rt>おん</rt></ruby>は、たとえどんなに<ruby>時<rt>とき</rt></ruby>が<ruby>経<rt>た</rt></ruby>とうとも<ruby>忘<rt>わす</rt></ruby>れ<ruby>得<rt>え</rt></ruby>ない。","The debt of gratitude I owe my mentor is something I can never forget, no matter how much time may pass."],
  N1: ["<ruby>戦禍<rt>せんか</rt></ruby>の<ruby>記憶<rt>きおく</rt></ruby>を<ruby>忘<rt>わす</rt></ruby>れ<ruby>去<rt>さ</rt></ruby>ることは、<ruby>後世<rt>こうせい</rt></ruby>への<ruby>責任<rt>せきにん</rt></ruby>を<ruby>放棄<rt>ほうき</rt></ruby>するに<ruby>等<rt>ひと</rt></ruby>しい。","To let the memory of the ravages of war fade away is tantamount to abandoning our responsibility to future generations."]
},
51: {
  N5: ["<ruby>窓<rt>まど</rt></ruby>を<ruby>開<rt>あ</rt></ruby>けてください。","Please open the window."],
  N4: ["<ruby>暑<rt>あつ</rt></ruby>かったので、<ruby>窓<rt>まど</rt></ruby>もドアも<ruby>開<rt>あ</rt></ruby>けて<ruby>風<rt>かぜ</rt></ruby>を<ruby>入<rt>い</rt></ruby>れた。","It was hot, so I opened both the windows and the door to let the breeze in."],
  N3: ["<ruby>店長<rt>てんちょう</rt></ruby>に<ruby>頼<rt>たの</rt></ruby>まれて、<ruby>毎朝<rt>まいあさ</rt></ruby><ruby>早<rt>はや</rt></ruby>く<ruby>店<rt>みせ</rt></ruby>を<ruby>開<rt>あ</rt></ruby>けるようになった。","At the manager's request, I've started opening the shop early every morning."],
  N2: ["<ruby>新<rt>あら</rt></ruby>たな<ruby>可能性<rt>かのうせい</rt></ruby>への<ruby>扉<rt>とびら</rt></ruby>を<ruby>自<rt>みずか</rt></ruby>ら<ruby>開<rt>あ</rt></ruby>けようとしないかぎり、<ruby>未来<rt>みらい</rt></ruby>は<ruby>変<rt>か</rt></ruby>わり<ruby>得<rt>え</rt></ruby>ない。","Unless you yourself try to open the door to new possibilities, the future cannot change."],
  N1: ["<ruby>交渉<rt>こうしょう</rt></ruby>の<ruby>糸口<rt>いとぐち</rt></ruby>を<ruby>開<rt>あ</rt></ruby>けるためとあれば、<ruby>多少<rt>たしょう</rt></ruby>の<ruby>譲歩<rt>じょうほ</rt></ruby>も<ruby>辞<rt>じ</rt></ruby>さない<ruby>覚悟<rt>かくご</rt></ruby>だ。","If it's for the sake of opening a thread to negotiations, I'm prepared to not shy away from some degree of concession."]
},
52: {
  N5: ["ドアを<ruby>閉<rt>し</rt></ruby>めてください。","Please close the door."],
  N4: ["<ruby>寒<rt>さむ</rt></ruby>くなってきたので、<ruby>窓<rt>まど</rt></ruby>を<ruby>閉<rt>し</rt></ruby>めてもいいですか。","It's getting cold, so may I close the window?"],
  N3: ["<ruby>子供<rt>こども</rt></ruby>が<ruby>寝<rt>ね</rt></ruby>ているので、<ruby>音<rt>おと</rt></ruby>を<ruby>立<rt>た</rt></ruby>てずにそっとドアを<ruby>閉<rt>し</rt></ruby>めた。","Since the child was sleeping, I closed the door gently without making a sound."],
  N2: ["<ruby>赤字<rt>あかじ</rt></ruby>が<ruby>続<rt>つづ</rt></ruby>くようでは、いずれこの<ruby>支店<rt>してん</rt></ruby>を<ruby>閉<rt>し</rt></ruby>めざるを<ruby>得<rt>え</rt></ruby>なくなるだろう。","If the losses keep mounting, we'll eventually have no choice but to close this branch."],
  N1: ["<ruby>創業<rt>そうぎょう</rt></ruby><ruby>百年<rt>ひゃくねん</rt></ruby>の<ruby>老舗<rt>しにせ</rt></ruby>が、<ruby>後継者難<rt>こうけいしゃなん</rt></ruby>のために<ruby>暖簾<rt>のれん</rt></ruby>を<ruby>閉<rt>し</rt></ruby>めるのは、<ruby>見<rt>み</rt></ruby>るに<ruby>堪<rt>た</rt></ruby>えない。","It's unbearable to watch a century-old establishment shut its doors due to a lack of a successor."]
},
53: {
  N5: ["ドアが<ruby>開<rt>あ</rt></ruby>いた。","The door opened."],
  N4: ["<ruby>風<rt>かぜ</rt></ruby>が<ruby>強<rt>つよ</rt></ruby>かったので、<ruby>窓<rt>まど</rt></ruby>がひとりでに<ruby>開<rt>あ</rt></ruby>いてびっくりした。","The wind was strong, so the window opened on its own and startled me."],
  N3: ["<ruby>自動<rt>じどう</rt></ruby>ドアが<ruby>急<rt>きゅう</rt></ruby>に<ruby>開<rt>あ</rt></ruby>いてしまって、<ruby>中<rt>なか</rt></ruby>の<ruby>冷<rt>つめ</rt></ruby>たい<ruby>空気<rt>くうき</rt></ruby>が<ruby>逃<rt>に</rt></ruby>げた。","The automatic door suddenly opened, and the cold air inside escaped."],
  N2: ["<ruby>金庫<rt>きんこ</rt></ruby>がこれほど<ruby>簡単<rt>かんたん</rt></ruby>に<ruby>開<rt>あ</rt></ruby>いたところを<ruby>見<rt>み</rt></ruby>ると、<ruby>内部<rt>ないぶ</rt></ruby>の<ruby>者<rt>もの</rt></ruby>の<ruby>仕業<rt>しわざ</rt></ruby>に<ruby>違<rt>ちが</rt></ruby>いない。","Seeing how easily the safe opened, it must be the work of someone on the inside."],
  N1: ["<ruby>長<rt>なが</rt></ruby>く<ruby>閉<rt>と</rt></ruby>ざされていた<ruby>国<rt>くに</rt></ruby>の<ruby>門戸<rt>もんこ</rt></ruby>がようやく<ruby>開<rt>あ</rt></ruby>いたとはいえ、<ruby>真<rt>しん</rt></ruby>の<ruby>交流<rt>こうりゅう</rt></ruby>はこれからだ。","Although the long-sealed country's doors have finally opened, true exchange is yet to come."]
},
54: {
  N5: ["<ruby>店<rt>みせ</rt></ruby>はもう<ruby>閉<rt>し</rt></ruby>まった。","The shop has already closed."],
  N4: ["<ruby>銀行<rt>ぎんこう</rt></ruby>は<ruby>三時<rt>さんじ</rt></ruby>に<ruby>閉<rt>し</rt></ruby>まるから、<ruby>早<rt>はや</rt></ruby>く<ruby>行<rt>い</rt></ruby>かなければならない。","The bank closes at three o'clock, so I have to hurry."],
  N3: ["<ruby>風<rt>かぜ</rt></ruby>で<ruby>急<rt>きゅう</rt></ruby>にドアが<ruby>閉<rt>し</rt></ruby>まってしまい、<ruby>鍵<rt>かぎ</rt></ruby>を<ruby>中<rt>なか</rt></ruby>に<ruby>閉<rt>と</rt></ruby>じ<ruby>込<rt>こ</rt></ruby>めてしまった。","The door suddenly slammed shut in the wind, and I locked the key inside."],
  N2: ["<ruby>営業時間内<rt>えいぎょうじかんない</rt></ruby>のはずなのにシャッターが<ruby>閉<rt>し</rt></ruby>まっているところを<ruby>見<rt>み</rt></ruby>ると、<ruby>臨時休業<rt>りんじきゅうぎょう</rt></ruby>に<ruby>違<rt>ちが</rt></ruby>いない。","Seeing the shutters closed when it should be within business hours, it must be an unscheduled closure."],
  N1: ["<ruby>人々<rt>ひとびと</rt></ruby>の<ruby>心<rt>こころ</rt></ruby>が<ruby>不信<rt>ふしん</rt></ruby>によって<ruby>固<rt>かた</rt></ruby>く<ruby>閉<rt>し</rt></ruby>まってしまっては、いかなる<ruby>対話<rt>たいわ</rt></ruby>も<ruby>成<rt>な</rt></ruby>り<ruby>立<rt>た</rt></ruby>ち<ruby>得<rt>え</rt></ruby>ない。","Once people's hearts are firmly closed off by distrust, no dialogue can possibly take hold."]
},
55: {
  N5: ["<ruby>電気<rt>でんき</rt></ruby>をつけてください。","Please turn on the light."],
  N4: ["<ruby>暗<rt>くら</rt></ruby>くなってきたから、<ruby>部屋<rt>へや</rt></ruby>の<ruby>明<rt>あ</rt></ruby>かりをつけたほうがいい。","It's getting dark, so you'd better turn on the room's light."],
  N3: ["<ruby>料理<rt>りょうり</rt></ruby>に<ruby>慣<rt>な</rt></ruby>れて、<ruby>味<rt>あじ</rt></ruby>をうまくつけられるようになった。","I've gotten used to cooking and can now season food well."],
  N2: ["<ruby>新製品<rt>しんせいひん</rt></ruby>に<ruby>高<rt>たか</rt></ruby>い<ruby>値段<rt>ねだん</rt></ruby>をつけたとおり、<ruby>品質<rt>ひんしつ</rt></ruby>にも<ruby>相当<rt>そうとう</rt></ruby>の<ruby>自信<rt>じしん</rt></ruby>があるわけだ。","Just as they set a high price on the new product, it means they have considerable confidence in its quality too."],
  N1: ["<ruby>曖昧<rt>あいまい</rt></ruby>なまま<ruby>放置<rt>ほうち</rt></ruby>された<ruby>議論<rt>ぎろん</rt></ruby>に<ruby>決着<rt>けっちゃく</rt></ruby>をつけずして、<ruby>次<rt>つぎ</rt></ruby>の<ruby>段階<rt>だんかい</rt></ruby>へ<ruby>進<rt>すす</rt></ruby>むことはできまい。","Without settling a debate that has been left ambiguous and unresolved, one surely cannot move on to the next stage."]
},
56: {
  N5: ["<ruby>電<rt>でん</rt></ruby><ruby>気<rt>き</rt></ruby>を<ruby>消<rt>け</rt></ruby>してください。","Please turn off the light."],
  N4: ["<ruby>寝<rt>ね</rt></ruby>る<ruby>前<rt>まえ</rt></ruby>に、テレビを<ruby>消<rt>け</rt></ruby>してから<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>きます。","Before going to bed, I turn off the TV and then brush my teeth."],
  N3: ["<ruby>間<rt>ま</rt></ruby><ruby>違<rt>ちが</rt></ruby>えて<ruby>書<rt>か</rt></ruby>いた<ruby>名<rt>な</rt></ruby><ruby>前<rt>まえ</rt></ruby>を<ruby>消<rt>け</rt></ruby>してしまった。","I ended up erasing the name I had written by mistake."],
  N2: ["<ruby>外<rt>そと</rt></ruby><ruby>出<rt>しゅつ</rt></ruby>する<ruby>際<rt>さい</rt></ruby>には、<ruby>必<rt>かなら</rt></ruby>ずエアコンを<ruby>消<rt>け</rt></ruby>すばかりでなく、<ruby>窓<rt>まど</rt></ruby>の<ruby>鍵<rt>かぎ</rt></ruby>も<ruby>確<rt>かく</rt></ruby><ruby>認<rt>にん</rt></ruby>すべきだ。","When going out, you should not only be sure to turn off the air conditioner but also check that the windows are locked."],
  N1: ["<ruby>節<rt>せつ</rt></ruby><ruby>電<rt>でん</rt></ruby>が<ruby>叫<rt>さけ</rt></ruby>ばれる<ruby>昨<rt>さっ</rt></ruby><ruby>今<rt>こん</rt></ruby>、<ruby>使<rt>つか</rt></ruby>わない<ruby>照<rt>しょう</rt></ruby><ruby>明<rt>めい</rt></ruby>はこまめに<ruby>消<rt>け</rt></ruby>さざるを<ruby>得<rt>え</rt></ruby>ない。","In these days when energy conservation is being urged, we have no choice but to diligently turn off lights we are not using."]
},
57: {
  N5: ["<ruby>部<rt>へ</rt></ruby><ruby>屋<rt>や</rt></ruby>の<ruby>電<rt>でん</rt></ruby><ruby>気<rt>き</rt></ruby>がつきました。","The room's light came on."],
  N4: ["スイッチを<ruby>押<rt>お</rt></ruby>すと、<ruby>赤<rt>あか</rt></ruby>いランプがつきますから、<ruby>見<rt>み</rt></ruby>てください。","When you press the switch, the red lamp comes on, so please watch."],
  N3: ["<ruby>暗<rt>くら</rt></ruby>くなると、<ruby>道<rt>みち</rt></ruby>の<ruby>街<rt>がい</rt></ruby><ruby>灯<rt>とう</rt></ruby>が<ruby>自<rt>じ</rt></ruby><ruby>動<rt>どう</rt></ruby><ruby>的<rt>てき</rt></ruby>につくようになった。","It has come to be that the streetlights on the road turn on automatically when it gets dark."],
  N2: ["<ruby>電<rt>でん</rt></ruby><ruby>源<rt>げん</rt></ruby>ボタンを<ruby>押<rt>お</rt></ruby>したとおりに<ruby>画<rt>が</rt></ruby><ruby>面<rt>めん</rt></ruby>がつくなら、<ruby>故<rt>こ</rt></ruby><ruby>障<rt>しょう</rt></ruby>ではないわけだ。","If the screen comes on just as you press the power button, then it isn't broken after all."],
  N1: ["<ruby>非<rt>ひ</rt></ruby><ruby>常<rt>じょう</rt></ruby><ruby>灯<rt>とう</rt></ruby>がつきさえすれば、<ruby>停<rt>てい</rt></ruby><ruby>電<rt>でん</rt></ruby><ruby>時<rt>じ</rt></ruby>であろうとも<ruby>避<rt>ひ</rt></ruby><ruby>難<rt>なん</rt></ruby><ruby>経<rt>けい</rt></ruby><ruby>路<rt>ろ</rt></ruby>を<ruby>見<rt>み</rt></ruby><ruby>失<rt>うしな</rt></ruby>うことはあるまい。","As long as the emergency lights come on, one will surely not lose sight of the evacuation route even during a blackout."]
},
58: {
  N5: ["<ruby>電<rt>でん</rt></ruby><ruby>気<rt>き</rt></ruby>が<ruby>消<rt>き</rt></ruby>えました。","The light went out."],
  N4: ["ろうそくの<ruby>火<rt>ひ</rt></ruby>が<ruby>消<rt>き</rt></ruby>えたから、<ruby>部<rt>へ</rt></ruby><ruby>屋<rt>や</rt></ruby>が<ruby>暗<rt>くら</rt></ruby>くなった。","The candle's flame went out, so the room got dark."],
  N3: ["<ruby>黒<rt>こく</rt></ruby><ruby>板<rt>ばん</rt></ruby>に<ruby>書<rt>か</rt></ruby>かれた<ruby>字<rt>じ</rt></ruby>が、いつの<ruby>間<rt>ま</rt></ruby>にか<ruby>消<rt>き</rt></ruby>えてしまっていた。","The letters written on the blackboard had disappeared before I knew it."],
  N2: ["<ruby>朝<rt>あさ</rt></ruby><ruby>日<rt>ひ</rt></ruby>が<ruby>昇<rt>のぼ</rt></ruby>るうちに、<ruby>夜<rt>よる</rt></ruby><ruby>空<rt>ぞら</rt></ruby>の<ruby>星<rt>ほし</rt></ruby>は<ruby>一<rt>ひと</rt></ruby>つずつ<ruby>消<rt>き</rt></ruby>えていった。","As the morning sun rose, the stars in the night sky disappeared one by one."],
  N1: ["<ruby>長<rt>なが</rt></ruby><ruby>年<rt>ねん</rt></ruby><ruby>抱<rt>いだ</rt></ruby>いてきた<ruby>夢<rt>ゆめ</rt></ruby>が<ruby>一<rt>いっ</rt></ruby><ruby>瞬<rt>しゅん</rt></ruby>にして<ruby>消<rt>き</rt></ruby>えるとは、<ruby>落<rt>らく</rt></ruby><ruby>胆<rt>たん</rt></ruby>に<ruby>堪<rt>た</rt></ruby>えない。","That a dream I had cherished for so many years should vanish in an instant is more than I can bear in my dejection."]
},
59: {
  N5: ["<ruby>私<rt>わたし</rt></ruby>は<ruby>白<rt>しろ</rt></ruby>いシャツを<ruby>着<rt>き</rt></ruby>ます。","I wear a white shirt."],
  N4: ["<ruby>寒<rt>さむ</rt></ruby>いから、コートを<ruby>着<rt>き</rt></ruby>てから<ruby>出<rt>で</rt></ruby>かけましょう。","It's cold, so let's put on a coat before we go out."],
  N3: ["<ruby>母<rt>はは</rt></ruby>が<ruby>作<rt>つく</rt></ruby>ってくれた<ruby>着<rt>き</rt></ruby><ruby>物<rt>もの</rt></ruby>を<ruby>着<rt>き</rt></ruby>ると、<ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ちが<ruby>引<rt>ひ</rt></ruby>き<ruby>締<rt>し</rt></ruby>まるようになった。","When I wear the kimono my mother made for me, I've come to feel a sense of composure."],
  N2: ["<ruby>式<rt>しき</rt></ruby><ruby>典<rt>てん</rt></ruby>に<ruby>出<rt>しゅっ</rt></ruby><ruby>席<rt>せき</rt></ruby>する<ruby>以<rt>い</rt></ruby><ruby>上<rt>じょう</rt></ruby>、<ruby>正<rt>せい</rt></ruby><ruby>装<rt>そう</rt></ruby>を<ruby>着<rt>き</rt></ruby>ていくのが<ruby>礼<rt>れい</rt></ruby><ruby>儀<rt>ぎ</rt></ruby>というものだ。","Since one is attending the ceremony, wearing formal attire is simply a matter of etiquette."],
  N1: ["<ruby>故<rt>こ</rt></ruby><ruby>人<rt>じん</rt></ruby>を<ruby>偲<rt>しの</rt></ruby>ぶ<ruby>会<rt>かい</rt></ruby>ともなると、<ruby>誰<rt>だれ</rt></ruby>もが<ruby>喪<rt>も</rt></ruby><ruby>服<rt>ふく</rt></ruby>を<ruby>着<rt>き</rt></ruby>て、<ruby>厳<rt>おごそ</rt></ruby>かな<ruby>面<rt>おも</rt></ruby><ruby>持<rt>も</rt></ruby>ちで<ruby>参<rt>さん</rt></ruby><ruby>列<rt>れつ</rt></ruby>する。","When it comes to a memorial gathering for the deceased, everyone wears mourning clothes and attends with a solemn expression."]
},
60: {
  N5: ["<ruby>毎<rt>まい</rt></ruby><ruby>日<rt>にち</rt></ruby><ruby>黒<rt>くろ</rt></ruby>いくつを<ruby>履<rt>は</rt></ruby>きます。","I wear black shoes every day."],
  N4: ["<ruby>新<rt>あたら</rt></ruby>しいくつを<ruby>履<rt>は</rt></ruby>いたから、<ruby>足<rt>あし</rt></ruby>が<ruby>少<rt>すこ</rt></ruby>し<ruby>痛<rt>いた</rt></ruby>い。","I wore new shoes, so my feet hurt a little."],
  N3: ["<ruby>祖<rt>そ</rt></ruby><ruby>父<rt>ふ</rt></ruby>が<ruby>若<rt>わか</rt></ruby>いころに<ruby>履<rt>は</rt></ruby>いていたという<ruby>下<rt>げ</rt></ruby><ruby>駄<rt>た</rt></ruby>が、<ruby>今<rt>いま</rt></ruby>でも<ruby>大<rt>たい</rt></ruby><ruby>切<rt>せつ</rt></ruby>に<ruby>残<rt>のこ</rt></ruby>されている。","The wooden clogs my grandfather is said to have worn in his youth are still carefully kept even now."],
  N2: ["<ruby>登<rt>と</rt></ruby><ruby>山<rt>ざん</rt></ruby>に<ruby>慣<rt>な</rt></ruby>れない<ruby>人<rt>ひと</rt></ruby>こそ、<ruby>滑<rt>すべ</rt></ruby>りにくい<ruby>靴<rt>くつ</rt></ruby>を<ruby>履<rt>は</rt></ruby>くべきだと<ruby>言<rt>い</rt></ruby>える。","It can be said that precisely those unaccustomed to mountain climbing ought to wear slip-resistant shoes."],
  N1: ["<ruby>雪<rt>ゆき</rt></ruby><ruby>道<rt>みち</rt></ruby>を<ruby>歩<rt>ある</rt></ruby>くともなれば、スパイクの<ruby>付<rt>つ</rt></ruby>いた<ruby>長<rt>なが</rt></ruby><ruby>靴<rt>ぐつ</rt></ruby>を<ruby>履<rt>は</rt></ruby>かざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to walking on snowy roads, one has no choice but to wear spiked boots."]
},
61: {
  N5: ["<ruby>父<rt>ちち</rt></ruby>は<ruby>帽<rt>ぼう</rt></ruby><ruby>子<rt>し</rt></ruby>をかぶります。","My father wears a hat."],
  N4: ["<ruby>日<rt>ひ</rt></ruby>が<ruby>強<rt>つよ</rt></ruby>いから、<ruby>帽<rt>ぼう</rt></ruby><ruby>子<rt>し</rt></ruby>をかぶってから<ruby>散<rt>さん</rt></ruby><ruby>歩<rt>ぽ</rt></ruby>に<ruby>行<rt>い</rt></ruby>きたい。","The sun is strong, so I want to put on a hat before going for a walk."],
  N3: ["<ruby>工<rt>こう</rt></ruby><ruby>事<rt>じ</rt></ruby><ruby>現<rt>げん</rt></ruby><ruby>場<rt>ば</rt></ruby>に<ruby>入<rt>はい</rt></ruby>る<ruby>人<rt>ひと</rt></ruby>は、ヘルメットをかぶらなければならないようになっている。","It has come to be that people entering the construction site must wear a helmet."],
  N2: ["<ruby>伝<rt>でん</rt></ruby><ruby>統<rt>とう</rt></ruby><ruby>行<rt>ぎょう</rt></ruby><ruby>事<rt>じ</rt></ruby>のとおりに、<ruby>踊<rt>おど</rt></ruby>り<ruby>手<rt>て</rt></ruby>たちは<ruby>独<rt>どく</rt></ruby><ruby>特<rt>とく</rt></ruby>な<ruby>面<rt>めん</rt></ruby>をかぶって<ruby>舞<rt>ま</rt></ruby>う。","Just as the traditional ritual dictates, the dancers wear distinctive masks as they perform."],
  N1: ["<ruby>不<rt>ふ</rt></ruby><ruby>祥<rt>しょう</rt></ruby><ruby>事<rt>じ</rt></ruby>の<ruby>責<rt>せき</rt></ruby><ruby>任<rt>にん</rt></ruby>を<ruby>一<rt>ひと</rt></ruby><ruby>人<rt>り</rt></ruby>でかぶらされるとは、<ruby>同<rt>どう</rt></ruby><ruby>情<rt>じょう</rt></ruby>を<ruby>禁<rt>きん</rt></ruby>じ<ruby>得<rt>え</rt></ruby>ない。","That he was made to shoulder the blame for the scandal all by himself — I cannot help but feel sympathy."]
},
62: {
  N5: ["<ruby>父<rt>ちち</rt></ruby>はネクタイを<ruby>締<rt>し</rt></ruby>めます。","My father fastens his necktie."],
  N4: ["<ruby>車<rt>くるま</rt></ruby>に<ruby>乗<rt>の</rt></ruby>ったら、シートベルトを<ruby>締<rt>し</rt></ruby>めてから<ruby>運<rt>うん</rt></ruby><ruby>転<rt>てん</rt></ruby>してください。","When you get in the car, please fasten your seatbelt before driving."],
  N3: ["<ruby>面<rt>めん</rt></ruby><ruby>接<rt>せつ</rt></ruby>のために<ruby>父<rt>ちち</rt></ruby>が<ruby>選<rt>えら</rt></ruby>んでくれたネクタイを<ruby>締<rt>し</rt></ruby>めると、<ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ちが<ruby>引<rt>ひ</rt></ruby>き<ruby>締<rt>し</rt></ruby>まった。","When I fastened the necktie my father had chosen for me for the interview, my mind grew taut with resolve."],
  N2: ["<ruby>気<rt>き</rt></ruby>を<ruby>抜<rt>ぬ</rt></ruby>かないうちに、もう<ruby>一<rt>いち</rt></ruby><ruby>度<rt>ど</rt></ruby><ruby>帯<rt>おび</rt></ruby>をしっかり<ruby>締<rt>し</rt></ruby>めておくべきだ。","Before you let your guard down, you ought to tighten the sash firmly once more."],
  N1: ["<ruby>大<rt>たい</rt></ruby><ruby>役<rt>やく</rt></ruby>を<ruby>任<rt>まか</rt></ruby>されたともなると、<ruby>気<rt>き</rt></ruby>を<ruby>締<rt>し</rt></ruby>めてかからざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to being entrusted with such an important role, one has no choice but to brace oneself and apply full focus."]
},
63: {
  N5: ["<ruby>姉<rt>あね</rt></ruby>はめがねをかけます。","My older sister wears glasses."],
  N4: ["<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>むときは、めがねをかけたほうがいいですよ。","When you read books, it's better to wear glasses."],
  N3: ["<ruby>目<rt>め</rt></ruby>が<ruby>悪<rt>わる</rt></ruby>くなってから、<ruby>運<rt>うん</rt></ruby><ruby>転<rt>てん</rt></ruby>のときにめがねをかけるようになった。","After my eyesight worsened, I came to wear glasses when driving."],
  N2: ["<ruby>細<rt>こま</rt></ruby>かい<ruby>字<rt>じ</rt></ruby>を<ruby>読<rt>よ</rt></ruby>むときには、<ruby>老<rt>ろう</rt></ruby><ruby>眼<rt>がん</rt></ruby><ruby>鏡<rt>きょう</rt></ruby>をかけざるを<ruby>得<rt>え</rt></ruby>ないわけだ。","It follows, then, that when reading small print one cannot avoid wearing reading glasses."],
  N1: ["<ruby>長<rt>なが</rt></ruby><ruby>時<rt>じ</rt></ruby><ruby>間<rt>かん</rt></ruby>の<ruby>細<rt>さい</rt></ruby><ruby>密<rt>みつ</rt></ruby>な<ruby>作<rt>さ</rt></ruby><ruby>業<rt>ぎょう</rt></ruby>ともなると、<ruby>専<rt>せん</rt></ruby><ruby>用<rt>よう</rt></ruby>のめがねをかけずにはいられない。","When it comes to long hours of intricate work, one cannot help but put on specialized glasses."]
},
64: {
  N5: ["<ruby>先<rt>せん</rt></ruby><ruby>生<rt>せい</rt></ruby>が<ruby>私<rt>わたし</rt></ruby>の<ruby>名<rt>な</rt></ruby><ruby>前<rt>まえ</rt></ruby>を<ruby>呼<rt>よ</rt></ruby>びました。","The teacher called my name."],
  N4: ["<ruby>友<rt>とも</rt></ruby><ruby>達<rt>だち</rt></ruby>を<ruby>家<rt>いえ</rt></ruby>に<ruby>呼<rt>よ</rt></ruby>んで、<ruby>一<rt>いっ</rt></ruby><ruby>緒<rt>しょ</rt></ruby>に<ruby>料<rt>りょう</rt></ruby><ruby>理<rt>り</rt></ruby>を<ruby>作<rt>つく</rt></ruby>りたい。","I want to invite my friends over to my house and cook together."],
  N3: ["<ruby>気<rt>き</rt></ruby>を<ruby>失<rt>うしな</rt></ruby>った<ruby>人<rt>ひと</rt></ruby>がいたので、すぐに<ruby>救<rt>きゅう</rt></ruby><ruby>急<rt>きゅう</rt></ruby><ruby>車<rt>しゃ</rt></ruby>を<ruby>呼<rt>よ</rt></ruby>んでしまった。","Since there was a person who had fainted, I went ahead and called an ambulance right away."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>の<ruby>発<rt>はつ</rt></ruby><ruby>言<rt>げん</rt></ruby>は<ruby>誤<rt>ご</rt></ruby><ruby>解<rt>かい</rt></ruby>を<ruby>呼<rt>よ</rt></ruby>びかねないばかりでなく、<ruby>無<rt>む</rt></ruby><ruby>用<rt>よう</rt></ruby>な<ruby>混<rt>こん</rt></ruby><ruby>乱<rt>らん</rt></ruby>を<ruby>招<rt>まね</rt></ruby>く<ruby>恐<rt>おそ</rt></ruby>れがある。","His remark not only risks inviting misunderstanding but also threatens to bring about needless confusion."],
  N1: ["<ruby>世<rt>せ</rt></ruby><ruby>論<rt>ろん</rt></ruby>の<ruby>反<rt>はん</rt></ruby><ruby>発<rt>ぱつ</rt></ruby>を<ruby>呼<rt>よ</rt></ruby>びかねない<ruby>政<rt>せい</rt></ruby><ruby>策<rt>さく</rt></ruby>ともなれば、<ruby>慎<rt>しん</rt></ruby><ruby>重<rt>ちょう</rt></ruby>な<ruby>説<rt>せつ</rt></ruby><ruby>明<rt>めい</rt></ruby>を<ruby>尽<rt>つ</rt></ruby>くさざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to a policy liable to provoke public backlash, the government has no choice but to exhaust every effort at careful explanation."]
},
65: {
  N5: ["<ruby>毎<rt>まい</rt></ruby><ruby>朝<rt>あさ</rt></ruby><ruby>六<rt>ろく</rt></ruby><ruby>時<rt>じ</rt></ruby>に<ruby>起<rt>お</rt></ruby>きます。","I get up at six every morning."],
  N4: ["<ruby>昨日<rt>きのう</rt></ruby>は<ruby>遅<rt>おそ</rt></ruby>く<ruby>寝<rt>ね</rt></ruby>たから、<ruby>今朝<rt>けさ</rt></ruby>はなかなか<ruby>起<rt>お</rt></ruby>きられなかった。","I went to bed late yesterday, so I couldn't get up easily this morning."],
  N3: ["<ruby>大<rt>おお</rt></ruby>きな<ruby>地<rt>じ</rt></ruby><ruby>震<rt>しん</rt></ruby>が<ruby>起<rt>お</rt></ruby>きたら、まず<ruby>机<rt>つくえ</rt></ruby>の<ruby>下<rt>した</rt></ruby>に<ruby>隠<rt>かく</rt></ruby>れるようにしている。","If a big earthquake occurs, I make a point of first hiding under a desk."],
  N2: ["<ruby>事<rt>じ</rt></ruby><ruby>故<rt>こ</rt></ruby>が<ruby>起<rt>お</rt></ruby>きてからでは<ruby>遅<rt>おそ</rt></ruby>いのだから、<ruby>事<rt>じ</rt></ruby><ruby>前<rt>ぜん</rt></ruby>に<ruby>対<rt>たい</rt></ruby><ruby>策<rt>さく</rt></ruby>を<ruby>講<rt>こう</rt></ruby>じておくべきだ。","Since it is too late once an accident has occurred, one ought to take countermeasures in advance."],
  N1: ["<ruby>予<rt>よ</rt></ruby><ruby>期<rt>き</rt></ruby>せぬ<ruby>事<rt>じ</rt></ruby><ruby>態<rt>たい</rt></ruby>が<ruby>起<rt>お</rt></ruby>きたともなれば、<ruby>計<rt>けい</rt></ruby><ruby>画<rt>かく</rt></ruby>の<ruby>全<rt>ぜん</rt></ruby><ruby>面<rt>めん</rt></ruby><ruby>的<rt>てき</rt></ruby>な<ruby>見<rt>み</rt></ruby><ruby>直<rt>なお</rt></ruby>しを<ruby>余<rt>よ</rt></ruby><ruby>儀<rt>ぎ</rt></ruby>なくされる。","Should an unforeseen situation arise, one is forced to undertake a complete reexamination of the plan."]
},
66: {
  N5: ["<ruby>私<rt>わたし</rt></ruby>は<ruby>十<rt>じゅう</rt></ruby><ruby>一<rt>いち</rt></ruby><ruby>時<rt>じ</rt></ruby>に<ruby>寝<rt>ね</rt></ruby>ます。","I go to bed at eleven o'clock."],
  N4: ["<ruby>疲<rt>つか</rt></ruby>れたから、<ruby>今日<rt>きょう</rt></ruby>は<ruby>早<rt>はや</rt></ruby>く<ruby>寝<rt>ね</rt></ruby>たいです。","I'm tired, so today I want to go to bed early."],
  N3: ["<ruby>赤<rt>あか</rt></ruby>ちゃんが<ruby>泣<rt>な</rt></ruby>き<ruby>出<rt>だ</rt></ruby>したので、<ruby>結<rt>けっ</rt></ruby><ruby>局<rt>きょく</rt></ruby>ゆうべは<ruby>三<rt>さん</rt></ruby><ruby>時<rt>じ</rt></ruby><ruby>間<rt>かん</rt></ruby>しか<ruby>寝<rt>ね</rt></ruby>られなかった。","The baby started crying, so in the end I was only able to sleep three hours last night."],
  N2: ["<ruby>体<rt>からだ</rt></ruby>が<ruby>弱<rt>よわ</rt></ruby>っているうちは、<ruby>無<rt>む</rt></ruby><ruby>理<rt>り</rt></ruby>をせずにしっかり<ruby>寝<rt>ね</rt></ruby>ておくべきだ。","While your body is weakened, you ought to sleep well without overexerting yourself."],
  N1: ["<ruby>締<rt>し</rt></ruby>め<ruby>切<rt>き</rt></ruby>りを<ruby>間<rt>ま</rt></ruby><ruby>近<rt>ぢか</rt></ruby>に<ruby>控<rt>ひか</rt></ruby>えたともなると、<ruby>満<rt>まん</rt></ruby><ruby>足<rt>ぞく</rt></ruby>に<ruby>寝<rt>ね</rt></ruby>る<ruby>暇<rt>ひま</rt></ruby>すら<ruby>惜<rt>お</rt></ruby>しんで<ruby>働<rt>はたら</rt></ruby>かざるを<ruby>得<rt>え</rt></ruby>ない。","With the deadline looming close at hand, one is forced to begrudge even the time to sleep properly and to keep working."]
},
67: {
  N5: ["<ruby>母<rt>はは</rt></ruby>が<ruby>私<rt>わたし</rt></ruby>を<ruby>起<rt>お</rt></ruby>こしました。","My mother woke me up."],
  N4: ["<ruby>明日<rt>あした</rt></ruby>は<ruby>早<rt>はや</rt></ruby>いから、<ruby>六<rt>ろく</rt></ruby><ruby>時<rt>じ</rt></ruby>に<ruby>起<rt>お</rt></ruby>こしてください。","Tomorrow is an early day, so please wake me up at six."],
  N3: ["<ruby>弟<rt>おとうと</rt></ruby>は<ruby>大<rt>おお</rt></ruby>きな<ruby>音<rt>おと</rt></ruby>を<ruby>立<rt>た</rt></ruby>てて、<ruby>家<rt>か</rt></ruby><ruby>族<rt>ぞく</rt></ruby>みんなを<ruby>起<rt>お</rt></ruby>こしてしまった。","My little brother made a loud noise and ended up waking the whole family."],
  N2: ["<ruby>不<rt>ふ</rt></ruby><ruby>用<rt>よう</rt></ruby><ruby>意<rt>い</rt></ruby>な<ruby>一<rt>ひと</rt></ruby><ruby>言<rt>こと</rt></ruby>が<ruby>大<rt>おお</rt></ruby>きな<ruby>誤<rt>ご</rt></ruby><ruby>解<rt>かい</rt></ruby>を<ruby>起<rt>お</rt></ruby>こしかねないわけだ。","It follows that a careless single word could well give rise to a major misunderstanding."],
  N1: ["<ruby>世<rt>せ</rt></ruby><ruby>間<rt>けん</rt></ruby>を<ruby>騒<rt>さわ</rt></ruby>がせる<ruby>騒<rt>そう</rt></ruby><ruby>動<rt>どう</rt></ruby>を<ruby>起<rt>お</rt></ruby>こした<ruby>以<rt>い</rt></ruby><ruby>上<rt>じょう</rt></ruby>、<ruby>当<rt>とう</rt></ruby><ruby>事<rt>じ</rt></ruby><ruby>者<rt>しゃ</rt></ruby>は<ruby>説<rt>せつ</rt></ruby><ruby>明<rt>めい</rt></ruby><ruby>責<rt>せき</rt></ruby><ruby>任<rt>にん</rt></ruby>を<ruby>果<rt>は</rt></ruby>たさざるを<ruby>得<rt>え</rt></ruby>ない。","Having caused an uproar that troubled the public, the parties involved have no choice but to fulfill their accountability."]
},
68: {
  N5: ["<ruby>友<rt>とも</rt></ruby><ruby>達<rt>だち</rt></ruby>に<ruby>本<rt>ほん</rt></ruby>をあげました。","I gave a book to my friend."],
  N4: ["<ruby>誕<rt>たん</rt></ruby><ruby>生<rt>じょう</rt></ruby><ruby>日<rt>び</rt></ruby>だから、<ruby>妹<rt>いもうと</rt></ruby>に<ruby>花<rt>はな</rt></ruby>をあげたいと<ruby>思<rt>おも</rt></ruby>います。","Because it's her birthday, I'm thinking I want to give my little sister some flowers."],
  N3: ["<ruby>困<rt>こま</rt></ruby>っている<ruby>人<rt>ひと</rt></ruby>を<ruby>見<rt>み</rt></ruby>ると、つい<ruby>手<rt>て</rt></ruby><ruby>持<rt>も</rt></ruby>ちのものをあげてしまう。","Whenever I see someone in trouble, I end up giving them whatever I have on hand without thinking."],
  N2: ["<ruby>感<rt>かん</rt></ruby><ruby>謝<rt>しゃ</rt></ruby>の<ruby>気<rt>き</rt></ruby><ruby>持<rt>も</rt></ruby>ちを<ruby>込<rt>こ</rt></ruby>めて<ruby>贈<rt>おく</rt></ruby>り<ruby>物<rt>もの</rt></ruby>をあげる<ruby>以<rt>い</rt></ruby><ruby>上<rt>じょう</rt></ruby>、<ruby>相<rt>あい</rt></ruby><ruby>手<rt>て</rt></ruby>の<ruby>好<rt>この</rt></ruby>みを<ruby>考<rt>かんが</rt></ruby>えるべきだ。","Since you are giving a gift imbued with gratitude, you ought to consider the recipient's tastes."],
  N1: ["<ruby>恩<rt>おん</rt></ruby><ruby>師<rt>し</rt></ruby>の<ruby>退<rt>たい</rt></ruby><ruby>官<rt>かん</rt></ruby><ruby>記<rt>き</rt></ruby><ruby>念<rt>ねん</rt></ruby>ともなると、<ruby>教<rt>きょう</rt></ruby>え<ruby>子<rt>ご</rt></ruby>たちは<ruby>心<rt>こころ</rt></ruby>のこもった<ruby>品<rt>しな</rt></ruby>をあげずにはいられない。","When it comes to commemorating their esteemed teacher's retirement, the former students cannot help but give heartfelt gifts."]
},
69: {
  N5: ["<ruby>友<rt>とも</rt></ruby>だちが<ruby>本<rt>ほん</rt></ruby>をくれました。","My friend gave me a book."],
  N4: ["<ruby>母<rt>はは</rt></ruby>がお<ruby>金<rt>かね</rt></ruby>をくれたので、<ruby>新<rt>あたら</rt></ruby>しいかばんを<ruby>買<rt>か</rt></ruby>いました。","My mother gave me money, so I bought a new bag."],
  N3: ["<ruby>道<rt>みち</rt></ruby>に<ruby>迷<rt>まよ</rt></ruby>っていたら、<ruby>知<rt>し</rt></ruby>らない<ruby>人<rt>ひと</rt></ruby>が<ruby>親切<rt>しんせつ</rt></ruby>に<ruby>道<rt>みち</rt></ruby>を<ruby>教<rt>おし</rt></ruby>えてくれた。","When I was lost, a stranger kindly told me the way."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>は<ruby>忙<rt>いそが</rt></ruby>しいにもかかわらず、わざわざ<ruby>手伝<rt>てつだ</rt></ruby>いに<ruby>来<rt>き</rt></ruby>てくれたわけだ。","Despite being busy, he went out of his way to come and help me."],
  N1: ["<ruby>恩師<rt>おんし</rt></ruby>が<ruby>厳<rt>きび</rt></ruby>しく<ruby>指導<rt>しどう</rt></ruby>してくれたればこそ、<ruby>今<rt>いま</rt></ruby>の<ruby>私<rt>わたし</rt></ruby>があるのだと<ruby>痛感<rt>つうかん</rt></ruby>せざるを<ruby>得<rt>え</rt></ruby>ない。","It is precisely because my mentor guided me so strictly that I cannot help but keenly feel I am who I am today."]
},
70: {
  N5: ["<ruby>姉<rt>あね</rt></ruby>にプレゼントをもらいました。","I received a present from my older sister."],
  N4: ["<ruby>先生<rt>せんせい</rt></ruby>からアドバイスをもらったので、とてもうれしかったです。","I got advice from my teacher, so I was very happy."],
  N3: ["<ruby>友人<rt>ゆうじん</rt></ruby>に<ruby>引<rt>ひ</rt></ruby>っ<ruby>越<rt>こ</rt></ruby>しを<ruby>手伝<rt>てつだ</rt></ruby>ってもらったら、<ruby>一日<rt>いちにち</rt></ruby>で<ruby>終<rt>お</rt></ruby>わってしまった。","When I had my friend help me move, it was all finished in a single day."],
  N2: ["<ruby>専門家<rt>せんもんか</rt></ruby>に<ruby>詳<rt>くわ</rt></ruby>しく<ruby>説明<rt>せつめい</rt></ruby>してもらったうちに、<ruby>問題<rt>もんだい</rt></ruby>の<ruby>本質<rt>ほんしつ</rt></ruby>が<ruby>見<rt>み</rt></ruby>えてきた。","While having an expert explain it in detail, the essence of the problem gradually came into view."],
  N1: ["<ruby>上司<rt>じょうし</rt></ruby>の<ruby>理解<rt>りかい</rt></ruby>を<ruby>得<rt>え</rt></ruby>て<ruby>長期<rt>ちょうき</rt></ruby><ruby>休暇<rt>きゅうか</rt></ruby>をもらえたからこそ、<ruby>長年<rt>ながねん</rt></ruby>の<ruby>夢<rt>ゆめ</rt></ruby>を<ruby>実現<rt>じつげん</rt></ruby>するに<ruby>至<rt>いた</rt></ruby>った。","It was precisely because I gained my superior's understanding and was granted a long leave that I came to realize my lifelong dream."]
},
71: {
  N5: ["<ruby>毎日<rt>まいにち</rt></ruby><ruby>日本語<rt>にほんご</rt></ruby>を<ruby>勉強<rt>べんきょう</rt></ruby>します。","I study Japanese every day."],
  N4: ["<ruby>音楽<rt>おんがく</rt></ruby>を<ruby>聞<rt>き</rt></ruby>きながら<ruby>勉強<rt>べんきょう</rt></ruby>するのが<ruby>好<rt>す</rt></ruby>きです。","I like studying while listening to music."],
  N3: ["<ruby>留学<rt>りゅうがく</rt></ruby>してから、<ruby>毎日<rt>まいにち</rt></ruby><ruby>図書館<rt>としょかん</rt></ruby>で<ruby>勉強<rt>べんきょう</rt></ruby>するようになった。","Since studying abroad, I've come to study at the library every day."],
  N2: ["<ruby>合格<rt>ごうかく</rt></ruby>するためには、<ruby>知識<rt>ちしき</rt></ruby>を<ruby>暗記<rt>あんき</rt></ruby>するばかりでなく、<ruby>応用力<rt>おうようりょく</rt></ruby>を<ruby>身<rt>み</rt></ruby>につくよう<ruby>勉強<rt>べんきょう</rt></ruby>する<ruby>必要<rt>ひつよう</rt></ruby>がある。","To pass, one must study not only by memorizing knowledge but also so as to acquire the ability to apply it."],
  N1: ["<ruby>第一線<rt>だいいっせん</rt></ruby>の<ruby>研究者<rt>けんきゅうしゃ</rt></ruby>ともなると、<ruby>休<rt>やす</rt></ruby>む<ruby>間<rt>ま</rt></ruby>も<ruby>惜<rt>お</rt></ruby>しんで<ruby>勉強<rt>べんきょう</rt></ruby>し<ruby>続<rt>つづ</rt></ruby>けざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to being a frontline researcher, one has no choice but to keep studying, grudging even the time to rest."]
},
72: {
  N5: ["<ruby>夜<rt>よる</rt></ruby><ruby>母<rt>はは</rt></ruby>に<ruby>電話<rt>でんわ</rt></ruby>します。","I phone my mother at night."],
  N4: ["<ruby>駅<rt>えき</rt></ruby>に<ruby>着<rt>つ</rt></ruby>いたら<ruby>電話<rt>でんわ</rt></ruby>するから、<ruby>待<rt>ま</rt></ruby>っていてください。","I'll call you when I arrive at the station, so please wait."],
  N3: ["<ruby>緊張<rt>きんちょう</rt></ruby>していたが、<ruby>思<rt>おも</rt></ruby>い<ruby>切<rt>き</rt></ruby>って<ruby>彼女<rt>かのじょ</rt></ruby>に<ruby>電話<rt>でんわ</rt></ruby>してしまった。","I was nervous, but I went ahead and phoned her after all."],
  N2: ["<ruby>約束<rt>やくそく</rt></ruby>の<ruby>時間<rt>じかん</rt></ruby>を<ruby>過<rt>す</rt></ruby>ぎても<ruby>連絡<rt>れんらく</rt></ruby>がない<ruby>以上<rt>いじょう</rt></ruby>、こちらから<ruby>電話<rt>でんわ</rt></ruby>するほかない。","Since there's been no contact even past the appointed time, there's nothing to do but call them ourselves."],
  N1: ["<ruby>取引先<rt>とりひきさき</rt></ruby>の<ruby>不興<rt>ふきょう</rt></ruby>を<ruby>買<rt>か</rt></ruby>った<ruby>以上<rt>いじょう</rt></ruby>、<ruby>社長<rt>しゃちょう</rt></ruby><ruby>自<rt>みずか</rt></ruby>ら<ruby>謝罪<rt>しゃざい</rt></ruby>の<ruby>電話<rt>でんわ</rt></ruby>するを<ruby>余儀<rt>よぎ</rt></ruby>なくされた。","Having incurred the client's displeasure, the president was compelled to make an apologetic phone call himself."]
},
73: {
  N5: ["<ruby>父<rt>ちち</rt></ruby>は<ruby>車<rt>くるま</rt></ruby>を<ruby>運転<rt>うんてん</rt></ruby>します。","My father drives a car."],
  N4: ["<ruby>免許<rt>めんきょ</rt></ruby>を<ruby>取<rt>と</rt></ruby>ったから、<ruby>自分<rt>じぶん</rt></ruby>で<ruby>運転<rt>うんてん</rt></ruby>したいです。","I got my license, so I want to drive myself."],
  N3: ["<ruby>雪<rt>ゆき</rt></ruby>が<ruby>積<rt>つ</rt></ruby>もった<ruby>道<rt>みち</rt></ruby>を<ruby>運転<rt>うんてん</rt></ruby>するのは、<ruby>慣<rt>な</rt></ruby>れないと<ruby>怖<rt>こわ</rt></ruby>く<ruby>感<rt>かん</rt></ruby>じてしまう。","Driving on a snow-covered road feels scary until you get used to it."],
  N2: ["<ruby>長時間<rt>ちょうじかん</rt></ruby><ruby>運転<rt>うんてん</rt></ruby>するうちに<ruby>注意力<rt>ちゅういりょく</rt></ruby>が<ruby>低下<rt>ていか</rt></ruby>するのは、<ruby>避<rt>さ</rt></ruby>け<ruby>得<rt>え</rt></ruby>ないことだ。","It is something that cannot be avoided that one's attention declines while driving for long hours."],
  N1: ["<ruby>視界<rt>しかい</rt></ruby>が<ruby>奪<rt>うば</rt></ruby>われるほどの<ruby>濃霧<rt>のうむ</rt></ruby>の<ruby>中<rt>なか</rt></ruby>を<ruby>運転<rt>うんてん</rt></ruby>するともなると、<ruby>熟練<rt>じゅくれん</rt></ruby>のドライバーですら<ruby>緊張<rt>きんちょう</rt></ruby>を<ruby>禁<rt>きん</rt></ruby>じ<ruby>得<rt>え</rt></ruby>ない。","When it comes to driving through fog thick enough to rob one of vision, even a seasoned driver cannot suppress a sense of tension."]
},
74: {
  N5: ["<ruby>毎朝<rt>まいあさ</rt></ruby>ピアノを<ruby>練習<rt>れんしゅう</rt></ruby>します。","I practice the piano every morning."],
  N4: ["<ruby>試合<rt>しあい</rt></ruby>に<ruby>勝<rt>か</rt></ruby>ちたいので、<ruby>毎日<rt>まいにち</rt></ruby>サッカーを<ruby>練習<rt>れんしゅう</rt></ruby>しています。","I want to win the match, so I practice soccer every day."],
  N3: ["<ruby>先生<rt>せんせい</rt></ruby>に<ruby>言<rt>い</rt></ruby>われたとおりに<ruby>練習<rt>れんしゅう</rt></ruby>したら、<ruby>上手<rt>じょうず</rt></ruby>に<ruby>話<rt>はな</rt></ruby>せるようになった。","When I practiced just as the teacher told me, I became able to speak well."],
  N2: ["<ruby>基礎<rt>きそ</rt></ruby>を<ruby>繰<rt>く</rt></ruby>り<ruby>返<rt>かえ</rt></ruby><ruby>練習<rt>れんしゅう</rt></ruby>してこそ、<ruby>本番<rt>ほんばん</rt></ruby>でも<ruby>実力<rt>じつりょく</rt></ruby>を<ruby>発揮<rt>はっき</rt></ruby>し<ruby>得<rt>え</rt></ruby>るというものだ。","It is only by repeatedly practicing the fundamentals that one can display one's true ability when it counts."],
  N1: ["<ruby>大舞台<rt>おおぶたい</rt></ruby>に<ruby>臨<rt>のぞ</rt></ruby>む<ruby>演奏家<rt>えんそうか</rt></ruby>ともなると、<ruby>指<rt>ゆび</rt></ruby>が<ruby>血<rt>ち</rt></ruby>を<ruby>滲<rt>にじ</rt></ruby>ませるほど<ruby>練習<rt>れんしゅう</rt></ruby>するのも<ruby>厭<rt>いと</rt></ruby>わない。","When it comes to a performer facing a grand stage, they do not even mind practicing until their fingers bleed."]
},
75: {
  N5: ["<ruby>先生<rt>せんせい</rt></ruby>が<ruby>文法<rt>ぶんぽう</rt></ruby>を<ruby>説明<rt>せつめい</rt></ruby>します。","The teacher explains the grammar."],
  N4: ["よく<ruby>分<rt>わ</rt></ruby>からないので、もう<ruby>一度<rt>いちど</rt></ruby><ruby>説明<rt>せつめい</rt></ruby>してください。","I don't understand well, so please explain it once more."],
  N3: ["<ruby>子供<rt>こども</rt></ruby>にも<ruby>分<rt>わ</rt></ruby>かるように<ruby>説明<rt>せつめい</rt></ruby>すれば、<ruby>難<rt>むずか</rt></ruby>しい<ruby>話<rt>はなし</rt></ruby>でも<ruby>伝<rt>つた</rt></ruby>わるはずだ。","If you explain it so that even a child can understand, even a difficult topic should get across."],
  N2: ["データを<ruby>示<rt>しめ</rt></ruby>しながら<ruby>論理的<rt>ろんりてき</rt></ruby>に<ruby>説明<rt>せつめい</rt></ruby>したとおり、この<ruby>方法<rt>ほうほう</rt></ruby>が<ruby>最<rt>もっと</rt></ruby>も<ruby>効率的<rt>こうりつてき</rt></ruby>なわけだ。","Just as I explained logically while presenting the data, this method is the most efficient."],
  N1: ["<ruby>不祥事<rt>ふしょうじ</rt></ruby>の<ruby>経緯<rt>けいい</rt></ruby>を<ruby>公<rt>おおやけ</rt></ruby>の<ruby>場<rt>ば</rt></ruby>で<ruby>説明<rt>せつめい</rt></ruby>するともなれば、<ruby>一語<rt>いちご</rt></ruby><ruby>一語<rt>いちご</rt></ruby>に<ruby>細心<rt>さいしん</rt></ruby>の<ruby>注意<rt>ちゅうい</rt></ruby>を<ruby>払<rt>はら</rt></ruby>わざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to explaining the circumstances of a scandal in public, one cannot help but pay the utmost attention to every single word."]
},
76: {
  N5: ["<ruby>食事<rt>しょくじ</rt></ruby>の<ruby>前<rt>まえ</rt></ruby>に<ruby>手<rt>て</rt></ruby>を<ruby>洗<rt>あら</rt></ruby>います。","I wash my hands before meals."],
  N4: ["<ruby>外<rt>そと</rt></ruby>から<ruby>帰<rt>かえ</rt></ruby>ってきたら、<ruby>手<rt>て</rt></ruby>を<ruby>洗<rt>あら</rt></ruby>ってから<ruby>食<rt>た</rt></ruby>べてください。","When you get home from outside, please wash your hands before eating."],
  N3: ["<ruby>母<rt>はは</rt></ruby>に<ruby>頼<rt>たの</rt></ruby>まれて、<ruby>汚<rt>よご</rt></ruby>れた<ruby>食器<rt>しょっき</rt></ruby>を<ruby>全部<rt>ぜんぶ</rt></ruby><ruby>洗<rt>あら</rt></ruby>わされた。","Asked by my mother, I was made to wash all the dirty dishes."],
  N2: ["<ruby>油<rt>あぶら</rt></ruby>がこびりついた<ruby>鍋<rt>なべ</rt></ruby>は、ぬるま<ruby>湯<rt>ゆ</rt></ruby>に<ruby>浸<rt>つ</rt></ruby>けておくうちに<ruby>洗<rt>あら</rt></ruby>いやすくなる。","A pot caked with grease becomes easier to wash while it soaks in lukewarm water."],
  N1: ["<ruby>過去<rt>かこ</rt></ruby>のしがらみから<ruby>足<rt>あし</rt></ruby>を<ruby>洗<rt>あら</rt></ruby>うともなると、<ruby>相応<rt>そうおう</rt></ruby>の<ruby>覚悟<rt>かくご</rt></ruby>と<ruby>犠牲<rt>ぎせい</rt></ruby>を<ruby>払<rt>はら</rt></ruby>わざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to washing one's hands of past entanglements, one cannot help but pay a commensurate resolve and sacrifice."]
},
77: {
  N5: ["ナイフでパンを<ruby>切<rt>き</rt></ruby>ります。","I cut the bread with a knife."],
  N4: ["<ruby>料理<rt>りょうり</rt></ruby>を<ruby>作<rt>つく</rt></ruby>るとき、<ruby>野菜<rt>やさい</rt></ruby>を<ruby>細<rt>こま</rt></ruby>かく<ruby>切<rt>き</rt></ruby>ってください。","When you make the dish, please cut the vegetables finely."],
  N3: ["<ruby>急<rt>いそ</rt></ruby>いでいたので、<ruby>指<rt>ゆび</rt></ruby>を<ruby>切<rt>き</rt></ruby>ってしまって<ruby>血<rt>ち</rt></ruby>が<ruby>出<rt>で</rt></ruby>た。","I was in a hurry, so I ended up cutting my finger and it bled."],
  N2: ["<ruby>交渉<rt>こうしょう</rt></ruby>が<ruby>難航<rt>なんこう</rt></ruby>している<ruby>以上<rt>いじょう</rt></ruby>、ここで<ruby>関係<rt>かんけい</rt></ruby>を<ruby>切<rt>き</rt></ruby>るのもやむを<ruby>得<rt>え</rt></ruby>ないだろう。","Since the negotiations are deadlocked, severing the relationship here is probably unavoidable too."],
  N1: ["<ruby>長年<rt>ながねん</rt></ruby><ruby>築<rt>きず</rt></ruby>いた<ruby>絆<rt>きずな</rt></ruby>を<ruby>自<rt>みずか</rt></ruby>ら<ruby>断<rt>た</rt></ruby>ち<ruby>切<rt>き</rt></ruby>るともなれば、<ruby>断腸<rt>だんちょう</rt></ruby>の<ruby>思<rt>おも</rt></ruby>いを<ruby>抱<rt>いだ</rt></ruby>かざるを<ruby>得<rt>え</rt></ruby>まい。","When it comes to severing with one's own hands a bond built over many years, one surely cannot help but harbor heartrending sorrow."]
},
78: {
  N5: ["<ruby>母<rt>はは</rt></ruby>は<ruby>毎日<rt>まいにち</rt></ruby><ruby>料理<rt>りょうり</rt></ruby>します。","My mother cooks every day."],
  N4: ["<ruby>友<rt>とも</rt></ruby>だちと<ruby>話<rt>はな</rt></ruby>しながら、<ruby>一緒<rt>いっしょ</rt></ruby>に<ruby>料理<rt>りょうり</rt></ruby>するのは<ruby>楽<rt>たの</rt></ruby>しいです。","Cooking together while chatting with friends is fun."],
  N3: ["レシピを<ruby>見<rt>み</rt></ruby>ながら<ruby>練習<rt>れんしゅう</rt></ruby>したら、おいしく<ruby>料理<rt>りょうり</rt></ruby>できるようになった。","After practicing while looking at recipes, I became able to cook deliciously."],
  N2: ["<ruby>新鮮<rt>しんせん</rt></ruby>な<ruby>食材<rt>しょくざい</rt></ruby>を<ruby>使<rt>つか</rt></ruby>うばかりでなく、<ruby>手間<rt>てま</rt></ruby>を<ruby>惜<rt>お</rt></ruby>しまず<ruby>料理<rt>りょうり</rt></ruby>してこそ、<ruby>本当<rt>ほんとう</rt></ruby>の<ruby>味<rt>あじ</rt></ruby>が<ruby>出<rt>で</rt></ruby>る。","Not only by using fresh ingredients but by cooking without sparing any effort does the true flavor emerge."],
  N1: ["<ruby>一流<rt>いちりゅう</rt></ruby>の<ruby>料亭<rt>りょうてい</rt></ruby>の<ruby>板前<rt>いたまえ</rt></ruby>ともなると、<ruby>素材<rt>そざい</rt></ruby>の<ruby>持<rt>も</rt></ruby>ち<ruby>味<rt>あじ</rt></ruby>を<ruby>極限<rt>きょくげん</rt></ruby>まで<ruby>引<rt>ひ</rt></ruby>き<ruby>出<rt>だ</rt></ruby>すべく<ruby>料理<rt>りょうり</rt></ruby>するを<ruby>常<rt>つね</rt></ruby>とする。","When it comes to the head chef of a first-class restaurant, it is their habit to cook so as to draw out the inherent qualities of the ingredients to the very limit."]
},
79: {
  N5: ["レジでお<ruby>金<rt>かね</rt></ruby>を<ruby>払<rt>はら</rt></ruby>います。","I pay the money at the register."],
  N4: ["カードがないので、<ruby>現金<rt>げんきん</rt></ruby>で<ruby>払<rt>はら</rt></ruby>ってもいいですか。","I don't have a card, so may I pay in cash?"],
  N3: ["<ruby>財布<rt>さいふ</rt></ruby>を<ruby>忘<rt>わす</rt></ruby>れてしまったので、<ruby>友<rt>とも</rt></ruby>だちに<ruby>払<rt>はら</rt></ruby>ってもらった。","I forgot my wallet, so I had my friend pay for me."],
  N2: ["<ruby>契約書<rt>けいやくしょ</rt></ruby>に<ruby>記<rt>しる</rt></ruby>されたとおり、<ruby>期日<rt>きじつ</rt></ruby>までに<ruby>全額<rt>ぜんがく</rt></ruby>を<ruby>払<rt>はら</rt></ruby>わなければならないわけだ。","Just as stated in the contract, the full amount must be paid by the due date."],
  N1: ["<ruby>巨額<rt>きょがく</rt></ruby>の<ruby>賠償金<rt>ばいしょうきん</rt></ruby>を<ruby>払<rt>はら</rt></ruby>うことを<ruby>余儀<rt>よぎ</rt></ruby>なくされ、<ruby>会社<rt>かいしゃ</rt></ruby>は<ruby>倒産<rt>とうさん</rt></ruby>の<ruby>危機<rt>きき</rt></ruby>に<ruby>瀕<rt>ひん</rt></ruby>した。","Compelled to pay an enormous sum in damages, the company teetered on the brink of bankruptcy."]
},
80: {
  N5: ["あの<ruby>店<rt>みせ</rt></ruby>は<ruby>花<rt>はな</rt></ruby>を<ruby>売<rt>う</rt></ruby>ります。","That shop sells flowers."],
  N4: ["<ruby>古<rt>ふる</rt></ruby>い<ruby>本<rt>ほん</rt></ruby>はもういらないから、<ruby>売<rt>う</rt></ruby>りたいです。","I don't need my old books anymore, so I want to sell them."],
  N3: ["その<ruby>商品<rt>しょうひん</rt></ruby>はテレビで<ruby>紹介<rt>しょうかい</rt></ruby>されてから、<ruby>飛<rt>と</rt></ruby>ぶように<ruby>売<rt>う</rt></ruby>れるようになった。","After that product was featured on TV, it came to sell like hotcakes."],
  N2: ["<ruby>不景気<rt>ふけいき</rt></ruby>のうちに<ruby>在庫<rt>ざいこ</rt></ruby>を<ruby>安<rt>やす</rt></ruby>く<ruby>売<rt>う</rt></ruby>ってしまうのは、<ruby>賢明<rt>けんめい</rt></ruby>な<ruby>判断<rt>はんだん</rt></ruby>とは<ruby>言<rt>い</rt></ruby>い<ruby>難<rt>がた</rt></ruby>い。","It is hard to call it a wise decision to sell off inventory cheaply while the economy is in a slump."],
  N1: ["<ruby>経営<rt>けいえい</rt></ruby><ruby>難<rt>なん</rt></ruby>に<ruby>陥<rt>おちい</rt></ruby>った<ruby>以上<rt>いじょう</rt></ruby>、<ruby>先祖<rt>せんぞ</rt></ruby><ruby>代々<rt>だいだい</rt></ruby>の<ruby>土地<rt>とち</rt></ruby>を<ruby>売<rt>う</rt></ruby>り<ruby>渡<rt>わた</rt></ruby>すことを<ruby>余儀<rt>よぎ</rt></ruby>なくされた。","Having fallen into management difficulties, they were compelled to sell off the land handed down through generations of ancestors."]
},
81: {
  N5: ["<ruby>友<rt>とも</rt></ruby>だちにペンを<ruby>貸<rt>か</rt></ruby>します。","I lend a pen to my friend."],
  N4: ["お<ruby>金<rt>かね</rt></ruby>が<ruby>足<rt>た</rt></ruby>りないので、<ruby>少<rt>すこ</rt></ruby>し<ruby>貸<rt>か</rt></ruby>してくれませんか。","I don't have enough money, so could you lend me a little?"],
  N3: ["<ruby>傘<rt>かさ</rt></ruby>を<ruby>持<rt>も</rt></ruby>っていなかったら、<ruby>隣<rt>となり</rt></ruby>の<ruby>人<rt>ひと</rt></ruby>が<ruby>貸<rt>か</rt></ruby>してくれて<ruby>助<rt>たす</rt></ruby>かった。","I didn't have an umbrella, and the person next to me lent me theirs, which was a great help."],
  N2: ["<ruby>信頼<rt>しんらい</rt></ruby>できる<ruby>相手<rt>あいて</rt></ruby>でない<ruby>限<rt>かぎ</rt></ruby>り、<ruby>大金<rt>たいきん</rt></ruby>を<ruby>貸<rt>か</rt></ruby>すべきではないわけだ。","Unless the other party is someone you can trust, you should not lend a large sum of money."],
  N1: ["<ruby>窮地<rt>きゅうち</rt></ruby>に<ruby>立<rt>た</rt></ruby>たされた<ruby>旧友<rt>きゅうゆう</rt></ruby>に<ruby>手<rt>て</rt></ruby>を<ruby>貸<rt>か</rt></ruby>さずにはいられず、<ruby>全財産<rt>ぜんざいさん</rt></ruby>を<ruby>投<rt>とう</rt></ruby>じるに<ruby>至<rt>いた</rt></ruby>った。","Unable to keep from lending a hand to an old friend driven into a corner, I went so far as to throw in my entire fortune."]
},
82: {
  N5: ["<ruby>本<rt>ほん</rt></ruby>を<ruby>借<rt>か</rt></ruby>りました。","I borrowed a book."],
  N4: ["<ruby>図書館<rt>としょかん</rt></ruby>でお<ruby>金<rt>かね</rt></ruby>について<ruby>本<rt>ほん</rt></ruby>を<ruby>借<rt>か</rt></ruby>りたいので、カードを<ruby>作<rt>つく</rt></ruby>りました。","I made a card because I want to borrow a book about money at the library."],
  N3: ["<ruby>友<rt>とも</rt></ruby>だちに<ruby>借<rt>か</rt></ruby>りた<ruby>傘<rt>かさ</rt></ruby>をなくしてしまって、とても<ruby>困<rt>こま</rt></ruby>っています。","I lost the umbrella I borrowed from my friend, so I'm really troubled."],
  N2: ["<ruby>必要<rt>ひつよう</rt></ruby>な<ruby>資金<rt>しきん</rt></ruby>を<ruby>銀行<rt>ぎんこう</rt></ruby>から<ruby>借<rt>か</rt></ruby>りないかぎり、この<ruby>計画<rt>けいかく</rt></ruby>は<ruby>実現<rt>じつげん</rt></ruby>し<ruby>得<rt>え</rt></ruby>ない。","Unless we borrow the necessary funds from the bank, this plan cannot be realized."],
  N1: ["<ruby>事業<rt>じぎょう</rt></ruby>を<ruby>立<rt>た</rt></ruby>て<ruby>直<rt>なお</rt></ruby>すためには、たとえ<ruby>高<rt>たか</rt></ruby>い<ruby>金利<rt>きんり</rt></ruby>であろうと<ruby>多額<rt>たがく</rt></ruby>の<ruby>資金<rt>しきん</rt></ruby>を<ruby>借<rt>か</rt></ruby>りざるを<ruby>得<rt>え</rt></ruby>なかった。","In order to rebuild the business, we had no choice but to borrow a large sum of capital, however high the interest rate was."]
},
83: {
  N5: ["<ruby>母<rt>はは</rt></ruby>にメールを<ruby>送<rt>おく</rt></ruby>ります。","I will send an email to my mother."],
  N4: ["<ruby>駅<rt>えき</rt></ruby>まで<ruby>友<rt>とも</rt></ruby>だちを<ruby>送<rt>おく</rt></ruby>ってから、<ruby>家<rt>いえ</rt></ruby>に<ruby>帰<rt>かえ</rt></ruby>りました。","After seeing my friend off to the station, I went home."],
  N3: ["<ruby>祖母<rt>そぼ</rt></ruby>が<ruby>送<rt>おく</rt></ruby>ってくれた<ruby>荷物<rt>にもつ</rt></ruby>が、やっと<ruby>届<rt>とど</rt></ruby>くようになりました。","The packages my grandmother sends have finally started arriving."],
  N2: ["<ruby>担当者<rt>たんとうしゃ</rt></ruby>は<ruby>書類<rt>しょるい</rt></ruby>を<ruby>送<rt>おく</rt></ruby>ったとおりに、<ruby>手続<rt>てつづ</rt></ruby>きが<ruby>進<rt>すす</rt></ruby>められた。","The procedures were carried out exactly as the person in charge had sent the documents."],
  N1: ["<ruby>恩師<rt>おんし</rt></ruby>を<ruby>見送<rt>みおく</rt></ruby>るにあたり、<ruby>感謝<rt>かんしゃ</rt></ruby>の<ruby>言葉<rt>ことば</rt></ruby>を<ruby>送<rt>おく</rt></ruby>らずにはいられなかった。","On the occasion of seeing off my mentor, I could not help but send words of gratitude."]
},
84: {
  N5: ["<ruby>先生<rt>せんせい</rt></ruby>が<ruby>日本語<rt>にほんご</rt></ruby>を<ruby>教<rt>おし</rt></ruby>えます。","The teacher teaches Japanese."],
  N4: ["<ruby>姉<rt>あね</rt></ruby>は<ruby>料理<rt>りょうり</rt></ruby>が<ruby>上手<rt>じょうず</rt></ruby>なので、よく<ruby>作<rt>つく</rt></ruby>り<ruby>方<rt>かた</rt></ruby>を<ruby>教<rt>おし</rt></ruby>えてくれます。","My older sister is good at cooking, so she often teaches me how to make things."],
  N3: ["<ruby>子供<rt>こども</rt></ruby>に<ruby>教<rt>おし</rt></ruby>えているうちに、<ruby>自分<rt>じぶん</rt></ruby>も<ruby>正<rt>ただ</rt></ruby>しく<ruby>説明<rt>せつめい</rt></ruby>できるようになった。","While teaching the children, I myself became able to explain things correctly."],
  N2: ["<ruby>経験豊富<rt>けいけんほうふ</rt></ruby>な<ruby>彼<rt>かれ</rt></ruby>が<ruby>教<rt>おし</rt></ruby>えてくれるなら、<ruby>成功<rt>せいこう</rt></ruby>するに<ruby>違<rt>ちが</rt></ruby>いない。","If someone as experienced as he is teaches us, we are bound to succeed."],
  N1: ["<ruby>後進<rt>こうしん</rt></ruby>に<ruby>技術<rt>ぎじゅつ</rt></ruby>を<ruby>教<rt>おし</rt></ruby>えることこそ、<ruby>熟練<rt>じゅくれん</rt></ruby>した<ruby>職人<rt>しょくにん</rt></ruby>の<ruby>使命<rt>しめい</rt></ruby>にほかならない。","Teaching one's skills to the next generation is precisely the mission of a seasoned craftsman."]
},
85: {
  N5: ["わたしはピアノを<ruby>習<rt>なら</rt></ruby>います。","I learn the piano."],
  N4: ["<ruby>子供<rt>こども</rt></ruby>のとき、<ruby>母<rt>はは</rt></ruby>から<ruby>書道<rt>しょどう</rt></ruby>を<ruby>習<rt>なら</rt></ruby>ったことがあります。","When I was a child, I learned calligraphy from my mother."],
  N3: ["<ruby>先輩<rt>せんぱい</rt></ruby>に<ruby>習<rt>なら</rt></ruby>った<ruby>方法<rt>ほうほう</rt></ruby>を<ruby>使<rt>つか</rt></ruby>えば、もっと<ruby>速<rt>はや</rt></ruby>くできるようになる。","If you use the method you were taught by your senior, you'll be able to do it faster."],
  N2: ["<ruby>専門家<rt>せんもんか</rt></ruby>から<ruby>直接<rt>ちょくせつ</rt></ruby><ruby>習<rt>なら</rt></ruby>えるうちに、できるだけ<ruby>多<rt>おお</rt></ruby>くを<ruby>吸収<rt>きゅうしゅう</rt></ruby>しておきたい。","While I can still learn directly from an expert, I want to absorb as much as possible."],
  N1: ["<ruby>名匠<rt>めいしょう</rt></ruby>のもとで<ruby>習<rt>なら</rt></ruby>えばこそ、これほどまでに<ruby>洗練<rt>せんれん</rt></ruby>された<ruby>技<rt>わざ</rt></ruby>を<ruby>身<rt>み</rt></ruby>につけられたのだ。","It is precisely because I learned under a master that I could acquire such refined skills."]
},
86: {
  N5: ["きのうのことを<ruby>思<rt>おも</rt></ruby>い<ruby>出<rt>だ</rt></ruby>します。","I remember what happened yesterday."],
  N4: ["この<ruby>歌<rt>うた</rt></ruby>を<ruby>聞<rt>き</rt></ruby>くと、<ruby>昔<rt>むかし</rt></ruby>のことを<ruby>思<rt>おも</rt></ruby>い<ruby>出<rt>だ</rt></ruby>して、<ruby>少<rt>すこ</rt></ruby>し<ruby>悲<rt>かな</rt></ruby>しくなります。","When I hear this song, I remember the old days and become a little sad."],
  N3: ["<ruby>大切<rt>たいせつ</rt></ruby>な<ruby>約束<rt>やくそく</rt></ruby>を<ruby>思<rt>おも</rt></ruby>い<ruby>出<rt>だ</rt></ruby>せなくて、<ruby>困<rt>こま</rt></ruby>ってしまった。","I couldn't remember an important promise, and I ended up troubled."],
  N2: ["<ruby>当時<rt>とうじ</rt></ruby>の<ruby>苦労<rt>くろう</rt></ruby>を<ruby>思<rt>おも</rt></ruby>い<ruby>出<rt>だ</rt></ruby>すたびに、<ruby>今<rt>いま</rt></ruby>の<ruby>幸<rt>しあわ</rt></ruby>せをありがたく<ruby>感<rt>かん</rt></ruby>じずにはいられない。","Every time I recall the hardships of those days, I cannot help but feel grateful for my present happiness."],
  N1: ["<ruby>故郷<rt>こきょう</rt></ruby>の<ruby>風景<rt>ふうけい</rt></ruby>を<ruby>思<rt>おも</rt></ruby>い<ruby>出<rt>だ</rt></ruby>すにつけ、<ruby>胸<rt>むね</rt></ruby>に<ruby>込<rt>こ</rt></ruby>み<ruby>上<rt>あ</rt></ruby>げる<ruby>郷愁<rt>きょうしゅう</rt></ruby>を<ruby>抑<rt>おさ</rt></ruby>え<ruby>得<rt>え</rt></ruby>なかった。","Whenever I recalled the scenery of my hometown, I could not suppress the welling nostalgia in my heart."]
},
87: {
  N5: ["<ruby>今日<rt>きょう</rt></ruby>はとても<ruby>寒<rt>さむ</rt></ruby>く<ruby>感<rt>かん</rt></ruby>じます。","Today feels very cold."],
  N4: ["この<ruby>映画<rt>えいが</rt></ruby>を<ruby>見<rt>み</rt></ruby>てから、<ruby>家族<rt>かぞく</rt></ruby>の<ruby>大切<rt>たいせつ</rt></ruby>さを<ruby>強<rt>つよ</rt></ruby>く<ruby>感<rt>かん</rt></ruby>じました。","After watching this movie, I strongly felt the importance of family."],
  N3: ["<ruby>初<rt>はじ</rt></ruby>めて<ruby>人前<rt>ひとまえ</rt></ruby>で<ruby>話<rt>はな</rt></ruby>したとき、<ruby>大<rt>おお</rt></ruby>きな<ruby>不安<rt>ふあん</rt></ruby>を<ruby>感<rt>かん</rt></ruby>じてしまった。","The first time I spoke in front of people, I ended up feeling great anxiety."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>の<ruby>態度<rt>たいど</rt></ruby>からは、<ruby>言葉<rt>ことば</rt></ruby>ばかりでなく<ruby>行動<rt>こうどう</rt></ruby>にも<ruby>誠意<rt>せいい</rt></ruby>を<ruby>感<rt>かん</rt></ruby>じることができた。","From his attitude, I could feel sincerity not only in his words but also in his actions."],
  N1: ["<ruby>戦地<rt>せんち</rt></ruby>からの<ruby>報告<rt>ほうこく</rt></ruby>には、<ruby>正視<rt>せいし</rt></ruby>するに<ruby>堪<rt>た</rt></ruby>えない<ruby>悲惨<rt>ひさん</rt></ruby>さを<ruby>感<rt>かん</rt></ruby>じざるを<ruby>得<rt>え</rt></ruby>なかった。","In the reports from the battlefield, I could not help but feel a misery too painful to look upon directly."]
},
88: {
  N5: ["お<ruby>金<rt>かね</rt></ruby>がなくて<ruby>困<rt>こま</rt></ruby>ります。","I'm troubled because I have no money."],
  N4: ["<ruby>道<rt>みち</rt></ruby>が<ruby>分<rt>わ</rt></ruby>からなくて<ruby>困<rt>こま</rt></ruby>っていたから、<ruby>駅員<rt>えきいん</rt></ruby>に<ruby>聞<rt>き</rt></ruby>きました。","I was troubled because I didn't know the way, so I asked a station attendant."],
  N3: ["<ruby>急<rt>きゅう</rt></ruby>に<ruby>仕事<rt>しごと</rt></ruby>を<ruby>頼<rt>たの</rt></ruby>まれて、どう<ruby>断<rt>ことわ</rt></ruby>ればいいか<ruby>困<rt>こま</rt></ruby>ってしまった。","I was suddenly asked to do work, and I ended up troubled about how to refuse."],
  N2: ["<ruby>規則<rt>きそく</rt></ruby>がころころ<ruby>変<rt>か</rt></ruby>わるので、<ruby>現場<rt>げんば</rt></ruby>の<ruby>社員<rt>しゃいん</rt></ruby>が<ruby>困<rt>こま</rt></ruby>っているわけだ。","The rules keep changing, which is precisely why the staff on site are troubled."],
  N1: ["<ruby>突然<rt>とつぜん</rt></ruby>の<ruby>規制<rt>きせい</rt></ruby>により、<ruby>多<rt>おお</rt></ruby>くの<ruby>業者<rt>ぎょうしゃ</rt></ruby>が<ruby>廃業<rt>はいぎょう</rt></ruby>を<ruby>余儀<rt>よぎ</rt></ruby>なくされ、<ruby>地域全体<rt>ちいきぜんたい</rt></ruby>が<ruby>困<rt>こま</rt></ruby>り<ruby>果<rt>は</rt></ruby>てている。","Due to the sudden regulations, many businesses were forced to shut down, and the entire region is utterly at a loss."]
},
89: {
  N5: ["<ruby>赤<rt>あか</rt></ruby>ちゃんが<ruby>泣<rt>な</rt></ruby>いています。","The baby is crying."],
  N4: ["<ruby>悲<rt>かな</rt></ruby>しい<ruby>映画<rt>えいが</rt></ruby>を<ruby>見<rt>み</rt></ruby>ながら、ずっと<ruby>泣<rt>な</rt></ruby>いていました。","I was crying the whole time while watching a sad movie."],
  N3: ["<ruby>叱<rt>しか</rt></ruby>られた<ruby>子供<rt>こども</rt></ruby>は、ついに<ruby>泣<rt>な</rt></ruby>き<ruby>出<rt>だ</rt></ruby>してしまった。","The child who was scolded finally burst into tears."],
  N2: ["<ruby>感動的<rt>かんどうてき</rt></ruby>な<ruby>結末<rt>けつまつ</rt></ruby>を<ruby>見<rt>み</rt></ruby>れば、<ruby>誰<rt>だれ</rt></ruby>でも<ruby>泣<rt>な</rt></ruby>き<ruby>得<rt>え</rt></ruby>るだろう。","Anyone could end up crying upon seeing such a moving ending."],
  N1: ["<ruby>愛<rt>あい</rt></ruby>する<ruby>者<rt>もの</rt></ruby>を<ruby>失<rt>うしな</rt></ruby>った<ruby>彼女<rt>かのじょ</rt></ruby>の<ruby>姿<rt>すがた</rt></ruby>は、<ruby>見<rt>み</rt></ruby>るに<ruby>堪<rt>た</rt></ruby>えないほど<ruby>泣<rt>な</rt></ruby>き<ruby>崩<rt>くず</rt></ruby>れていた。","Having lost her beloved, she had collapsed in tears to a degree almost too painful to watch."]
},
90: {
  N5: ["みんなで<ruby>楽<rt>たの</rt></ruby>しく<ruby>笑<rt>わら</rt></ruby>いました。","We all laughed happily together."],
  N4: ["<ruby>彼<rt>かれ</rt></ruby>の<ruby>話<rt>はなし</rt></ruby>はおもしろかったので、みんな<ruby>大<rt>おお</rt></ruby>きな<ruby>声<rt>こえ</rt></ruby>で<ruby>笑<rt>わら</rt></ruby>いました。","His story was funny, so everyone laughed loudly."],
  N3: ["<ruby>緊張<rt>きんちょう</rt></ruby>していた<ruby>彼女<rt>かのじょ</rt></ruby>も、いつの<ruby>間<rt>ま</rt></ruby>にか<ruby>自然<rt>しぜん</rt></ruby>に<ruby>笑<rt>わら</rt></ruby>えるようになった。","Even she, who had been nervous, came to be able to smile naturally before she knew it."],
  N2: ["どんなに<ruby>辛<rt>つら</rt></ruby>い<ruby>時<rt>とき</rt></ruby>でも<ruby>笑<rt>わら</rt></ruby>っていられる<ruby>人<rt>ひと</rt></ruby>は、<ruby>強<rt>つよ</rt></ruby>い<ruby>人<rt>ひと</rt></ruby>だと<ruby>言<rt>い</rt></ruby>えるわけだ。","A person who can keep smiling no matter how hard times are can indeed be called a strong person."],
  N1: ["<ruby>苦境<rt>くきょう</rt></ruby>にあってなお<ruby>泰然<rt>たいぜん</rt></ruby>と<ruby>笑<rt>わら</rt></ruby>える<ruby>人物<rt>じんぶつ</rt></ruby>ともなると、もはや<ruby>尊敬<rt>そんけい</rt></ruby>の<ruby>念<rt>ねん</rt></ruby>を<ruby>抱<rt>いだ</rt></ruby>かざるを<ruby>得<rt>え</rt></ruby>ない。","When it comes to a person who can still smile calmly even in adversity, one can only feel a sense of respect."]
},
91: {
  N5: ["<ruby>庭<rt>にわ</rt></ruby>に<ruby>旗<rt>はた</rt></ruby>を<ruby>立<rt>た</rt></ruby>てます。","I will put up a flag in the garden."],
  N4: ["<ruby>来年<rt>らいねん</rt></ruby>の<ruby>計画<rt>けいかく</rt></ruby>を<ruby>立<rt>た</rt></ruby>ててから、<ruby>貯金<rt>ちょきん</rt></ruby>を<ruby>始<rt>はじ</rt></ruby>めました。","After making next year's plan, I started saving money."],
  N3: ["<ruby>父<rt>ちち</rt></ruby>が<ruby>若<rt>わか</rt></ruby>いころに<ruby>立<rt>た</rt></ruby>てた<ruby>家<rt>いえ</rt></ruby>は、<ruby>今<rt>いま</rt></ruby>でも<ruby>大切<rt>たいせつ</rt></ruby>に<ruby>使<rt>つか</rt></ruby>われている。","The house my father built when he was young is still used with great care."],
  N2: ["<ruby>綿密<rt>めんみつ</rt></ruby>な<ruby>戦略<rt>せんりゃく</rt></ruby>を<ruby>立<rt>た</rt></ruby>てたとおりに<ruby>事<rt>こと</rt></ruby>が<ruby>運<rt>はこ</rt></ruby>べば、<ruby>勝利<rt>しょうり</rt></ruby>は<ruby>確実<rt>かくじつ</rt></ruby>だ。","If things proceed exactly as the meticulous strategy we devised, victory is certain."],
  N1: ["<ruby>国家<rt>こっか</rt></ruby>の<ruby>百年<rt>ひゃくねん</rt></ruby>の<ruby>計<rt>けい</rt></ruby>を<ruby>立<rt>た</rt></ruby>てるともなれば、<ruby>目先<rt>めさき</rt></ruby>の<ruby>利益<rt>りえき</rt></ruby>にとらわれてはなるまい。","When it comes to laying out a nation's plan for a hundred years, one must not be captivated by immediate gains."]
},
92: {
  N5: ["<ruby>部屋<rt>へや</rt></ruby>の<ruby>色<rt>いろ</rt></ruby>を<ruby>変<rt>か</rt></ruby>えます。","I will change the color of the room."],
  N4: ["<ruby>予定<rt>よてい</rt></ruby>を<ruby>変<rt>か</rt></ruby>えたいので、もう<ruby>一度<rt>いちど</rt></ruby><ruby>相談<rt>そうだん</rt></ruby>させてください。","I want to change the schedule, so please let me discuss it once more."],
  N3: ["<ruby>環境<rt>かんきょう</rt></ruby>を<ruby>変<rt>か</rt></ruby>えたら、<ruby>自然<rt>しぜん</rt></ruby>と<ruby>前向<rt>まえむ</rt></ruby>きに<ruby>考<rt>かんが</rt></ruby>えられるようになった。","After I changed my environment, I naturally became able to think positively."],
  N2: ["<ruby>世論<rt>せろん</rt></ruby>が<ruby>政策<rt>せいさく</rt></ruby>を<ruby>変<rt>か</rt></ruby>え<ruby>得<rt>え</rt></ruby>るということを、<ruby>政治家<rt>せいじか</rt></ruby>は<ruby>忘<rt>わす</rt></ruby>れてはならない。","Politicians must not forget that public opinion can change policy."],
  N1: ["<ruby>時代<rt>じだい</rt></ruby>の<ruby>要請<rt>ようせい</rt></ruby>に<ruby>応<rt>おう</rt></ruby>じて<ruby>体制<rt>たいせい</rt></ruby>を<ruby>変<rt>か</rt></ruby>えざるを<ruby>得<rt>え</rt></ruby>ないとはいえ、<ruby>理念<rt>りねん</rt></ruby>だけは<ruby>守<rt>まも</rt></ruby>り<ruby>抜<rt>ぬ</rt></ruby>くべきだ。","Although we are forced to change the system in response to the demands of the times, we should hold fast to our principles alone."]
},
93: {
  N5: ["<ruby>信号<rt>しんごう</rt></ruby>が<ruby>赤<rt>あか</rt></ruby>に<ruby>変<rt>か</rt></ruby>わりました。","The traffic light changed to red."],
  N4: ["<ruby>天気<rt>てんき</rt></ruby>が<ruby>急<rt>きゅう</rt></ruby>に<ruby>変<rt>か</rt></ruby>わったので、<ruby>傘<rt>かさ</rt></ruby>を<ruby>持<rt>も</rt></ruby>ってきました。","The weather changed suddenly, so I brought an umbrella."],
  N3: ["<ruby>留学<rt>りゅうがく</rt></ruby>してから、<ruby>彼<rt>かれ</rt></ruby>の<ruby>考<rt>かんが</rt></ruby>え<ruby>方<rt>かた</rt></ruby>は<ruby>大<rt>おお</rt></ruby>きく<ruby>変<rt>か</rt></ruby>わるようになった。","After studying abroad, his way of thinking came to change greatly."],
  N2: ["<ruby>状況<rt>じょうきょう</rt></ruby>は<ruby>刻々<rt>こっこく</rt></ruby>と<ruby>変<rt>か</rt></ruby>わっているのだから、<ruby>計画<rt>けいかく</rt></ruby>も<ruby>柔軟<rt>じゅうなん</rt></ruby>に<ruby>見直<rt>みなお</rt></ruby>すべきなわけだ。","The situation is changing moment by moment, which is precisely why the plan should be flexibly reviewed."],
  N1: ["<ruby>世<rt>よ</rt></ruby>の<ruby>価値観<rt>かちかん</rt></ruby>が<ruby>根本<rt>こんぽん</rt></ruby>から<ruby>変<rt>か</rt></ruby>わりつつある<ruby>今<rt>いま</rt></ruby>、<ruby>旧来<rt>きゅうらい</rt></ruby>の<ruby>常識<rt>じょうしき</rt></ruby>に<ruby>固執<rt>こしつ</rt></ruby>するわけにはいかない。","Now, when society's values are changing from the very foundations, we cannot afford to cling to old conventions."]
},
94: {
  N5: ["<ruby>電車<rt>でんしゃ</rt></ruby>が<ruby>駅<rt>えき</rt></ruby>に<ruby>止<rt>と</rt></ruby>まりました。","The train stopped at the station."],
  N4: ["<ruby>事故<rt>じこ</rt></ruby>があったから、バスがしばらく<ruby>止<rt>と</rt></ruby>まっていました。","Because there was an accident, the bus was stopped for a while."],
  N3: ["<ruby>目<rt>め</rt></ruby>の<ruby>前<rt>まえ</rt></ruby>で<ruby>急<rt>きゅう</rt></ruby>に<ruby>車<rt>くるま</rt></ruby>が<ruby>止<rt>と</rt></ruby>まってしまって、びっくりした。","A car suddenly stopped right in front of me, and I was startled."],
  N2: ["<ruby>機械<rt>きかい</rt></ruby>が<ruby>突然<rt>とつぜん</rt></ruby><ruby>止<rt>と</rt></ruby>まったところを<ruby>見<rt>み</rt></ruby>ると、<ruby>停電<rt>ていでん</rt></ruby>が<ruby>起<rt>お</rt></ruby>きたに<ruby>違<rt>ちが</rt></ruby>いない。","Judging from the fact that the machine stopped suddenly, there must have been a power outage."],
  N1: ["<ruby>心臓<rt>しんぞう</rt></ruby>が<ruby>止<rt>と</rt></ruby>まりかねないほどの<ruby>緊張<rt>きんちょう</rt></ruby>を<ruby>強<rt>し</rt></ruby>いられる<ruby>場面<rt>ばめん</rt></ruby>ともなると、<ruby>並<rt>なみ</rt></ruby>の<ruby>選手<rt>せんしゅ</rt></ruby>では<ruby>耐<rt>た</rt></ruby>えられまい。","When it comes to a scene that forces tension so great it could almost stop one's heart, an ordinary player could hardly endure it."]
},
95: {
  N5: ["<ruby>車<rt>くるま</rt></ruby>を<ruby>止<rt>と</rt></ruby>めてください。","Please stop the car."],
  N4: ["<ruby>駅<rt>えき</rt></ruby>の<ruby>前<rt>まえ</rt></ruby>に<ruby>車<rt>くるま</rt></ruby>を<ruby>止<rt>と</rt></ruby>めてから、<ruby>買<rt>か</rt></ruby>い<ruby>物<rt>もの</rt></ruby>に<ruby>行<rt>い</rt></ruby>きました。","I parked the car in front of the station and then went shopping."],
  N3: ["<ruby>急<rt>きゅう</rt></ruby>に<ruby>人<rt>ひと</rt></ruby>が<ruby>飛<rt>と</rt></ruby>び<ruby>出<rt>だ</rt></ruby>してきたので、あわてて<ruby>車<rt>くるま</rt></ruby>を<ruby>止<rt>と</rt></ruby>めてしまった。","A person suddenly jumped out, so I ended up stopping the car in a panic."],
  N2: ["ここは<ruby>駐車禁止<rt>ちゅうしゃきんし</rt></ruby>だから、<ruby>少<rt>すこ</rt></ruby>しの<ruby>間<rt>あいだ</rt></ruby>でも<ruby>車<rt>くるま</rt></ruby>を<ruby>止<rt>と</rt></ruby>めるわけにはいかない。","Parking is prohibited here, so we can't leave the car even for a short while."],
  N1: ["<ruby>沿道<rt>えんどう</rt></ruby>の<ruby>住民<rt>じゅうみん</rt></ruby>からの<ruby>苦情<rt>くじょう</rt></ruby>が<ruby>絶<rt>た</rt></ruby>えない<ruby>以上<rt>いじょう</rt></ruby>、この<ruby>路上<rt>ろじょう</rt></ruby>に<ruby>車<rt>くるま</rt></ruby>を<ruby>止<rt>と</rt></ruby>めるのは<ruby>差<rt>さ</rt></ruby>し<ruby>控<rt>ひか</rt></ruby>えざるを<ruby>得<rt>え</rt></ruby>ない。","Since the complaints from residents along the road never cease, we have no choice but to refrain from parking on this street."]
},
96: {
  N5: ["かぎを<ruby>探<rt>さが</rt></ruby>します。","I will look for my keys."],
  N4: ["なくした<ruby>財布<rt>さいふ</rt></ruby>を<ruby>一日中<rt>いちにちじゅう</rt></ruby><ruby>探<rt>さが</rt></ruby>したけど、<ruby>見<rt>み</rt></ruby>つかりませんでした。","I searched all day for the wallet I lost, but I couldn't find it."],
  N3: ["<ruby>条件<rt>じょうけん</rt></ruby>に<ruby>合<rt>あ</rt></ruby>うアパートを<ruby>探<rt>さが</rt></ruby>していたら、ようやく<ruby>気<rt>き</rt></ruby>に<ruby>入<rt>い</rt></ruby>る<ruby>部屋<rt>へや</rt></ruby>が<ruby>見<rt>み</rt></ruby>つかるようになった。","As I kept searching for an apartment that met my conditions, I finally started to find rooms I liked."],
  N2: ["<ruby>彼<rt>かれ</rt></ruby>は<ruby>給料<rt>きゅうりょう</rt></ruby>ばかりでなく、やりがいのある<ruby>仕事<rt>しごと</rt></ruby>を<ruby>探<rt>さが</rt></ruby>しているに<ruby>違<rt>ちが</rt></ruby>いない。","He must be searching not only for a good salary but for rewarding work."],
  N1: ["<ruby>真相<rt>しんそう</rt></ruby>を<ruby>突<rt>つ</rt></ruby>き<ruby>止<rt>と</rt></ruby>めようと<ruby>手<rt>て</rt></ruby>がかりを<ruby>探<rt>さが</rt></ruby>すうちに、<ruby>事件<rt>じけん</rt></ruby>はますます<ruby>複雑<rt>ふくざつ</rt></ruby>な<ruby>様相<rt>ようそう</rt></ruby>を<ruby>呈<rt>てい</rt></ruby>し<ruby>始<rt>はじ</rt></ruby>めた。","As I searched for clues in an attempt to get to the bottom of the truth, the case began to take on an increasingly complex aspect."]
},
97: {
  N5: ["いい<ruby>本<rt>ほん</rt></ruby>を<ruby>見<rt>み</rt></ruby>つけました。","I found a good book."],
  N4: ["インターネットで<ruby>調<rt>しら</rt></ruby>べてから、<ruby>安<rt>やす</rt></ruby>くていいホテルを<ruby>見<rt>み</rt></ruby>つけました。","After looking it up on the internet, I found a hotel that was cheap and good."],
  N3: ["<ruby>誰<rt>だれ</rt></ruby>にも<ruby>解<rt>と</rt></ruby>けなかった<ruby>問題<rt>もんだい</rt></ruby>の<ruby>答<rt>こた</rt></ruby>えを<ruby>見<rt>み</rt></ruby>つけたら、みんなに<ruby>褒<rt>ほ</rt></ruby>められた。","When I found the answer to the problem no one could solve, everyone praised me."],
  N2: ["<ruby>長年<rt>ながねん</rt></ruby><ruby>努力<rt>どりょく</rt></ruby>を<ruby>重<rt>かさ</rt></ruby>ねてきた<ruby>彼女<rt>かのじょ</rt></ruby>だからこそ、<ruby>自分<rt>じぶん</rt></ruby>に<ruby>合<rt>あ</rt></ruby>った<ruby>生<rt>い</rt></ruby>き<ruby>方<rt>かた</rt></ruby>を<ruby>見<rt>み</rt></ruby>つけ<ruby>得<rt>え</rt></ruby>たのだ。","It is precisely because she has accumulated effort over many years that she was able to find a way of life that suited her."],
  N1: ["<ruby>幾多<rt>いくた</rt></ruby>の<ruby>挫折<rt>ざせつ</rt></ruby>を<ruby>経<rt>へ</rt></ruby>た<ruby>者<rt>もの</rt></ruby>ともなると、<ruby>絶望<rt>ぜつぼう</rt></ruby>の<ruby>淵<rt>ふち</rt></ruby>においてもなお<ruby>一筋<rt>ひとすじ</rt></ruby>の<ruby>希望<rt>きぼう</rt></ruby>を<ruby>見<rt>み</rt></ruby>つけるものである。","When it comes to those who have endured countless setbacks, they can find a single ray of hope even at the abyss of despair."]
},
98: {
  N5: ["<ruby>傘<rt>かさ</rt></ruby>を<ruby>持<rt>も</rt></ruby>ってきます。","I will bring an umbrella."],
  N4: ["<ruby>明日<rt>あした</rt></ruby>は<ruby>寒<rt>さむ</rt></ruby>いから、<ruby>厚<rt>あつ</rt></ruby>い<ruby>上着<rt>うわぎ</rt></ruby>を<ruby>持<rt>も</rt></ruby>ってきたほうがいいですよ。","It will be cold tomorrow, so you should bring a thick jacket."],
  N3: ["<ruby>先生<rt>せんせい</rt></ruby>に<ruby>頼<rt>たの</rt></ruby>まれて、<ruby>資料<rt>しりょう</rt></ruby>を<ruby>職員室<rt>しょくいんしつ</rt></ruby>まで<ruby>持<rt>も</rt></ruby>ってきてしまった。","I was asked by the teacher and ended up bringing the materials all the way to the staff room."],
  N2: ["パーティーには<ruby>飲<rt>の</rt></ruby>み<ruby>物<rt>もの</rt></ruby>だけでなく、<ruby>手作<rt>てづく</rt></ruby>りの<ruby>料理<rt>りょうり</rt></ruby>も<ruby>持<rt>も</rt></ruby>ってくるとのことだ。","I hear that for the party they will bring not only drinks but also homemade dishes."],
  N1: ["<ruby>会議<rt>かいぎ</rt></ruby>の<ruby>席上<rt>せきじょう</rt></ruby>で<ruby>証拠<rt>しょうこ</rt></ruby>となる<ruby>書類<rt>しょるい</rt></ruby>を<ruby>持<rt>も</rt></ruby>ってこなかったがために、<ruby>彼<rt>かれ</rt></ruby>は<ruby>発言<rt>はつげん</rt></ruby>の<ruby>撤回<rt>てっかい</rt></ruby>を<ruby>余儀<rt>よぎ</rt></ruby>なくされた。","Because he failed to bring the documents that would serve as evidence to the meeting, he was forced to retract his statement."]
},
99: {
  N5: ["<ruby>子<rt>こ</rt></ruby>どもを<ruby>公園<rt>こうえん</rt></ruby>に<ruby>連<rt>つ</rt></ruby>れていきます。","I will take the children to the park."],
  N4: ["<ruby>妹<rt>いもうと</rt></ruby>が<ruby>行<rt>い</rt></ruby>きたがっているので、<ruby>映画館<rt>えいがかん</rt></ruby>に<ruby>連<rt>つ</rt></ruby>れていくつもりです。","My little sister wants to go, so I plan to take her to the movie theater."],
  N3: ["<ruby>祖母<rt>そぼ</rt></ruby>が<ruby>一人<rt>ひとり</rt></ruby>で<ruby>歩<rt>ある</rt></ruby>けなくなったので、<ruby>毎週<rt>まいしゅう</rt></ruby><ruby>病院<rt>びょういん</rt></ruby>へ<ruby>連<rt>つ</rt></ruby>れていくようになった。","Since my grandmother became unable to walk on her own, I have started taking her to the hospital every week."],
  N2: ["<ruby>子供<rt>こども</rt></ruby>を<ruby>連<rt>つ</rt></ruby>れていくとなると、<ruby>安全<rt>あんぜん</rt></ruby>な<ruby>経路<rt>けいろ</rt></ruby>を<ruby>事前<rt>じぜん</rt></ruby>に<ruby>確認<rt>かくにん</rt></ruby>しておくべきだろう。","If we are going to take the children along, we should probably confirm a safe route in advance."],
  N1: ["<ruby>被災地<rt>ひさいち</rt></ruby>の<ruby>視察<rt>しさつ</rt></ruby>がてら、<ruby>現地<rt>げんち</rt></ruby>の<ruby>事情<rt>じじょう</rt></ruby>に<ruby>精通<rt>せいつう</rt></ruby>した<ruby>専門家<rt>せんもんか</rt></ruby>を<ruby>連<rt>つ</rt></ruby>れていくことにした。","While inspecting the disaster-stricken area, I decided to take along an expert well versed in local conditions."]
},
100: {
  N5: ["<ruby>母<rt>はは</rt></ruby>を<ruby>手伝<rt>てつだ</rt></ruby>います。","I help my mother."],
  N4: ["<ruby>友達<rt>ともだち</rt></ruby>の<ruby>引<rt>ひ</rt></ruby>っ<ruby>越<rt>こ</rt></ruby>しを<ruby>手伝<rt>てつだ</rt></ruby>ったことがあります。","I have helped a friend with their move before."],
  N3: ["<ruby>忙<rt>いそが</rt></ruby>しそうな<ruby>同僚<rt>どうりょう</rt></ruby>を<ruby>見<rt>み</rt></ruby>ると、つい<ruby>仕事<rt>しごと</rt></ruby>を<ruby>手伝<rt>てつだ</rt></ruby>ってしまう。","Whenever I see a colleague who looks busy, I end up helping them with their work."],
  N2: ["<ruby>頼<rt>たの</rt></ruby>まれた<ruby>以上<rt>いじょう</rt></ruby>は、たとえ<ruby>忙<rt>いそが</rt></ruby>しくても<ruby>準備<rt>じゅんび</rt></ruby>を<ruby>手伝<rt>てつだ</rt></ruby>わないわけにはいかない。","Now that I have been asked, I cannot very well refuse to help with the preparations, even if I am busy."],
  N1: ["<ruby>恩師<rt>おんし</rt></ruby>のたっての<ruby>願<rt>ねが</rt></ruby>いとあれば、<ruby>多忙<rt>たぼう</rt></ruby>を<ruby>極<rt>きわ</rt></ruby>める<ruby>身<rt>み</rt></ruby>であろうとも、<ruby>研究<rt>けんきゅう</rt></ruby>の<ruby>整理<rt>せいり</rt></ruby>を<ruby>手伝<rt>てつだ</rt></ruby>わざるを<ruby>得<rt>え</rt></ruby>ない。","If it is the earnest request of my former teacher, then even if I am extremely busy, I have no choice but to help organize the research."]
}
};
