/**
 * `flowatlas shapes --suggest` - which missing packages to write a shape file
 * for, and what of each this project uses (P78).
 *
 * The packages come from the built graph: the `module-not-installed` part of
 * what the reader could not follow (P75), most places first. What each is used
 * for comes from the repositories' own files, read as syntax and kept as names:
 * the names imported from it, whether each is constructed, called or written as
 * a type, and the members read off it. That is all a shape file needs to say,
 * and nothing of anybody's code is copied into the answer.
 *
 * Read-only, unless `--out` names a directory: then a starter `.d.ts` is
 * written there for each package listed, every type `any`, for the project to
 * refine. Never into a repository the configuration reads, and never over a
 * file that is already there unless `--force` says so.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  collectPackageUses,
  describeAcceptedProblem,
  exportKindOf,
  groupCantFollow,
  listRepoSources,
  loadConfig,
  packageCoverage,
  readShapeFile,
  serviceDirOf,
  shapesFor,
  starterShape,
  type AcceptedProblem,
  type CantFollowSample,
  type LoadedConfig,
  type ModuleUses,
  type PackageCover,
  type UsedExport,
} from '@flowatlas/core';
import type { Command } from 'commander';
import { sourceRootOptionsOf } from '../build/extractor.js';
import { CliError, EXIT } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { cantFollowRowsOf } from './doctor.js';

/** Version of the JSON this prints. Bump it when a field is removed or changes meaning. */
export const SHAPES_SUGGEST_FORMAT_VERSION = 1;

/** The cause whose packages a shape file can answer. */
const MISSING = 'module-not-installed';

export interface ShapesOptions {
  config?: string;
  db?: string;
  suggest?: boolean;
  top?: string;
  service?: string;
  /** Only this package. */
  package?: string;
  members?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
}

/** One name a package exports that the project uses, as a shape would declare it. */
export interface SuggestedExport {
  name: string;
  kind: 'class' | 'function' | 'value' | 'type';
  uses: number;
  /** Members read off what it constructs or types, most used first; `name()` when called. */
  members: string[];
  /** Members read off the name itself. */
  statics: string[];
}

export interface ShapeSuggestion {
  package: string;
  /** Places the reader could not follow because this package is missing. */
  sites: number;
  services: string[];
  /** The module specifiers it is imported by: the package, and any subpath. */
  specifiers: string[];
  /** Files importing it, across the services read. */
  files: number;
  exports: SuggestedExport[];
  /** Names left out by `--members`. */
  truncated?: number;
  samples: CantFollowSample[];
  /** What would stand in for it once rebuilt, when something already would. */
  coveredBy: PackageCover['by'] | null;
  coveredFrom: string | null;
}

export interface ShapeFileSummary {
  /** Relative to the configuration. */
  file: string;
  declares: string[];
  /** Why nothing of it is read, when nothing is. */
  unread: string | null;
  /** Declared packages no service imports. */
  unmatched: string[];
}

export interface ShapesSuggestReport {
  shapesSuggestFormatVersion: number;
  service: string | null;
  /** Every missing package and the places they stand for, before `--top`. */
  total: { packages: number; sites: number };
  packages: ShapeSuggestion[];
  /** Packages left out by `--top`. */
  truncated?: number;
  /** Missing packages a shape file is not the answer for, with why. */
  skipped: Array<{ package: string; sites: number; why: string }>;
  shapeFiles: ShapeFileSummary[];
  /** What `--out` wrote, and what it left as it was. */
  written?: Array<{ file: string; packages: string[] }>;
  kept?: Array<{ file: string; packages: string[] }>;
  /** The glob to add under `shapes` when what `--out` wrote is not read yet. */
  listShapes?: string;
  note: string | null;
  /** Why `accepted.json` could not be read, so nothing in it was left out (P80). Absent when it read. */
  acceptedProblem?: AcceptedProblem;
}

const whole = (value: string | undefined, fallback: number, flag: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError(`${flag} must be a whole number of at least 1, not ${JSON.stringify(value)}`, EXIT.cannotRun);
  }
  return parsed;
};

/** A path as the configuration would write it: relative below it, absolute anywhere else. */
const relativeTo = (base: string, path: string): string => {
  const at = relative(base, path).split(sep).join('/');
  if (at === '') return '.';
  return at === '..' || at.startsWith('../') ? path : at;
};

/** A missing package that no shape written by hand would stand in for well. */
const notForAShape = (pkg: string): string | undefined =>
  pkg.startsWith('@types/') ? `the runtime's own declarations: install ${pkg} rather than describe it by hand` : undefined;

