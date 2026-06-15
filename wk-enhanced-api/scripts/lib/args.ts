// Tiny shared argv parser for the operator scripts. `arg('--x')` returns the value after
// `--x` (or undefined); `has('--x')` is a presence flag. Kept in one place so the scripts
// that parse flags don't each carry an identical copy.

export const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
};

export const has = (name: string) => process.argv.includes(name);
