/**
 * `flowatlas export backstage` and `flowatlas export structurizr` (P119): the
 * map delivered into the tools that already hold one - a Backstage
 * catalogue whose `providesApis`, `consumesApis` and `dependsOn` are the
 * joins the graph made, and a Structurizr workspace with a container view
 * and one dynamic view per flow.
 *
 * The files go to the output directory (`<output>/export/<kind>/`), never
 * into a repository the configuration reads (the P78 rule): a team that
 * commits its catalogue copies the files, and runs `--check` in CI, which
 * writes nothing and fails when a file is not what would be written now,
 * naming the first relation that differs. Nothing is sent anywhere.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadConfig, serviceDirOf, type LoadedConfig } from '@flowatlas/core';
import {
  BACKSTAGE_LOCATION_FILE,
  DEFAULT_EXPORT_FLOWS,
  DEFAULT_MAX_LABELS,
  DEFAULT_SPEC_DEPTH,
  exportBackstage,
  exportStructurizr,
  specOptionsOf,
  STRUCTURIZR_FILE,
  writeSpecs,
  type BackstageExport,
  type BackstageSummary,
  type ExportFile,
  type ExportFlow,
  type ExportService,
  type GraphDb,
  type StructurizrExport,
  type StructurizrSummary,
} from '@flowatlas/linker';
import type { Command } from 'commander';
import { openProjectDb } from '../analysis/open.js';
import { CliError, EXIT } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { resolveEntry } from '../query/refs.js';
import { walkSequence } from '../query/sequence.js';
import { halfOf } from '../readers.js';
import { renderSpecFile, specFileName } from '../report/spec.js';
import { collect, oneOf, whole } from './diff.js';
import { wanted } from './spec.js';

export const EXPORT_KINDS = ['backstage', 'structurizr'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** Where the files go under the output directory when `--out` is not given: `<output>/export/<kind>/`. */
export const EXPORT_DIR = 'export';

/** Nodes each flow's walk may visit before it is cut (I9). */
export const EXPORT_WALK_NODES = 400;

export interface ExportCommandOptions {
  config?: string;
  db?: string;
  out?: string;
  service?: string[];
  includeHeuristic?: boolean;
  /** Ways in to draw a dynamic view of, repeatable (structurizr). */
  flow?: string[];
  maxFlows?: string;
  maxLabels?: string;
  /** Write nothing; exit 1 when a file differs from what would be written now. */
  check?: boolean;
  /** Print the entities (or the model) as JSON. */
  json?: boolean;
}

export interface ExportFileState {
  /** Absolute. */
  file: string;
  /** Relative to the export directory. */
  path: string;
  state?: 'same' | 'differs' | 'missing' | 'stale';
  /** For a file that differs: the first line that is new, and the first that is gone, each with the entity and field it is under. */
  difference?: { added?: string; removed?: string };
}

export interface ExportRun {
  kind: ExportKind;
  outDir: string;
  files: ExportFileState[];
  text: string;
  exitCode: number;
  backstage?: BackstageExport;
  structurizr?: StructurizrExport;
}

/**
 * The export directory, refused when it is inside a repository the
 * configuration reads and something would be written there. `--check` writes
 * nothing, so it may read a catalogue a repository commits; a directory that
 * is not a configured service's (the catalogue's own repository) is fine.
 */
const outDirOf = (loaded: LoadedConfig, kind: ExportKind, out: string | undefined, writing: boolean): string => {
  const dir = out === undefined ? join(loaded.outputDir, EXPORT_DIR, kind) : isAbsolute(out) ? out : resolve(process.cwd(), out);
  if (!writing) return dir;
  for (const service of loaded.config.services) {
    if (service.document !== undefined) continue;
    const repo = serviceDirOf(loaded.rootDir, service.repo);
    if (dir === repo || dir.startsWith(`${repo}${sep}`)) {
      throw new CliError(
        `--out ${out ?? dir} is inside the repository of ${service.name}; an export is written to the output directory, not into a repository it reads`,
        EXIT.cannotRun,
        ['Leave --out out to write under the configured output, or name a directory outside every configured repository; copy the files into a repository yourself if it commits them, and run --check there.'],
      );
    }
  }
  return dir;
};

