#!/usr/bin/env node
/**
 * Measures what reading package sources in place of an install costs a build (P82).
 *
 *   node scripts/bench-package-sources.mjs [dir] [--services N] [--packages M] [--files K]
 *        [--parts P] [--members W] [--folders F] [--shapes S]
 *        [--runs R] [--concurrency C] [--budget X] [--profile DIR] [--keep]
 *
 * Writes into `dir` (default: a new directory under the system's temporary one,
 * removed afterwards unless `--keep`) a project with nothing installed:
 *
 * - N NestJS-style services (shop, orders, billing, catalog, ...), K files a
 *   service, each importing most of the internal packages, two members of the
 *   workspace below and one shaped client;
 * - M internal packages, each a repository of the configuration, of P files of
 *   a class and a helper each behind an index, each using the one before it;
 * - one repository that is a workspace of W such packages;
 * - F directories beside the configuration nobody configured, each a small
 *   workspace, which the search under the configuration walks;
 * - a `shapes` glob over S `.d.ts` files: three clients the services import,
 *   the rest starters nothing imports.
 *
 * So every service mounts every package and installs every shape. Then it runs
 * a cold `flowatlas build --no-cache` R times with `packageSources` on and R
 * times with it off, alternating, and prints the median of each and their
 * ratio. The build reads one repository at a time by default
 * (`--concurrency 1`), so the wall time is the sum of what every reader costs
 * and the ratio is the CPU the sources add, not how many cores happen to be
 * free.
 *
 * The budget (D4): with sources on, the median is at most `--budget` (1.3) times
 * the median with them off, on the same machine and the same project. The
 * default size is 6 services, 24 packages of 24 files, 60 files a service, a
 * workspace of 8 members, 10 folders, 24 shape files and 3 runs: a few minutes.
 * Most of what stays above 1.0 is the compiler parsing and binding the mounted
 * sources, which is what reading them means. The exit code is 1 when the ratio
 * is over budget.
 *
 * `--profile DIR` runs each build once more with `--cpu-prof` (inherited by
 * every reader the build starts) and writes the profiles under DIR/on and
 * DIR/off.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'packages/cli/bin/flowatlas.js');

const args = process.argv.slice(2);
const valued = new Set(['services', 'packages', 'files', 'parts', 'members', 'folders', 'shapes', 'runs', 'concurrency', 'budget', 'profile']);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const positional = args.filter((arg, i) => !arg.startsWith('--') && !valued.has(args[i - 1]?.slice(2) ?? ''));
const services = Number(flag('services', 6));
const packages = Number(flag('packages', 24));
const files = Number(flag('files', 60));
const parts = Number(flag('parts', 24));
const members = Number(flag('members', 8));
const folders = Number(flag('folders', 10));
const shapes = Number(flag('shapes', 24));
const runs = Number(flag('runs', 3));
const concurrency = Number(flag('concurrency', 1));
const budget = Number(flag('budget', 1.3));
const profile = flag('profile', undefined);
const keep = args.includes('--keep');
const given = positional[0] === undefined ? undefined : resolve(positional[0]);
const dir = given ?? mkdtempSync(join(tmpdir(), 'flowatlas-bench-package-sources-'));

const SERVICE_NAMES = ['shop', 'orders', 'billing', 'catalog', 'shipping', 'support', 'accounts', 'reviews'];
const PACKAGE_NAMES = ['money', 'ledger', 'mailer', 'flags', 'audit', 'geo', 'units', 'clock'];
const SHAPED = ['queue-client', 'cache-client', 'search-client'];

const nameOf = (names, i) => (i < names.length ? names[i] : `${names[i % names.length]}${Math.floor(i / names.length) + 1}`);
const pascal = (name) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const write = (path, body) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
};

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'commonjs',
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      strict: false,
      skipLibCheck: true,
      types: [],
    },
    include: ['src'],
  },
  null,
  2,
);

/* ── The internal packages: classes and functions behind an index ── */

