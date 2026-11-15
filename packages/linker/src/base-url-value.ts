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
   * name of exactly one service: `CATALOG_URL` for `catalog`. `value` is then empty.
   */
  readonly byName?: boolean;
  /** For a setting taken by its name: the files that set it and whose values are never read. */
  readonly namedOnly?: readonly string[];
  /** For a setting taken by its name: the values found, none of which named a configured service. */
  readonly unmatched?: readonly string[];
  /** The service the value is an address of, where the deployment says so: an API another service publishes (P249). */
  readonly service?: string;
  /**
   * For an address of an API the caller's own deployment serves, written out
   * with an id the files do not tie to it (P268): the path it asks for on the
   * API, after its stage, and the address as it is written.
   */
  readonly apiPath?: string;
  readonly written?: string;
  /** The address is built around a reference to the API, which says which API it is (P272). */
  readonly referenced?: boolean;
}

/** What the values of a setting say a request's base address is. */
export type BaseUrlAnswer =
  | { readonly kind: 'service'; readonly service: string; readonly found: FoundValue; readonly others: readonly FoundValue[] }
  | {
      readonly kind: 'external';
      readonly host: string;
      readonly found: FoundValue;
      /** Every value found, among them those of this machine a third party's host outweighed (P281). */
      readonly values?: readonly FoundValue[];
    }
  | {
      readonly kind: 'unsettled';
      readonly values: readonly FoundValue[];
      /** The services the values disagree between, when they name more than one. */
      readonly services: readonly string[];
      readonly namedOnly: readonly string[];
    };

/** Every name a host is known by, and the services it names. */
export type HostIndex = ReadonlyMap<string, readonly string[]>;

const addTo = (index: Map<string, string[]>, host: string, service: string): void => {
  const key = host.toLowerCase();
  const list = index.get(key) ?? [];
  if (!list.includes(service)) list.push(service);
  index.set(key, list);
};

/** The hosts every service is reached at: its name and aliases, its configured hosts, and what its files say. */
export const hostIndexOf = (config: FlowatlasConfig, settings: Readonly<Record<string, RepoSettings>>): HostIndex => {
  const index = new Map<string, string[]>();
  for (const service of config.services) {
    addTo(index, service.name, service.name);
    // A service is reached at the names it is known by (P91).
    for (const alias of service.aliases ?? []) addTo(index, alias, service.name);
    for (const host of service.hosts ?? []) addTo(index, host, service.name);
  }
  for (const [service, own] of Object.entries(settings)) {
    for (const alias of own.hosts) addTo(index, alias.host, service);
  }
  for (const list of index.values()) list.sort(cmp);
  return index;
};

/**
 * The hosts only an example environment file gives a service (P309): each
 * host with the services every file placing them there at it is an example
 * or a template of. Such a host is offered, not where a run is placed.
 */
export const offeredHostsOf = (settings: Readonly<Record<string, RepoSettings>>): HostIndex => {
  const index = new Map<string, string[]>();
  for (const [service, own] of Object.entries(settings)) {
    const firm = new Set(own.hosts.filter((alias) => alias.example !== true).map((alias) => alias.host.toLowerCase()));
    for (const alias of own.hosts) if (alias.example === true && !firm.has(alias.host.toLowerCase())) addTo(index, alias.host, service);
  }
  for (const list of index.values()) list.sort(cmp);
  return index;
};

/** The services a value's host names, by every name it may be known by. */
export const servicesAt = (address: string, index: HostIndex): readonly string[] | 'external' | 'inner' | undefined => {
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
    // An API another service publishes, imported by its name: that service (P249).
    if (set?.kind === 'api' && set.service !== undefined && set.value !== undefined) {
      return [{ variable, value: set.value, from: `the environment ${fn.label} is deployed with`, deployed: true, service: set.service }];
    }
    // An address of an API the function's own deployment serves (P268): its service.
    if (set?.kind === 'api' && set.path !== undefined && set.value !== undefined) {
      return [
        { variable, value: set.value, from: `the environment ${fn.label} is deployed with`, deployed: true, service: fn.repo, apiPath: set.path, written: set.written, ...(set.referenced === true ? { referenced: true } : {}) },
      ];
    }
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
   * The services an address on this machine reaches by its port, the ports
   * their code listens on among them (P250, P254): asked before the hosts,
   * so a value only the code places is placed (P292). Nothing for an address
   * that is not this machine's, or a port nothing is known at.
   */
  readonly atPort?: (address: string) => readonly string[] | undefined;
  /**
   * Every configured service, for a setting named after one; empty where a
   * name is not to decide. Asked for a browser's request as for one between
   * services (P292), after `apiTarget`, which the configuration writes for it.
   */
  readonly services: readonly string[];
}

