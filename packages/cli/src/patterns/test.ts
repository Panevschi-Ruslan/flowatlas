import {
  compilePattern,
  isCompiled,
  readPatternText,
  type FlowatlasConfig,
  type PatternExpectation,
  type PatternFileReading,
  type PatternRefusal,
  type PatternRule,
  type CompiledRule,
} from '@flowatlas/core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { runSample, type Drawn, type SampleOptions, type SampleRow } from './sample.js';

/**
 * `flowatlas patterns test`: every rule's own tests, run before a build trusts
 * the rule (P121).
 *
 * A test is a piece of code and what the rule should make of it: a channel,
 * a verb and an address, a table, a name, a row - or `none`, for code the
 * rule must leave alone. Each is run by the reader the build runs (see
 * `sample.ts`) and passes when every field it states holds; a field it does
 * not state is not asked. A rule that does not compile has no tests to run
 * and is reported with the part that cannot be said, as the build reports it.
 */

/** Version of the JSON this prints. Bump it when a field is removed or changes meaning. */
export const PATTERNS_TEST_FORMAT_VERSION = 1;

export interface TestOutcome {
  readonly code: string;
  readonly expect: PatternExpectation;
  readonly pass: boolean;
  /** Why it failed, field by field; empty when it passed. */
  readonly failures: readonly string[];
  readonly drawn: readonly Drawn[];
  readonly rows: readonly SampleRow[];
  readonly captures: Readonly<Record<string, string>>;
}

export interface RuleOutcome {
  readonly id: string;
  readonly kind?: string;
  /** Where the rule is written, relative to where the command was asked from. */
  readonly file: string;
  readonly line: number;
  readonly refused?: PatternRefusal;
  readonly tests: readonly TestOutcome[];
  /**
   * What the rule compiles to, as it would be written under `adapters` in
   * `flowatlas.config.json`: the key it goes under and the description.
   */
  readonly descriptor?: { readonly under: string; readonly description: unknown };
}

export interface PatternsTestReport {
  patternsTestFormatVersion: typeof PATTERNS_TEST_FORMAT_VERSION;
  readonly files: readonly { readonly file: string; readonly problem?: string }[];
  readonly rules: readonly RuleOutcome[];
  readonly total: { readonly rules: number; readonly refused: number; readonly tests: number; readonly failed: number };
}

/** What a rule drew, as the one value a field of a test is compared with. */
const channelsOf = (drawn: readonly Drawn[]): string[] => drawn.flatMap((each) => [...(each.channels ?? [])]);

type Check = (want: string, drawn: readonly Drawn[], rows: readonly SampleRow[]) => string | undefined;

/** One check per field a test may state; each answers why it failed, or nothing. */
const CHECKS: Readonly<Record<string, Check>> = {
  channel: (want, drawn) => {
    const channels = channelsOf(drawn);
    if (want === '*') {
      const unread = drawn.some((each) => (each.node === 'producer' || each.node === 'consumer') && (each.channels ?? []).length === 0);
      return unread ? undefined : `wanted a channel that cannot be read; drew ${channels.join(', ') || 'none'}`;
    }
    return channels.includes(want) ? undefined : `wanted channel ${want}; drew ${channels.join(', ') || 'no channel'}`;
  },
  verb: (want, drawn) => {
    const verbs = drawn.map((each) => each.verb ?? null);
    return verbs.some((verb) => verb !== null && verb.toUpperCase() === want.toUpperCase())
      ? undefined
      : `wanted verb ${want}; drew ${verbs.map((verb) => verb ?? '?').join(', ') || 'no request'}`;
  },
  url: (want, drawn) => {
    const urls = drawn.map((each) => each.url ?? null);
    return urls.some((url) => url === want || (url !== null && url.endsWith(want)))
      ? undefined
      : `wanted address ${want}; drew ${urls.map((url) => url ?? '?').join(', ') || 'no request'}`;
  },
  table: (want, drawn) => {
    const tables = drawn.map((each) => each.table ?? null);
    return tables.includes(want) ? undefined : `wanted table ${want}; drew ${tables.map((table) => table ?? '?').join(', ') || 'no query'}`;
  },
  name: (want, drawn) => {
    const names = drawn.flatMap((each) => [...(each.names ?? [])]);
    return names.includes(want) ? undefined : `wanted to start ${want}; drew ${names.join(', ') || 'no start'}`;
  },
  row: (want, _drawn, rows) =>
    rows.some((row) => row.reason === want) ? undefined : `wanted a ${want} row; the code left ${rows.map((row) => row.reason).join(', ') || 'none'}`,
};

/** Why a test failed, or nothing when it passed. */
export const failuresOf = (expect: PatternExpectation, drawn: readonly Drawn[], rows: readonly SampleRow[]): string[] => {
  if (expect === 'none') {
    return drawn.length === 0 ? [] : [`wanted nothing; drew ${drawn.map((each) => `${each.node} ${each.label}`).join(', ')}`];
  }
  const asked = Object.entries(expect).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  // Anything at all is the one thing every expectation but a row asks for.
  if (drawn.length === 0 && asked.some(([field]) => field !== 'row')) return ['the rule drew nothing from this code'];
  return asked.flatMap(([field, want]) => {
    const check = CHECKS[field];
    const why = check?.(want, drawn, rows);
    return why === undefined ? [] : [why];
  });
};