/** One package's source: `parts` files of a class and a helper each, and an index over them. */
const writePackage = (base, name, peer) => {
  const Name = pascal(name);
  write(`${base}/package.json`, JSON.stringify({ name: `@bench/${name}`, version: '1.0.0', private: true, main: 'dist/index.js', types: 'dist/index.d.ts' }, null, 2));
  write(`${base}/tsconfig.json`, TSCONFIG);
  const index = [];
  for (let part = 0; part < parts; part += 1) {
    const peered = peer !== undefined && part === 0;
    write(
      `${base}/src/part${part}.ts`,
      [
        ...(peered ? [`import { ${pascal(peer)}Part0 } from '@bench/${peer}';`, ''] : []),
        `export interface ${Name}Options${part} {`,
        '  readonly scale: number;',
        '  readonly label?: string;',
        '  readonly tags: readonly string[];',
        '}',
        '',
        `export class ${Name}Part${part} {`,
        `  constructor(private readonly options: ${Name}Options${part} = { scale: 1, tags: [] }) {}`,
        '',
        ...Array.from({ length: 8 }, (_, m) => [
          `  method${m}(value: number, note?: string): { value: number; note: string; part: number } {`,
          `    return { value: value * this.options.scale + ${m}, note: note ?? this.options.label ?? '', part: ${part} };`,
          '  }',
          '',
        ]).flat(),
        ...(peered ? [`  peer(): ${pascal(peer)}Part0 {`, `    return new ${pascal(peer)}Part0();`, '  }', ''] : []),
        '}',
        '',
        `export const ${camel(name)}Helper${part} = (input: string): string => input.trim() + '${part}';`,
        '',
      ].join('\n'),
    );
    index.push(`export { ${Name}Part${part}, ${camel(name)}Helper${part}, type ${Name}Options${part} } from './part${part}';`);
  }
  write(`${base}/src/index.ts`, `${index.join('\n')}\n`);
};

// Each a repository of the configuration; a package uses the one before it,
// as the libraries of one company do.
const packageNames = Array.from({ length: packages }, (_, i) => nameOf(PACKAGE_NAMES, i));
for (const [p, name] of packageNames.entries()) writePackage(`${name}-lib`, name, p === 0 ? undefined : packageNames[p - 1]);

// One repository that is a workspace of `members` packages: the configured
// tier's members.
const memberNames = Array.from({ length: members }, (_, i) => `platform-${nameOf(PACKAGE_NAMES, i)}`);
write('platform/package.json', JSON.stringify({ name: 'platform', private: true, workspaces: ['packages/*'] }, null, 2));
for (const name of memberNames) writePackage(`platform/packages/${name}`, name, undefined);

// Directories beside the configuration that nobody configured, each a small
// workspace: what the search under the configuration walks, and nothing imports.
for (let f = 0; f < folders; f += 1) {
  write(`tool${f}/package.json`, JSON.stringify({ name: `tool${f}`, private: true, workspaces: ['packages/*'] }, null, 2));
  for (let m = 0; m < 3; m += 1) {
    write(`tool${f}/packages/part${m}/package.json`, JSON.stringify({ name: `@bench/tool${f}-part${m}`, version: '0.1.0' }));
  }
}

/* ── Shape files: the clients nobody has the source of, and starters nobody imports ── */

const shapeFile = (name) =>
  [
    `declare module '@bench/${name}' {`,
    `  export class ${pascal(name)} {`,
    '    constructor(url?: string);',
    '    connect(): Promise<void>;',
    '    publish(topic: string, body: unknown): Promise<void>;',
    '    get(key: string): Promise<string | undefined>;',
    '  }',
    '}',
    '',
  ].join('\n');
for (const name of SHAPED) write(`shapes/${name}.d.ts`, shapeFile(name));
for (let i = SHAPED.length; i < shapes; i += 1) write(`shapes/starter-${i}.d.ts`, shapeFile(`starter-${i}`));

/* ── The services: K files each, every one importing most packages ── */

const serviceNames = Array.from({ length: services }, (_, i) => nameOf(SERVICE_NAMES, i));

