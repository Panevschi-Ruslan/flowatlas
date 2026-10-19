import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  compilePattern,
  guessPatternKind,
  httpVerbOf,
  importOf,
  isBelowDir,
  isCompiled,
  isWithinDir,
  patternFilesFor,
  patternRuleSchema,
  PATTERN_CAUSES,
  serviceDirOf,
  type LoadedConfig,
  type PatternExpectation,
  type Unresolved,
} from '@flowatlas/core';
import { Node, type CallExpression, type Node as TsNode } from 'ts-morph';
import { stringify } from 'yaml';
import { CliError, EXIT } from '../exit.js';
import { placesOfRow, receiverPackageOf, receiverTypeOf, ServiceSources, siteNamed, type Place } from './places.js';
import { runSample } from './sample.js';

/**
 * `flowatlas patterns suggest`: starter rules for the wrappers the reader
 * could not follow most often (P121).
 *
 * The places come from the built graph - the Can't follow rows a pattern is
 * the usual fix for (`PATTERN_CAUSES`) - and each is opened to read the call
 * written there: the method, the type of what it is called on (the checker's,
 * or what the source states), or the function. Places are grouped by the two,
 * every call of the same method on the same type in the service is counted,
 * and a group of at least `--min-sites` gets a starter: the kind guessed from
 * the names, a pattern written from the first call's own shape, the holes it
 * can place, `TODO` where it cannot tell, and two tests from the first calls
 * with what the starter makes of them. Nothing is read until a person lists
 * the file under `patterns`.
 */

/** Version of the JSON this prints. */
export const PATTERNS_SUGGEST_FORMAT_VERSION = 1;

export interface SuggestOptions {
  readonly minSites: number;
  readonly cause?: string;
  readonly service?: string;
}

export interface SuggestedRule {
  readonly id: string;
  readonly kind: string;
  /** What the calls are made on, or the function they call. */
  readonly receiverType?: string;
  readonly function?: string;
  readonly module?: string;
  readonly method: string;
  readonly sites: number;
  readonly services: readonly string[];
  /** The reasons of the rows the group came from. */
  readonly reasons: readonly string[];
  readonly places: readonly Place[];
  /** The starter, as YAML to write into a pattern file. */
  readonly yaml: string;
  /** Whether the starter compiles as it is, or has a `TODO` to fill first. */
  readonly compiles: boolean;
}

export interface PatternsSuggestReport {
  patternsSuggestFormatVersion: typeof PATTERNS_SUGGEST_FORMAT_VERSION;
  readonly minSites: number;
  readonly total: { readonly places: number; readonly groups: number };
  readonly rules: readonly SuggestedRule[];
  /** Groups left out by `--min-sites`, with how many places each has. */
  readonly below: readonly { readonly group: string; readonly sites: number }[];
  written?: string[];
  kept?: string[];
  /** The glob to add under `patterns` when what `--out` wrote is not read yet. */
  listPatterns?: string;
}

const kebab = (text: string): string =>
  text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

const holeName = (key: string): string => `$${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`;

const KEYS: Readonly<Record<string, RegExp>> = {
  channel: /^(topic|channel|event|eventName|name|type|subject|queue|routingKey|key)$/i,
  payload: /^(data|payload|body|message|detail|event|value)$/i,
  url: /^(path|url|endpoint|uri|route)$/i,
  verb: /^(method|verb)$/i,
  body: /^(body|data|payload|json)$/i,
  table: /^(table|collection|entity|model)$/i,
  name: /^(name|workflow|process|function|flow)$/i,
};

/** One argument of the first call, as a pattern writes it, with the role each hole may play. */
interface Shaped {
  readonly text: string;
  /** Holes and what kind of value is written at each: `string`, `function`, `value`. */
  readonly holes: readonly { readonly hole: string; readonly key?: string; readonly written: 'string' | 'verb' | 'function' | 'value' }[];
}

const writtenAs = (value: TsNode | undefined): 'string' | 'verb' | 'function' | 'value' => {
  if (value === undefined) return 'value';
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) return httpVerbOf(value.getLiteralText()) === undefined ? 'string' : 'verb';
  if (Node.isTemplateExpression(value)) return 'string';
  if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) return 'function';
  return 'value';
};

