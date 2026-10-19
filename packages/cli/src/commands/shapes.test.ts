import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { toPosixPath } from '@flowatlas/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runCantFollowCommand } from './doctor.js';
import { runShapesSuggest, shapeFileName, SHAPES_SUGGEST_FORMAT_VERSION } from './shapes.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'uninstalled-internal-packages');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');

const quiet = { out(): void {}, err(): void {}, tty: false };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the fixture read without an install', () => {
  it('leaves module-not-installed only for the package nothing stands in for', () => {
    const { report } = runCantFollowCommand({ config: CONFIG, cause: 'module-not-installed' }, quiet);
    expect(report.causes.flatMap((cause) => cause.packages.map((pkg) => pkg.package))).toEqual(['@acme/feature-flags']);
  });
});

describe('shapes --suggest', () => {
  it('lists the missing packages by places, with the names used of each', () => {
    const { report, text } = runShapesSuggest({ config: CONFIG, suggest: true }, quiet);
    expect(report.shapesSuggestFormatVersion).toBe(SHAPES_SUGGEST_FORMAT_VERSION);
    expect(report.packages.map((pkg) => pkg.package)).toEqual(['@acme/feature-flags']);
    const [flags] = report.packages;
    expect(flags).toMatchObject({ sites: 1, services: ['loans-api'], specifiers: ['@acme/feature-flags'], coveredBy: null });
    expect(flags?.exports).toEqual([
      expect.objectContaining({ name: 'FlagClient', kind: 'class', members: ['variant()'] }),
      expect.objectContaining({ name: 'isOn', kind: 'function' }),
    ]);
    expect(text).toContain('@acme/feature-flags: 1 place  loans-api');
    expect(report.shapeFiles).toEqual([
      { file: 'flowatlas-shapes/acme-queue-client.d.ts', declares: ['@acme/queue-client'], unread: null, unmatched: [] },
    ]);
  });

  it('prints the same as data, and narrows to one package', () => {
    const { text } = runShapesSuggest({ config: CONFIG, suggest: true, json: true, package: '@acme/nothing' }, quiet);
    expect(JSON.parse(text)).toMatchObject({ packages: [], total: { packages: 0, sites: 0 } });
  });

  it('marks a package the configuration already covers, so a rebuild is all it needs', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'flowatlas-shapes-covered-'));
    dirs.push(tmp);
    const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as Record<string, unknown> & { services: Array<{ repo: string }> };
    for (const service of config.services) service.repo = join(FIXTURE, service.repo);
    writeFileSync(join(tmp, 'flags.d.ts'), "declare module '@acme/feature-flags' { export function isOn(name: string): boolean; }\n");
    const covered = join(tmp, 'flowatlas.config.json');
    writeFileSync(
      covered,
      JSON.stringify({ ...config, shapes: [join(FIXTURE, 'flowatlas-shapes/*.d.ts'), './flags.d.ts'], output: join(FIXTURE, '.flowatlas') }),
    );
    const { report, text } = runShapesSuggest({ config: covered, suggest: true }, quiet);
    expect(report.packages[0]).toMatchObject({ package: '@acme/feature-flags', coveredBy: 'shape', coveredFrom: 'flags.d.ts' });
    expect(text).toContain('covered by the shape file flags.d.ts; rebuild to read it');
  });

  it('writes a starter shape per package with --out, names only, and never over a file', () => {
    const out = mkdtempSync(join(tmpdir(), 'flowatlas-shapes-out-'));
    dirs.push(out);
    const first = runShapesSuggest({ config: CONFIG, suggest: true, out }, quiet);
    const path = join(out, shapeFileName('@acme/feature-flags'));
    expect(first.report.written?.map((entry) => entry.packages)).toEqual([['@acme/feature-flags']]);
    // A glob for the configuration, so written with forward slashes on every platform.
    expect(first.report.listShapes).toBe(`${toPosixPath(out)}/*.d.ts`);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain("declare module '@acme/feature-flags' {");
    expect(text).toContain('variant(...args: any[]): any;');
    expect(text).not.toContain('fee-plan');
    writeFileSync(path, '// refined by hand\n');
    const again = runShapesSuggest({ config: CONFIG, suggest: true, out }, quiet);
    expect(again.report.kept?.length).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe('// refined by hand\n');
  });

  it('refuses to write into a repository the configuration reads', () => {
    const inside = join(FIXTURE, 'loans-api', 'shapes');
    expect(() => runShapesSuggest({ config: CONFIG, suggest: true, out: inside }, quiet)).toThrow(/inside the repository of loans-api/);
    expect(existsSync(inside)).toBe(false);
  });

  it('names a starter file after its package', () => {
    expect(shapeFileName('@acme/feature-flags')).toBe('acme-feature-flags.d.ts');
    expect(shapeFileName('left-pad')).toBe('left-pad.d.ts');
  });
});
