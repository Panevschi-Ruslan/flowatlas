import {
  hostOf,
  innerServiceName,
  LISTEN_META,
  literalPort,
  type ContainerRun,
  type GraphNode,
  type ListenPort,
  type RepoSettings,
  type RoutedName,
  type Unresolved,
} from '@flowatlas/core';
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
 *
 * What the code says and what the files say are put together where they meet
 * (P254). A port the code reads from a setting alone (`process.env.PORT`) is
 * where the service's example environment file says the setting is. A
 * container that publishes `3001:3000` for a service listening on 3000 is
 * one fact with two sides: the service is reached at `localhost:3001` on the
 * machine running the container, through the mapping, and at `orders:3000` on
 * the container's own network; inside the container, the port its
 * environment gives the setting the code reads is the one it listens on. A
 * mapping whose container side nothing in the code listens on is a note.
 *
 * A cluster's network is read the same way (P257): a name its manifests
 * route to the service's containers (`orders:80` to 3000) is where the
 * service is reached on that network, joined where the code listens on the
 * port it routes to, a note where it does not. And a request on either
 * network to a port the service is not reached at there - the port a
 * container publishes on the machine, or the containers' own port behind a
 * routed name - will not connect: it is a finding, never a join.
 */

/** One port a service listens on, and where its code says so. */
export interface Listening {
  readonly service: string;
  readonly file: string;
  readonly line: number;
  readonly setting?: string;
  readonly default?: true;
  /** Where the port is handed to the function that starts the server (P254). */
  readonly handed?: string;
  /** A front end's dev server, which forwards what it does not serve (P254). */
  readonly devServer?: true;
  /** The file that gives the setting the code reads its port from alone its value (P254). */
  readonly valueFrom?: string;
  /**
   * The published side of a container's mapping this port is reached through
   * on the machine (P254); or a port this machine forwards to a cluster's
   * object, or one every node of a cluster opens for it (P260), with the
   * object it reaches.
   */
  readonly published?: { readonly port: number; readonly file: string; readonly via?: 'forwarded' | 'node-port'; readonly object?: string };
  /** The container this is the port of, on the container's own network (P254). */
  readonly inContainer?: { readonly name: string; readonly file: string };
  /** The name a cluster's network routes to this port, and the port it is reached at (P257). */
  readonly routed?: { readonly name: string; readonly port: number; readonly file: string };
}

/** A host on a container's or a cluster's network that names a service at a port it is not reached at there (P257). */
export interface ClosedPort {
  readonly service: string;
  /** What the port is: published on the machine, or the containers' own behind a routed name. */
  readonly kind: 'published' | 'behind';
  /** The hosts the network does reach the service at, `orders:3000`. */
  readonly reachable: readonly string[];
  readonly file: string;
}

/** The ports a node says its service listens on: a repository node's, or a GraphQL endpoint's (P245). */
const portsOf = (node: GraphNode): readonly ListenPort[] => {
  if (node.type === 'repo') return (node.meta?.[LISTEN_META] as readonly ListenPort[] | undefined) ?? [];
  if (node.type === 'entry' && node.kind === 'http') {
    return (node.meta?.[GRAPHQL_META] as { listen?: readonly ListenPort[] } | undefined)?.listen ?? [];
  }
  return [];
};

/** Whether where a service listens is as sure as the code writing the port as a number, wherever it runs. */
const isSure = (listening: Listening): boolean =>
  literalPort(listening) && listening.valueFrom === undefined && listening.published === undefined && listening.routed === undefined;

/** One service listening at a port, kept once: the surer word where one service says the port twice. */
const addListening = (into: Map<number, Listening[]>, port: number, listening: Listening): void => {
  const list = into.get(port) ?? [];
  const seen = list.findIndex((each) => each.service === listening.service);
  if (seen < 0) list.push(listening);
  else if (!isSure(list[seen] as Listening) && isSure(listening)) list[seen] = listening;
  into.set(port, list.sort((a, b) => cmp(a.service, b.service)));
};

