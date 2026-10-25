#!/usr/bin/env node
/**
 * Measures the call-shape pass (P69) over one large generated service file.
 *
 *   node scripts/bench-call-shape.mjs [dir] [--methods N] [--runs N]
 *
 * Writes a small NestJS repository into `dir` (default: a new directory under
 * the system's temporary one): a module, a controller, and one service whose
 * methods each call several others - in a loop, side by side, and plainly -
 * with more calls around them that are not edges. Then reads it with the
 * extractor `runs` times and prints how long the call-shape pass and the whole
 * read took, median of the runs.
 *
 * The pass looks up the calls on a line for every call edge, so a pass that
 * walked the whole file once per edge grows with calls x edges; with one index
 * per file (P79) it grows roughly with the calls. Doubling `--methods` shows
 * which of the two it is. Not a gate: wall time on a shared machine is a
 * number for the record, and the walk-count test in core is what fails.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { extractRepo } = await import(join(root, 'packages/extractor-nestjs/dist/index.js'));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : Number(args[at + 1]);
};
const positional = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
const methods = flag('methods', 400);
const runs = flag('runs', 3);
const given = positional[0] === undefined ? undefined : resolve(positional[0]);
const dir = given ?? mkdtempSync(join(tmpdir(), 'flowatlas-bench-call-shape-'));

/** Method `i` calls the next few methods: one per item of a loop, two side by side, one plainly. */
const methodBody = (i) => {
  const next = (k) => `step${(i + k) % methods}`;
  return [
    `  async step${i}(ids: string[]): Promise<number> {`,
    `    const clean = ids.map((id) => String(id).trim()).filter((id) => id.length > 0);`,
    `    for (const id of clean) {`,
    `      await this.${next(1)}([id]);`,
    `    }`,
    `    const [a, b] = await Promise.all([this.${next(2)}(clean), this.${next(3)}(clean)]);`,
    `    const total = Math.max(a, b) + JSON.parse(JSON.stringify(clean)).length;`,
    `    return total + (await this.${next(4)}(clean.slice(0, 1)));`,
    `  }`,
  ].join('\n');
};

const write = (path, body) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
};

write('package.json', JSON.stringify({ name: 'bench', private: true, dependencies: { '@nestjs/common': '^11.0.0' } }));
write(
  'tsconfig.json',
  JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'commonjs', experimentalDecorators: true, strict: false, types: [] },
    include: ['src'],
  }),
);
write(
  'src/main.ts',
  "import { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\n\nvoid NestFactory.create(AppModule).then((app) => app.listen(3000));\n",
);
write(
  'src/app.module.ts',
  [
    "import { Module } from '@nestjs/common';",
    "import { CatalogController } from './catalog.controller';",
    "import { CatalogService } from './catalog.service';",
    '',
    '@Module({ controllers: [CatalogController], providers: [CatalogService] })',
    'export class AppModule {}',
    '',
  ].join('\n'),
);
write(
  'src/catalog.controller.ts',
  [
    "import { Body, Controller, Post } from '@nestjs/common';",
    "import { CatalogService } from './catalog.service';",
    '',
    "@Controller('catalog')",
    'export class CatalogController {',
    '  constructor(private readonly catalog: CatalogService) {}',
    '',
    "  @Post('run')",
    '  run(@Body() ids: string[]): Promise<number> {',
    '    return this.catalog.step0(ids);',
    '  }',
    '}',
    '',
  ].join('\n'),
);
write(
  'src/catalog.service.ts',
  [
    "import { Injectable } from '@nestjs/common';",
    '',
    '@Injectable()',
    'export class CatalogService {',
    Array.from({ length: methods }, (_, i) => methodBody(i)).join('\n\n'),
    '}',
    '',
  ].join('\n'),
);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/** Times each pass by the `pass <name>` line the extractor logs before running it. */
const timedRead = async () => {
  const marks = [];
  const note = (message) => marks.push({ message: String(message), at: performance.now() });
  const logger = { debug: note, info: () => {}, warn: () => {}, error: () => {} };
  const started = performance.now();
  const graph = await extractRepo({ rootDir: dir, repo: 'bench', logger });
  const ended = performance.now();
  const at = marks.findIndex((mark) => mark.message === 'pass call-shape');
  const pass = at < 0 ? Number.NaN : (marks[at + 1]?.at ?? ended) - (marks[at]?.at ?? ended);
  return { pass, total: ended - started, edges: graph.edges.filter((edge) => edge.type === 'calls').length };
};

try {
  const passes = [];
  const totals = [];
  let edges = 0;
  for (let run = 0; run < runs; run += 1) {
    const result = await timedRead();
    passes.push(result.pass);
    totals.push(result.total);
    edges = result.edges;
  }
  console.log(
    `call-shape over ${methods} methods (${edges} call edges): ` +
      `pass ${median(passes).toFixed(0)}ms, whole read ${median(totals).toFixed(0)}ms (median of ${runs})`,
  );
} finally {
  if (given === undefined) rmSync(dir, { recursive: true, force: true });
}
