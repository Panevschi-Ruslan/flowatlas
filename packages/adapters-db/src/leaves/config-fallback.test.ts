import { Node, Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

const HEADER = `
declare const process: { env: Record<string, string | undefined> };
declare const configService: { get<T>(key: string, fallback?: T): T | undefined };
declare const fallbackValue: string;
`;

/** Every read of a setting in a sample, as `readConfig` reads it, the outermost read of each expression only. */
const readsIn = (text: string) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  const file = project.createSourceFile('/api/src/a.ts', `${HEADER}${text}`);
  const found: Array<{ key: string; defaultValue?: unknown; fallback?: true }> = [];
  file.forEachDescendant((node) => {
    if (!Node.isCallExpression(node) && !Node.isPropertyAccessExpression(node)) return;
    const read = readConfig(node);
    if (read === null || read.dynamic === true) return;
    found.push({ key: read.key, ...(read.defaultValue === undefined ? {} : { defaultValue: read.defaultValue }), ...(read.fallback === undefined ? {} : { fallback: read.fallback }) });
  });
  return found;
};

/** Whether a read goes on without its value (P388): what a key set nowhere is judged by. */
describe('a read of a setting that goes on without it', () => {
  it('is one with a default not written out, `??`, `||`, or a test of whether it is there', () => {
    expect(
      readsIn(`
        const a = configService.get('A', fallbackValue);
        const b = process.env.B ?? 'x';
        const c = process.env.C || fallbackValue;
        const d = process.env.D ? 1 : 2;
        if (process.env.E) {}
      `),
    ).toEqual([
      { key: 'A', fallback: true },
      { key: 'B', fallback: true },
      { key: 'C', fallback: true },
      { key: 'D', fallback: true },
      { key: 'E', fallback: true },
    ]);
  });

  it('is not one that needs the key set: a bare read, a refusal when it is missing', () => {
    expect(readsIn("const a = configService.get('A'); const b = process.env.B; if (!process.env.C) throw new Error('C');")).toEqual([
      { key: 'A' },
      { key: 'B' },
      { key: 'C' },
    ]);
    expect(readsIn("const a = configService.get('A', 'x');")).toEqual([{ key: 'A', defaultValue: 'x' }]);
  });
});
