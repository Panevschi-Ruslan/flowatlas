import { forwardedBy, PROXY_META, type GraphNode, type ProxyRule } from '@flowatlas/core';
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
}

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

/** The port a scheme is reached at where an address writes none. */
export const defaultPortOf = (address: unknown): number | undefined => {
  if (typeof address !== 'string') return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(address)?.[1]?.toLowerCase();
  return scheme === 'https' || scheme === 'wss' ? 443 : scheme === 'http' || scheme === 'ws' ? 80 : undefined;
};

/** How a service's proxy forwards a path, or nothing where no rule of it does. */
export const forwardOf =
  (proxies: ReadonlyMap<string, readonly ProxyRule[]>) =>
  (service: string, path: string): Forward | undefined => {
    const found = forwardedBy(proxies.get(service) ?? [], path);
    if (found === undefined) return undefined;
    const host = found.rule.target.replace(/^[a-z]+:\/\//i, '');
    const port = defaultPortOf(found.rule.target);
    return { rule: found.rule, host, path: found.path, ...(port === undefined ? {} : { defaultPort: port }) };
  };

/** What an edge joined through a proxy carries: the rule, and the path it was forwarded as where that differs. */
export const proxiedMeta = (forward: Forward | undefined, asked: string): Record<string, unknown> =>
  forward === undefined
    ? {}
    : { proxiedBy: `${forward.rule.file}:${forward.rule.line}`, ...(forward.path === asked ? {} : { proxiedAs: forward.path }) };

/** What is said of a request a proxy forwards to a host no service of the project is reached at. */
export const proxiedOutFinding = (service: string, forward: Forward): Finding => ({
  reason: 'proxied-to-third-party',
  level: 'info',
  message: `${service}'s proxy (${forward.rule.file}:${forward.rule.line}) forwards this request to ${forward.host}${forward.path}, which no configured service is reached at`,
  hint: `Drawn as a call to ${forward.host}. If that host is one of the project's services, name it under services[].hosts of that service.`,
});
