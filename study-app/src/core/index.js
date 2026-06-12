// Barrel for the pure-core modules. app.js does `import * as Core from './core/index.js'`
// then destructures the bare names it needs; the test imports the named exports directly.
export * from './srs.js';
export * from './forecast.js';
export * from './facets.js';
export * from './examples.js';
export * from './kana.js';
export * from './pitch.js';
export * from './text.js';
export * from './minna.js';
export * from './recordings.js';
export * from './audio.js';
export * from './selftalk.js';
