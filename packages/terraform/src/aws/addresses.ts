import { executeApiServedAt } from '@flowatlas/aws';
import { SERVED_AT_META, type ServedAt } from '@flowatlas/core';
import type { Instance, Value } from '../eval/values.js';
import { attributeOf } from '../hcl/ast.js';
import { referencesIn } from '../hcl/walk.js';
import { argument, textOf, unreadRow, whyNot } from './arguments.js';
import type { ResourceReader, ResourceReading } from './reading.js';

/**
 * Where an API is reached: the custom domains it is mapped onto, and the stages
 * it is deployed to (R174).
 *
 * A mapping puts a base path in front of every route of the API, and that base
 * path is part of the address a caller writes - `https://api.library.example/v1/loans`
 * calls `POST /loans` of the API mapped at `v1` - so a route of a mapped API is
 * read at its address under each domain. A stage is not: a caller reaches a
 * stage through the URL the stage is invoked at, which already carries it, so
 * the stage is recorded beside the route and not put in front of it.
 */

/** `{loanId}` is a parameter and `{proxy+}` takes the rest of the path. */
const routeSegment = (part: string): string => (/^\{[^}]+\+\}$/.test(part) ? '*' : part);

/** A path below another, as API Gateway writes either. */
export const joinSegments = (base: string, part: string): string =>
  `${base.replace(/\/$/, '')}/${part.split('/').filter((segment) => segment !== '').map(routeSegment).join('/')}`;

/** What a caller reaches an API at. */
export interface ApiAddress {
  /** What goes in front of every route: `''` for nothing, `/v1`; `undefined` where the base path is not read. */
  readonly prefix: string | undefined;
  /** What a route at this address records about it: domains, base path, stages. */
  readonly meta: Readonly<Record<string, unknown>>;
}

/** The two resources that map an API onto a custom domain, by which argument says what. */
const MAPPINGS = [
  { type: 'aws_api_gateway_base_path_mapping', api: 'api_id', basePath: 'base_path', stage: 'stage_name', domain: 'domain_name' },
  { type: 'aws_apigatewayv2_api_mapping', api: 'api_id', basePath: 'api_mapping_key', stage: 'stage', domain: 'domain_name' },
] as const;

/** Resources that deploy an API to a stage, by the argument naming the API and the one naming the stage. */
const STAGES = [
  { type: 'aws_api_gateway_stage', api: 'rest_api_id', name: 'stage_name' },
  { type: 'aws_api_gateway_deployment', api: 'rest_api_id', name: 'stage_name' },
  { type: 'aws_apigatewayv2_stage', api: 'api_id', name: 'name' },
] as const;

/** The argument a stage or a domain is named by, for a reference to its id rather than to its name. */
const NAMED_BY: ReadonlyMap<string, string> = new Map([
  ['aws_api_gateway_stage', 'stage_name'],
  ['aws_apigatewayv2_stage', 'name'],
  ['aws_api_gateway_domain_name', 'domain_name'],
  ['aws_apigatewayv2_domain_name', 'domain_name'],
]);

const API_TYPES = new Set(['aws_api_gateway_rest_api', 'aws_apigatewayv2_api']);

/** The block a value refers to, however it refers to it. */
const referenced = (value: Value | undefined): Instance | undefined => {
  if (value === undefined) return undefined;
  if (value.kind === 'ref') return value.target;
  if (value.kind === 'instance') return value.instance;
  return 'via' in value ? value.via?.target : undefined;
};

/** A name as written, or the name of the stage or domain a reference to its id stands for. */
const nameAt = (value: Value | undefined): string | undefined => {
  const text = textOf(value);
  if (text !== undefined) return text;
  const target = referenced(value);
  const namedBy = target === undefined ? undefined : NAMED_BY.get(target.type);
  return target === undefined || namedBy === undefined ? undefined : textOf(argument(target, namedBy));
};

/** A base path as the part of an address it is: `''`, `/v1`, `/library/v2`. */
const prefixOf = (value: Value | undefined): string | undefined => {
  if (value === undefined || value.kind === 'null') return '';
  const text = textOf(value);
  if (text === undefined) return undefined;
  const trimmed = text.replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '' : `/${trimmed}`;
};

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** The stages an API is deployed to, as the files name them. */
const stagesOf = (api: Instance, reading: ResourceReading): string[] =>
  sorted(
    STAGES.flatMap((stage) =>
      reading
        .ofType('managed', stage.type)
        .filter((instance) => referenced(argument(instance, stage.api)) === api)
        .flatMap((instance) => textOf(argument(instance, stage.name)) ?? []),
    ),
  );

/**
 * Whether an argument is left to whoever applies the configuration (P294): a
 * root module's `var.<name>`, which `-var` sets, or `terraform.workspace`,
 * which the workspace selected sets.
 */