/**
 * The settings a chain of `||` reads after the one a request is rooted at,
 * in order (P296): `process.env.A || process.env.B || 'x'` goes to `B` where
 * `A` is not set.
 */
export const settingsAfter = (call: GraphNode): readonly string[] => {
  const also = call.meta?.['baseUrlAlso'];
  return Array.isArray(also) ? also.filter((each): each is string => typeof each === 'string') : [];
};

/**
 * The settings of a condition's branches nobody settles, the first branch's
 * first (P309): `isProd ? process.env.A : process.env.B` is `['A', 'B']`,
 * each as much the request's base as the other.
 */
export const settingsEither = (call: GraphNode): readonly string[] => {
  const either = call.meta?.['baseUrlEither'];
  return Array.isArray(either) ? either.filter((each): each is string => typeof each === 'string') : [];
};

/**
 * The variable of the environment a settings factory builds a setting's key
 * from (P77), for the key a request is rooted at and for each setting of a
 * chain or a condition's branches after it (P313): `config.get('orders.url')`
 * read from `ORDERS_URL`.
 */
export const variableOfSetting = (call: GraphNode, setting: string): string | undefined => {
  if (setting === call.meta?.['baseUrlEnv']) {
    const variable = call.meta?.['baseUrlVariable'];
    if (typeof variable === 'string') return variable;
  }
  const variables = call.meta?.['baseUrlVariables'];
  const variable = typeof variables === 'object' && variables !== null ? (variables as Record<string, unknown>)[setting] : undefined;
  return typeof variable === 'string' ? variable : undefined;
};

/** Who claims a setting of a request's base: whoever claims its key, else whoever claims the variable its key is built from (P77, P313). */
export const claimantsOfSetting = (call: GraphNode, setting: string, claimantsOf: (setting: string) => readonly string[]): readonly string[] => {
  const own = claimantsOf(setting);
  if (own.length > 0) return own;
  const variable = variableOfSetting(call, setting);
  return variable === undefined ? own : claimantsOf(variable);
};

/** A service a setting of a request's base reaches, with the settings of the base it claims. */
export interface BranchClaim {
  readonly service: string;
  readonly settings: readonly string[];
}

/**
 * The services a request's base may be, where its settings are claimed by
 * more than one (P309, P313), asked in tiers:
 *
 * - `either`: a condition's branches nobody settles, one tier, every
 *   claimant of every branch's setting as much the base as another, a setting
 *   several services claim naming each of them;
 * - `chain`: `A || B`, `A ?? B`, one tier per setting someone claims, in the
 *   order they are read, a service counted at the first setting it claims.
 */
export interface SettingCandidates {
  readonly order: 'either' | 'chain';
  readonly tiers: readonly (readonly BranchClaim[])[];
}

const claimsOf = (call: GraphNode, settings: readonly string[], claimantsOf: (setting: string) => readonly string[], seen: ReadonlySet<string>): BranchClaim[] => {
  const claims: { service: string; settings: string[] }[] = [];
  for (const setting of settings) {
    for (const service of claimantsOfSetting(call, setting, claimantsOf)) {
      if (seen.has(service)) continue;
      const claim = claims.find((each) => each.service === service);
      if (claim === undefined) claims.push({ service, settings: [setting] });
      else if (!claim.settings.includes(setting)) claim.settings.push(setting);
    }
  }
  return claims;
};

/**
 * Who may be a request's base among the settings it is read from (P313): a
 * condition's branches as one tier, else the settings of a chain, each its
 * own tier. Nothing where they name one service or none, so the setting the
 * request is rooted at is looked up as it always was.
 */
