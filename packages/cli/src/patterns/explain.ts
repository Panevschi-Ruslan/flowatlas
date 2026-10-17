import {
  isParsed,
  matchPatternAt,
  parsePattern,
  readPatterns,
  type LoadedConfig,
  type MatchStep,
  type Unresolved,
} from '@flowatlas/core';
import { Node } from 'ts-morph';
import { CliError, EXIT } from '../exit.js';
import { placesOfRow, receiverTypeOf, ServiceSources, type Place } from './places.js';

/**
 * `flowatlas patterns explain <place>`: for a place the reader could not
 * follow, which rules were tried and how far each got (P121).
 *
 * The ast-grep debug view, for a near miss: each rule of the service's
 * pattern files is held against each call written on the line, part by part -
 * the method's name, the receiver's type, each argument and key - and the
 * first part that did not fit is named. A rule that does not compile is
 * listed with why, since it was never tried.
 */

/** Version of the JSON this prints. */
export const PATTERNS_EXPLAIN_FORMAT_VERSION = 1;

export interface RuleTrial {
  readonly id: string;
  readonly fits: boolean;
  /** The first part that did not fit, when one did not. */
  readonly stoppedAt?: MatchStep;
  readonly steps: readonly MatchStep[];
  readonly refused?: string;
}

export interface ExplainedCall {
  readonly code: string;
  readonly receiverType?: string;
  readonly rules: readonly RuleTrial[];
}

export interface ExplainedPlace extends Place {
  readonly calls: readonly ExplainedCall[];
}

export interface PatternsExplainReport {
  patternsExplainFormatVersion: typeof PATTERNS_EXPLAIN_FORMAT_VERSION;
  readonly places: readonly ExplainedPlace[];
  /** Why there was nothing to explain, when there was nothing. */
  readonly note?: string;
}

const GAP = /^gap:([^|]+)\|([^|]+)\|(.+)$/;
const AT = /^(.+):(\d+)$/;

/**
 * The places a place argument names: `service/file:line`, `file:line` with
 * `--service`, or a gap id from `search` (`gap:<service>|<file>|<reason>`),
 * which stands for every place of that row.
 */
export const placesNamed = (
  loaded: LoadedConfig,
  written: string,
  service: string | undefined,
  rows: () => readonly Unresolved[],
): Place[] => {
  const gap = written.match(GAP);
  if (gap !== null) {
    const [, name, file, reason] = gap as unknown as [string, string, string, string];
    return rows()
      .filter((row) => row.service === name && row.reason === reason)
      .flatMap(placesOfRow)
      .filter((place) => place.file === file);
  }
  const at = written.match(AT);
  if (at === null) throw new CliError(`${written} is not a place: write <service>/<file>:<line>, <file>:<line> with --service, or a gap id`, EXIT.cannotRun);
  const [, path, line] = at as unknown as [string, string, string];
  if (service !== undefined) return [{ service, file: path, line: Number(line) }];
  const named = loaded.config.services.find((each) => path.startsWith(`${each.name}/`));
  if (named === undefined) {
    throw new CliError(`${written} names no service: write it as <service>/<file>:<line>, or pass --service`, EXIT.cannotRun);
  }
  return [{ service: named.name, file: path.slice(named.name.length + 1), line: Number(line) }];
};

/** Holds every rule a service reads against the calls at each place. */
export const explainPlaces = (loaded: LoadedConfig, places: readonly Place[]): PatternsExplainReport => {
  const sources = new ServiceSources(loaded);
  const explained = places.map((place): ExplainedPlace => {
    const service = sources.service(place.service);
    if (service === undefined) return { ...place, calls: [] };
    const reading = readPatterns({ config: loaded.config, service, configDir: loaded.rootDir });
    const rules = reading.files.flatMap((file) => file.rules);
    const calls = sources.sitesAt(place).map((site): ExplainedCall => {
      const receiver = Node.isCallExpression(site) && Node.isPropertyAccessExpression(site.getExpression()) ? site.getExpression() : undefined;
      const type = receiver !== undefined && Node.isPropertyAccessExpression(receiver) ? receiverTypeOf(receiver.getExpression()) : undefined;
      const trials = rules.map((each): RuleTrial => {
        if (each.rule === undefined) return { id: each.id ?? '?', fits: false, steps: [], refused: `${each.refused?.part}: ${each.refused?.reason}` };
        const refused = reading.refused.find((refusal) => refusal.file === each.file && refusal.line === each.line);
        if (refused !== undefined) return { id: each.rule.id, fits: false, steps: [], refused: `${refused.refusal.part}: ${refused.refusal.reason}` };
        const parsed = parsePattern(each.rule.pattern);
        if (!isParsed(parsed)) return { id: each.rule.id, fits: false, steps: [], refused: parsed.error };
        const types = each.rule.on.receiverType;
        const match = matchPatternAt(parsed, site, {
          receiverTypeOf,
          ...(types === undefined ? {} : { receiverTypes: typeof types === 'string' ? [types] : types }),
        });
        const stoppedAt = match.steps.find((step) => !step.ok);
        return { id: each.rule.id, fits: match.matched, steps: match.steps, ...(stoppedAt === undefined ? {} : { stoppedAt }) };
      });
      return { code: site.getText().replace(/\s+/g, ' ').slice(0, 100), ...(type === undefined ? {} : { receiverType: type }), rules: trials };
    });
    return { ...place, calls };
  });
  const none =
    places.length === 0
      ? 'no place of that name: the gap names no row, or the build has none'
      : explained.every((place) => place.calls.length === 0)
        ? 'nothing is called on that line'
        : explained.every((place) => place.calls.every((call) => call.rules.length === 0))
          ? 'the service reads no pattern files: list them under patterns in flowatlas.config.json'
          : undefined;
  return { patternsExplainFormatVersion: PATTERNS_EXPLAIN_FORMAT_VERSION, places: explained, ...(none === undefined ? {} : { note: none }) };
};

export const renderPatternsExplain = (report: PatternsExplainReport): string => {
  const lines: string[] = [];
  for (const place of report.places) {
    lines.push(`${place.service}/${place.file}:${place.line}`);
    for (const call of place.calls) {
      lines.push(`  ${call.code}${call.receiverType === undefined ? '' : `  (receiver: ${call.receiverType})`}`);
      for (const rule of call.rules) {
        if (rule.refused !== undefined) {
          lines.push(`    ${rule.id}: not tried, the rule is refused: ${rule.refused}`);
          continue;
        }
        const reached = rule.steps.filter((step) => step.ok).map((step) => step.part);
        lines.push(
          rule.fits
            ? `    ${rule.id}: fits (${reached.join(', ')})`
            : `    ${rule.id}: stops at ${rule.stoppedAt?.part ?? '?'}: ${rule.stoppedAt?.detail ?? ''}${reached.length === 0 ? '' : `  (fitted: ${reached.join(', ')})`}`,
        );
      }
    }
  }
  if (report.note !== undefined) lines.push(`note: ${report.note}`);
  return `${lines.join('\n')}\n`;
};