const listeningOf = (service: string, port: ListenPort): Listening => ({
  service,
  file: port.file,
  line: port.line,
  ...(port.setting === undefined ? {} : { setting: port.setting }),
  ...(port.default === undefined ? {} : { default: port.default }),
  ...(port.handed === undefined ? {} : { handed: port.handed }),
  ...(port.devServer === undefined ? {} : { devServer: port.devServer }),
});

/** Every port each service's code says it listens on, a setting alone included, by service. */
const codePortsOf = (nodes: ReadonlyMap<string, GraphNode>): Map<string, ListenPort[]> => {
  const out = new Map<string, ListenPort[]>();
  for (const node of nodes.values()) {
    const ports = portsOf(node);
    if (ports.length > 0) out.set(node.repo, [...(out.get(node.repo) ?? []), ...ports]);
  }
  return out;
};

/**
 * Every port the servers of the project listen on, as their code writes it:
 * each service's repository node (P250), and a GraphQL endpoint's own, which
 * P245 carried first. A service is listed once per port.
 */
export const listeningAt = (nodes: ReadonlyMap<string, GraphNode>): Map<number, Listening[]> => {
  const found = new Map<number, Listening[]>();
  for (const [service, ports] of codePortsOf(nodes)) {
    for (const port of ports) if (port.port !== undefined) addListening(found, port.port, listeningOf(service, port));
  }
  return found;
};

/** Where the project's services listen, the code and the files put together (P254). */
export interface PortListening {
  /** By port on this machine. */
  readonly byPort: ReadonlyMap<number, readonly Listening[]>;
  /** By `<name>:<port>` on a container's own network. */
  readonly inNetwork: ReadonlyMap<string, readonly Listening[]>;
  /** A mapping whose container side the code does not listen on, one row each. */
  readonly rows: readonly Unresolved[];
  /** By `<name>:<port>`: a port the network does not reach the service at (P257). */
  readonly closed: ReadonlyMap<string, ClosedPort>;
}

/** The ports a service listens on inside a container: its environment's value for the setting the code reads, else the code's own. */
const insideContainer = (service: string, ports: readonly ListenPort[], container: Pick<ContainerRun, 'name' | 'file' | 'environment' | 'environmentFrom'>): Map<number, Listening> => {
  const inside = new Map<number, Listening>();
  for (const port of ports) {
    const given = port.setting === undefined ? undefined : container.environment[port.setting];
    const at = given ?? port.port;
    if (at === undefined) continue;
    const listening = listeningOf(service, port);
    const read: Listening = given === undefined ? listening : { ...listening, valueFrom: `${container.environmentFrom ?? container.file} (${container.name})` };
    if (!inside.has(at) || isSure(read)) inside.set(at, read);
  }
  return inside;
};

/** Where a service's code says it listens, for the row about a mapping that misses it. */
const portsSaid = (service: string, ports: readonly ListenPort[], environment: Readonly<Record<string, number>> = {}): string => {
  // A port the container's environment gives the setting the code reads is
  // the one it listens on there, whatever the code's own fallback (P283).
  const givenOf = (port: ListenPort): number | undefined => (port.setting === undefined ? undefined : environment[port.setting]);
  const numbered = [
    ...new Set(
      ports.flatMap((port) => {
        const given = givenOf(port);
        if (given !== undefined) return [`${given} (${port.setting} as the container's environment gives it, ${port.file}:${port.line})`];
        return port.port === undefined ? [] : [`${port.port} (${port.file}:${port.line})`];
      }),
    ),
  ];
  const alone = [...new Set(ports.flatMap((port) => (port.port === undefined && port.setting !== undefined && givenOf(port) === undefined ? [`${port.setting} (${port.file}:${port.line})`] : [])))];
  const said = [
    ...(numbered.length === 0 ? [] : [`listens on ${numbered.join(', ')}`]),
    ...(alone.length === 0 ? [] : [`reads its port from ${alone.join(', ')}, which the container's environment does not give`]),
  ];
  return said.length === 0 ? `nothing in ${service}'s code is read listening on a port` : `${service}'s code ${said.join(' and ')}`;
};

