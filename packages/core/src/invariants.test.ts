import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The invariants are a gate, and a gate nobody has seen fail is not known to
 * work. Both of the ones checked here were written after something passed every
 * other stage: a raw NUL byte in a string literal compiled, bundled, tested and
 * shipped, and a front-end framework could have been named in the core for as
 * long as its name was missing from the list.
 *
 * They are exercised against a tree built for the purpose rather than against
 * this repository, because the only way to watch a gate fail here would be to
 * commit the very thing it forbids. The script takes `--root` and `--only` for
 * exactly this, and the tree is thrown away afterwards.
 *
 * This lives in the core because the core is what I1 guards and because it is
 * the only package in the invariant's own scope that runs tests.
 */
const SCRIPT = fileURLToPath(new URL('../../../scripts/invariants.sh', import.meta.url));

let root: string;

const write = (name: string, contents: string | Uint8Array): void => {
  writeFileSync(join(root, 'packages', 'core', 'src', name), contents);
};

const run = (only: string) =>
  spawnSync('bash', [SCRIPT, '--root', root, '--only', only], { encoding: 'utf8' });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'flowatlas-invariants-'));
  mkdirSync(join(root, 'packages', 'core', 'src'), { recursive: true });
  write('clean.ts', "export const name = 'orders';\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('I2, the control character gate', () => {
  it('fails on a raw NUL written into a source file', () => {
    // The byte itself, not its escape, which is how it got in: a string written
    // with a literal control character rather than with the escape for it. Built
    // from its code point here for the same reason the forbidden name below is
    // built from halves: a raw one written into this file would trip the gate
    // being tested, which is a thing this file has already watched happen.
    const nul = String.fromCharCode(0);
    write('broken.ts', `export const sep = "a${nul}b";\n`);
    const result = run('I2');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('broken.ts');
  });

  it('leaves a tab and a non-ASCII character alone', () => {
    // A tab indents, and the prose comments in this repository are full of
    // characters above the ASCII range. Either one flagged would make the gate
    // fail on every file and be turned off within a day.
    write('fine.ts', '\texport const dash = "an em dash — here";\n');
    expect(run('I2').status).toBe(0);
  });
});

/**
 * A name the gate forbids, spelled in pieces.
 *
 * This file lives under `packages/core/src`, which is the very directory I1
 * greps. Writing the name out would make the gate fail on the test that proves
 * the gate works, so the one place that has to say the word says it in halves.
 */
const FORBIDDEN_NAME = ['re', 'act'].join('');

describe('I1, the technology-agnostic gate', () => {
  it('fails on a front-end framework named in the core', () => {
    write('frontend.ts', `// reads a ${FORBIDDEN_NAME} component tree\nexport const read = () => 1;\n`);
    const result = run('I1');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('frontend.ts');
  });

  it('leaves a word that merely contains a forbidden name alone', () => {
    // `-w` is what makes this list usable at all: a longer word that happens to
    // start with a forbidden name is not that name.
    write('word.ts', `export const ${FORBIDDEN_NAME}ion = 1;\n`);
    expect(run('I1').status).toBe(0);
  });

  it('leaves `next` alone, because the list cannot carry that name', () => {
    // Word bounded, `next` is the ordinary English word the core uses for the
    // following element, in `trace.ts` and in `types/type-ref.ts`.
    write('walk.ts', 'export const step = (xs: number[]) => { const next = xs[0]; return next; };\n');
    expect(run('I1').status).toBe(0);
  });
});