export const settingCandidates = (call: GraphNode, claimantsOf: (setting: string) => readonly string[]): SettingCandidates | undefined => {
  const either = settingsEither(call);
  if (either.length > 0) {
    const claims = claimsOf(call, either, claimantsOf, new Set());
    return claims.length > 1 ? { order: 'either', tiers: [claims] } : undefined;
  }
  const env = call.meta?.['baseUrlEnv'];
  if (typeof env !== 'string') return undefined;
  const seen = new Set<string>();
  const tiers: BranchClaim[][] = [];
  for (const setting of [env, ...settingsAfter(call)]) {
    const tier = claimsOf(call, [setting], claimantsOf, seen);
    if (tier.length === 0) continue;
    for (const claim of tier) seen.add(claim.service);
    tiers.push(tier);
  }
  return seen.size > 1 ? { order: 'chain', tiers } : undefined;
};

/**
 * Who claims each setting of a condition's branches nobody settles (P309):
 * every claimant of every branch's setting, each with the branch settings it
 * claims, in the order the branches are written (P313). Nothing where they
 * name one service or none.
 */
export const branchClaims = (call: GraphNode, claimantsOf: (setting: string) => readonly string[]): readonly BranchClaim[] | undefined => {
  const candidates = settingCandidates(call, claimantsOf);
  return candidates?.order === 'either' ? candidates.tiers[0] : undefined;
};

/** A claim as a row names it: `ORDERS_URL (orders)`. */
export const branchSaid = (claim: BranchClaim): string => `${claim.settings.join(', ')} (${claim.service})`;

/** The service a request's base was chosen as among its settings' claimants, or the several serving it. */
export type SettingChoice<T> =
  | { readonly kind: 'one'; readonly claim: BranchClaim; readonly found: T; readonly said: readonly string[]; readonly order: SettingCandidates['order'] }
  | {
      readonly kind: 'several';
      readonly serving: readonly { readonly claim: BranchClaim; readonly found: T }[];
      readonly said: readonly string[];
      readonly order: SettingCandidates['order'];
    };

/**
 * The claimant serving the request among a request's base settings (P309,
 * P313), `ask` answering for a service that serves it and nothing for one
 * that does not. Tier by tier: the first tier anyone serves it in is the
 * answer, one service the join, a guess, several a row. A chain's first tier
 * serving it is the join it always was, so nothing; and where nobody serves
 * it, nothing, and the first claimant is asked as before.
 */
export const chooseAmongSettings = <T>(candidates: SettingCandidates, ask: (service: string) => T | undefined): SettingChoice<T> | undefined => {
  const said = candidates.tiers.flat().map(branchSaid);
  for (const [index, tier] of candidates.tiers.entries()) {
    const serving = tier.flatMap((claim) => {
      const found = ask(claim.service);
      return found === undefined ? [] : [{ claim, found }];
    });
    if (serving.length === 0) continue;
    if (candidates.order === 'chain' && index === 0) return undefined;
    const [only] = serving;
    return only !== undefined && serving.length === 1
      ? { kind: 'one', claim: only.claim, found: only.found, said, order: candidates.order }
      : { kind: 'several', serving, said, order: candidates.order };
  }
  return undefined;
};

/** How a row says the base was read from its settings: chosen by a condition, or the first of a chain that is set. */
export const howChosen = (order: SettingCandidates['order']): string =>
  order === 'either' ? 'chosen by a condition nobody settles' : 'read from the first of them that is set';

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

/** The prefixes a build requires of the settings it hands the browser, which name no service. */
const BROWSER_PREFIX = /^(?:NEXT_PUBLIC_|NUXT_PUBLIC_|EXPO_PUBLIC_|REACT_APP_|VUE_APP_|NG_APP_|GATSBY_|VITE_|PUBLIC_)(?=[A-Z0-9])/;

/**
 * The one service a setting is named after: the words of its name, the
 * generic ones (`url`, `api`, `service`) left out, are the words of exactly
 * one service's name. A guess, and only asked where no value said otherwise.
 */
export const serviceNamed = (variables: readonly string[], services: readonly string[]): string | undefined => {
  const same = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size > 0 && a.size === b.size && [...a].every((word) => b.has(word));
  const matching = new Set<string>();
  for (const variable of variables) {
    // The prefix a build requires of a setting the browser is handed says
    // nothing of the service: `VITE_ORDERS_URL` is named after `orders` (P292).
    const asked = wordsOf(variable.replace(BROWSER_PREFIX, ''));
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
    const at = found.service === undefined ? (input.atPort?.(found.value) ?? servicesAt(found.value, input.hosts)) : [found.service];
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
    return { kind: 'external', host, found, values };
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