/** The row for a routed name whose target port nothing in the service's code listens on (P257). */
const unroutedRow = (service: string, routed: RoutedName, port: RoutedName['ports'][number], ports: readonly ListenPort[]): Unresolved => ({
  service,
  file: port.file,
  line: port.line,
  reason: 'published-port-unheard',
  level: 'info',
  message: `${port.file} routes ${routed.name}:${port.port} to port ${port.target} of ${service}'s containers, but ${portsSaid(service, ports)}`,
  hint: `Route the name to the port the server listens on (targetPort), or check that the containers' environment gives the server ${port.target}. A request to ${routed.name}:${port.port} is still joined to ${service} by the file.`,
  symbol: `${routed.name}:${port.port}:${port.target}`,
  meta: { routed: port.port, container: port.target, listens: [...new Set(ports.flatMap((each) => (each.port === undefined ? [] : [each.port])))].sort((a, b) => a - b) },
});

/** How a file makes a port of this machine reach a container's, as a row says it (P254, P260). */
const publishing = (container: ContainerRun, mapping: ContainerRun['ports'][number], service: string): string =>
  container.via === 'forwarded'
    ? `${mapping.file} forwards port ${mapping.published} of this machine to ${container.name}, port ${mapping.container} of ${service}'s containers`
    : container.via === 'node-port'
      ? `${mapping.file} opens node port ${mapping.published} for ${container.name}, port ${mapping.container} of ${service}'s containers`
      : `${mapping.file} publishes port ${mapping.container} of ${container.name} (${service}) as ${mapping.published}`;

const unheardRow = (service: string, container: ContainerRun, mapping: ContainerRun['ports'][number], ports: readonly ListenPort[]): Unresolved => {
  return {
    service,
    file: mapping.file,
    line: mapping.line,
    reason: 'published-port-unheard',
    level: 'info',
    message: `${publishing(container, mapping, service)}, but ${portsSaid(service, ports, container.environment)}`,
    hint: `Map the published port to the port the server listens on (${mapping.published}:<that port>), or check that the container's environment gives the server ${mapping.container}. A request to localhost:${mapping.published} is still joined to ${service} by the file.`,
    symbol: `${container.name}:${mapping.published}:${mapping.container}`,
    meta: { published: mapping.published, container: mapping.container, listens: [...new Set(ports.flatMap((port) => (port.port === undefined ? [] : [port.port])))].sort((a, b) => a - b) },
  };
};

/**
 * Where every service listens (P250), the code and the setting files put
 * together (P254): the code's own ports; a port the code reads from a setting
 * alone, at each value the service's example environment files give it; each
 * container mapping whose container side the service listens on, at its
 * published port and on the container's network; and a row for each mapping
 * that meets nothing in the code.
 */