/** Runs one rule's tests, or says why it does not compile. */
export const testRule = async (
  rule: PatternRule,
  at: { readonly file: string; readonly line: number },
  options: SampleOptions = {},
): Promise<RuleOutcome> => {
  const result = compilePattern(rule);
  if (!isCompiled(result)) return { id: rule.id, kind: rule.kind, ...at, refused: result.refused, tests: [] };
  const tests: TestOutcome[] = [];
  for (const test of rule.tests) {
    const run = await runSample(rule, result.compiled, test.code, options);
    const failures = failuresOf(test.expect, run.drawn, run.rows);
    tests.push({ code: test.code, expect: test.expect, pass: failures.length === 0, failures, drawn: run.drawn, rows: run.rows, captures: run.captures });
  }
  return { id: rule.id, kind: rule.kind, ...at, tests, descriptor: writtenAs(result.compiled) };
};

/** Where a compiled rule would be written in configuration, and as what. */
const UNDER: Readonly<Record<CompiledRule['descriptor']['slot'], string>> = {
  broker: 'adapters.broker.custom',
  starter: 'adapters.starters',
  table: 'adapters.db.tables',
  http: 'adapters.http.clients',
};

const writtenAs = (compiled: CompiledRule): { under: string; description: unknown } => {
  const { descriptor } = compiled;
  const description =
    descriptor.slot === 'broker'
      ? descriptor.broker
      : descriptor.slot === 'starter'
        ? descriptor.starter
        : descriptor.slot === 'table'
          ? descriptor.table
          : descriptor.client;
  return { under: UNDER[descriptor.slot], description };
};

/** Runs every rule of the files read. */
export const testPatternFiles = async (
  readings: readonly PatternFileReading[],
  nameOf: (path: string) => string,
  options: { readonly config?: FlowatlasConfig; readonly only?: string; readonly sample?: SampleOptions['service'] } = {},
): Promise<PatternsTestReport> => {
  const rules: RuleOutcome[] = [];
  for (const reading of readings) {
    for (const each of reading.rules) {
      if (options.only !== undefined && each.id !== options.only) continue;
      const at = { file: nameOf(each.file), line: each.line };
      if (each.rule === undefined) {
        rules.push({ id: each.id ?? '?', ...at, refused: each.refused ?? { part: 'rule', reason: 'not a rule' }, tests: [] });
        continue;
      }
      rules.push(
        await testRule(each.rule, at, {
          ...(options.config === undefined ? {} : { config: options.config }),
          ...(options.sample === undefined ? {} : { service: options.sample }),
        }),
      );
    }
  }
  const tests = rules.flatMap((rule) => rule.tests);
  return {
    patternsTestFormatVersion: PATTERNS_TEST_FORMAT_VERSION,
    files: readings.map((reading) => ({ file: nameOf(reading.path), ...(reading.problem === undefined ? {} : { problem: reading.problem }) })),
    rules,
    total: {
      rules: rules.length,
      refused: rules.filter((rule) => rule.refused !== undefined).length,
      tests: tests.length,
      failed: tests.filter((test) => !test.pass).length,
    },
  };
};

/** Rules written as YAML text - one rule or a list - read as a pattern file is. */
export const readRulesText = (yaml: string, name = '<yaml>'): PatternFileReading => {
  const listed = readPatternText(name, yaml);
  if (listed.problem !== 'it is not a list of rules') return listed;
  // A single rule written as a mapping is a list of one.
  let value: unknown;
  try {
    value = parseYaml(yaml);
  } catch {
    return listed;
  }
  return typeof value === 'object' && value !== null ? readPatternText(name, stringifyYaml([value])) : listed;
};

const expectText = (expect: PatternExpectation): string =>
  expect === 'none'
    ? 'none'
    : Object.entries(expect)
        .map(([field, value]) => `${field}: ${String(value)}`)
        .join(', ');

const drawnText = (drawn: Drawn): string => {
  if (drawn.node === 'http_out' || drawn.node === 'ui_api_call') return `${drawn.node} ${drawn.verb ?? '?'} ${drawn.url ?? '?'}`;
  if (drawn.node === 'db_query') return `${drawn.node} on ${drawn.table ?? '?'}`;
  if (drawn.names !== undefined && drawn.names.length > 0) return `${drawn.node} starting ${drawn.names.join(', ')}`;
  const channels = drawn.channels ?? [];
  return `${drawn.node} on ${channels.length === 0 ? 'a channel that cannot be read' : channels.map((name) => `channel:${name}`).join(', ')}`;
};