for (const [s, service] of serviceNames.entries()) {
  const dependencies = Object.fromEntries([
    ['@nestjs/common', '^11.0.0'],
    ['@nestjs/core', '^11.0.0'],
    ...[...packageNames, ...memberNames, ...SHAPED].map((name) => [`@bench/${name}`, '^1.0.0']),
  ]);
  write(`${service}/package.json`, JSON.stringify({ name: service, version: '0.0.0', private: true, dependencies }, null, 2));
  write(`${service}/tsconfig.json`, TSCONFIG);
  write(
    `${service}/src/main.ts`,
    "import { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\n\nvoid NestFactory.create(AppModule).then((app) => app.listen(3000));\n",
  );
  const classes = [];
  for (let f = 0; f < files; f += 1) {
    // Most packages, not all: a file leaves one out in turn, and takes two of
    // the workspace's members.
    const used = [
      ...packageNames.filter((_, p) => packageNames.length < 3 || p !== (f + s) % packageNames.length),
      ...(memberNames.length === 0 ? [] : [memberNames[f % memberNames.length], memberNames[(f + 1) % memberNames.length]]),
    ].filter((name, i, all) => all.indexOf(name) === i);
    const shaped = SHAPED[f % SHAPED.length];
    const Shaped = pascal(shaped);
    const Part = `Part${f}`;
    const at = f % parts;
    write(
      `${service}/src/part${f}/part${f}.service.ts`,
      [
        "import { Injectable } from '@nestjs/common';",
        ...used.map((name) => `import { ${pascal(name)}Part${at}, ${camel(name)}Helper${at} } from '@bench/${name}';`),
        `import { ${Shaped} } from '@bench/${shaped}';`,
        '',
        '@Injectable()',
        `export class ${Part}Service {`,
        `  private readonly client = new ${Shaped}();`,
        '',
        '  async run(id: string): Promise<number> {',
        '    let total = 0;',
        ...used.map((name) => `    total += new ${pascal(name)}Part${at}().method${f % 8}(total, ${camel(name)}Helper${at}(id)).value;`),
        `    await this.client.publish('${service}.part${f}', { id, total });`,
        '    return total;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    write(
      `${service}/src/part${f}/part${f}.controller.ts`,
      [
        "import { Controller, Get, Param } from '@nestjs/common';",
        `import { ${Part}Service } from './part${f}.service';`,
        '',
        `@Controller('part${f}')`,
        `export class ${Part}Controller {`,
        `  constructor(private readonly service: ${Part}Service) {}`,
        '',
        "  @Get(':id')",
        "  run(@Param('id') id: string): Promise<number> {",
        '    return this.service.run(id);',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    classes.push(Part);
  }
  write(
    `${service}/src/app.module.ts`,
    [
      "import { Module } from '@nestjs/common';",
      ...classes.flatMap((Part, f) => [
        `import { ${Part}Controller } from './part${f}/part${f}.controller';`,
        `import { ${Part}Service } from './part${f}/part${f}.service';`,
      ]),
      '',
      '@Module({',
      `  controllers: [${classes.map((Part) => `${Part}Controller`).join(', ')}],`,
      `  providers: [${classes.map((Part) => `${Part}Service`).join(', ')}],`,
      '})',
      'export class AppModule {}',
      '',
    ].join('\n'),
  );
}

const configWith = (packageSources) => ({
  services: [
    ...serviceNames.map((name) => ({ name, repo: `./${name}`, type: 'nestjs' })),
    ...packageNames.map((name) => ({ name: `${name}-lib`, repo: `./${name}-lib`, type: 'nestjs' })),
    { name: 'platform', repo: './platform', type: 'nestjs' },
  ],
  shapes: ['./shapes/*.d.ts'],
  packageSources,
  adapters: {
    broker: {
      custom: SHAPED.map((name) => ({
        name: `${name}-bus`,
        channelKind: 'topic',
        producers: [{ receiverType: pascal(name), method: 'publish', channelArg: 0, payloadArg: 1 }],
      })),
    },
  },
  output: '.flowatlas',
});

/* ── The runs ── */

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/** One cold build with the setting given, its wall time in milliseconds. */
const build = (on, env = process.env) => {
  writeFileSync(join(dir, 'flowatlas.config.json'), `${JSON.stringify(configWith(on), null, 2)}\n`);
  const out = join(dir, on ? '.flowatlas-on' : '.flowatlas-off');
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [bin, 'build', dir, '--no-cache', '--out', out, '--concurrency', String(concurrency)],
    { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const ms = performance.now() - started;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`build with packageSources ${on} exited ${result.status}`);
  }
  return ms;
};

try {
  const times = { on: [], off: [] };
  // Alternating, so a machine that slows down part-way slows both sides.
  for (let run = 0; run < runs; run += 1) {
    times.off.push(build(false));
    times.on.push(build(true));
  }
  const on = median(times.on);
  const off = median(times.off);
  const ratio = on / off;
  console.log(
    `package sources over ${services} services, ${packages} packages, ${files} files a service ` +
      `(concurrency ${concurrency}, median of ${runs}): on ${on.toFixed(0)}ms, off ${off.toFixed(0)}ms, ` +
      `ratio ${ratio.toFixed(2)} (budget ${budget})`,
  );
  if (profile !== undefined) {
    for (const on of [true, false]) {
      const into = resolve(profile, on ? 'on' : 'off');
      mkdirSync(into, { recursive: true });
      const options = `${process.env.NODE_OPTIONS ?? ''} --cpu-prof --cpu-prof-dir=${into}`.trim();
      build(on, { ...process.env, NODE_OPTIONS: options });
    }
    console.log(`profiles written under ${resolve(profile)}`);
  }
  if (ratio > budget) process.exitCode = 1;
} finally {
  if (given === undefined && !keep) rmSync(dir, { recursive: true, force: true });
}
