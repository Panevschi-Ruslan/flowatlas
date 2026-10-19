/**
 * One SARIF 2.1.0 log from one command's findings (P115).
 *
 * Pure: the findings arrive already adapted (`SarifInput`), and this decides
 * only what is the same for every command - where each path points, how loud
 * each result is, what identifies it, what is cut and how the cut is said.
 * One run per invocation, under `flowatlas/<command>/`, so two commands
 * uploaded from one job are two categories and neither closes the other's
 * alerts (D1).
 *
 * Paths are written as the configuration's directory sees them - a row's file
 * under the directory its service's repository is in, the mapping `doctor
 * --format github` uses (P191) - because code scanning reads a relative URI as
 * relative to the repository the log is uploaded to, and in a project checked
 * out side by side that is where the file is. `--sarif-root` writes them
 * relative to one checkout instead, for a log uploaded to one repository of
 * several; a result whose place is outside it belongs to another upload and
 * is left out, counted.
 */
import { isAbsolute, join, relative, sep } from 'node:path';
import { atLeast, levelRank } from './levels.js';
import { fingerprintOf, partialFingerprints } from './fingerprints.js';
import type {
  SarifFinding,
  SarifInput,
  SarifLevel,
  SarifLocation,
  SarifLog,
  SarifNotification,
  SarifPaths,
  SarifPlace,
  SarifReportingDescriptor,
  SarifResult,
  SarifRun,
  SarifStep,
} from './types.js';

export const SARIF_SCHEMA = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';

/** Where the tool is described, for `tool.driver.informationUri`. */
export const INFORMATION_URI = 'https://panevschi-ruslan.github.io/flowatlas/';

/** The base every URI in a log is relative to: the configuration's directory, or `--sarif-root`. */
export const SOURCE_ROOT = '%SRCROOT%';

/**
 * Most results a log carries when nobody says: what code scanning shows of a
 * run (it keeps the 5,000 most severe).
 */
export const DEFAULT_SARIF_RESULTS = 5000;

/** Most results code scanning accepts in one run; a log with more is refused whole. */
export const SARIF_RESULT_LIMIT = 25000;

/** A path as a URI reference: each segment encoded, `/` kept, `@` left readable. */
const uriOf = (path: string): string =>
  path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%40/g, '@'))
    .join('/');

const posix = (path: string): string => path.split(sep).join('/');

/** The path a place has relative to the configuration's directory, before any `--sarif-root`. */
const fromConfig = (place: SarifPlace, paths: SarifPaths): string => {
  const dir = place.service === undefined ? undefined : paths.repoDirs.get(place.service);
  return dir === undefined || dir === '' ? place.file : `${dir}/${place.file}`;
};

/**
 * The path as the log writes it, or undefined when `--sarif-root` names a
 * checkout the file is not in.
 */
const relocate = (path: string, paths: SarifPaths): string | undefined => {
  if (paths.sarifRoot === undefined) return path;
  const absolute = join(paths.rootDir ?? process.cwd(), path);
  const inside = relative(paths.sarifRoot, absolute);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return undefined;
  return posix(inside);
};

/** A located place: the SARIF location, or `outside` when it belongs to another checkout. */
type Located = { location: SarifLocation } | { outside: true; said: string };

const physical = (path: string, line: number | undefined): SarifLocation => ({
  physicalLocation: {
    artifactLocation: { uri: uriOf(path), uriBaseId: SOURCE_ROOT },
    ...(line === undefined || line <= 0 ? {} : { region: { startLine: line } }),
  },
});

const locate = (path: string, line: number | undefined, paths: SarifPaths): Located => {
  const written = relocate(path, paths);
  return written === undefined ? { outside: true, said: line === undefined || line <= 0 ? path : `${path}:${line}` } : { location: physical(written, line) };
};

/**
 * Where a finding is: its own place when it has a file, otherwise the line of
 * the configuration that names its rule or its service, otherwise the
 * configuration itself (I3: never dropped, never a guessed line).
 */
