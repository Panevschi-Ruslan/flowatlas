import {
  addressOnly,
  ENVIRONMENT_META,
  hostOf,
  innerServiceName,
  isInnerHost,
  type EnvironmentValue,
  type FlowatlasConfig,
  type GraphNode,
  type RepoSettings,
} from '@flowatlas/core';
import { wordsOf } from './api-choice.js';
import { cmp } from './order.js';

/**
 * Which service a base address is, from the value a setting is given (P77).
 *
 * A request rooted at a setting no service claims under `baseUrlEnv` used to
 * stop there. The value is usually written down: the environment a function is
 * deployed with, a repository's own example environment file, the environment
 * a container is started with, the code's own fallback. Each of those is a
 * candidate; the host of each is looked up among the configured services - by
 * name, by the hosts configured for it, by what the files say it is reached at
 * - and the answer is the one service they agree on, a third party where they
 * all name one, or a row saying what was found and why it settled nothing.
 *
 * Only the deployment says what really runs. A value from it is taken alone
 * where there is one, and the join is as sure as one read from the
 * configuration; a value from any other file is evidence of where the request
 * goes when the project is run locally, and the join it makes is a guess.
 */

/** One value a setting was found with, and where. */
export interface FoundValue {
  readonly variable: string;
  readonly value: string;
  /** The file it is written in, or the deployment that sets it. */
  readonly from: string;
  /** What inside that file it is given to: a container, a function. */
  readonly within?: string;
  /** True for the environment a function that runs the request is deployed with. */
  readonly deployed: boolean;
  /**
   * True where no value settled anything and the setting's own name is the
   * name of exactly one service: `MENU_URL` for `menu`. `value` is then empty.
   */
  readonly byName?: boolean;
  /** For a setting taken by its name: the files that set it and whose values are never read. */
  readonly namedOnly?: readonly string[];
  /** For a setting taken by its name: the values found, none of which named a configured service. */
  readonly unmatched?: readonly string[];
}

/** What the values of a setting say a request's base address is. */
export type BaseUrlAnswer =
  | { readonly kind: 'service'; readonly service: string; readonly found: FoundValue; readonly others: readonly FoundValue[] }
  | { readonly kind: 'external'; readonly host: string; readonly found: FoundValue }
  | {
      readonly kind: 'unsettled';
      readonly values: readonly FoundValue[];
      /** The services the values disagree between, when they name more than one. */
      readonly services: readonly string[];
      readonly namedOnly: readonly string[];
    };

/** Every name a host is known by, and the services it names. */
type HostIndex = ReadonlyMap<string, readonly string[]>;

const addTo = (index: Map<string, string[]>, host: string, service: string): void => {
  const key = host.toLowerCase();
  const list = index.get(key) ?? [];
  if (!list.includes(service)) list.push(service);
  index.set(key, list);
};

/** The hosts every service is reached at: its name, its configured hosts, and what its files say. */
export const hostIndexOf = (config: FlowatlasConfig, settings: Readonly<Record<string, RepoSettings>>): HostIndex => {
  const index = new Map<string, string[]>();
  for (const service of config.services) {
    addTo(index, service.name, service.name);
    for (const host of service.hosts ?? []) addTo(index, host, service.name);
  }
  for (const [service, own] of Object.entries(settings)) {
    for (const alias of own.hosts) addTo(index, alias.host, service);
  }
  for (const list of index.values()) list.sort(cmp);
  return index;
};

/** The services a value's host names, by every name it may be known by. */
const servicesAt = (address: string, index: HostIndex): readonly string[] | 'external' | 'inner' | undefined => {
  const host = hostOf(address);
  if (host === undefined) return undefined;
  const named =
    index.get(host.host) ?? index.get(host.hostname) ?? (innerServiceName(host.hostname) === undefined ? undefined : index.get(innerServiceName(host.hostname) as string));
  if (named !== undefined && named.length > 0) return named;
  return isInnerHost(host.hostname) ? 'inner' : 'external';
};

/** The values a deployment gives a setting, for the functions that run the request. */
const deployedValues = (variable: string, runners: readonly GraphNode[]): FoundValue[] =>
  runners.flatMap((fn) => {
    const set = (fn.meta?.[ENVIRONMENT_META] as Record<string, EnvironmentValue> | undefined)?.[variable];
    // A reference to something deployed is a function URL or a queue, which
    // their own joins answer; only a value the files settle as text is an address.
    if (set?.value === undefined || set.kind !== undefined) return [];
    const value = addressOnly(set.value);
    return value === undefined ? [] : [{ variable, value, from: `the environment ${fn.label} is deployed with`, deployed: true }];
  });

export interface BaseUrlInput {
  readonly call: GraphNode;
  /** The setting the address is rooted at, and the variable of the environment behind it where they differ. */
  readonly variables: readonly string[];
  /** The deployed functions that run the request. */
  readonly runners: readonly GraphNode[];
  /** What the caller's own files say, or nothing. */
  readonly settings?: RepoSettings;
  readonly hosts: HostIndex;
  /**
   * Every configured service, for a setting named after one; empty where a
   * name is not to decide. A browser's request is told which service its key
   * names by `apiTarget`, and a guess from the name there would answer the
   * one question the configuration is meant to.
   */
  readonly services: readonly string[];
}