const shapeOf = (args: readonly TsNode[]): Shaped => {
  const parts: string[] = [];
  const holes: Array<Shaped['holes'][number]> = [];
  args.forEach((arg, index) => {
    // An object is read key by key only where a key names a part of the
    // call - a topic, a path, a verb - and is otherwise one value: a body.
    const named =
      Node.isObjectLiteralExpression(arg) &&
      arg.getProperties().some((property) => {
        const key = Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property) ? property.getName() : '';
        return ['channel', 'url', 'verb', 'table', 'name'].some((field) => KEYS[field]?.test(key) === true);
      });
    if (Node.isObjectLiteralExpression(arg) && named) {
      const keys: string[] = [];
      for (const property of arg.getProperties()) {
        if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) continue;
        const key = property.getName();
        const hole = holeName(key);
        keys.push(`${key}: ${hole}`);
        holes.push({ hole, key, written: writtenAs(Node.isPropertyAssignment(property) ? property.getInitializer() : undefined) });
      }
      parts.push(`{ ${keys.join(', ')} }`);
      return;
    }
    const written = writtenAs(arg);
    const hole = written === 'function' ? '$HANDLER' : `$ARG${index}`;
    holes.push({ hole, written });
    parts.push(hole);
  });
  return { text: parts.join(', '), holes };
};


/** The fields a starter of a kind names, from the first call's holes; `TODO` where none fits. */
const fieldsOf = (kind: string, shape: Shaped): Record<string, string> => {
  const holes = shape.holes;
  const byKey = (field: string, used: Set<string>): string | undefined =>
    holes.find((each) => each.key !== undefined && KEYS[field]?.test(each.key) === true && !used.has(each.hole))?.hole;
  const firstString = (used: Set<string>): string | undefined =>
    holes.find((each) => each.key === undefined && each.written === 'string' && !used.has(each.hole))?.hole;
  const next = (after: string | undefined, used: Set<string>): string | undefined => {
    const at = holes.findIndex((each) => each.hole === after);
    return holes.slice(at + 1).find((each) => each.written !== 'function' && !used.has(each.hole))?.hole;
  };
  const pick = (found: string | undefined, used: Set<string>): string => {
    if (found === undefined) return 'TODO';
    used.add(found);
    return found;
  };
  const used = new Set<string>();
  switch (kind) {
    case 'publish': {
      const channel = pick(byKey('channel', used) ?? firstString(used), used);
      return { channel, payload: pick(byKey('payload', used) ?? next(channel, used), used) };
    }
    case 'subscribe':
      return {
        channel: pick(firstString(used) ?? byKey('channel', used), used),
        handler: pick(holes.find((each) => each.written === 'function')?.hole, used),
      };
    case 'http-request': {
      const verb = pick(holes.find((each) => each.written === 'verb')?.hole ?? byKey('verb', used), used);
      const url = pick(byKey('url', used) ?? firstString(used), used);
      const body = byKey('body', used) ?? next(url, used);
      return { verb, url, ...(body === undefined ? {} : { body: pick(body, used) }) };
    }
    case 'table':
      return { table: pick(byKey('table', used) ?? firstString(used), used) };
    case 'start':
      return { name: pick(byKey('name', used) ?? firstString(used), used), target: 'TODO' };
    default:
      return {};
  }
};

/** What a call is: a method on a type, or a function. */
interface CallGroup {
  readonly key: string;
  readonly method: string;
  readonly receiverType?: string;
  readonly function?: string;
  readonly module?: string;
}

const groupOf = (call: CallExpression): CallGroup | undefined => {
  const callee = call.getExpression();
  if (Node.isPropertyAccessExpression(callee)) {
    const type = receiverTypeOf(callee.getExpression());
    if (type === undefined || type === 'any' || type === '__type') return undefined;
    const pkg = receiverPackageOf(callee.getExpression());
    return { key: `${type}.${callee.getName()}`, method: callee.getName(), receiverType: type, ...(pkg === undefined ? {} : { module: pkg }) };
  }
  if (Node.isIdentifier(callee)) {
    const imported = importOf(callee);
    const name = imported?.exported ?? callee.getText();
    return { key: `${name}()`, method: name, function: name, ...(imported === undefined ? {} : { module: imported.module }) };
  }
  return undefined;
};

/** Every call of the group in a service's own source files. */
const callsOfGroup = (sources: ServiceSources, loaded: LoadedConfig, service: string, group: CallGroup): CallExpression[] => {
  const config = sources.service(service);
  if (config === undefined) return [];
  const repoDir = loaded.repoDir(config);
  const found: CallExpression[] = [];
  for (const source of sources.project(config).getSourceFiles()) {
    const path = source.getFilePath();
    // The compiler's path against the OS's directory (P199).
    if (path.includes('/node_modules/') || !isBelowDir(path, repoDir)) continue;
    source.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : Node.isIdentifier(callee) ? callee.getText() : undefined;
      if (name !== group.method && group.function === undefined) return;
      if (groupOf(node)?.key === group.key) found.push(node);
    });
  }
  return found;
};