const primaryOf = (finding: SarifFinding, paths: SarifPaths): Located | undefined => {
  const at = finding.at;
  if (at !== undefined && at.file !== '') return locate(fromConfig(at, paths), at.line, paths);
  if (paths.configFile === undefined) return undefined;
  const service = at?.service ?? finding.fallbackService;
  const line =
    (finding.fallbackRule === undefined ? undefined : paths.ruleLine?.(finding.fallbackRule)) ??
    (service === undefined ? undefined : paths.serviceLine?.(service));
  return locate(paths.configFile, line, paths);
};

/** A step beside the finding, located where it can be and said in words where it cannot. */
const stepOf = (step: SarifStep, paths: SarifPaths): SarifLocation => {
  const message = { text: step.message };
  if (step.place === undefined || step.place.file === '') return { message };
  const located = locate(fromConfig(step.place, paths), step.place.line, paths);
  if ('location' in located) return { ...located.location, message };
  // In another repository than the one this log is for: named, not pointed at.
  return { message: { text: `${step.message} (${located.said}, another checkout)` } };
};

/** A literal bracket in a message that also carries links (SARIF §3.11.6). */
const escapeBrackets = (text: string): string => text.replace(/[[\]]/g, (bracket) => `\\${bracket}`);

/**
 * The message, with each related location linked in it: code scanning links
 * a related location only where the message embeds it.
 */
const messageOf = (finding: SarifFinding, related: readonly SarifLocation[]): string => {
  const linked = related.filter((location) => location.physicalLocation !== undefined);
  if (linked.length === 0) return finding.message;
  const links = linked.map((location) => `[${escapeBrackets(location.message?.text ?? 'here')}](${location.id})`);
  return `${escapeBrackets(finding.message)} (${links.join('; ')})`;
};

