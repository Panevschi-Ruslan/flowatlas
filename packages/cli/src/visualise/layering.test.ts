import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The page's modules lean on the analysis and the model, never on a command
 * (P84): a command is a way to print an answer, and what the page shares with
 * one lives under `analysis/`. Tests may drive a command to compare with it.
 */
describe('layering', () => {
  it('no module under visualise/ imports from commands/', () => {
    const offenders = readdirSync(here)
      .filter((name) => /\.(ts|js)$/.test(name) && !name.includes('.test.'))
      .filter((name) => /from\s+['"]\.\.\/commands\//.test(readFileSync(join(here, name), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
