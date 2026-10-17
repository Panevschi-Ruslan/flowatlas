import { readAccepted, ruleSetOf, type PromptRuleBreak } from '@flowatlas/core';
import { evaluateRules, ruleGraphOf, type GraphDb, type RulesReport, type RuleViolation } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { truncate } from '../query/detail.js';
import { REVERSE_EDGES } from '../query/flow.js';
import { nearWords } from '../query/names.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import { callOf, commonInput, pagedNext, pageInput, READ_ONLY, serviceInput, withDb, type ToolContext } from './common.js';

/**
 * The architecture rules of the configuration, checked over the graph the
 * server reads (P114): the linker's `evaluateRules`, the same function
 * `flowatlas rules` calls, with `accepted.json`'s `rule:<name>` entries
 * excusing what they cover. Undefined when the configuration has no rules.
 */
export const rulesReportOf = (db: GraphDb, ctx: ToolContext): RulesReport | undefined => {
  const config = ctx.handle.config;
  if (config === undefined) return undefined;
  const ruleSet = ruleSetOf(config);
  if (ruleSet.rules.length === 0) return undefined;
  return evaluateRules(ruleGraphOf(db, ruleSet.tags), ruleSet.rules, { accepted: readAccepted(ctx.handle.path).gaps });
};

const locOf = (violation: RuleViolation): string | undefined =>
  violation.at === undefined ? undefined : violation.at.line === undefined ? violation.at.file : `${violation.at.file}:${violation.at.line}`;

/** The way in a violation starts behind, when one is: the entry `get_flow` would walk it from. */
const wayInto = (db: GraphDb, id: string): string | undefined => {
  const node = db.node(id);
  if (node?.type === 'entry' || node?.type === 'consumer') return id;
  return db
    .traverse({ from: id, direction: 'in', edgeTypes: REVERSE_EDGES, maxDepth: 12, maxNodes: 500 })
    .rows.find((row) => row.type === 'entry' || row.type === 'consumer')?.id;
};

/** The node on the near side of the hop that crossed: where the fix goes, as `at` says. */
const crossingOf = (violation: RuleViolation): string => {
  const hop = violation.path.find((each) => each.type === violation.via);
  if (hop === undefined) return violation.from;
  return hop.type === 'consumes' ? hop.to : hop.from;
};

/** A violation as it goes out: no hop list, the place as `loc`, and the calls that show it. */
const wireViolation = (db: GraphDb, violation: RuleViolation): Record<string, unknown> => {
  const loc = locOf(violation);
  const entry = wayInto(db, violation.from);
  return {
    rule: violation.rule,
    severity: violation.severity,
    from: violation.from,
    to: violation.to,
    service: violation.fromService,
    ...(loc === undefined ? {} : { loc }),
    via: violation.via,
    confidence: violation.confidence,
    ...(violation.heuristic ? { heuristic: true } : {}),
    message: violation.message,
    ...(violation.note === undefined ? {} : { note: violation.note }),
    ...(violation.partial === undefined ? {} : { partial: violation.partial }),
    next: [
      ...(entry === undefined ? [] : [callOf('get_flow', { entry })]),
      callOf('get_source', { symbol: crossingOf(violation) }),
    ],
  };
};

/** What `describe_for_prompt` says under "Rules it breaks": the violations whose path runs through a node. */
export const ruleBreaksAt = (report: RulesReport | undefined, ids: ReadonlySet<string>): PromptRuleBreak[] =>
  (report?.violations ?? [])
    .filter((violation) => ids.has(violation.from) || ids.has(violation.to) || violation.path.some((hop) => ids.has(hop.from) || ids.has(hop.to)))
    .map((violation) => {
      const loc = locOf(violation);
      return {
        rule: violation.rule,
        severity: violation.severity,
        message: violation.message,
        ...(violation.at === undefined ? {} : { service: violation.at.service }),
        ...(loc === undefined ? {} : { loc }),
        confidence: violation.confidence,
        ...(violation.note === undefined ? {} : { note: violation.note }),
      };
    });

/**
 * Each hop a violation runs along, as `from|to`, with the rules it breaks:
 * what `get_flow` marks a step with (`violates`).
 */
export const violatedHops = (report: RulesReport | undefined): Map<string, string[]> => {
  const hops = new Map<string, string[]>();
  for (const violation of report?.violations ?? []) {
    for (const hop of violation.path) {
      const key = `${hop.from}|${hop.to}`;
      const rules = hops.get(key) ?? [];
      if (!rules.includes(violation.rule)) hops.set(key, [...rules, violation.rule]);
    }
  }
  return hops;
};

export const registerRules = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'check_rules',
    {
      title: 'Architecture rules',
      description: 'Architecture rules from the config: each violation and where it crosses.',
      inputSchema: {
        rule: z.string().optional(),
        service: serviceInput,
        maxNodes: commonInput.maxNodes,
        ...pageInput,
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const report = rulesReportOf(db, ctx);
        if (report === undefined) return { error: 'no rules are configured: add rules[] to flowatlas.config.json' };
        const names = report.rules.map((rule) => rule.name);
        if (input.rule !== undefined && !names.includes(input.rule)) {
          const near = nearWords(names, input.rule, 3);
          return { error: `no rule named ${JSON.stringify(input.rule)}`, suggestions: near, next: near.slice(0, MAX_NEXT).map((name) => callOf('check_rules', { rule: name })) };
        }
        const keep = <T extends { rule: string }>(item: T): boolean => input.rule === undefined || item.rule === input.rule;
        const touches = (item: RuleViolation): boolean =>
          input.service === undefined || item.fromService === input.service || item.toService === input.service;
        const rows = report.violations.filter((item) => keep(item) && touches(item));
        const { items, total, truncated, nextOffset } = truncate(rows, input.maxNodes, input.offset);
        const wired = items.map((item) => wireViolation(db, item));
        const args = { rule: input.rule, service: input.service, maxNodes: input.maxNodes };
        return withNext(
          {
            rules: report.rules.filter((rule) => input.rule === undefined || rule.name === input.rule).map((rule) => ({
              name: rule.name,
              shape: rule.shape,
              severity: rule.severity,
              status: rule.status,
              violations: rule.violations,
              ...(rule.excused === 0 ? {} : { excused: rule.excused }),
              ...(rule.note === undefined ? {} : { note: rule.note }),
            })),
            violations: wired,
            total,
            ...(truncated === undefined ? {} : { truncated }),
            ...(nextOffset === undefined ? {} : { nextOffset }),
            ...(report.unchecked.some(keep) ? { unchecked: report.unchecked.filter(keep).map(({ rule, reason, message }) => ({ rule, reason, message })) } : {}),
            ...(report.notes.some(keep) ? { notes: report.notes.filter(keep).map(({ rule, reason, message }) => ({ rule, reason, message })) } : {}),
            ...(report.excused.some(keep) ? { excused: report.excused.filter(keep).length } : {}),
          },
          pagedNext({ tool: 'check_rules', args, nextOffset }, wired.slice(0, 2).flatMap((row) => (row['next'] as string[]).slice(0, 1))),
        );
      }),
  );
};