const chosenOnApply = (instance: Instance, name: string): boolean => {
  const written = attributeOf(instance.block.body, name);
  if (written === undefined || instance.module.root !== undefined) return false;
  return [...referencesIn(written.expression)].some(
    (reference) =>
      reference.source.type === 'variable' &&
      (reference.source.name === 'var' || (reference.source.name === 'terraform' && reference.steps[0]?.kind === 'attr' && reference.steps[0].name === 'workspace')),
  );
};

/** The region the AWS provider a block is created with is configured for, where the files settle it (P294). */
const regionOf = (instance: Instance): string | undefined => {
  const named = attributeOf(instance.block.body, 'provider')?.source.trim();
  const provider = instance.module.provider(named !== undefined && /^aws(\.[\w-]+)?$/.test(named) ? named : 'aws');
  return textOf(provider?.get('region'));
};

/**
 * Where API Gateway serves an API itself (P294), for a route written out
 * with its id: at the gateway host of its provider's region, any region where
 * that is not read, once per stage it is deployed to - a stage `apply` may
 * set open, with the one it sets where nothing does - at the root for an HTTP
 * API's `$default` stage, the one a quick-create API (`target`) makes, and at
 * a stage chosen elsewhere where none is read. None where its own endpoint is
 * turned off.
 */
const servedOf = (api: Instance, reading: ResourceReading): ServedAt[] => {
  const disabled = argument(api, 'disable_execute_api_endpoint');
  if (disabled?.kind === 'bool' && disabled.value) return [];
  const stages: { name?: string; chosen?: boolean }[] = STAGES.flatMap((stage) =>
    reading
      .ofType('managed', stage.type)
      .filter((instance) => referenced(argument(instance, stage.api)) === api && argument(instance, stage.name) !== undefined)
      .map((instance) => {
        const name = textOf(argument(instance, stage.name));
        const chosen = name === undefined || chosenOnApply(instance, stage.name);
        return { ...(name === undefined ? {} : { name }), ...(chosen ? { chosen } : {}) };
      }),
  );
  if (api.type === 'aws_apigatewayv2_api' && argument(api, 'target') !== undefined) stages.push({});
  if (stages.length === 0) stages.push({ chosen: true });
  const region = regionOf(api);
  const label = textOf(argument(api, 'name')) ?? api.address;
  const all = stages.map((stage) => executeApiServedAt(region, label, stage));
  return [...new Map(all.map((served) => [JSON.stringify(served), served])).values()];
};

/**
 * Every address an API is reached at: one per base path it is mapped at, or -
 * where nothing maps it - the API's own, with the stages it is deployed to.
 */
export const addressesOf = (api: Instance, reading: ResourceReading): ApiAddress[] => {
  const byPrefix = new Map<string, { prefix: string | undefined; domains: string[]; stages: string[] }>();
  for (const mapping of MAPPINGS) {
    for (const instance of reading.ofType('managed', mapping.type)) {
      if (referenced(argument(instance, mapping.api)) !== api) continue;
      const prefix = prefixOf(argument(instance, mapping.basePath));
      const key = prefix ?? '\0';
      const found = byPrefix.get(key) ?? { prefix, domains: [], stages: [] };
      const domain = nameAt(argument(instance, mapping.domain));
      const stage = nameAt(argument(instance, mapping.stage));
      if (domain !== undefined) found.domains.push(domain);
      if (stage !== undefined) found.stages.push(stage);
      byPrefix.set(key, found);
    }
  }
  if (byPrefix.size === 0) {
    const stages = stagesOf(api, reading);
    const served = servedOf(api, reading);
    return [{ prefix: '', meta: { ...(stages.length === 0 ? {} : { stages }), ...(served.length === 0 ? {} : { [SERVED_AT_META]: served }) } }];
  }
  return [...byPrefix.values()].map(({ prefix, domains, stages }) => ({
    prefix,
    meta: {
      basePath: prefix ?? null,
      ...(domains.length === 0 ? {} : { domains: sorted(domains) }),
      ...(stages.length === 0 ? {} : { stages: sorted(stages) }),
    },
  }));
};

/**
 * A mapping whose API or base path is not read: the routes of the API it maps
 * are then at an address that is not known in full, and this says why.
 */
const readMapping =
  (mapping: (typeof MAPPINGS)[number]): ResourceReader[1] =>
  (instance, reading) => {
    const apiValue = argument(instance, mapping.api);
    const api = referenced(apiValue);
    if (api === undefined || !API_TYPES.has(api.type)) {
      reading.rows.push(unreadRow(instance, 'route-base-path-unread', `the API ${instance.address} maps onto a domain`, whyNot(apiValue, mapping.api)));
      return;
    }
    const base = argument(instance, mapping.basePath);
    if (prefixOf(base) === undefined) {
      reading.rows.push(unreadRow(instance, 'route-base-path-unread', `the base path ${instance.address} puts in front of the routes of ${api.address}`, whyNot(base, mapping.basePath)));
    }
  };

export const MAPPING_READERS: readonly ResourceReader[] = MAPPINGS.map((mapping) => [mapping.type, readMapping(mapping)] as const);