/** The services as an export reads them: which half each is, and what the catalogue says. */
const exportServicesOf = (loaded: LoadedConfig): ExportService[] =>
  loaded.config.services.map((service) => ({
    name: service.name,
    type: service.type,
    half: halfOf(service.type) ?? 'server',
    ...(service.catalog === undefined ? {} : { catalog: service.catalog }),
  }));

/** The project's name: the one system every chosen service says it belongs to, else the configuration's directory. */
const projectNameOf = (loaded: LoadedConfig, services: readonly string[]): string => {
  const systems = new Set(loaded.config.services.filter((service) => services.includes(service.name)).map((service) => service.catalog?.system));
  const [only] = systems;
  return systems.size === 1 && only !== undefined ? only : basename(loaded.rootDir);
};

/**
 * The flows a workspace draws: the ways in named with `--flow`, or every
 * entry of the services in scope and every browser action, each walked as
 * P116 walks a flow (bounded by `EXPORT_WALK_NODES`).
 */
const flowsOf = (db: GraphDb, loaded: LoadedConfig, services: readonly string[], asked: readonly string[]): ExportFlow[] => {
  const nodes =
    asked.length > 0
      ? asked.map((ref) => resolveEntry(db, ref))
      : [...db.nodesByType('entry'), ...db.nodesByType('ui_action')]
          .filter((node) => services.includes(node.repo))
          .filter((node) => node.type === 'entry' || halfOf(loaded.config.services.find((service) => service.name === node.repo)?.type ?? '') === 'browser')
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return nodes.map((node) => {
    const walk = walkSequence(db, node.id, { maxNodes: EXPORT_WALK_NODES, detail: 'service' });
    return { entry: node.id, label: node.label, service: node.repo, sequence: walk.sequence, ...(walk.truncated === undefined ? {} : { truncated: walk.truncated }) };
  });
};

/** The YAML entity and field a line is under, for naming what differs: `billing spec.consumesApis`. */
const yamlContextOf = (lines: readonly string[], at: number): string => {
  const indentOf = (line: string): number => line.length - line.trimStart().length;
  let indent = indentOf(lines[at] ?? '');
  const path: string[] = [];
  let entity: string | undefined;
  for (let i = at - 1; i >= 0; i -= 1) {
    const line = lines[i] as string;
    if (line === '---') break;
    if (entity === undefined && /^ {2}name: /.test(line)) entity = line.slice('  name: '.length);
    const key = /^(\s*)([^\s-][^:]*):(?: [|>]-?)?$/.exec(line);
    if (key !== null && indentOf(line) < indent) {
      path.unshift(key[2] as string);
      indent = indentOf(line);
    }
  }
  return [entity, path.join('.')].filter((part) => part !== undefined && part !== '').join(' ');
};

/** The first line one text has that the other has not, as many times; for YAML with the entity and field it is under. */
const firstDifference = (was: string, now: string, yaml: boolean): { added?: string; removed?: string } => {
  const counted = (lines: readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  };
  const before = was.split('\n');
  const after = now.split('\n');
  const said = (lines: readonly string[], other: Map<string, number>): string | undefined => {
    const seen = new Map<string, number>();
    for (let at = 0; at < lines.length; at += 1) {
      const line = lines[at] as string;
      seen.set(line, (seen.get(line) ?? 0) + 1);
      if ((seen.get(line) ?? 0) > (other.get(line) ?? 0)) {
        const context = yaml ? yamlContextOf(lines, at) : '';
        return `${context === '' ? '' : `${context}: `}${line.trim()}`;
      }
    }
    return undefined;
  };
  const added = said(after, counted(before));
  const removed = said(before, counted(after));
  return { ...(added === undefined ? {} : { added }), ...(removed === undefined ? {} : { removed }) };
};

