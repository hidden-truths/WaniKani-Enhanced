// Thin re-export so main.js / cloud.js import the 鰐蟹 WaniKani package from the same
// flat features/ path as every other tab (the minna/selftalk/songs convention). The
// real module is the features/wanikani/ directory behind wanikani/index.js.
export * from './wanikani/index.js';
