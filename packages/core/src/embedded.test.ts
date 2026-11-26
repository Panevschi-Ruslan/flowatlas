import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { afterAll, describe, expect, it } from 'vitest';
import { addEmbeddedScripts, blankOutside, type EmbeddedFormat } from './embedded.js';
import { makeSymbolId, normalizeFilePath } from './ids.js';

const dir = mkdtempSync(join(tmpdir(), 'flowatlas-embedded-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A format whose script is everything between `<<` and `>>`. */
const FORMAT: EmbeddedFormat = {
  extension: '.part',
  scripts: (text) => ({ ranges: [[text.indexOf('<<') + 2, text.indexOf('>>')]], tail: 'const tail = 1;' }),
};

describe('scripts written inside files of another format (P233)', () => {
  it('blanks everything outside the scripts and keeps every line and offset', () => {
    expect(blankOutside('ab<<x\ny>>cd\r\nef', [[4, 7]])).toBe('    x\ny    \r\n  ');
  });

  it('makes a file for the checker, named everywhere as the file it was made from', () => {
    writeFileSync(join(dir, 'page.part'), 'markup <<\nexport function go(): number { return 1; }\n>> more markup\n');
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const [made] = addEmbeddedScripts(project, dir, ['page.part'], [FORMAT]);
    expect(made?.file).toBe('page.part');
    const go = made?.sourceFile.getFunction('go');
    expect(go?.getStartLineNumber()).toBe(2);
    expect(normalizeFilePath(made?.sourceFile.getFilePath() as string, dir)).toBe('page.part');
    expect(makeSymbolId('web', normalizeFilePath(go?.getSourceFile().getFilePath() as string, dir), 'go')).toBe('web#page.part:go');
    // The tail follows the file's own lines, where no position of it is.
    expect(made?.sourceFile.getVariableDeclaration('tail')?.getStartLineNumber()).toBe(5);
  });

  it('leaves a file alone whose made-up name is a real file', () => {
    writeFileSync(join(dir, 'real.part'), '<<const a = 1;>>');
    writeFileSync(join(dir, 'real.part.ts'), 'export const b = 2;\n');
    expect(addEmbeddedScripts(new Project({ skipAddingFilesFromTsConfig: true }), dir, ['real.part'], [FORMAT])).toEqual([]);
  });
});
