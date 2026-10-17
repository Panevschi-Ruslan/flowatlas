import { hostOf, innerServiceName, type FlowatlasConfig, type GraphNode, type RepoSettings } from '@flowatlas/core';
import { hostIndexOf } from '@flowatlas/linker';
import type { FrontEndContext } from './reader-parts.js';

/**
 * Where a project's front ends send their calls (P112), for the HAR reader:
 * which services the map has browser calls for, and which service an origin
 * a call was sent to is.
 *
 * An origin is a service when a base URL of the front end is written with it
 * (`apiBaseEnv` values in the front end's own files, P77), and its key is
 * named by `apiTarget` or its host is a service's; or when its host is one a
 * service is reached at - its name, an alias, `services[].hosts`, or what the
 * project's files say (`hostIndexOf`, the build's own index). Nothing else is
 * guessed: an origin nothing names is the reader's to place.
 */

/** The services the map has browser calls (`ui_api_call`) for, sorted. */
export const frontEndsOf = (nodes: readonly GraphNode[]): string[] =>
  [...new Set(nodes.filter((node) => node.type === 'ui_api_call').map((node) => node.repo))].sort();

/** An address's origin, `https://host[:port]`, or nothing when it is not a URL. */
const originOf = (address: string): string | undefined => {
  try {
    const url = new URL(address);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

/** The one service a lookup names, or nothing for none or several. */
const one = (services: readonly string[] | undefined): string | undefined =>
  services !== undefined && services.length === 1 ? services[0] : undefined;

export const frontEndContextOf = (
  nodes: readonly GraphNode[],
  project?: { config: FlowatlasConfig; settings: Readonly<Record<string, RepoSettings>> },
): FrontEndContext => {
  const frontEnds = frontEndsOf(nodes);
  if (project === undefined) return { frontEnds, serviceAt: () => undefined };
  const { config, settings } = project;
  const hosts = hostIndexOf(config, settings);
  /** The service a host is reached at: with its port, then without, then a cluster's name for it. */
  const serviceOfHost = (address: string): string | undefined => {
    const host = hostOf(address);
    if (host === undefined) return undefined;
    const inner = innerServiceName(host.hostname);
    return one(hosts.get(host.host)) ?? one(hosts.get(host.hostname)) ?? (inner === undefined ? undefined : one(hosts.get(inner)));
  };
  /** Per front end, the origins its base URLs are written with, and the service each names; `null` where they disagree. */
  const bases = new Map<string, Map<string, string | null>>();
  for (const service of config.services) {
    const origins = new Map<string, string | null>();
    for (const variable of service.apiBaseEnv ?? []) {
      const target = service.apiTarget?.[variable];
      for (const value of settings[service.name]?.values[variable] ?? []) {
        const origin = originOf(value.value);
        const named = target === undefined ? serviceOfHost(value.value) : (one(hosts.get(target.toLowerCase())) ?? target);
        if (origin === undefined || named === undefined) continue;
        const had = origins.get(origin);
        origins.set(origin, had === undefined || had === named ? named : null);
      }
    }
    if (origins.size > 0) bases.set(service.name, origins);
  }
  return {
    frontEnds,
    serviceAt: (origin, frontEnd) => {
      const base = bases.get(frontEnd)?.get(origin);
      if (base !== undefined) return base ?? undefined;
      return serviceOfHost(origin);
    },
  };
};
