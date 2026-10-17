import type { GraphBuilder } from '../builder.js';
import { patternFilesFor, type FlowatlasConfig, type ServiceConfig } from '../config.js';
import { normalizeFilePath } from '../ids.js';
import type { Unresolved } from '../model/graph.js';
import { compilePattern, isCompiled, type CompiledRule, type PatternRefusal } from './compile.js';
import { patternsFor, type PatternFileReading } from './schema.js';

/**
 * Pattern files, read for one service and folded into its configuration
 * (P121).
 *
 * What a reader is handed is the configuration it always was, with every
 * compiled rule appended to the descriptions of its kind: a publish under
 * `broker.custom`, a start under `starters`, a table under `db.tables`, a
 * request under `http.clients`. Appended rather than put first, so a
 * description written by hand is read first wherever order decides; where
 * both match one call the readers say so (`pattern-shadowed`). Nothing else
 * in the reading changes, which is the whole of I2.
 */

/** A compiled rule, with where it is written. */
export interface PlacedRule {
  readonly compiled: CompiledRule;
  readonly file: string;
  readonly line: number;
}

/** A rule that was refused, with where it is written. */
export interface RefusedRule {
  readonly id?: string;
  readonly file: string;
  readonly line: number;
  readonly refusal: PatternRefusal;
}

export interface PatternReading {
  /** The configuration with every compiled rule among its descriptions. */
  readonly config: FlowatlasConfig;
  readonly files: readonly PatternFileReading[];
  readonly rules: readonly PlacedRule[];
  readonly refused: readonly RefusedRule[];
  /** The files the service's own list names, which only it reports. */
  readonly own: readonly string[];
  /** Whether this service says what is wrong with the project's own list: the first one read. */
  readonly speaksForProject: boolean;
}

/** Every rule of the files, compiled, a later rule with an id already used refused. */
const compileFiles = (files: readonly PatternFileReading[]): { rules: PlacedRule[]; refused: RefusedRule[] } => {
  const rules: PlacedRule[] = [];
  const refused: RefusedRule[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    for (const reading of file.rules) {
      const at = { file: reading.file, line: reading.line, ...(reading.id === undefined ? {} : { id: reading.id }) };
      if (reading.rule === undefined) {
        refused.push({ ...at, refusal: reading.refused ?? { part: 'rule', reason: 'not a rule' } });
        continue;
      }
      const earlier = seen.get(reading.rule.id);
      if (earlier !== undefined && earlier !== reading.file) {
        refused.push({ ...at, refusal: { part: 'id', reason: `${reading.rule.id} is the id of a rule in ${earlier} too` } });
        continue;
      }
      seen.set(reading.rule.id, reading.file);
      const result = compilePattern(reading.rule);
      if (isCompiled(result)) rules.push({ compiled: result.compiled, file: reading.file, line: reading.line });
      else refused.push({ ...at, refusal: result.refused });
    }
  }
  return { rules, refused };
};

/**
 * The configuration with compiled rules among its descriptions. Pure: the
 * configuration handed in is left as it is.
 */
export const withCompiledRules = (config: FlowatlasConfig, rules: readonly CompiledRule[]): FlowatlasConfig => {
  if (rules.length === 0) return config;
  const of = <S extends CompiledRule['descriptor']['slot']>(slot: S) =>
    rules.flatMap((rule) => (rule.descriptor.slot === slot ? [rule.descriptor as Extract<CompiledRule['descriptor'], { slot: S }>] : []));
  return {
    ...config,
    adapters: {
      ...config.adapters,
      broker: { ...config.adapters.broker, custom: [...config.adapters.broker.custom, ...of('broker').map((each) => each.broker)] },
      starters: [...config.adapters.starters, ...of('starter').map((each) => each.starter)],
      db: { ...config.adapters.db, tables: [...config.adapters.db.tables, ...of('table').map((each) => each.table)] },
      http: { ...config.adapters.http, clients: [...config.adapters.http.clients, ...of('http').map((each) => each.client)] },
    },
  };
};

/** Whether a service speaks for the project's list: the first repository the configuration names. */
const speaksForProject = (config: FlowatlasConfig, service: ServiceConfig | undefined): boolean => {
  const first = config.services.find((each) => each.document === undefined);
  return service === undefined || first === undefined || first.name === service.name;
};

/**
 * Reads the pattern files a service lists and folds their rules into its
 * configuration. Without a configuration's directory, or with no files
 * listed, the configuration is handed back as it was.
 */
export const readPatterns = (options: {
  readonly config: FlowatlasConfig;
  readonly service: ServiceConfig | undefined;
  readonly configDir: string | undefined;
}): PatternReading => {
  const { config, service, configDir } = options;
  const files = patternsFor(config, service, configDir);
  const { rules, refused } = compileFiles(files);
  return {
    config: withCompiledRules(config, rules.map((rule) => rule.compiled)),
    files,
    rules,
    refused,
    own: configDir === undefined ? [] : patternFilesFor(undefined, service, configDir),
    speaksForProject: speaksForProject(config, service),
  };
};

/**
 * Records what of a service's pattern files could not be used (P121): one
 * `pattern-file-unread` per listed file that gave nothing, one
 * `pattern-not-expressible` per rule refused, with the part named. A file of
 * the project's list is reported by the first service only, as a shape file
 * is, so one mistake is one row.
 */
export const reportPatterns = (
  context: { readonly builder: GraphBuilder; readonly repoDir: string },
  reading: PatternReading,
): readonly Unresolved[] => {
  const rows: Unresolved[] = [];
  const reports = (path: string): boolean => reading.own.includes(path) || reading.speaksForProject;
  for (const file of reading.files) {
    if (file.problem === undefined || !reports(file.path)) continue;
    const at = normalizeFilePath(file.path, context.repoDir);
    rows.push(
      context.builder.addUnresolved({
        file: at,
        line: 1,
        reason: 'pattern-file-unread',
        symbol: at,
        message: `the pattern file ${at} is listed under patterns and was not read: ${file.problem}`,
        hint: 'Fix the path or the glob under patterns in flowatlas.config.json, or the file: it is a YAML list of rules (flowatlas patterns test reads it the way the build does).',
      }),
    );
  }
  for (const refused of reading.refused) {
    if (!reports(refused.file)) continue;
    const at = normalizeFilePath(refused.file, context.repoDir);
    const named = refused.id === undefined ? 'a rule' : `the rule ${refused.id}`;
    rows.push(
      context.builder.addUnresolved({
        file: at,
        line: refused.line,
        reason: 'pattern-not-expressible',
        symbol: refused.id ?? at,
        message: `${named} is not read: ${refused.refusal.part}: ${refused.refusal.reason}`,
        hint: 'Nothing of the rule is read until it compiles. Change the part named, or describe the call under adapters in flowatlas.config.json; flowatlas patterns test shows the same refusal.',
        meta: { part: refused.refusal.part, ...(refused.id === undefined ? {} : { rule: refused.id }) },
      }),
    );
  }
  return rows;
};