export const portsListening = (nodes: ReadonlyMap<string, GraphNode>, settings: Readonly<Record<string, RepoSettings>>): PortListening => {
  const byPort = listeningAt(nodes);
  const inNetwork = new Map<string, Listening[]>();
  const rows: Unresolved[] = [];
  const closed = new Map<string, ClosedPort>();
  const inNetworkAdd = (key: string, listening: Listening): void => {
    const list = inNetwork.get(key) ?? [];
    if (!list.some((each) => each.service === listening.service)) list.push(listening);
    inNetwork.set(key, list);
  };
  const code = codePortsOf(nodes);
  for (const [service, ports] of [...code.entries()].sort(([a], [b]) => cmp(a, b))) {
    for (const port of ports) {
      if (port.port !== undefined || port.setting === undefined) continue;
      for (const value of settings[service]?.ports?.[port.setting] ?? []) {
        addListening(byPort, value.port, { ...listeningOf(service, port), valueFrom: value.file });
      }
    }
  }
  for (const [service, own] of Object.entries(settings).sort(([a], [b]) => cmp(a, b))) {
    const ports = code.get(service) ?? [];
    for (const container of own.containers ?? []) {
      const inside = insideContainer(service, ports, container);
      for (const [port, listening] of inside) {
        for (const name of container.names) inNetworkAdd(`${name}:${port}`, { ...listening, inContainer: { name: container.name, file: container.file } });
      }
      for (const mapping of container.ports) {
        const listening = inside.get(mapping.container);
        if (listening === undefined) rows.push(unheardRow(service, container, mapping, ports));
        else {
          const how = container.via === undefined ? {} : { via: container.via, object: container.name };
          addListening(byPort, mapping.published, { ...listening, published: { port: mapping.published, file: mapping.file, ...how } });
        }
        // The published side is the machine's: on the container's network it is nothing.
        if (inside.size === 0 || inside.has(mapping.published)) continue;
        const reachable = [...inside.keys()].sort((a, b) => a - b);
        for (const name of container.names) {
          closed.set(`${name}:${mapping.published}`, { service, kind: 'published', reachable: reachable.map((port) => `${name}:${port}`), file: mapping.file });
        }
      }
    }
    for (const routed of own.routes ?? []) {
      const inside = insideContainer(service, ports, routed);
      const routes = new Set(routed.ports.map((port) => port.port));
      for (const port of routed.ports) {
        const listening = inside.get(port.target);
        if (listening === undefined) {
          rows.push(unroutedRow(service, routed, port, ports));
          continue;
        }
        for (const name of routed.names) inNetworkAdd(`${name}:${port.port}`, { ...listening, routed: { name: routed.name, port: port.port, file: port.file } });
        // The containers' own port is reached only through the name's port.
        if (routes.has(port.target)) continue;
        for (const name of routed.names) {
          const reachable = routed.ports.filter((each) => each.target === port.target).map((each) => `${name}:${each.port}`);
          closed.set(`${name}:${port.target}`, { service, kind: 'behind', reachable, file: port.file });
        }
      }
    }
  }
  // A port a network reaches some other way is no closed one.
  for (const key of inNetwork.keys()) closed.delete(key);
  return { byPort, inNetwork, rows, closed };
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

/** How a port of this machine reaches the one a service listens on (P254, P260). */
const publishedAs = (published: NonNullable<Listening['published']>): string =>
  published.via === 'forwarded'
    ? `, forwarded from ${published.port} to ${published.object} by ${published.file}`
    : published.via === 'node-port'
      ? `, at node port ${published.port} of ${published.object} (${published.file})`
      : `, published as ${published.port} by ${published.file}`;

/**
 * Where a service listens, as a reader is told it: `src/main.ts:7`, with the
 * setting a fallback is behind, where the setting's value is from, the call
 * that hands the port in, and the side of a container's mapping it is
 * reached through.
 */
export const whereListening = (listening: Listening): string =>
  `${listening.file}:${listening.line}` +
  (listening.setting === undefined ? '' : listening.valueFrom === undefined ? ` (${listening.setting})` : ` (${listening.setting} from ${listening.valueFrom})`) +
  (listening.default === true ? ' (its default)' : '') +
  (listening.handed === undefined ? '' : ` (handed at ${listening.handed})`) +
  (listening.published === undefined ? '' : publishedAs(listening.published)) +
  (listening.inContainer === undefined ? '' : `, in the container ${listening.inContainer.name} (${listening.inContainer.file})`) +
  (listening.routed === undefined ? '' : `, behind ${listening.routed.name}:${listening.routed.port} (${listening.routed.file})`);

/** Where a service listens, as a row naming two services says it: the place, and the mapping it is reached through. */
const whereShort = (listening: Listening): string =>
  `${listening.file}:${listening.line}${listening.published === undefined ? '' : `, published by ${listening.published.file}`}`;

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
    }
  | {
      /** A host on a network that names the service at a port it is not reached at there (P257). */
      readonly kind: 'closed';
      readonly host: string;
      readonly closed: ClosedPort;
    };

