// 合格 JLPT tab — the "four papers" section grid, split out of view.js
// (refactor-jlpt-view-split, step 2). A self-contained HTML builder: each of the four exam
// sections (語彙 / 文法 / 読解 / 聴解) mapped to the app surface that trains it, with go-* nav
// chips (the handlers stay in view.js's ACTIONS table). No view state, no signals — just
// the target level for the copy.
export function sectionsHtml(store) {
  const cards = [
    {
      jp: '語彙', en: 'Vocabulary & Kanji', icon: 'i-cards',
      copy: 'Daily SRS both sides: WaniKani for kanji recognition, this deck for recall. Leeches are the highest-value fixes — same-kanji families live on the 鰐蟹 tab.',
      links: [
        { act: 'go-due', label: 'Review due cards' },
        { act: 'go-wanikani', label: '鰐蟹 leeches' },
      ],
    },
    {
      jp: '文法', en: 'Grammar', icon: 'i-book',
      copy: 'One point a day, seen in real sentences. The Browse grammar facet filters your cards to sentences that use a point; 教科書 lessons introduce new ones in order.',
      links: [
        { act: 'go-grammar', label: 'Browse by grammar' },
        { act: 'go-minna', label: '教科書 lessons' },
      ],
    },
    {
      jp: '読解', en: 'Reading', icon: 'i-eye',
      copy: 'Read Japanese you half-know: lesson passages and song lyrics with furigana off, tap only the words that stop you. Volume matters more than difficulty.',
      links: [
        { act: 'go-minna', label: 'Lesson reading' },
        { act: 'go-songs', label: '歌 Read mode' },
      ],
    },
    {
      jp: '聴解', en: 'Listening', icon: 'i-headphones',
      copy: 'Dictation is the sharpest listening drill: 歌 Listen blanks a line, you type what you hear. Shadowing the same line then trains the mouth on what the ear caught.',
      links: [
        { act: 'go-songs', label: '歌 Listen & Shadow' },
        { act: 'go-selftalk', label: '独り言 speaking' },
      ],
    },
  ];
  const grid = cards.map((c) => `<div class="jl-section">
      <div class="jl-section-head"><span class="jl-section-jp jp-min">${c.jp}</span><b>${c.en}</b><svg class="ic" aria-hidden="true"><use href="#${c.icon}"/></svg></div>
      <p>${c.copy}</p>
      <div class="jl-section-links">${c.links.map((l) => `<button class="chip jl-go" data-jl-act="${l.act}">${l.label}</button>`).join('')}</div>
    </div>`).join('');
  return `<section class="jl-card jl-sections-card">
    <div class="jl-card-head"><div><h2 class="title">The four papers</h2>
      <div class="sub">every ${store.level} section, mapped to the surface that trains it${store.level !== 'N3' ? ' · guidance copy is tuned for N3 for now' : ''}</div></div></div>
    <div class="jl-sections">${grid}</div>
  </section>`;
}