interface Placed {
  finding: SarifFinding;
  level: SarifLevel;
  primary: SarifLocation | undefined;
  /** The primary URI and line, for ordering. */
  uri: string;
  line: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** The log's own notes: what was cut, what belongs elsewhere, what the report said of itself. */
const notificationsOf = (input: SarifInput, cut: number, outside: number): SarifNotification[] => {
  const notes: SarifNotification[] = (input.notes ?? []).map((note) => ({ level: note.level, message: { text: note.text } }));
  const left = cut + (input.cutBefore ?? 0);
  if (left > 0) {
    notes.push({
      level: 'warning',
      descriptor: { id: 'results-cut' },
      message: {
        text:
          `${plural(left, 'result')} left out by the bound on this output (--max-nodes or --max)` +
          (input.completeFile === undefined ? '; raise it to write them' : `; the complete report is in ${input.completeFile}`),
      },
    });
  }
  if (outside > 0) {
    notes.push({
      level: 'note',
      descriptor: { id: 'results-elsewhere' },
      message: {
        text: `${plural(outside, 'result')} in files outside --sarif-root left out: they belong to another repository's upload`,
      },
    });
  }
  return notes;
};

/** One base per service as well as the root, for a reader that resolves them; the URIs use the root. */
const baseIdsOf = (paths: SarifPaths): SarifRun['originalUriBaseIds'] => {
  const bases: SarifRun['originalUriBaseIds'] = {
    [SOURCE_ROOT]: {
      description: {
        text: paths.sarifRoot === undefined ? 'The directory flowatlas.config.json is in.' : 'The checkout --sarif-root names.',
      },
    },
  };
  for (const [service, dir] of [...paths.repoDirs].sort((a, b) => cmp(a[0], b[0]))) {
    const written = relocate(dir, paths);
    if (written === undefined || written === '' || Object.hasOwn(bases, service)) continue;
    bases[service] = { uri: `${uriOf(written)}/`, uriBaseId: SOURCE_ROOT };
  }
  return bases;
};

/** The log. Deterministic: two runs over one input write the same bytes. */
export const toSarif = (input: SarifInput): SarifLog => {
  const { paths } = input;
  let outside = 0;
  const placed: Placed[] = [];
  for (const finding of input.findings) {
    if (finding.level === undefined || !atLeast(finding.level, input.minLevel)) continue;
    const primary = primaryOf(finding, paths);
    if (primary !== undefined && 'outside' in primary) {
      outside += 1;
      continue;
    }
    const location = primary?.location;
    placed.push({
      finding,
      level: finding.level,
      primary: location,
      uri: location?.physicalLocation?.artifactLocation.uri ?? '',
      line: location?.physicalLocation?.region?.startLine ?? 0,
    });
  }
  // The loudest first, so a cut keeps what matters (code scanning keeps the
  // most severe too), then by place.
  placed.sort(
    (a, b) =>
      levelRank(a.level) - levelRank(b.level) ||
      cmp(a.uri, b.uri) ||
      a.line - b.line ||
      cmp(a.finding.rule.id, b.finding.rule.id) ||
      cmp(a.finding.key.value, b.finding.key.value) ||
      cmp(a.finding.message, b.finding.message),
  );
  const max = Math.min(input.maxResults ?? DEFAULT_SARIF_RESULTS, SARIF_RESULT_LIMIT);
  const kept = placed.slice(0, max);
  const cut = placed.length - kept.length;

  // Only rules with a result, in id order; each at its loudest result's level.
  const loudest = new Map<string, { info: SarifFinding['rule']; level: SarifLevel }>();
  for (const { finding, level } of kept) {
    const seen = loudest.get(finding.rule.id);
    if (seen === undefined || levelRank(level) < levelRank(seen.level)) loudest.set(finding.rule.id, { info: seen?.info ?? finding.rule, level });
  }
  const ruleIds = [...loudest.keys()].sort(cmp);
  const ruleIndex = new Map(ruleIds.map((id, index) => [id, index]));
  const rules: SarifReportingDescriptor[] = ruleIds.map((id) => {
    const { info, level } = loudest.get(id) as { info: SarifFinding['rule']; level: SarifLevel };
    return {
      id,
      name: id,
      shortDescription: { text: info.short },
      help: { text: info.help, markdown: info.helpMarkdown ?? info.help },
      defaultConfiguration: { level },
      ...(info.properties === undefined ? {} : { properties: info.properties }),
    };
  });

  const occurrences = new Map<string, number>();
  const results: SarifResult[] = kept.map(({ finding, level, primary }) => {
    const fingerprint = fingerprintOf(finding.key.kind, finding.key.value);
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    const related = (finding.related ?? []).map((step, index) => ({ id: index + 1, ...stepOf(step, paths) }));
    const flow = (finding.flow ?? []).map((step, index) => ({ location: stepOf(step, paths), executionOrder: index + 1 }));
    const properties = {
      ...(finding.at?.service === undefined ? {} : { service: finding.at.service }),
      ...finding.properties,
    };
    return {
      ruleId: finding.rule.id,
      ruleIndex: ruleIndex.get(finding.rule.id) as number,
      level,
      message: { text: messageOf(finding, related) },
      locations: primary === undefined ? [] : [primary],
      ...(related.length === 0 ? {} : { relatedLocations: related }),
      ...(flow.length === 0 ? {} : { codeFlows: [{ threadFlows: [{ locations: flow }] }] }),
      partialFingerprints: partialFingerprints(fingerprint, occurrence),
      ...(finding.baselineState === undefined ? {} : { baselineState: finding.baselineState }),
      ...(finding.suppression === undefined ? {} : { suppressions: [finding.suppression] }),
      ...(Object.keys(properties).length === 0 ? {} : { properties }),
    };
  });

  const notifications = notificationsOf(input, cut, outside);
  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'flowatlas',
            version: input.version,
            semanticVersion: input.version,
            informationUri: INFORMATION_URI,
            rules,
          },
        },
        automationDetails: { id: `flowatlas/${input.command}/` },
        originalUriBaseIds: baseIdsOf(paths),
        invocations: [
          {
            executionSuccessful: true,
            ...(notifications.length === 0 ? {} : { toolExecutionNotifications: notifications }),
          },
        ],
        results,
      },
    ],
  };
};

/** How many results of each level a log holds, for the line a run prints beside the file. */
export const sarifCounts = (log: SarifLog): Record<SarifLevel, number> => {
  const counts: Record<SarifLevel, number> = { error: 0, warning: 0, note: 0 };
  for (const run of log.runs) for (const result of run.results) counts[result.level] += 1;
  return counts;
};

export const renderSarif = (log: SarifLog): string => `${JSON.stringify(log, null, 2)}\n`;