/** Every value the setting is found with, strongest first: the deployment's alone, where it says. */
export const valuesOf = (input: BaseUrlInput): FoundValue[] => {
  const deployed = input.variables.flatMap((variable) => deployedValues(variable, input.runners));
  if (deployed.length > 0) return deployed;
  const written = input.variables.flatMap((variable) =>
    (input.settings?.values[variable] ?? []).map((value) => ({
      variable,
      value: value.value,
      from: value.file,
      ...(value.within === undefined ? {} : { within: value.within }),
      deployed: false,
    })),
  );
  const fallback = input.call.meta?.['baseUrlDefault'];
  const writtenIn = input.call.meta?.['baseUrlDefaultFrom'];
  const own =
    typeof fallback === 'string'
      ? [
          {
            variable: input.variables[0] as string,
            value: fallback,
            from: typeof writtenIn === 'string' ? writtenIn : (input.call.file ?? 'the code'),
            within: 'the code’s own fallback',
            deployed: false,
          },
        ]
      : [];
  return [...written, ...own];
};

/**
 * The one service a setting is named after: the words of its name, the
 * generic ones (`url`, `api`, `service`) left out, are the words of exactly
 * one service's name. A guess, and only asked where no value said otherwise.
 */
export const serviceNamed = (variables: readonly string[], services: readonly string[]): string | undefined => {
  const same = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size > 0 && a.size === b.size && [...a].every((word) => b.has(word));
  const matching = new Set<string>();
  for (const variable of variables) {
    const asked = wordsOf(variable);
    for (const service of services) if (same(asked, wordsOf(service))) matching.add(service);
  }
  return matching.size === 1 ? [...matching][0] : undefined;
};

/** The answer a setting named after a service gives, where its values settled nothing. */
const byItsName = (input: BaseUrlInput, others: readonly FoundValue[], namedOnly: readonly string[]): BaseUrlAnswer | undefined => {
  const service = serviceNamed(input.variables, input.services);
  if (service === undefined) return undefined;
  const found: FoundValue = {
    variable: input.variables[0] as string,
    value: '',
    from: 'its name',
    deployed: false,
    byName: true,
    ...(namedOnly.length === 0 ? {} : { namedOnly }),
    ...(others.length === 0 ? {} : { unmatched: [...new Set(others.map((other) => other.value))] }),
  };
  return { kind: 'service', service, found, others };
};

/** What a request's base address is, from the values its setting is found with, or nothing when none is. */
export const baseUrlOf = (input: BaseUrlInput): BaseUrlAnswer | undefined => {
  const values = valuesOf(input);
  const namedOnly = [...new Set(input.variables.flatMap((variable) => input.settings?.namedOnly[variable] ?? []))].sort(cmp);
  if (values.length === 0) {
    return byItsName(input, [], namedOnly) ?? (namedOnly.length === 0 ? undefined : { kind: 'unsettled', values: [], services: [], namedOnly });
  }

  const byService = new Map<string, FoundValue[]>();
  const external = new Map<string, FoundValue>();
  const unsettled: string[] = [];
  for (const found of values) {
    const at = servicesAt(found.value, input.hosts);
    if (Array.isArray(at)) {
      if (at.length === 1) byService.set(at[0] as string, [...(byService.get(at[0] as string) ?? []), found]);
      else unsettled.push(...at);
    } else if (at === 'external') {
      const host = hostOf(found.value)?.host as string;
      if (!external.has(host)) external.set(host, found);
    }
  }
  if (byService.size === 1 && unsettled.length === 0) {
    const [[service, found]] = [...byService.entries()] as [[string, FoundValue[]]];
    const [first] = found as [FoundValue];
    return { kind: 'service', service, found: first, others: values.filter((value) => value !== first) };
  }
  if (byService.size === 0 && unsettled.length === 0 && external.size > 0) {
    const [[host, found]] = [...external.entries()].sort(([a], [b]) => cmp(a, b)) as [[string, FoundValue]];
    return { kind: 'external', host, found };
  }
  const services = [...new Set([...byService.keys(), ...unsettled])].sort(cmp);
  // Values that name nothing configured - a port nobody is known to listen
  // on - leave the name to decide; values that name services do not.
  const named = services.length === 0 && external.size === 0 ? byItsName(input, values, namedOnly) : undefined;
  return named ?? { kind: 'unsettled', values, services, namedOnly };
};

/** What a request or an edge carries of the value its base address was taken from. */
export const takenMeta = (found: FoundValue): Record<string, string> =>
  found.byName === true ? { baseUrlFrom: 'its name' } : { baseUrl: found.value, baseUrlFrom: whereFound(found) };

/** Where a value was found, as a reader is told it. */
export const whereFound = (found: FoundValue): string =>
  found.deployed ? found.from : found.within === undefined ? found.from : `${found.from} (${found.within})`;
