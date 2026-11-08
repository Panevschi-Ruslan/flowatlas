import { forwardedBy, proxyTargetOf, OWN_ORIGIN_META, PROXY_META, type GraphNode, type IngressRoute, type ProxyRule, type RepoSettings, type Unresolved } from '@flowatlas/core';
import type { Finding } from './http-link.js';

/**
 * A request a server forwards, followed to where it is forwarded (P257).
 *
 * A front end calling `/api/orders` with no host is calling the server its
 * page is served from, and that server's proxy may hand `/api` to another
 * service: the rules its framework's configuration writes are kept on the
 * repository node (`meta.proxy`), and a request matching one is asked again
 * as the request the proxy makes - the target's host, the rewritten path.
 * The join is `heuristic`, since a proxy is how a server is run, not what
 * the code says, and the edge names the rule (`proxiedBy`).
 *
 * Three things more are followed here (P260). A rule whose target is read
 * from a setting is given the value the service's own files give it (P77),
 * or its fallback. A request a cluster's way in (an `Ingress`, an
 * `HTTPRoute`) matches on its public host is forwarded the same way, to the
 * name the cluster routes and the path the rule rewrites. And a request
 * forwarded to a server that forwards it again is followed again, up to
 * `PROXY_HOPS` servers; a longer chain, or one that comes back to a server
 * it passed, is a row.
 */

/** A request as a proxy forwards it. */
export interface Forward {
  readonly rule: ProxyRule;
  /** The host it is forwarded to, `localhost:3001`. */
  readonly host: string;
  /** The port the target's scheme defaults to, where its host writes none. */
  readonly defaultPort?: number;
  /** The path it is forwarded as. */
  readonly path: string;
  /** A cluster's way in rather than a server's proxy (P260). */
  readonly via?: 'ingress';
  /** The object a way in is written in, `ingress/shop` (P260). */
  readonly object?: string;
  /** The setting the target was read from and the file that gives its value (P260). */
  readonly targetFrom?: string;
  /** The forwards before this one where a proxy forwarded to another (P260): each server, and the rule it forwarded by. */
  readonly through?: ReadonlyArray<{ readonly service: string; readonly forward: Forward }>;
}

/** How many servers a request is followed through before the chain is said and not followed (P260). */
export const PROXY_HOPS = 4;

/** Every service's proxy rules, from its repository node. */
export const proxiesAt = (nodes: ReadonlyMap<string, GraphNode>): Map<string, readonly ProxyRule[]> => {
  const out = new Map<string, readonly ProxyRule[]>();
  for (const node of nodes.values()) {
    if (node.type !== 'repo') continue;
    const rules = node.meta?.[PROXY_META] as readonly ProxyRule[] | undefined;
    if (rules !== undefined && rules.length > 0) out.set(node.repo, [...(out.get(node.repo) ?? []), ...rules]);
  }
  return out;
};

/** The services whose servers resolve their own requests with no host against their own address (P260). */
export const ownOriginsAt = (nodes: ReadonlyMap<string, GraphNode>): Set<string> => {
  const out = new Set<string>();
  for (const node of nodes.values()) if (node.type === 'repo' && node.meta?.[OWN_ORIGIN_META] === true) out.add(node.repo);
  return out;
};

/** The port a scheme is reached at where an address writes none. */
export const defaultPortOf = (address: unknown): number | undefined => {
  if (typeof address !== 'string') return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(address)?.[1]?.toLowerCase();
  return scheme === 'https' || scheme === 'wss' ? 443 : scheme === 'http' || scheme === 'ws' ? 80 : undefined;
};

/** A rule, with where its target was read from where a setting gave it. */
interface Settled {
  readonly rule: ProxyRule;
  readonly targetFrom?: string;
}