/** Every source file of every service read, as `[service, absolute path]`. */
const sourcesOf = (loaded: LoadedConfig): Array<[string, string]> =>
  loaded.config.services
    .filter((service) => service.document === undefined)
    .flatMap((service) => {
      const dir = serviceDirOf(loaded.rootDir, service.repo);
      if (!existsSync(dir)) return [];
      return listRepoSources(dir, service.readTestDirectories, sourceRootOptionsOf(service, dir, loaded.config)).map(
        (file): [string, string] => [service.name, join(dir, file)],
      );
    });

/** What every service uses of the wanted packages, by specifier. */
const usesOf = (loaded: LoadedConfig, wanted: ReadonlySet<string>): Map<string, ModuleUses> => {
  const modules = new Map<string, ModuleUses>();
  if (wanted.size === 0) return modules;
  for (const [, path] of sourcesOf(loaded)) {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    collectPackageUses(path, text, wanted, modules);
  }
  return modules;
};

const memberNames = (members: ReadonlyMap<string, { called: boolean; uses: number }>): string[] =>
  [...members]
    .sort(([a, x], [b, y]) => y.uses - x.uses || (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, use]) => (use.called ? `${name}()` : name));

/** One entry per name, however many module specifiers of the package it was imported through. */
const mergedExports = (uses: readonly UsedExport[]): UsedExport[] => {
  const byName = new Map<string, UsedExport>();
  const mergeMembers = (into: UsedExport['members'], from: UsedExport['members']): void => {
    for (const [name, use] of from) {
      const seen = into.get(name) ?? { called: false, uses: 0 };
      into.set(name, { called: seen.called || use.called, uses: seen.uses + use.uses });
    }
  };
  for (const use of uses) {
    const seen = byName.get(use.name);
    if (seen === undefined) {
      byName.set(use.name, { ...use, statics: new Map(use.statics), members: new Map(use.members) });
      continue;
    }
    seen.constructed ||= use.constructed;
    seen.called ||= use.called;
    seen.typed ||= use.typed;
    seen.valued ||= use.valued;
    seen.uses += use.uses;
    seen.typeArgs = Math.max(seen.typeArgs, use.typeArgs);
    mergeMembers(seen.statics, use.statics);
    mergeMembers(seen.members, use.members);
  }
  return [...byName.values()];
};

const suggestedExport = (use: UsedExport): SuggestedExport => ({
  name: use.name,
  kind: exportKindOf(use),
  uses: use.uses,
  members: memberNames(use.members),
  statics: memberNames(use.statics),
});

/** A file name for a package's starter shape: `@acme/feature-flags` is `acme-feature-flags.d.ts`. */
export const shapeFileName = (pkg: string): string =>
  `${pkg.replace(/^@/, '').replace(/[^A-Za-z0-9._-]+/g, '-')}.d.ts`;