const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`;

/** What a Backstage run says beyond the counts: every gap it wrote as `unknown` or left empty. */
const backstageLines = (summary: BackstageSummary): string[] => {
  const lines: string[] = [];
  for (const key of ['owner', 'lifecycle'] as const) {
    const unset = summary.unset[key];
    if (unset.length > 0) lines.push(`${key} not given for ${plural(unset.length, 'service')}, written as unknown: ${unset.join(', ')} (services[].catalog.${key})`);
  }
  if (summary.unset.system.length > 0) lines.push(`no system for ${plural(summary.unset.system.length, 'service')}: ${summary.unset.system.join(', ')} (services[].catalog.system)`);
  for (const channel of summary.channelsWithoutPublisher) lines.push(`nothing in the project publishes ${channel.channel}: ${channel.consumers.join(', ')} consume${channel.consumers.length === 1 ? 's' : ''} it from no API`);
  for (const table of summary.sharedTables) lines.push(`${table.table} is written by ${table.writers.join(' and ')}: one resource, owned by ${table.owner}, every writer depends on it`);
  for (const name of summary.renamed) lines.push(`${name.kind} ${JSON.stringify(name.from)} is named ${name.to} (a catalogue name is [a-z0-9] words joined by - _ .)`);
  if (summary.inline.length > 0) lines.push(`no single document for ${summary.inline.join(', ')}: an inline definition of the operations instead`);
  if (summary.heuristic.leftOut > 0) lines.push(`${plural(summary.heuristic.leftOut, 'heuristic join')} left out (--include-heuristic draws them, named in flowatlas/heuristic-relations)`);
  if (summary.heuristic.drawn > 0) lines.push(`${plural(summary.heuristic.drawn, 'relation')} drawn from a heuristic join only, named in flowatlas/heuristic-relations`);
  return lines;
};

const structurizrLines = (summary: StructurizrSummary, maxFlows: number, maxLabels: number): string[] => {
  const lines: string[] = [];
  if (summary.flows.cut > 0) lines.push(`${plural(summary.flows.cut, 'more flow')} crossed containers, past --max-flows ${maxFlows}`);
  if (summary.flows.repeated > 0) lines.push(`${plural(summary.flows.repeated, 'way in', 'ways in')} ${summary.flows.repeated === 1 ? 'draws' : 'draw'} the same steps as a flow ranked above them: drawn once`);
  if (summary.flows.nothingCrosses > 0) lines.push(`${plural(summary.flows.nothingCrosses, 'way in', 'ways in')} never ${summary.flows.nothingCrosses === 1 ? 'leaves' : 'leave'} one container: no dynamic view`);
  if (summary.collapsed > 0) lines.push(`${plural(summary.collapsed, 'relationship')} ${summary.collapsed === 1 ? 'lists' : 'list'} more than --max-labels ${maxLabels} and ${summary.collapsed === 1 ? 'says' : 'say'} "+N more"`);
  if (summary.stepsCut > 0) lines.push(`${plural(summary.stepsCut, 'step')} of the drawn flows left out: no relationship of the model under them (a heuristic join, a cache)`);
  if (summary.heuristic.leftOut > 0) lines.push(`${plural(summary.heuristic.leftOut, 'heuristic join')} left out (--include-heuristic draws them, tagged Heuristic)`);
  if (summary.heuristic.drawn > 0) lines.push(`${plural(summary.heuristic.drawn, 'relationship')} drawn from heuristic joins only, tagged Heuristic`);
  return lines;
};

/** A file as a person reads it: from the configuration's directory when it is under it. */
const shownPath = (rootDir: string, file: string): string => {
  const path = relative(rootDir, file);
  return path.startsWith('..') ? file : path;
};

/**
 * Writes the export, or with `--check` compares it with what is there. The
 * files are complete (I9); what was bounded or left out is counted in what
 * the run says.
 */
export const runExport = (kindAsked: string, options: ExportCommandOptions, io: QueryIo = processIo): ExportRun => {
  const kind = oneOf(kindAsked, EXPORT_KINDS, 'backstage', 'the export kind');
  const maxFlows = whole(options.maxFlows, DEFAULT_EXPORT_FLOWS, '--max-flows');
  const maxLabels = whole(options.maxLabels, DEFAULT_MAX_LABELS, '--max-labels');
  const loaded = loadConfig(options.config ?? process.cwd());
  const services = wanted(loaded, options.service);
  const only = options.service === undefined || options.service.length === 0 ? undefined : services;
  const outDir = outDirOf(loaded, kind, options.out, options.check !== true);
  const project = projectNameOf(loaded, services);
  const exportServices = exportServicesOf(loaded);
  const includeHeuristic = options.includeHeuristic === true;

  const { db, close } = openProjectDb({ ...(options.config === undefined ? {} : { config: options.config }), ...(options.db === undefined ? {} : { db: options.db }) });
  let backstage: BackstageExport | undefined;
  let structurizr: StructurizrExport | undefined;
  try {
    const graph = { nodes: db.allNodes(), edges: db.allEdges() };
    if (kind === 'backstage') {
      const documents = writeSpecs(db, services, { ...specOptionsOf(loaded.config, { depth: DEFAULT_SPEC_DEPTH }), kind: 'both' }).map((spec) => ({
        service: spec.service,
        kind: spec.kind,
        file: specFileName(spec, 'yaml'),
        text: renderSpecFile(spec, 'yaml'),
      }));
      backstage = exportBackstage(graph, { services: exportServices, ...(only === undefined ? {} : { only }), includeHeuristic, documents, project });
    } else {
      const asked = options.flow ?? [];
      structurizr = exportStructurizr(graph, {
        services: exportServices,
        project,
        ...(only === undefined ? {} : { only }),
        includeHeuristic,
        maxLabels,
        maxFlows,
        flows: flowsOf(db, loaded, services, asked),
        asked: asked.length > 0,
      });
    }
  } finally {
    close();
  }
  const written: ExportFile[] = (backstage ?? structurizr)?.files ?? [];

  let files: ExportFileState[];
  if (options.check === true) {
    files = written.map(({ path, text }) => {
      const file = join(outDir, path);
      if (!existsSync(file)) return { file, path, state: 'missing' as const };
      const there = readFileSync(file, 'utf8');
      return there === text ? { file, path, state: 'same' as const } : { file, path, state: 'differs' as const, difference: firstDifference(there, text, !path.endsWith('.dsl')) };
    });
    // A file of this export the run would not write any more: the entities of a service that left, a table nobody queries now.
    // Only a file flowatlas wrote counts; a hand-kept entity beside the export is the team's.
    const writing = new Set(written.map(({ path }) => path));
    const ours = (name: string): boolean =>
      kind === 'backstage' ? name.endsWith('.yaml') && readFileSync(join(outDir, name), 'utf8').includes('flowatlas') : name === STRUCTURIZR_FILE;
    if (existsSync(outDir)) {
      for (const name of readdirSync(outDir).sort()) {
        if (!ours(name) || writing.has(name)) continue;
        files.push({ file: join(outDir, name), path: name, state: 'stale' });
      }
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    for (const { path, text } of written) writeFileSync(join(outDir, path), text, 'utf8');
    files = written.map(({ path }) => ({ file: join(outDir, path), path }));
  }

  const outOfDate = files.filter((file) => file.state !== undefined && file.state !== 'same');
  const exitCode = outOfDate.length > 0 ? EXIT.failed : EXIT.ok;
  const shownDir = shownPath(loaded.rootDir, outDir);

  let text: string;
  if (options.json === true) {
    text = `${JSON.stringify(
      {
        kind,
        out: shownDir,
        files: files.map((file) => ({ path: file.path, ...(file.state === undefined ? {} : { state: file.state }), ...(file.difference === undefined ? {} : { difference: file.difference }) })),
        ...(backstage === undefined ? {} : { entities: backstage.entities, summary: backstage.summary }),
        ...(structurizr === undefined ? {} : { model: structurizr.model, summary: structurizr.summary }),
      },
      null,
      2,
    )}\n`;
  } else {
    const lines: string[] = [];
    if (backstage !== undefined) {
      const { summary } = backstage;
      lines.push(
        `backstage: ${plural(summary.components, 'component')}, ${plural(summary.apis, 'API')}, ${plural(summary.resources, 'resource')} in ${plural(written.length, 'file')} -> ${shownDir} (register ${BACKSTAGE_LOCATION_FILE})`,
        ...backstageLines(summary),
      );
    }
    if (structurizr !== undefined) {
      const { summary } = structurizr;
      lines.push(
        `structurizr: ${plural(summary.containers, 'container')}, ${plural(summary.externals, 'system')} outside, ${plural(summary.relationships, 'relationship')}, ${plural(summary.flows.drawn, 'dynamic view')} -> ${join(shownDir, STRUCTURIZR_FILE)}`,
        ...structurizrLines(summary, maxFlows, maxLabels),
      );
    }
    if (options.check === true) {
      if (outOfDate.length === 0) lines.push(`check: every file in ${shownDir} is what would be written now`);
      for (const file of outOfDate) {
        lines.push(`${file.path}: ${file.state === 'stale' ? 'stale (no longer written)' : file.state}`);
        if (file.difference?.added !== undefined) lines.push(`  + ${file.difference.added}`);
        if (file.difference?.removed !== undefined) lines.push(`  - ${file.difference.removed}`);
      }
    }
    text = `${lines.join('\n')}\n`;
  }
  io.out(text);
  return { kind, outDir, files, text, exitCode, ...(backstage === undefined ? {} : { backstage }), ...(structurizr === undefined ? {} : { structurizr }) };
};

const withCommonOptions = (command: Command): Command =>
  command
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'graph database (default: the configured output)')
    .option('--out <dir>', `where to write (default: <output>/${EXPORT_DIR}/<kind>/; never inside a configured repository)`)
    .option('--service <name>', 'only this service, repeatable', collect, [])
    .option('--include-heuristic', 'also draw joins the linker only guessed, marked as such')
    .option('--check', 'write nothing; exit 1 when a file there differs from what would be written now, naming the first relation')
    .option('--json', 'print what would be written as data');

export const registerExport = (program: Command): void => {
  const command = program.command('export').description('the map as a Backstage catalogue or a Structurizr workspace, written from the graph');
  const finish = (kind: ExportKind) => (options: ExportCommandOptions) => {
    const run = runExport(kind, options);
    if (run.exitCode !== EXIT.ok) throw new CliError(`${plural(run.files.filter((file) => file.state !== 'same').length, 'file')} there ${run.files.filter((file) => file.state !== 'same').length === 1 ? 'is' : 'are'} not what would be written now`, EXIT.failed);
  };
  withCommonOptions(command.command('backstage').description('catalog-info entities: providesApis, consumesApis and dependsOn from the joins')).action(finish('backstage'));
  withCommonOptions(command.command('structurizr').description('a C4 workspace: the container view and one dynamic view per flow'))
    .option('--flow <entry>', 'draw this way in, repeatable (default: the flows that cross the most services)', collect, [])
    .option('--max-flows <n>', `most dynamic views (default ${DEFAULT_EXPORT_FLOWS})`)
    .option('--max-labels <n>', `labels a relationship lists before "+N more" (default ${DEFAULT_MAX_LABELS})`)
    .action(finish('structurizr'));
};