/** Whether a row is about a place a pattern may fix, by its reason or the cause it records. */
const isPatternPlace = (row: Unresolved, cause: string | undefined): boolean => {
  if (!PATTERN_CAUSES.includes(row.reason)) return false;
  if (cause === undefined) return true;
  const causes = [row.meta?.['cause'], ...(((row.meta?.['causes'] as Array<{ cause?: string }> | undefined) ?? []).map((each) => each.cause))];
  return row.reason === cause || causes.includes(cause);
};

const starterOf = (group: CallGroup, kind: string, first: CallExpression): { rule: Record<string, unknown>; shape: Shaped } => {
  const shape = shapeOf(first.getArguments());
  const pattern = group.function === undefined ? `$RECV.${group.method}(${shape.text})` : `${group.function}(${shape.text})`;
  const on: Record<string, string> = {
    ...(group.receiverType === undefined ? {} : { receiverType: group.receiverType }),
    ...(group.function === undefined ? {} : { function: group.function }),
    ...(group.function !== undefined && group.module !== undefined ? { module: group.module } : {}),
  };
  return {
    rule: {
      id: kebab(group.function ?? `${group.receiverType ?? ''}-${group.method}`),
      kind,
      on,
      pattern,
      ...fieldsOf(kind, shape),
    },
    shape,
  };
};

/** What a starter makes of one call, as a test's expectation. */
const expectationOf = async (rule: Record<string, unknown>, code: string): Promise<PatternExpectation | 'TODO'> => {
  const parsed = patternRuleSchema.safeParse({ ...rule, tests: [] });
  if (!parsed.success) return 'TODO';
  const compiled = compilePattern(parsed.data);
  if (!isCompiled(compiled)) return 'TODO';
  const run = await runSample(parsed.data, compiled.compiled, code);
  const [drawn] = run.drawn;
  if (drawn === undefined) return 'none';
  if (drawn.node === 'http_out' || drawn.node === 'ui_api_call') return { ...(drawn.verb == null ? {} : { verb: drawn.verb }), url: drawn.url ?? '*' };
  if (drawn.node === 'db_query') return { table: drawn.table ?? '*' };
  if (drawn.names !== undefined && drawn.names.length > 0) return { name: drawn.names[0] as string };
  return { channel: drawn.channels?.[0] ?? '*' };
};

/** The suggestion, as data. Read-only. */
export const suggestPatterns = async (
  loaded: LoadedConfig,
  rows: readonly Unresolved[],
  options: SuggestOptions,
): Promise<PatternsSuggestReport> => {
  const sources = new ServiceSources(loaded);
  const places = rows
    .filter((row) => isPatternPlace(row, options.cause) && (options.service === undefined || row.service === options.service))
    .flatMap(placesOfRow);
  const groups = new Map<string, { group: CallGroup; services: Set<string>; reasons: Set<string>; places: Place[] }>();
  for (const row of rows) {
    if (!isPatternPlace(row, options.cause) || (options.service !== undefined && row.service !== options.service)) continue;
    for (const place of placesOfRow(row)) {
      const site = siteNamed(sources.sitesAt(place), place.symbol);
      if (site === undefined || !Node.isCallExpression(site)) continue;
      const group = groupOf(site);
      if (group === undefined) continue;
      const entry = groups.get(group.key) ?? { group, services: new Set<string>(), reasons: new Set<string>(), places: [] };
      entry.services.add(place.service);
      entry.reasons.add(row.reason);
      entry.places.push(place);
      groups.set(group.key, entry);
    }
  }

  const rules: SuggestedRule[] = [];
  const below: Array<{ group: string; sites: number }> = [];
  const counted = [...groups.values()].map((entry) => {
    const calls = [...entry.services].sort().flatMap((service) => callsOfGroup(sources, loaded, service, entry.group).map((call) => ({ service, call })));
    return { entry, calls };
  });
  counted.sort((a, b) => b.calls.length - a.calls.length || (a.entry.group.key < b.entry.group.key ? -1 : 1));
  for (const { entry, calls } of counted) {
    const sites = Math.max(calls.length, entry.places.length);
    if (sites < options.minSites) {
      below.push({ group: entry.group.key, sites });
      continue;
    }
    const first = calls[0]?.call;
    if (first === undefined) continue;
    const kind = guessPatternKind(entry.group.method, `${entry.group.receiverType ?? ''} ${entry.group.module ?? ''}`);
    const { rule } = starterOf(entry.group, kind, first);
    const tests = [];
    for (const { call } of calls.slice(0, 2)) {
      const code = call.getText().replace(/\s+/g, ' ');
      tests.push({ code, expect: await expectationOf(rule, code) });
    }
    const parsed = patternRuleSchema.safeParse({ ...rule, tests: [] });
    const compiles = parsed.success && isCompiled(compilePattern(parsed.data));
    const header = [
      `# A starter for ${entry.group.key}: ${sites} call(s) in ${[...entry.services].sort().join(', ')} the reader could not follow (${[...entry.reasons].sort().join(', ')}).`,
      `# Written by flowatlas patterns suggest from the first calls' shapes. Check the kind and fill every TODO;`,
      `# then run flowatlas patterns test on this file, and list it under "patterns" in flowatlas.config.json.`,
    ];
    rules.push({
      id: rule['id'] as string,
      kind,
      ...(entry.group.receiverType === undefined ? {} : { receiverType: entry.group.receiverType }),
      ...(entry.group.function === undefined ? {} : { function: entry.group.function }),
      ...(entry.group.module === undefined ? {} : { module: entry.group.module }),
      method: entry.group.method,
      sites,
      services: [...entry.services].sort(),
      reasons: [...entry.reasons].sort(),
      places: entry.places.slice(0, 3),
      yaml: `${header.join('\n')}\n${stringify([{ ...rule, tests }], { lineWidth: 0 })}`,
      compiles,
    });
  }
  return {
    patternsSuggestFormatVersion: PATTERNS_SUGGEST_FORMAT_VERSION,
    minSites: options.minSites,
    total: { places: places.length, groups: groups.size },
    rules,
    below,
  };
};