/** The row for a rule whose target setting the service's files do not settle (P260). */
const unsettledRow = (service: string, rule: ProxyRule, why: string): Unresolved => ({
  service,
  file: rule.file,
  line: rule.line,
  reason: 'proxy-rule-unread',
  symbol: rule.path,
  message: `the proxy rule for ${rule.path} in ${rule.file} reads its target from ${rule.setting?.name}, which ${why}`,
  hint: `Give ${rule.setting?.name} one address in an example environment file of the service (.env.example), or write the target as a literal.`,
  meta: { key: rule.path, setting: rule.setting?.name },
});

/**
 * Each service's rules with their targets settled (P260): a rule whose target
 * is read from a setting takes the one address the service's files give it,
 * or the fallback written beside it; with neither, it is not followed, and a
 * row says so.
 */
const settledRules = (proxies: ReadonlyMap<string, readonly ProxyRule[]>, settings: Readonly<Record<string, RepoSettings>>): { rules: Map<string, Settled[]>; rows: Unresolved[] } => {
  const rules = new Map<string, Settled[]>();
  const rows: Unresolved[] = [];
  for (const [service, own] of proxies) {
    const kept: Settled[] = [];
    for (const rule of own) {
      if (rule.setting === undefined) {
        kept.push({ rule });
        continue;
      }
      const values = settings[service]?.values?.[rule.setting.name] ?? [];
      const targets = [...new Map(values.flatMap((value) => {
        const target = proxyTargetOf(value.value);
        return target === undefined ? [] : [[`${target.origin}${target.path}`, { target, file: value.file }] as const];
      })).values()];
      if (targets.length === 1) {
        const [{ target, file }] = targets as [(typeof targets)[number]];
        kept.push({ rule: { ...rule, target: target.origin, to: `${target.path}${rule.setting.to}` }, targetFrom: `${rule.setting.name} from ${file}` });
        continue;
      }
      if (rule.target !== '') {
        kept.push({ rule });
        continue;
      }
      rows.push(unsettledRow(service, rule, targets.length === 0 ? "the service's files give no address" : `the service's files give several addresses (${targets.map((each) => `${each.target.origin}${each.target.path}`).join(', ')})`));
    }
    if (kept.length > 0) rules.set(service, kept);
  }
  return { rules, rows };
};