export interface PortIndex {
  /** The hosts the configuration gives: names, aliases, `services[].hosts`. */
  readonly configured: HostIndex;
  /** The same with the hosts the setting files give, where they are read. */
  readonly all: HostIndex;
  readonly listening: ReadonlyMap<number, readonly Listening[]>;
  /** Where a service listens on a container's own network, by `<name>:<port>` (P254), or on a cluster's (P257). */
  readonly inNetwork?: ReadonlyMap<string, readonly Listening[]>;
  /** The hosts on a network at a port the service is not reached at there (P257). */
  readonly closed?: ReadonlyMap<string, ClosedPort>;
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
    return { kind: 'service', service, sure: where !== undefined && isSure(where), ...(where === undefined ? {} : { listening: where }) };
  }
  const said = services.map((service) => {
    const where = listening.find((each) => each.service === service);
    return where === undefined ? `${service} (its setting files)` : `${service} (${whereShort(where)})`;
  });
  return { kind: 'shared', port, services, said };
};

/**
 * The spellings a host on a network is looked up by: as written, with the
 * port its scheme defaults to where it writes none (P257), and by the name a
 * cluster gives a service under its own suffix (`orders.shop.svc.cluster.local`
 * is `orders` there).
 */
const networkKeys = (host: string, defaultPort?: number): string[] => {
  const written = host.toLowerCase();
  const withPort = /:\d+$/.test(written) || defaultPort === undefined ? written : `${written}:${defaultPort}`;
  const [name, port] = [withPort.replace(/:\d+$/, ''), /:(\d+)$/.exec(withPort)?.[1]];
  const inner = innerServiceName(name);
  return [...new Set([written, withPort, ...(inner === undefined || port === undefined ? [] : [`${inner}:${port}`])])];
};

/** Where a service listens on a container's or a cluster's network, for a host `orders:3000` that names it (P254, P257). */
export const inNetworkAt = (host: string, service: string, index: PortIndex, defaultPort?: number): Listening | undefined => {
  for (const key of networkKeys(host, defaultPort)) {
    const found = index.inNetwork?.get(key)?.find((each) => each.service === service);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * A port the network does not reach the named service at, for a host that
 * names it there (P257): the service's own, or any service's where the host
 * names none another way.
 */
export const closedAt = (host: string, service: string | undefined, index: PortIndex, defaultPort?: number): ClosedPort | undefined => {
  for (const key of networkKeys(host, defaultPort)) {
    if (index.inNetwork?.has(key) === true) return undefined;
    const found = index.closed?.get(key);
    if (found !== undefined && (service === undefined || found.service === service)) return found;
  }
  return undefined;
};

/** Why a request on a network to a port the service is not reached at there is not joined (P257). */
export const portClosedFinding = (host: string, closed: ClosedPort): Finding => ({
  reason: 'network-port-unreachable',
  message:
    closed.kind === 'published'
      ? `${host} names ${closed.service} on its container's network at a port ${closed.file} publishes only on the machine running it, so the request will not connect` +
        (closed.reachable.length === 0 ? '' : `; on that network it is reached at ${closed.reachable.join(', ')}`)
      : `${host} names ${closed.service} on its cluster's network at its containers' own port, which ${closed.file} routes only through ${closed.reachable.join(', ')}, so the request will not connect`,
  hint:
    closed.kind === 'published'
      ? `Inside the network, use the port the container listens on${closed.reachable.length === 0 ? '' : ` (${closed.reachable.join(', ')})`}; the published port is for the machine (localhost).`
      : `Use the port the name routes (${closed.reachable.join(', ')}), or route this port too.`,
});

/** Why two services on one port leave a request unjoined, as a row says it. */
export const portSharedFinding = (port: number, said: readonly string[]): Finding => ({
  reason: 'local-port-shared',
  message: `port ${port} on this machine is where ${said.join(' and ')} each listen, so it is not one service`,
  hint: `Name the host under services[].hosts of the service this request means (localhost:${port}), or start the servers on different ports.`,
});
