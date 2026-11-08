import {
  hostOf,
  LISTEN_META,
  literalPort,
  type ContainerRun,
  type GraphNode,
  type ListenPort,
  type RepoSettings,
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
  /** The published side of a container's mapping this port is reached through on the machine (P254). */
  readonly published?: { readonly port: number; readonly file: string };
  /** The container this is the port of, on the container's own network (P254). */
  readonly inContainer?: { readonly name: string; readonly file: string };
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
const isSure = (listening: Listening): boolean => literalPort(listening) && listening.valueFrom === undefined && listening.published === undefined;

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
}

/** The ports a service listens on inside a container: its environment's value for the setting the code reads, else the code's own. */
const insideContainer = (service: string, ports: readonly ListenPort[], container: ContainerRun): Map<number, Listening> => {
  const inside = new Map<number, Listening>();
  for (const port of ports) {
    const given = port.setting === undefined ? undefined : container.environment[port.setting];
    const at = given ?? port.port;
    if (at === undefined) continue;
    const listening = listeningOf(service, port);
    const read: Listening = given === undefined ? listening : { ...listening, valueFrom: `${container.file} (${container.name})` };
    if (!inside.has(at) || isSure(read)) inside.set(at, read);
  }
  return inside;
};

/** Where a service's code says it listens, for the row about a mapping that misses it. */
const portsSaid = (service: string, ports: readonly ListenPort[]): string => {
  const numbered = [...new Set(ports.flatMap((port) => (port.port === undefined ? [] : [`${port.port} (${port.file}:${port.line})`])))];
  const alone = [...new Set(ports.flatMap((port) => (port.port === undefined && port.setting !== undefined ? [`${port.setting} (${port.file}:${port.line})`] : [])))];
  const said = [
    ...(numbered.length === 0 ? [] : [`listens on ${numbered.join(', ')}`]),
    ...(alone.length === 0 ? [] : [`reads its port from ${alone.join(', ')}, which the container's environment does not give`]),
  ];
  return said.length === 0 ? `nothing in ${service}'s code is read listening on a port` : `${service}'s code ${said.join(' and ')}`;
};

const unheardRow = (service: string, container: ContainerRun, mapping: ContainerRun['ports'][number], ports: readonly ListenPort[]): Unresolved => {
  return {
    service,
    file: mapping.file,
    line: mapping.line,
    reason: 'published-port-unheard',
    level: 'info',
    message: `${mapping.file} publishes port ${mapping.container} of ${container.name} (${service}) as ${mapping.published}, but ${portsSaid(service, ports)}`,
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
        for (const name of container.names) {
          const key = `${name}:${port}`;
          const list = inNetwork.get(key) ?? [];
          if (!list.some((each) => each.service === service)) list.push({ ...listening, inContainer: { name: container.name, file: container.file } });
          inNetwork.set(key, list);
        }
      }
      for (const mapping of container.ports) {
        const listening = inside.get(mapping.container);
        if (listening === undefined) rows.push(unheardRow(service, container, mapping, ports));
        else addListening(byPort, mapping.published, { ...listening, published: { port: mapping.published, file: mapping.file } });
      }
    }
  }
  return { byPort, inNetwork, rows };
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
  (listening.published === undefined ? '' : `, published as ${listening.published.port} by ${listening.published.file}`) +
  (listening.inContainer === undefined ? '' : `, in the container ${listening.inContainer.name} (${listening.inContainer.file})`);

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
    };

export interface PortIndex {
  /** The hosts the configuration gives: names, aliases, `services[].hosts`. */
  readonly configured: HostIndex;
  /** The same with the hosts the setting files give, where they are read. */
  readonly all: HostIndex;
  readonly listening: ReadonlyMap<number, readonly Listening[]>;
  /** Where a service listens on a container's own network, by `<name>:<port>` (P254). */
  readonly inNetwork?: ReadonlyMap<string, readonly Listening[]>;
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

/** Where a service listens on a container's own network, for a host `orders:3000` that names it (P254). */
export const inNetworkAt = (host: string, service: string, index: PortIndex): Listening | undefined =>
  index.inNetwork?.get(host.toLowerCase())?.find((each) => each.service === service);

/** Why two services on one port leave a request unjoined, as a row says it. */
export const portSharedFinding = (port: number, said: readonly string[]): Finding => ({
  reason: 'local-port-shared',
  message: `port ${port} on this machine is where ${said.join(' and ')} each listen, so it is not one service`,
  hint: `Name the host under services[].hosts of the service this request means (localhost:${port}), or start the servers on different ports.`,
});