const forwardFrom = (settled: Settled, path: string, via?: { via: 'ingress'; object: string }): Forward => {
  const host = settled.rule.target.replace(/^[a-z]+:\/\//i, '');
  const port = defaultPortOf(settled.rule.target);
  return {
    rule: settled.rule,
    host,
    path,
    ...(port === undefined ? {} : { defaultPort: port }),
    ...(settled.targetFrom === undefined ? {} : { targetFrom: settled.targetFrom }),
    ...(via ?? {}),
  };
};

/** How each service's proxy forwards a path, and a row for each rule whose target is not settled (P257, P260). */
export const forwarding = (
  nodes: ReadonlyMap<string, GraphNode>,
  settings: Readonly<Record<string, RepoSettings>> = {},
): { forwardOf: (service: string, path: string) => Forward | undefined; rows: readonly Unresolved[] } => {
  const { rules, rows } = settledRules(proxiesAt(nodes), settings);
  const forwardOf = (service: string, path: string): Forward | undefined => {
    const own = rules.get(service) ?? [];
    const found = forwardedBy(
      own.map((each) => each.rule),
      path,
    );
    if (found === undefined) return undefined;
    const settled = own.find((each) => each.rule === found.rule) as Settled;
    return forwardFrom(settled, found.path);
  };
  return { forwardOf, rows };
};

/** How each service's proxy forwards a path, or nothing where no rule of it does. */
export const forwardOf =
  (proxies: ReadonlyMap<string, readonly ProxyRule[]>) =>
  (service: string, path: string): Forward | undefined => {
    const found = forwardedBy(proxies.get(service) ?? [], path);
    return found === undefined ? undefined : forwardFrom({ rule: found.rule }, found.path);
  };

/** The rules of a public host, exactly or by a wildcard of one label. */
const rulesOfHost = (byHost: ReadonlyMap<string, IngressRoute[]>, host: string): IngressRoute[] => {
  const name = host.toLowerCase().replace(/:\d+$/, '');
  const exact = byHost.get(name);
  if (exact !== undefined) return exact;
  const dot = name.indexOf('.');
  return dot < 0 ? [] : (byHost.get(`*${name.slice(dot)}`) ?? []);
};

/**
 * How a cluster's ways in forward a request to a public host (P260), and the
 * public hosts a service's own pages are served at, which a request it writes
 * with no host is a request to.
 */
export const waysIn = (
  settings: Readonly<Record<string, RepoSettings>>,
): { ingressOf: (host: string, path: string) => Forward | undefined; publicHostsOf: (service: string) => readonly string[] } => {
  const byHost = new Map<string, IngressRoute[]>();
  const hostsOf = new Map<string, Set<string>>();
  for (const [service, own] of Object.entries(settings)) {
    for (const route of own.ingress ?? []) {
      byHost.set(route.host, [...(byHost.get(route.host) ?? []), route]);
      if (!route.host.startsWith('*')) hostsOf.set(service, new Set([...(hostsOf.get(service) ?? []), route.host]));
    }
  }
  const ingressOf = (host: string, path: string): Forward | undefined => {
    const routes = rulesOfHost(byHost, host);
    if (routes.length === 0) return undefined;
    const found = forwardedBy(
      routes.map((each) => each.rule),
      path,
    );
    if (found === undefined) return undefined;
    const route = routes.find((each) => each.rule === found.rule) as IngressRoute;
    return forwardFrom({ rule: found.rule }, found.path, { via: 'ingress', object: route.object });
  };
  return { ingressOf, publicHostsOf: (service) => [...(hostsOf.get(service) ?? [])].sort() };
};

/** A forward made after the ones before it, which it remembers. */
export const forwardedAgain = (before: Forward, service: string, next: Forward): Forward => ({
  ...next,
  through: [...(before.through ?? []), { service, forward: { ...before, through: [] } }],
});

/** What an edge joined through a proxy carries: the rule, the servers it passed and the path it was forwarded as where that differs. */
export const proxiedMeta = (forward: Forward | undefined, asked: string): Record<string, unknown> => {
  if (forward === undefined) return {};
  const first = forward.through?.[0]?.forward ?? forward;
  const then = [...(forward.through ?? []).slice(1).map((each) => each.forward), ...(forward.through === undefined || forward.through.length === 0 ? [] : [forward])];
  return {
    proxiedBy: `${first.rule.file}:${first.rule.line}`,
    ...(then.length === 0 ? {} : { proxiedThen: then.map((each) => `${each.rule.file}:${each.rule.line}`) }),
    ...(forward.path === asked ? {} : { proxiedAs: forward.path }),
    ...(forward.object === undefined ? {} : { wayIn: forward.object }),
    ...(forward.targetFrom === undefined ? {} : { proxiedTo: forward.targetFrom }),
  };
};

/** What is said of a request a proxy forwards to a host no service of the project is reached at. */
export const proxiedOutFinding = (service: string, forward: Forward): Finding => ({
  reason: 'proxied-to-third-party',
  level: 'info',
  message: `${service}'s proxy (${forward.rule.file}:${forward.rule.line}) forwards this request to ${forward.host}${forward.path}, which no configured service is reached at`,
  hint: `Drawn as a call to ${forward.host}. If that host is one of the project's services, name it under services[].hosts of that service.`,
});

/** What is said of a request forwarded through more servers than are followed, or back to one it passed (P260). */
export const proxyChainFinding = (services: readonly string[], loop: boolean): Finding => ({
  reason: 'proxy-chain-unfollowed',
  message: loop
    ? `the request is forwarded by ${services.slice(0, -1).join(', then ')}, and back to ${services[services.length - 1]}: the proxies forward it in a circle`
    : `the request is forwarded by ${services.join(', then ')} and on, past the ${PROXY_HOPS} servers a request is followed through`,
  hint: loop ? 'One of the rules forwards to the server the request came from; check the targets of the rules named.' : 'Annotate the request with the service it reaches (/** @flowatlas-calls <service> METHOD /path */).',
});
