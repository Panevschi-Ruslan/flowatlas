import { hostOf, LISTEN_META, literalPort, type GraphNode, type ListenPort } from '@flowatlas/core';
import { GRAPHQL_META } from '@flowatlas/graphql';
import { servicesAt, type HostIndex } from './base-url-value.js';
import type { Finding } from './http-link.js';
import { cmp } from './order.js';

/**
 * Which service an address on this machine is, by the port it names (P250).
 *
 * `http://localhost:3001/orders` names no service, and the service listening
 * on 3001 is the one it reaches. Three things can say which that is, and they
 * are asked in this order:
 *
 * 1. the configuration: a host `services[].hosts` (or a name, an alias) gives
 *    exactly one service wins, `static`, as it always did;
 * 2. the code: the port each service's server is started on, as its
 *    repository node keeps it (`meta.listen`), and the setting files: the
 *    `localhost:<port>` a `PORT=` in an example environment file, a published
 *    container port or a worker's dev port places (P77). Agreement, not
 *    precedence (P77 D3): the services they name together must be one;
 * 3. two or more is no answer, and the row names each and where it listens.
 *
 * The join from a port the code writes as a number is `static`: the server
 * listens there wherever it runs. One that is only a setting's fallback, a
 * library's default or a setting file's value is where a local run listens,
 * which is the run an address on this machine is written for, and the join
 * says it is a guess.
 */

/** One port a service listens on, and where its code says so. */
export interface Listening {
  readonly service: string;
  readonly file: string;
  readonly line: number;
  readonly setting?: string;
  readonly default?: true;
}

/** The ports a node says its service listens on: a repository node's, or a GraphQL endpoint's (P245). */
const portsOf = (node: GraphNode): readonly ListenPort[] => {
  if (node.type === 'repo') return (node.meta?.[LISTEN_META] as readonly ListenPort[] | undefined) ?? [];
  if (node.type === 'entry' && node.kind === 'http') {
    return (node.meta?.[GRAPHQL_META] as { listen?: readonly ListenPort[] } | undefined)?.listen ?? [];
  }
  return [];
};

/**
 * Every port the servers of the project listen on, as their code writes it:
 * each service's repository node (P250), and a GraphQL endpoint's own, which
 * P245 carried first. A service is listed once per port.
 */
export const listeningAt = (nodes: ReadonlyMap<string, GraphNode>): Map<number, Listening[]> => {
  const found = new Map<number, Listening[]>();
  for (const node of nodes.values()) {
    for (const port of portsOf(node)) {
      const list = found.get(port.port) ?? [];
      const seen = list.findIndex((each) => each.service === node.repo);
      const listening: Listening = {
        service: node.repo,
        file: port.file,
        line: port.line,
        ...(port.setting === undefined ? {} : { setting: port.setting }),
        ...(port.default === undefined ? {} : { default: port.default }),
      };
      // A literal port is the surer word where one service says the port twice.
      if (seen < 0) list.push(listening);
      else if (!literalPort(list[seen] as Listening) && literalPort(listening)) list[seen] = listening;
      found.set(port.port, list.sort((a, b) => cmp(a.service, b.service)));
    }
  }
  return found;
};

/** The hosts an address on this machine is written with, and nothing else. */
export const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

/** The port an address names on this machine: `http://localhost:4001/graphql` is 4001. */
export const localPortOf = (address: string): number | undefined => {
  const host = hostOf(address);
  if (host === undefined || !LOCAL_HOSTNAMES.has(host.hostname)) return undefined;
  const port = /:(\d+)$/.exec(host.host)?.[1];
  return port === undefined ? undefined : Number(port);
};

/** Where a service listens, as a reader is told it: `src/main.ts:7`, with the setting a fallback is behind. */
export const whereListening = (listening: Listening): string =>
  `${listening.file}:${listening.line}${listening.setting === undefined ? '' : ` (${listening.setting})`}${listening.default === true ? ' (its default)' : ''}`;

/** What the port of an address on this machine says. */
export type PortAnswer =
  | {
      readonly kind: 'service';
      readonly service: string;
      /** The configuration names it, or its code writes the port as a number. */
      readonly sure: boolean;
      /** Where its code starts the server on the port, when the code says. */
      readonly listening?: Listening;
    }
  | {
      readonly kind: 'shared';
      readonly port: number;
      readonly services: readonly string[];
      /** Each service, with where it listens: `inventory (src/index.ts:22)`, `audit (its setting files)`. */
      readonly said: readonly string[];
    };

export interface PortIndex {
  /** The hosts the configuration gives: names, aliases, `services[].hosts`. */
  readonly configured: HostIndex;
  /** The same with the hosts the setting files give, where they are read. */
  readonly all: HostIndex;
  readonly listening: ReadonlyMap<number, readonly Listening[]>;
}

/**
 * The service an address on this machine reaches, by its port, or nothing
 * where it names no port on this machine or nothing listens there.
 */
export const atLocalPort = (address: string, index: PortIndex): PortAnswer | undefined => {
  const port = localPortOf(address);
  if (port === undefined) return undefined;
  const configured = servicesAt(address, index.configured);
  if (Array.isArray(configured) && configured.length === 1) return { kind: 'service', service: configured[0] as string, sure: true };
  // The files spell a published port three ways; `[::1]` is the same machine.
  const local = `http:${'/'.repeat(2)}localhost:${port}`;
  const filed = servicesAt(local, index.all);
  const fromFiles = Array.isArray(filed) ? filed : [];
  const listening = index.listening.get(port) ?? [];
  const services = [...new Set([...fromFiles, ...listening.map((each) => each.service)])].sort(cmp);
  if (services.length === 0) return undefined;
  if (services.length === 1) {
    const service = services[0] as string;
    const where = listening.find((each) => each.service === service);
    return { kind: 'service', service, sure: where !== undefined && literalPort(where), ...(where === undefined ? {} : { listening: where }) };
  }
  const said = services.map((service) => {
    const where = listening.find((each) => each.service === service);
    return where === undefined ? `${service} (its setting files)` : `${service} (${where.file}:${where.line})`;
  });
  return { kind: 'shared', port, services, said };
};

/** Why two services on one port leave a request unjoined, as a row says it. */
export const portSharedFinding = (port: number, said: readonly string[]): Finding => ({
  reason: 'local-port-shared',
  message: `port ${port} on this machine is where ${said.join(' and ')} each listen, so it is not one service`,
  hint: `Name the host under services[].hosts of the service this request means (localhost:${port}), or start the servers on different ports.`,
});
