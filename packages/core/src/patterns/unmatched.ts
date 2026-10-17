import type { FlowatlasConfig } from '../config.js';
import { normalizeFilePath } from '../ids.js';
import type { Unresolved } from '../model/graph.js';
import { readPatterns } from './apply.js';

/**
 * The rules nothing matched, said once a build has read every service a rule
 * applies to (P121).
 *
 * A rule is matched where some node of a service that lists its file records
 * it as `meta.describedBy`. One nothing records is `pattern-unmatched`, at
 * `info`: the rule cost nothing and drew nothing, which is usually a receiver
 * type spelled differently from the code's, and is the row a person reaches
 * for `flowatlas patterns explain` from. Said only when every service the
 * rule applies to was read this build; a service left out has not had its say.
 */
export interface ServiceNodes {
  readonly service: string;
  readonly repoDir: string;
  readonly nodes: readonly { readonly meta?: Readonly<Record<string, unknown>> | undefined }[];
  /** The service's rows: a rule shadowed or ambiguous at a call matched it, though it drew nothing. */
  readonly unresolved?: readonly { readonly reason: string; readonly meta?: Readonly<Record<string, unknown>> | undefined }[];
}

export const unmatchedPatternRows = (
  config: FlowatlasConfig,
  configDir: string,
  read: readonly ServiceNodes[],
): Map<string, Unresolved[]> => {
  const byService = new Map(read.map((each) => [each.service, each]));
  /** Every rule, once, with the services that list its file, in configuration order. */
  const rules = new Map<string, { id: string; kind: string; file: string; line: number; services: string[] }>();
  for (const service of config.services) {
    if (service.document !== undefined) continue;
    const reading = readPatterns({ config, service, configDir });
    for (const placed of reading.rules) {
      const key = `${placed.file}\0${placed.compiled.id}`;
      const entry = rules.get(key) ?? { id: placed.compiled.id, kind: placed.compiled.kind, file: placed.file, line: placed.line, services: [] };
      entry.services.push(service.name);
      rules.set(key, entry);
    }
  }
  const drawn = new Set<string>();
  for (const each of read) {
    for (const node of each.nodes) {
      const by = node.meta?.['describedBy'];
      if (typeof by === 'string') drawn.add(`${each.service}\0${by}`);
    }
    for (const row of each.unresolved ?? []) {
      if (row.reason !== 'pattern-shadowed' && row.reason !== 'pattern-ambiguous') continue;
      const named = [row.meta?.['rule'], ...((row.meta?.['rules'] as unknown[] | undefined) ?? [])];
      for (const id of named) if (typeof id === 'string') drawn.add(`${each.service}\0pattern:${id}`);
    }
  }
  const out = new Map<string, Unresolved[]>();
  for (const rule of rules.values()) {
    if (rule.services.some((service) => !byService.has(service))) continue;
    if (rule.services.some((service) => drawn.has(`${service}\0pattern:${rule.id}`))) continue;
    const first = byService.get(rule.services[0] as string) as ServiceNodes;
    const file = normalizeFilePath(rule.file, first.repoDir);
    const rows = out.get(first.service) ?? [];
    rows.push({
      file,
      line: rule.line,
      reason: 'pattern-unmatched',
      level: 'info',
      symbol: rule.id,
      message: `the rule ${rule.id} (${rule.kind}) matches nothing in ${rule.services.join(', ')}`,
      hint: 'Check the rule\'s on.receiverType or function and its pattern against a call it should match (flowatlas patterns explain <file:line>), or remove it.',
      meta: { rule: rule.id, services: rule.services },
    });
    out.set(first.service, rows);
  }
  return out;
};
