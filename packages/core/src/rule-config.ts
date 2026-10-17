/**
 * Architecture rules, as a project writes them in `flowatlas.config.json` (P114).
 *
 * A rule is a contract about who talks to whom, not about a shape: "web must
 * not call billing directly", "only orders writes the orders table", "a
 * service tagged frontend reaches only services tagged edge". Four shapes and
 * a selector, never a language (D1): a shape names graph concepts - a service,
 * a tag, a way in, a table, a channel, a route, a node type - and nothing of a
 * framework (I1).
 *
 * The shapes are dependency-cruiser's `forbidden`, `allowed` (read as "only
 * these may") and `reachable`, and Nx's `depConstraints` by tag, read over the
 * edges between repositories that neither of them can see. They are checked by
 * the linker's `evaluateRules`, over the joined graph, with no source read.
 */
import { z } from 'zod';

/**
 * The edges a rule can name.
 *
 * `hits` is a browser's request to a route, `http_calls` one service's request
 * to another, `emits` and `consumes` the two ends of a channel, `queries` a
 * read or write of a table (with its `op`), `triggers` a workflow or a
 * function started by name. `calls` is a call inside one service, and is only
 * read when a rule names it (§2: a cross-service tool sees a controller
 * reaching a repository directly, and dependency-cruiser does the rest better).
 */
export const RULE_EDGE_KINDS = ['http_calls', 'hits', 'emits', 'consumes', 'queries', 'triggers', 'calls'] as const;
export type RuleEdgeKind = (typeof RULE_EDGE_KINDS)[number];

/** What a rule names when it says no `via`: every kind but a call inside one service. */
export const DEFAULT_RULE_VIA: readonly RuleEdgeKind[] = Object.freeze(['http_calls', 'hits', 'emits', 'consumes', 'queries', 'triggers']);

/** How loud a broken rule is; `error` unless it says otherwise. */
export const RULE_SEVERITIES = ['error', 'warning', 'info'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

/** The four shapes, in the order they are described. */
export const RULE_SHAPES = ['forbid', 'only', 'tags', 'reachable'] as const;
export type RuleShape = (typeof RULE_SHAPES)[number];

/** What a table access does, as a `queries` edge's node records it. */
export const RULE_OPS = ['read', 'write', 'delete'] as const;

/** The keys of a selector, in the order a message names them. */
export const SELECTOR_KEYS = ['service', 'tag', 'entry', 'table', 'channel', 'route', 'type'] as const;
export type SelectorKey = (typeof SELECTOR_KEYS)[number];

const word = z.string().min(1);

/**
 * Which nodes a side of a rule is about. Every key is optional and they are
 * ANDed; `*` (and `**`) is any run of characters, as in `doctor.publicRoutes`.
 *
 * `service` and `tag` name the service a node belongs to (a channel belongs to
 * none: the same channel is one node whoever publishes it, I6), `entry` a way
 * in by its id or its label, `table` and `channel` a table or a channel by its
 * name, `route` an HTTP way in as `METHOD /path` (core's `matchesRoutePattern`),
 * and `type` a node type (`entry`, `method`, `ui_api_call`, …).
 */
export const selectorSchema = z
  .strictObject({
    service: word.optional(),
    tag: word.optional(),
    entry: word.optional(),
    table: word.optional(),
    channel: word.optional(),
    route: word.optional(),
    type: word.optional(),
  })
  .refine((selector) => SELECTOR_KEYS.some((key) => selector[key] !== undefined), {
    message: `a selector names at least one of ${SELECTOR_KEYS.join(', ')}`,
  });
export type RuleSelector = z.infer<typeof selectorSchema>;

const viaSchema = z.array(z.enum(RULE_EDGE_KINDS)).min(1);

/** `from` must not reach `to`: in one hop between services (default), or by any path. */
export const forbidRuleSchema = z.strictObject({
  from: selectorSchema,
  to: selectorSchema,
  via: viaSchema.optional(),
  reach: z.enum(['direct', 'transitive']).optional(),
});

/** Nothing outside `from` may reach `to` by `via` (and, for a table, by `op`). */
export const onlyRuleSchema = z.strictObject({
  from: selectorSchema,
  to: selectorSchema,
  via: viaSchema.optional(),
  op: z.enum(RULE_OPS).optional(),
});

/** A service tagged `source` may join only services carrying one of `mayReach` (`*` any). */
export const tagsRuleSchema = z.strictObject({
  source: word,
  mayReach: z.array(word).min(1),
  via: viaSchema.optional(),
});

/** A path from `from` to `to` must exist (`must: true`) or must not (`must: false`). */
export const reachableRuleSchema = z.strictObject({
  from: selectorSchema,
  to: selectorSchema,
  must: z.boolean(),
});

/** A rule's name: the key a baseline and an accept use, so it is kept to one plain spelling. */
export const RULE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ruleSchema = z
  .strictObject({
    name: z.string().regex(RULE_NAME, 'a rule name is kebab-case: lowercase words and digits joined by -'),
    severity: z.enum(RULE_SEVERITIES).default('error'),
    /** Why the rule exists, printed with every violation of it. */
    note: z.string().min(1).optional(),
    forbid: forbidRuleSchema.optional(),
    only: onlyRuleSchema.optional(),
    tags: tagsRuleSchema.optional(),
    reachable: reachableRuleSchema.optional(),
  })
  .superRefine((rule, ctx) => {
    const shapes = RULE_SHAPES.filter((shape) => rule[shape] !== undefined);
    if (shapes.length === 1) return;
    ctx.addIssue({
      code: 'custom',
      path: [],
      message:
        shapes.length === 0
          ? `a rule has one of ${RULE_SHAPES.join(', ')}`
          : `a rule has exactly one shape, and this one has ${shapes.join(' and ')}`,
    });
  });
export type RuleConfig = z.infer<typeof ruleSchema>;

/** How rules are read, beside the rules themselves. */
export const rulesSettingsSchema = z.strictObject({
  /**
   * Whether a violation along a `heuristic` edge can fail a run (D4). Off: a
   * gate that fails on a guessed edge is switched off within a week; it is
   * still shown, marked `heuristic`.
   */
  failOnHeuristic: z.boolean().default(false),
});
export type RulesSettings = z.infer<typeof rulesSettingsSchema>;

/** The shape a rule was written in. */
export const shapeOfRule = (rule: RuleConfig): RuleShape =>
  RULE_SHAPES.find((shape) => rule[shape] !== undefined) as RuleShape;

/** The rules of a configuration with the facts they are checked against. */
export interface RuleSet {
  rules: RuleConfig[];
  /** Each service's tags, by service name. */
  tags: Record<string, string[]>;
  failOnHeuristic: boolean;
}

/** The rule set a configuration declares; empty when it declares none. */
export const ruleSetOf = (config: {
  services: ReadonlyArray<{ name: string; tags?: readonly string[] | undefined }>;
  rules?: readonly RuleConfig[] | undefined;
  rulesSettings?: { failOnHeuristic?: boolean | undefined } | undefined;
}): RuleSet => ({
  rules: [...(config.rules ?? [])],
  tags: Object.fromEntries(config.services.map((service) => [service.name, [...(service.tags ?? [])]])),
  failOnHeuristic: config.rulesSettings?.failOnHeuristic === true,
});