/** The report as a terminal shows it; with `showDescriptor`, what each rule compiles to as well. */
export const renderPatternsTest = (report: PatternsTestReport, options: { readonly showDescriptor?: boolean } = {}): string => {
  const lines: string[] = [];
  for (const file of report.files) if (file.problem !== undefined) lines.push(`${file.file}: not read: ${file.problem}`);
  for (const rule of report.rules) {
    if (rule.refused !== undefined) {
      lines.push(`refused  ${rule.id}  ${rule.file}:${rule.line}`, `  ${rule.refused.part}: ${rule.refused.reason}`);
      continue;
    }
    const failed = rule.tests.filter((test) => !test.pass).length;
    lines.push(`${failed === 0 ? 'ok' : 'FAIL'}  ${rule.id} (${rule.kind ?? '?'})  ${rule.file}:${rule.line}  ${rule.tests.length - failed}/${rule.tests.length} tests`);
    if (options.showDescriptor === true && rule.descriptor !== undefined) {
      lines.push(`  compiles to, under ${rule.descriptor.under}:`);
      for (const line of JSON.stringify(rule.descriptor.description, null, 2).split('\n')) lines.push(`    ${line}`);
    }
    if (rule.tests.length === 0) lines.push('  no tests: the build reads it, and nothing here says it reads what was meant');
    for (const test of rule.tests) {
      lines.push(`  ${test.pass ? 'pass' : 'FAIL'}  ${test.code}`, `        expect ${expectText(test.expect)}`);
      for (const drawn of test.drawn) lines.push(`        drew   ${drawnText(drawn)}`);
      for (const row of test.rows) lines.push(`        row    ${row.reason}`);
      const holes = Object.entries(test.captures);
      if (holes.length > 0) lines.push(`        holes  ${holes.map(([hole, text]) => `${hole} = ${text}`).join('; ')}`);
      for (const failure of test.failures) lines.push(`        why    ${failure}`);
    }
  }
  const { total } = report;
  lines.push(
    '',
    `${total.rules} rule(s), ${total.refused} refused; ${total.tests} test(s), ${total.failed} failed`,
  );
  return `${lines.join('\n')}\n`;
};

/** A drawn node as one line, for an answer that is read rather than parsed. */
export const drawnLine = (drawn: Drawn): string => drawnText(drawn);

/**
 * Rules written as YAML, tested as `flowatlas patterns test` tests them, and
 * run over a piece of code when one is given: what the MCP `test_pattern`
 * answers (P121). A service, when named, types the code in its own program.
 */
export const testPatternText = async (
  input: { readonly yaml: string; readonly code?: string; readonly service?: string },
  project: { readonly config: FlowatlasConfig; readonly service?: SampleOptions['service'] } | undefined,
): Promise<{ rules: PatternTesterRuleLike[]; error?: string }> => {
  const reading = readRulesText(input.yaml);
  if (reading.problem !== undefined) return { rules: [], error: `the YAML is not read: ${reading.problem}` };
  const rules: PatternTesterRuleLike[] = [];
  for (const each of reading.rules) {
    if (each.rule === undefined) {
      rules.push({ id: each.id ?? '?', refused: each.refused ?? { part: 'rule', reason: 'not a rule' }, tests: [] });
      continue;
    }
    const options: SampleOptions = {
      ...(project === undefined ? {} : { config: project.config }),
      ...(project?.service === undefined ? {} : { service: project.service }),
    };
    const outcome = await testRule(each.rule, { file: '<yaml>', line: each.line }, options);
    const tests = outcome.tests.map((test) => ({
      code: test.code,
      pass: test.pass,
      failures: [...test.failures],
      drew: test.drawn.map(drawnText),
      rows: test.rows.map((row) => row.reason),
    }));
    if (outcome.refused !== undefined) {
      rules.push({ id: outcome.id, kind: each.rule.kind, refused: outcome.refused, tests: [] });
      continue;
    }
    let code: PatternTesterRuleLike['code'];
    if (input.code !== undefined) {
      const compiled = compilePattern(each.rule);
      if (isCompiled(compiled)) {
        const run = await runSample(each.rule, compiled.compiled, input.code, options);
        const stopped = run.nearest?.steps.find((step) => !step.ok);
        code = {
          drew: run.drawn.map(drawnText),
          rows: run.rows.map((row) => row.reason),
          holes: { ...run.captures },
          ...(stopped === undefined ? {} : { stoppedAt: `${stopped.part}: ${stopped.detail}` }),
        };
      }
    }
    rules.push({ id: outcome.id, kind: each.rule.kind, tests, ...(code === undefined ? {} : { code }) });
  }
  return { rules };
};

/** One rule as `testPatternText` answers it; the MCP `PatternTesterRule`, said here without importing the server. */
export interface PatternTesterRuleLike {
  id: string;
  kind?: string;
  refused?: { part: string; reason: string };
  tests: Array<{ code: string; pass: boolean; failures: string[]; drew: string[]; rows: string[] }>;
  code?: { drew: string[]; rows: string[]; holes: Record<string, string>; stoppedAt?: string };
}