/** The suggestion, as data; `--out` is the only part that writes. */
export const shapesSuggest = (options: ShapesOptions): ShapesSuggestReport => {
  const top = whole(options.top, 10, '--top');
  const memberLimit = whole(options.members, 12, '--members');
  const loaded = loadConfig(options.config ?? process.cwd(), { checkRepos: false });
  const coverage = packageCoverage(loaded.config, loaded.rootDir);

  const { fresh, note, accepted } =
    options.suggest === false ? { fresh: [], note: undefined, accepted: undefined } : cantFollowRowsOf(options);
  const grouped = groupCantFollow(fresh, {
    cause: MISSING,
    top: Number.MAX_SAFE_INTEGER,
    samples: 3,
    ...(options.service === undefined ? {} : { service: options.service }),
  });
  const missing = (grouped.causes[0]?.packages ?? []).flatMap((pkg) =>
    pkg.package === null ? [] : [{ ...pkg, package: pkg.package }],
  );
  const skipped = missing.flatMap((pkg) => {
    const why = notForAShape(pkg.package);
    return why === undefined ? [] : [{ package: pkg.package, sites: pkg.sites, why }];
  });
  const listed = missing.filter(
    (pkg) => notForAShape(pkg.package) === undefined && (options.package === undefined || pkg.package === options.package),
  );

  // The shape files listed, and what each declares, beside the packages to suggest.
  const shapeFiles = [
    ...new Set([
      ...shapesFor(loaded.config, undefined, loaded.rootDir),
      ...loaded.config.services.flatMap((service) => shapesFor(undefined, service, loaded.rootDir)),
    ]),
  ].sort();
  const readings = shapeFiles.map((path) => readShapeFile(path, existsSync(path) ? readFileSync(path, 'utf8') : undefined));
  const declared = readings.flatMap((reading) => reading.shapes.map((shape) => shape.package));

  const wanted = new Set([
    ...listed.slice(0, top).map((pkg) => pkg.package),
    ...declared.map((name) => name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')),
  ]);
  const modules = usesOf(loaded, wanted);

  const packages: ShapeSuggestion[] = listed.slice(0, top).map((pkg) => {
    const specs = [...modules.values()].filter(
      (module) => module.specifier === pkg.package || module.specifier.startsWith(`${pkg.package}/`),
    );
    const exports = mergedExports(specs.flatMap((module) => [...module.exports.values()])).sort(
      (a, b) => b.uses - a.uses || (a.name < b.name ? -1 : 1),
    );
    const cover = coverage.get(pkg.package);
    const services =
      groupCantFollow(fresh, {
        cause: MISSING,
        package: pkg.package,
        samples: 0,
        ...(options.service === undefined ? {} : { service: options.service }),
      }).causes[0]?.services ?? [];
    return {
      package: pkg.package,
      sites: pkg.sites,
      services,
      specifiers: specs.map((module) => module.specifier).sort(),
      files: specs.reduce((sum, module) => sum + module.files, 0),
      exports: exports.slice(0, memberLimit).map(suggestedExport),
      ...(exports.length > memberLimit ? { truncated: exports.length - memberLimit } : {}),
      samples: pkg.samples,
      coveredBy: cover?.by ?? null,
      coveredFrom: cover?.from ?? null,
    };
  });

  const summaries: ShapeFileSummary[] = readings.map((reading) => ({
    file: relativeTo(loaded.rootDir, reading.path),
    declares: reading.shapes.map((shape) => shape.package),
    unread: reading.problem ?? null,
    unmatched: reading.shapes
      .map((shape) => shape.package)
      .filter((name) => ![...modules.keys()].some((specifier) => specifier === name)),
  }));

  const report: ShapesSuggestReport = {
    shapesSuggestFormatVersion: SHAPES_SUGGEST_FORMAT_VERSION,
    service: options.service ?? null,
    total: { packages: listed.length, sites: listed.reduce((sum, pkg) => sum + pkg.sites, 0) },
    packages,
    ...(listed.length > top ? { truncated: listed.length - top } : {}),
    skipped,
    shapeFiles: summaries,
    note: note ?? null,
    ...(accepted?.problem === undefined ? {} : { acceptedProblem: accepted.problem }),
  };

  if (options.out !== undefined) {
    const { written, kept, dir } = writeStarters(loaded, options, packages, modules, memberLimit);
    report.written = written;
    report.kept = kept;
    const listed = shapesFor(loaded.config, undefined, loaded.rootDir);
    const glob = `${dir === '.' || isAbsolute(dir) ? dir : `./${dir}`}/*.d.ts`;
    const read = [...written, ...kept].every((entry) => listed.includes(resolve(loaded.rootDir, entry.file)));
    if (!read && (written.length > 0 || kept.length > 0)) report.listShapes = glob;
  }
  return report;
};

/** Writes a starter shape per uncovered package listed; never into a repository, never over a file. */
const writeStarters = (
  loaded: LoadedConfig,
  options: ShapesOptions,
  packages: readonly ShapeSuggestion[],
  modules: ReadonlyMap<string, ModuleUses>,
  memberLimit: number,
): { written: Array<{ file: string; packages: string[] }>; kept: Array<{ file: string; packages: string[] }>; dir: string } => {
  const out = isAbsolute(options.out as string) ? (options.out as string) : resolve(process.cwd(), options.out as string);
  for (const service of loaded.config.services) {
    if (service.document !== undefined) continue;
    const dir = serviceDirOf(loaded.rootDir, service.repo);
    if (out === dir || out.startsWith(`${dir}${sep}`)) {
      throw new CliError(
        `--out ${options.out} is inside the repository of ${service.name}; shape files are kept beside the configuration, not in a repository it reads`,
        EXIT.cannotRun,
      );
    }
  }
  const written: Array<{ file: string; packages: string[] }> = [];
  const kept: Array<{ file: string; packages: string[] }> = [];
  for (const pkg of packages) {
    if (pkg.coveredBy !== null) continue;
    const path = join(out, shapeFileName(pkg.package));
    const entry = { file: relativeTo(loaded.rootDir, path), packages: [pkg.package] };
    if (existsSync(path) && options.force !== true) {
      kept.push(entry);
      continue;
    }
    const specs = pkg.specifiers.length === 0 ? [pkg.package] : pkg.specifiers;
    const text = starterShape(
      specs.map((specifier) => modules.get(specifier) ?? { specifier, exports: new Map(), files: 0 }),
      {
        members: memberLimit,
        header: [
          `A starter shape of ${pkg.package}, from the names this project uses of it (flowatlas shapes --suggest).`,
          'Every type is any: write the real ones in, and the calls through the package are followed.',
          'List this file under "shapes" in flowatlas.config.json, then run flowatlas build.',
        ],
      },
    );
    mkdirSync(out, { recursive: true });
    writeFileSync(path, text, 'utf8');
    written.push(entry);
  }
  return { written, kept, dir: relativeTo(loaded.rootDir, out) };
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const exportLine = (use: SuggestedExport, width: number): string => {
  const parts = [...use.statics.map((name) => `.${name}`), ...use.members];
  return `    ${use.name.padEnd(width)}  ${use.kind.padEnd(8)}${parts.length === 0 ? '' : `  ${parts.join(', ')}`}`;
};

export const renderShapesText = (report: ShapesSuggestReport): string => {
  const lines: string[] = [];
  if (report.note !== null) lines.push(`note: ${report.note}`, '');
  if (report.acceptedProblem !== undefined) lines.push(`warning: ${describeAcceptedProblem(report.acceptedProblem)}`, '');
  const narrowed = report.service === null ? '' : ` (service ${report.service})`;
  lines.push(
    `packages not installed: ${plural(report.total.packages, 'package')} over ${plural(report.total.sites, 'place')}${narrowed}, most places first`,
  );
  if (report.packages.length === 0) lines.push('  none: every package the reader needed resolved');
  for (const pkg of report.packages) {
    const covered =
      pkg.coveredBy === null
        ? ''
        : `  covered by ${pkg.coveredBy === 'repo' ? 'its source in' : 'the shape file'} ${pkg.coveredFrom}; rebuild to read it`;
    lines.push('', `  ${pkg.package}: ${plural(pkg.sites, 'place')}  ${pkg.services.join(', ')}${covered}`);
    if (pkg.exports.length === 0) lines.push('    no import of it read; it may be reached through require() or a re-export');
    const width = Math.max(0, ...pkg.exports.map((use) => use.name.length));
    for (const use of pkg.exports) lines.push(exportLine(use, width));
    if (pkg.truncated !== undefined) lines.push(`    … ${plural(pkg.truncated, 'more name')}; --members lists more`);
    for (const sample of pkg.samples.slice(0, 2)) {
      lines.push(`    at ${sample.service === undefined ? '' : `${sample.service}/`}${sample.file}:${sample.line}`);
    }
  }
  if (report.truncated !== undefined) lines.push('', `… ${plural(report.truncated, 'more package')}; --top lists more`);
  for (const skip of report.skipped) lines.push('', `  ${skip.package}: ${plural(skip.sites, 'place')}, not listed: ${skip.why}`);
  if (report.shapeFiles.length > 0) {
    lines.push('', 'shape files:');
    for (const file of report.shapeFiles) {
      if (file.unread !== null) {
        lines.push(`  ${file.file}  not read: ${file.unread}`);
        continue;
      }
      const unmatched = file.unmatched.length === 0 ? '' : `; nothing imports ${file.unmatched.join(', ')}`;
      lines.push(`  ${file.file}  declares ${file.declares.join(', ')}${unmatched}`);
    }
  }
  for (const entry of report.written ?? []) lines.push('', `wrote ${entry.file}`);
  for (const entry of report.kept ?? []) lines.push('', `kept ${entry.file}: it is there already (--force writes over it)`);
  if (report.written === undefined && report.packages.some((pkg) => pkg.coveredBy === null)) {
    lines.push(
      '',
      'next: flowatlas shapes --suggest --out <dir> writes a starter .d.ts per package, every type any; refine it and list it under "shapes"',
    );
  } else if (report.listShapes !== undefined) {
    lines.push('', `next: add "shapes": ["${report.listShapes}"] to flowatlas.config.json, refine the any types, and run flowatlas build`);
  } else if ((report.written?.length ?? 0) > 0) {
    lines.push('', 'next: refine the any types, and run flowatlas build');
  }
  return `${lines.join('\n')}\n`;
};

export const renderShapesJson = (report: ShapesSuggestReport): string => `${JSON.stringify(report, null, 2)}\n`;

export interface ShapesRun {
  report: ShapesSuggestReport;
  text: string;
  exitCode: number;
}

export const runShapesSuggest = (options: ShapesOptions, io: QueryIo = processIo): ShapesRun => {
  const report = shapesSuggest(options);
  const text = options.json === true ? renderShapesJson(report) : renderShapesText(report);
  io.out(text);
  return { report, text, exitCode: EXIT.ok };
};

export const registerShapes = (program: Command): void => {
  program
    .command('shapes')
    .description('the shape files read in place of missing packages, and which packages to write one for')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--suggest', 'list the missing packages most places need, with the names used of each')
    .option('--top <n>', 'most packages to list (default 10)')
    .option('--service <name>', 'only the places of one service')
    .option('--package <name>', 'only this package')
    .option('--members <n>', 'most names listed per package (default 12)')
    .option('--out <dir>', 'with --suggest: write a starter .d.ts per package listed into this directory')
    .option('--force', 'with --out: write over a file that is there already')
    .option('--json', 'print the answer as JSON')
    .action((options: ShapesOptions) => {
      runShapesSuggest({ ...options, suggest: options.suggest === true });
    });
};