/** A path as the configuration would write it: relative where it is under it, absolute where it is not. */
const relativeTo = (root: string, path: string): string => {
  const rel = relative(root, path);
  if (rel === '') return '.';
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel.split(sep).join('/');
};

/** Writes each starter as a file of its own; never into a repository the configuration reads, never over a file. */
export const writeStarters = (
  loaded: LoadedConfig,
  report: PatternsSuggestReport,
  outDir: string,
  force: boolean,
): void => {
  const out = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);
  for (const service of loaded.config.services) {
    if (service.document !== undefined) continue;
    const dir = serviceDirOf(loaded.rootDir, service.repo);
    if (isWithinDir(out, dir)) {
      throw new CliError(
        `--out ${outDir} is inside the repository of ${service.name}; pattern files are kept beside the configuration, not in a repository it reads`,
        EXIT.cannotRun,
      );
    }
  }
  const written: string[] = [];
  const kept: string[] = [];
  for (const rule of report.rules) {
    const path = join(out, `${rule.id}.yml`);
    const name = relativeTo(loaded.rootDir, path);
    if (existsSync(path) && !force) {
      kept.push(name);
      continue;
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(path, rule.yaml, 'utf8');
    written.push(name);
  }
  report.written = written;
  report.kept = kept;
  const listed = new Set(loaded.config.services.flatMap((service) => patternFilesFor(loaded.config, service, loaded.rootDir)));
  const dir = relativeTo(loaded.rootDir, out);
  const read = [...written, ...kept].every((file) => listed.has(resolve(loaded.rootDir, file)));
  if (!read && written.length + kept.length > 0) report.listPatterns = `${dir === '.' || isAbsolute(dir) ? dir : `./${dir}`}/*.yml`;
};

export const renderPatternsSuggest = (report: PatternsSuggestReport): string => {
  const lines: string[] = [
    `places a pattern could fix: ${report.total.places} over ${report.total.groups} call shape(s); starters for those with at least ${report.minSites} call(s)`,
  ];
  if (report.rules.length === 0) lines.push('  none: no call shape is reached that often (--min-sites lowers the bar)');
  for (const rule of report.rules) {
    lines.push(
      '',
      `${rule.id}: ${rule.kind}, ${rule.sites} call(s) of ${rule.function === undefined ? `${rule.receiverType}.${rule.method}` : `${rule.function}()`} in ${rule.services.join(', ')}${rule.compiles ? '' : ' (fill the TODOs first)'}`,
    );
    for (const place of rule.places) lines.push(`  at ${place.service}/${place.file}:${place.line}`);
    lines.push(...rule.yaml.trimEnd().split('\n').map((line) => `  | ${line}`));
  }
  for (const group of report.below) lines.push('', `${group.group}: ${group.sites} call(s), below --min-sites`);
  for (const file of report.written ?? []) lines.push('', `wrote ${file}`);
  for (const file of report.kept ?? []) lines.push('', `kept ${file}: it is there already (--force writes over it)`);
  if (report.written === undefined && report.rules.length > 0) {
    lines.push('', 'next: flowatlas patterns suggest --out <dir> writes each starter to a file; fill the TODOs, run flowatlas patterns test, and list them under "patterns"');
  } else if (report.listPatterns !== undefined) {
    lines.push('', `next: fill the TODOs, run flowatlas patterns test, and add "patterns": ["${report.listPatterns}"] to flowatlas.config.json`);
  }
  return `${lines.join('\n')}\n`;
};
