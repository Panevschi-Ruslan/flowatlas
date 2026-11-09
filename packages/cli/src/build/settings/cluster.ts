import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { readYaml, type PositionedDocument } from '@flowatlas/core';
import { interpolated } from './compose.js';
import type { Written } from './dotenv.js';
import { definesOf, mergedValues, renderings, setValue, UNREAD_MARK, type ChartContext, type Rendered } from './helm.js';

/**
 * What a repository's cluster manifests say about where its containers are
 * reached (P257), and how a request from outside the cluster reaches them
 * (P260).
 *
 * A Kubernetes `Service` named `orders` that routes its port 80 to the
 * `targetPort` 3000 (or to a port the pods name `http`) of the pods a
 * `Deployment` or `StatefulSet` runs is how another service in the cluster
 * reaches orders: `http://orders/…`, `orders.shop.svc.cluster.local:80`.
 * Read here: every workload's containers (their named ports and the ports
 * their environment gives a setting), every service object (its name, its
 * namespace, its selector, each port it routes and the port each node opens
 * for it), and every way in from outside: an `Ingress`'s rules and an
 * `HTTPRoute`'s, host and path to a service object's port, with the path
 * rewritten where the rule writes how.
 *
 * Manifests are read the way the tools that apply them build them:
 *
 * - a plain YAML file, several documents to a file;
 * - a chart (a directory with `Chart.yaml`): each template rendered with the
 *   chart's `values.yaml` and the values files and `--set`s the command that
 *   installs it gives (`helm.ts`), every way its undecided conditions can go,
 *   and read where the ways agree; a row where they do not;
 * - a kustomization: the resources and bases it lists (files and other
 *   folders' kustomizations), its patches (strategic merge and JSON 6902),
 *   its images, namespace, name prefix and suffix. Where several overlays
 *   build on one base and nothing chooses which is applied, they are read
 *   where they agree, and a row says they do not.
 *
 * Only what is written as a literal, or what the values render one as, is
 * read. A template outside a chart is read as P257 read it: a line that is
 * only a directive is dropped, a value that holds an expression is unread.
 */

/** A container of a workload's pods. */
export interface ManifestContainer {
  readonly name?: string;
  /** The image's own name, without registry, path or tag. */
  readonly image?: string;
  readonly ports: ReadonlyArray<{ readonly port: number; readonly name?: string }>;
  /** Its environment, values written as literals only. */
  readonly environment: readonly Written[];
  /** Where its environment is written: the workload's file, or a patch's (P260). */
  readonly environmentFile?: string;
}

/** A `Deployment`, `StatefulSet` or `DaemonSet`. */
export interface ManifestWorkload {
  readonly name: string;
  readonly namespace?: string;
  /** The labels of its pod template, which a service object selects it by. */
  readonly labels: Readonly<Record<string, string>>;
  readonly containers: readonly ManifestContainer[];
  readonly file: string;
}

/** A port a service object routes. */
export interface ManifestServicePort {
  readonly port: number;
  readonly target?: number | string;
  /** The port's own name, which an `Ingress` may name it by. */
  readonly name?: string;
  /** The port every node of the cluster opens for it, where the object is a `NodePort` or `LoadBalancer` one (P260). */
  readonly nodePort?: number;
  /** Where the port is written: the manifest's own file, or the patch that wrote it. */
  readonly file: string;
  readonly line: number;
}

/** A `Service`. */
export interface ManifestService {
  readonly name: string;
  readonly namespace?: string;
  readonly selector: Readonly<Record<string, string>>;
  readonly ports: readonly ManifestServicePort[];
  readonly file: string;
}

/** How a way in rewrites the path it matched, as the rule writes it (P260). */
export type ManifestRewrite =
  /** The prefix it matched replaced with another. */
  | { readonly kind: 'prefix'; readonly with: string }
  /** The whole path replaced by a regular expression's replacement, groups and all. */
  | { readonly kind: 'pattern'; readonly source: string; readonly flags: string; readonly with: string };

/** One path of a way in, and the service objects it sends a request to (P260). */
export interface ManifestPath {
  /** How the path is matched: a prefix of whole segments, the path exactly, or a regular expression. */
  readonly match: 'prefix' | 'exact' | 'pattern';
  readonly path: string;
  /** Flags of a regular expression's match. */
  readonly flags?: string;
  readonly backends: ReadonlyArray<{ readonly name: string; readonly port?: number | string }>;
  readonly rewrite?: ManifestRewrite;
  /** The hosts the path is a way in at, where they are its own rule's rather than every host of its object's (P263); `*` for any host. */
  readonly hosts?: readonly string[];
  readonly file: string;
  readonly line: number;
}

/** A way in from outside the cluster (P260): an `Ingress`, or an `HTTPRoute` of a gateway. */
export interface ManifestIngress {
  readonly kind: 'ingress' | 'http-route';
  readonly name: string;
  readonly namespace?: string;
  /** The hosts a request is written to, lower case; `*.shop.example.test` for a wildcard, `*` for any host a rule with none answers (P263). */
  readonly hosts: readonly string[];
  readonly paths: readonly ManifestPath[];
  readonly file: string;
}

/** Something about a manifest that is not read, said as a row by whoever the manifest is about (P260). */
export interface ManifestRow {
  readonly reason: 'manifest-unread' | 'manifest-overlay-unchosen';
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly hint: string;
  /** The names of the objects it is about, which say whose service it is. */
  readonly about: readonly string[];
}

export interface Manifests {
  readonly workloads: readonly ManifestWorkload[];
  readonly services: readonly ManifestService[];
  /** Ways in from outside the cluster (P260). */
  readonly ingresses?: readonly ManifestIngress[];
  /** What was not read (P260). */
  readonly rows?: readonly ManifestRow[];
}

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet']);

/** What a line holding a template expression outside a chart is read as: a value nobody wrote. */
const TEMPLATED = UNREAD_MARK;

/** Where a mapping or a list of a manifest is written. */
const AT: unique symbol = Symbol('at');

interface Where {
  readonly file: string;
  readonly line: number;
}

type Located = Record<string, unknown> & { [AT]?: Where };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const whereOf = (value: unknown): Where | undefined => (typeof value === 'object' && value !== null ? (value as Located)[AT] : undefined);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? (value.includes(TEMPLATED) ? undefined : value) : typeof value === 'number' ? String(value) : undefined;

const portNumber = (value: unknown): number | undefined => {
  const written = text(value);
  if (written === undefined || !/^\d+$/.test(written)) return undefined;
  const port = Number(written);
  return port > 0 && port < 65536 ? port : undefined;
};

const labelsOf = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [key, label] of Object.entries(value)) {
    const written = text(label);
    if (written !== undefined) out[key] = written;
  }
  return out;
};

/** A deep copy that keeps where each mapping and list is written. */
const copied = <T>(value: T): T => {
  if (Array.isArray(value)) {
    const out = value.map((each) => copied(each)) as unknown as Located;
    const at = whereOf(value);
    if (at !== undefined) Object.defineProperty(out, AT, { value: at, enumerable: false, writable: true });
    return out as unknown as T;
  }
  if (!isRecord(value)) return value;
  const out: Located = {};
  for (const [key, each] of Object.entries(value)) out[key] = copied(each);
  const at = whereOf(value);
  if (at !== undefined) Object.defineProperty(out, AT, { value: at, enumerable: false, writable: true });
  return out as T;
};

const located = <T extends object>(value: T, at: Where): T => {
  Object.defineProperty(value, AT, { value: at, enumerable: false, writable: true });
  return value;
};

/** A document's value, each mapping and list given the line it is written on. */
const locate = (document: PositionedDocument, file: string, lineOf: (line: number) => number): unknown => {
  const walk = (value: unknown, path: Array<string | number>): unknown => {
    const line = lineOf(document.at(path)?.line ?? 1);
    if (Array.isArray(value)) return located(value.map((each, index) => walk(each, [...path, index])), { file, line });
    if (!isRecord(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, each] of Object.entries(value)) out[key] = walk(each, [...path, key]);
    return located(out, { file, line });
  };
  return walk(document.value, []);
};

/**
 * A template's text with what is not YAML taken out: a line that is only a
 * directive (`{{- if … }}`, `{{- include … | nindent 4 }}`) goes, and a value
 * that holds an expression is read as nothing written.
 */
const untemplated = (source: string): string =>
  source
    .split('\n')
    .map((line) => {
      if (!line.includes('{{')) return line;
      if (/^\s*(?:-\s*)?\{\{[^]*\}\}\s*$/.test(line)) return '';
      const keyed = /^(\s*(?:-\s+)?[\w./-]+\s*:\s*)(.*)$/.exec(line);
      return keyed === null ? '' : `${keyed[1]}${JSON.stringify(TEMPLATED)}`;
    })
    .join('\n');

/** One resource of a manifest: its value, each mapping and list located, and the names it has had. */
interface Resource {
  value: Located;
  readonly file: string;
  /** Every name the resource has been called by, before a kustomization's prefix and after. */
  readonly names: Set<string>;
}

/** The documents of a text, each value located, its lines mapped to where the text came from. */
const documentsOf = (source: string, file: string, lineOf: (line: number) => number = (line) => line): unknown[] => {
  const lines = source.split('\n');
  const out: unknown[] = [];
  let start = 0;
  const flush = (end: number): void => {
    const chunk = lines.slice(start, end).join('\n');
    if (chunk.trim() === '') return;
    let document: PositionedDocument;
    try {
      document = readYaml(chunk);
    } catch {
      // A document that is not YAML is not read.
      return;
    }
    const first = start;
    out.push(locate(document, file, (line) => lineOf(line + first)));
  };
  lines.forEach((line, index) => {
    if (!/^---(?:\s|$)/.test(line)) return;
    flush(index);
    start = index + 1;
  });
  flush(lines.length);
  return out;
};

const resourceOf = (value: Located, file: string): Resource => {
  const name = text(isRecord(value['metadata']) ? value['metadata']['name'] : undefined);
  return { value, file, names: new Set(name === undefined ? [] : [name]) };
};

/** The resources of a text: each of its documents that is a mapping. */
const resourcesOf = (source: string, file: string, lineOf?: (line: number) => number): Resource[] =>
  documentsOf(source, file, lineOf).flatMap((value) => (isRecord(value) ? [resourceOf(value as Located, file)] : []));

/** The values a `ConfigMap` or a `Secret` holds, each with the file that writes it (P263). */
interface ConfigValues {
  readonly values: ReadonlyMap<string, { readonly raw: string; readonly file: string }>;
}

/** The config maps and secrets of a set of resources, by kind and every name each has had. */
type Configs = (kind: 'ConfigMap' | 'Secret', name: string, namespace: string | undefined) => ConfigValues | undefined;

/** Where each key of a generated config map's `data` is written, beside the mapping's own place. */
const KEYS_AT: unique symbol = Symbol('keys at');

type KeyedData = Record<string, unknown> & { [KEYS_AT]?: Record<string, Where> };

const configsOf = (resources: readonly Resource[]): Configs => {
  const found: Array<{ kind: string; names: ReadonlySet<string>; namespace?: string; read: ConfigValues }> = [];
  for (const resource of resources) {
    const kind = text(resource.value['kind']);
    if (kind !== 'ConfigMap' && kind !== 'Secret') continue;
    const values = new Map<string, { raw: string; file: string }>();
    const fileOf = (data: unknown, key: string): string => (data as KeyedData)[KEYS_AT]?.[key]?.file ?? whereOf(data)?.file ?? resource.file;
    const data = resource.value['data'];
    if (isRecord(data)) {
      for (const [key, value] of Object.entries(data)) {
        const written = text(value);
        if (written === undefined) continue;
        // A secret's data is written in base64.
        const raw = kind === 'Secret' && !(data as KeyedData)[KEYS_AT] ? Buffer.from(written, 'base64').toString('utf8') : written;
        values.set(key, { raw, file: fileOf(data, key) });
      }
    }
    const plain = resource.value['stringData'];
    if (kind === 'Secret' && isRecord(plain)) {
      for (const [key, value] of Object.entries(plain)) if (text(value) !== undefined) values.set(key, { raw: text(value) as string, file: fileOf(plain, key) });
    }
    const metadata = isRecord(resource.value['metadata']) ? resource.value['metadata'] : {};
    const namespace = text(metadata['namespace']);
    found.push({ kind, names: resource.names, ...(namespace === undefined ? {} : { namespace }), read: { values } });
  }
  return (kind, name, namespace) => {
    const named = found.filter((each) => each.kind === kind && each.names.has(name));
    return (named.find((each) => namespace === undefined || each.namespace === undefined || each.namespace === namespace) ?? named[0])?.read;
  };
};

/**
 * The environment of a container: each `env` entry's literal value, or the
 * value of the config map or secret key it names (`valueFrom`), over every
 * key of the config maps and secrets it takes whole (`envFrom`, with its
 * `prefix`), as the cluster gives a pod them (P263). Each said at the file
 * that writes it.
 */
const environmentOf = (container: Record<string, unknown>, namespace: string | undefined, configs: Configs): Array<Written & { file: string }> => {
  const out = new Map<string, Written & { file: string }>();
  for (const source of (Array.isArray(container['envFrom']) ? container['envFrom'] : []).filter(isRecord)) {
    const ref = isRecord(source['configMapRef']) ? (['ConfigMap', source['configMapRef']] as const) : isRecord(source['secretRef']) ? (['Secret', source['secretRef']] as const) : undefined;
    const name = ref === undefined ? undefined : text(ref[1]['name']);
    if (ref === undefined || name === undefined) continue;
    const prefix = text(source['prefix']) ?? '';
    for (const [key, { raw, file }] of configs(ref[0], name, namespace)?.values ?? []) out.set(`${prefix}${key}`, { name: `${prefix}${key}`, raw, file });
  }
  for (const each of (Array.isArray(container['env']) ? container['env'] : []).filter(isRecord)) {
    const key = text(each['name']);
    if (key === undefined) continue;
    const from = isRecord(each['valueFrom']) ? each['valueFrom'] : undefined;
    const ref = from === undefined ? undefined : isRecord(from['configMapKeyRef']) ? (['ConfigMap', from['configMapKeyRef']] as const) : isRecord(from['secretKeyRef']) ? (['Secret', from['secretKeyRef']] as const) : undefined;
    if (ref !== undefined) {
      const name = text(ref[1]['name']);
      const wanted = text(ref[1]['key']);
      const found = name === undefined || wanted === undefined ? undefined : configs(ref[0], name, namespace)?.values.get(wanted);
      if (found !== undefined) out.set(key, { name: key, raw: found.raw, file: found.file });
      else out.delete(key);
      continue;
    }
    const raw = text(each['value']);
    const settled = raw === undefined ? undefined : interpolated(raw);
    if (settled === undefined || settled === '') {
      out.delete(key);
      continue;
    }
    out.set(key, { name: key, raw: settled, file: whereOf(each)?.file ?? '' });
  }
  return [...out.values()];
};

const containersOf = (spec: unknown, namespace?: string, configs: Configs = () => undefined): ManifestContainer[] => {
  const containers = isRecord(spec) ? spec['containers'] : undefined;
  if (!Array.isArray(containers)) return [];
  return containers.filter(isRecord).map((container) => {
    const image = text(container['image'])?.split('/').pop()?.split(/[:@]/)[0];
    const name = text(container['name']);
    const ports = (Array.isArray(container['ports']) ? container['ports'] : []).filter(isRecord).flatMap((each) => {
      const port = portNumber(each['containerPort']);
      const named = text(each['name']);
      return port === undefined ? [] : [{ port, ...(named === undefined ? {} : { name: named }) }];
    });
    const written = environmentOf(container, namespace, configs);
    const environment = written.map(({ name: key, raw }): Written => ({ name: key, raw }));
    // Where the environment is said to be written: where its first port is, else where its first value is.
    const environmentFile = (written.find((each) => /^\d+$/.test(each.raw) && each.file !== '') ?? written.find((each) => each.file !== ''))?.file;
    return {
      ...(name === undefined ? {} : { name }),
      ...(image === undefined || image === '' ? {} : { image }),
      ports,
      environment,
      ...(environmentFile === undefined ? {} : { environmentFile }),
    };
  });
};

/**
 * The host a rule with no `host` is a way in at (P263): any host the
 * controller is reached at. It answers the requests of the front ends it
 * serves (their pages are served at whatever host reached it), and nothing
 * more: whether it is also tried for a host other rules name depends on the
 * controller, and a host no rule names is not known to reach the cluster.
 */
export const ANY_HOST = '*';

/** The annotation an ingress controller is told to rewrite a matched path by, and to read paths as patterns by. */
const REWRITE_TARGET = 'nginx.ingress.kubernetes.io/rewrite-target';
const USE_REGEX = 'nginx.ingress.kubernetes.io/use-regex';

/** A backend an `Ingress` path sends to: `service: { name, port: { number | name } }`, or the older `serviceName` / `servicePort`. */
const ingressBackend = (backend: unknown): { name: string; port?: number | string } | undefined => {
  if (!isRecord(backend)) return undefined;
  const service = isRecord(backend['service']) ? backend['service'] : undefined;
  const name = text(service?.['name'] ?? backend['serviceName']);
  if (name === undefined) return undefined;
  const portSpec = service?.['port'];
  const port = isRecord(portSpec) ? (portNumber(portSpec['number']) ?? text(portSpec['name'])) : (portNumber(backend['servicePort']) ?? text(backend['servicePort']));
  return { name, ...(port === undefined ? {} : { port }) };
};

/** The paths of an `Ingress`, matched and rewritten as its controller's annotations say. */
const ingressOf = (value: Located, name: string, namespace: string | undefined, file: string): ManifestIngress | undefined => {
  const metadata = isRecord(value['metadata']) ? value['metadata'] : {};
  const annotations = labelsOf(metadata['annotations']);
  const target = annotations[REWRITE_TARGET];
  const regex = target !== undefined || annotations[USE_REGEX] === 'true';
  const spec = isRecord(value['spec']) ? value['spec'] : {};
  const rules = (Array.isArray(spec['rules']) ? spec['rules'] : []).filter(isRecord);
  // A rule with no host answers any host the controller is reached at (P263).
  const hostOf = (rule: Record<string, unknown>): string => text(rule['host'])?.toLowerCase() ?? ANY_HOST;
  const hosts = [...new Set(rules.map(hostOf))];
  const paths: ManifestPath[] = [];
  const pathOf = (path: string, pathType: string | undefined, backend: unknown, at: Where, own: readonly string[]): void => {
    const to = ingressBackend(backend);
    if (to === undefined) return;
    // A controller told to read paths as patterns matches each from the start, ignoring case, and
    // replaces the whole path with the rewrite target, its groups substituted.
    if (regex && pathType !== 'Exact') {
      const source = `^${path}`;
      paths.push({
        match: 'pattern',
        path: source,
        flags: 'i',
        backends: [to],
        ...(target === undefined ? {} : { rewrite: { kind: 'pattern' as const, source, flags: 'i', with: target } }),
        hosts: own,
        ...at,
      });
      return;
    }
    paths.push({ match: pathType === 'Exact' ? 'exact' : 'prefix', path, backends: [to], hosts: own, ...at });
  };
  for (const rule of rules) {
    const http = isRecord(rule['http']) ? rule['http'] : {};
    // Each path is a way in at its own rule's host only (P263).
    for (const each of (Array.isArray(http['paths']) ? http['paths'] : []).filter(isRecord)) {
      const at = whereOf(each) ?? { file, line: 1 };
      pathOf(text(each['path']) ?? '/', text(each['pathType']), each['backend'], at, [hostOf(rule)]);
    }
  }
  // What no path of a host matches goes to the default backend; an `Ingress`
  // with no rule at all sends every request there, at any host.
  const fallback = spec['defaultBackend'] ?? spec['backend'];
  const fallbackHosts = rules.length === 0 ? [ANY_HOST] : hosts;
  if (fallback !== undefined) {
    const to = ingressBackend(fallback);
    if (to !== undefined) paths.push({ match: 'prefix', path: '/', backends: [to], hosts: fallbackHosts, ...(whereOf(fallback) ?? { file, line: 1 }) });
    if (rules.length === 0) hosts.push(ANY_HOST);
  }
  if (hosts.length === 0 || paths.length === 0) return undefined;
  return { kind: 'ingress', name, ...(namespace === undefined ? {} : { namespace }), hosts, paths, file };
};

/** The paths of an `HTTPRoute`'s rules, with a `URLRewrite` filter's path read where it is literal. */
const httpRouteOf = (value: Located, name: string, namespace: string | undefined, file: string, gateways: ReadonlyMap<string, readonly string[]>): ManifestIngress | undefined => {
  const spec = isRecord(value['spec']) ? value['spec'] : {};
  const written = (Array.isArray(spec['hostnames']) ? spec['hostnames'] : []).flatMap((each) => (text(each) === undefined ? [] : [(text(each) as string).toLowerCase()]));
  // A route that names no host takes the hosts of the gateways it is attached to.
  const parents = (Array.isArray(spec['parentRefs']) ? spec['parentRefs'] : []).filter(isRecord).flatMap((ref) => (text(ref['name']) === undefined ? [] : [text(ref['name']) as string]));
  const hosts = written.length > 0 ? written : [...new Set(parents.flatMap((parent) => gateways.get(parent) ?? []))];
  const paths: ManifestPath[] = [];
  for (const rule of (Array.isArray(spec['rules']) ? spec['rules'] : []).filter(isRecord)) {
    const backends = (Array.isArray(rule['backendRefs']) ? rule['backendRefs'] : []).filter(isRecord).flatMap((ref) => {
      const backend = text(ref['name']);
      const kind = text(ref['kind']);
      if (backend === undefined || (kind !== undefined && kind !== 'Service')) return [];
      const port = portNumber(ref['port']);
      return [{ name: backend, ...(port === undefined ? {} : { port }) }];
    });
    if (backends.length === 0) continue;
    let rewrite: ManifestRewrite | undefined;
    for (const filter of (Array.isArray(rule['filters']) ? rule['filters'] : []).filter(isRecord)) {
      if (text(filter['type']) !== 'URLRewrite' || !isRecord(filter['urlRewrite'])) continue;
      const path = filter['urlRewrite']['path'];
      if (!isRecord(path)) continue;
      const prefix = text(path['replacePrefixMatch']);
      const full = text(path['replaceFullPath']);
      if (prefix !== undefined) rewrite = { kind: 'prefix', with: prefix };
      else if (full !== undefined) rewrite = { kind: 'pattern', source: '^.*$', flags: '', with: full.replace(/\$/g, '$$$$') };
    }
    const matches = (Array.isArray(rule['matches']) ? rule['matches'] : []).filter(isRecord);
    const at = whereOf(rule) ?? { file, line: 1 };
    for (const match of matches.length === 0 ? [{}] : matches) {
      const path = isRecord(match['path']) ? match['path'] : {};
      const kind = text(path['type']) ?? 'PathPrefix';
      const written = text(path['value']) ?? '/';
      const where = whereOf(match) ?? at;
      if (kind === 'RegularExpression') {
        const source = written.startsWith('^') ? written : `^${written}`;
        paths.push({ match: 'pattern', path: source, flags: '', backends, ...(rewrite?.kind === 'pattern' ? { rewrite } : {}), ...where });
      } else paths.push({ match: kind === 'Exact' ? 'exact' : 'prefix', path: written, backends, ...(rewrite === undefined ? {} : { rewrite }), ...where });
    }
  }
  if (hosts.length === 0 || paths.length === 0) return undefined;
  return { kind: 'http-route', name, ...(namespace === undefined ? {} : { namespace }), hosts, paths, file };
};

/** The hosts each gateway's listeners are written for, by the gateway's name. */
const gatewayHosts = (resources: readonly Resource[]): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const { value } of resources) {
    if (text(value['kind']) !== 'Gateway') continue;
    const name = text(isRecord(value['metadata']) ? value['metadata']['name'] : undefined);
    const spec = isRecord(value['spec']) ? value['spec'] : {};
    // A listener with no hostname answers any host (P263), as an `Ingress` rule with none does.
    const hosts = (Array.isArray(spec['listeners']) ? spec['listeners'] : []).filter(isRecord).map((listener) => text(listener['hostname'])?.toLowerCase() ?? ANY_HOST);
    if (name !== undefined) out.set(name, [...new Set(hosts)]);
  }
  return out;
};

/** What a set of resources declares. */
const manifestsOf = (resources: readonly Resource[]): Required<Pick<Manifests, 'workloads' | 'services' | 'ingresses'>> => {
  const workloads: ManifestWorkload[] = [];
  const services: ManifestService[] = [];
  const ingresses: ManifestIngress[] = [];
  const gateways = gatewayHosts(resources);
  const configs = configsOf(resources);
  for (const { value, file } of resources) {
    const kind = text(value['kind']);
    const metadata = isRecord(value['metadata']) ? value['metadata'] : {};
    const name = text(metadata['name']);
    if (kind === undefined || name === undefined) continue;
    const namespace = text(metadata['namespace']);
    const spec = isRecord(value['spec']) ? value['spec'] : {};
    if (WORKLOADS.has(kind)) {
      const template = isRecord(spec['template']) ? spec['template'] : {};
      const templateMeta = isRecord(template['metadata']) ? template['metadata'] : {};
      workloads.push({
        name,
        ...(namespace === undefined ? {} : { namespace }),
        labels: labelsOf(templateMeta['labels']),
        containers: containersOf(template['spec'], namespace, configs),
        file,
      });
      continue;
    }
    if (kind === 'Ingress') {
      const read = ingressOf(value, name, namespace, file);
      if (read !== undefined) ingresses.push(read);
      continue;
    }
    if (kind === 'HTTPRoute') {
      const read = httpRouteOf(value, name, namespace, file, gateways);
      if (read !== undefined) ingresses.push(read);
      continue;
    }
    if (kind !== 'Service') continue;
    const type = text(spec['type']);
    const opensNodes = type === 'NodePort' || type === 'LoadBalancer';
    const ports = (Array.isArray(spec['ports']) ? spec['ports'] : []).flatMap((each): ManifestServicePort[] => {
      if (!isRecord(each)) return [];
      const port = portNumber(each['port']);
      if (port === undefined) return [];
      const written = each['targetPort'];
      const target = written === undefined ? port : (portNumber(written) ?? text(written));
      // A target written as a template expression is not read.
      if (written !== undefined && target === undefined) return [];
      const named = text(each['name']);
      const nodePort = opensNodes ? portNumber(each['nodePort']) : undefined;
      const at = whereOf(each) ?? { file, line: 1 };
      return [{ port, ...(target === undefined ? {} : { target }), ...(named === undefined ? {} : { name: named }), ...(nodePort === undefined ? {} : { nodePort }), file: at.file, line: at.line }];
    });
    services.push({ name, ...(namespace === undefined ? {} : { namespace }), selector: labelsOf(spec['selector']), ports, file });
  }
  return { workloads, services, ingresses };
};

/** What a kustomization gives the files it lists. */
export interface Kustomized {
  readonly namespace?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

/** A resource's name, namespace and the references a name prefix reaches, given a kustomization's. */
const kustomizedResource = (resource: Resource, given: Kustomized, services: ReadonlySet<string>): void => {
  const metadata = isRecord(resource.value['metadata']) ? resource.value['metadata'] : undefined;
  if (metadata === undefined) return;
  const named = (name: string): string => `${given.prefix ?? ''}${name}${given.suffix ?? ''}`;
  const name = text(metadata['name']);
  if (name !== undefined && (given.prefix !== undefined || given.suffix !== undefined)) {
    metadata['name'] = named(name);
    resource.names.add(named(name));
  }
  if (given.namespace !== undefined) metadata['namespace'] = given.namespace;
  // A name prefix reaches what an `Ingress` names the service objects of the same build by.
  if (text(resource.value['kind']) !== 'Ingress' || (given.prefix === undefined && given.suffix === undefined)) return;
  const spec = isRecord(resource.value['spec']) ? resource.value['spec'] : {};
  const backends = [spec['defaultBackend'], ...(Array.isArray(spec['rules']) ? spec['rules'] : []).filter(isRecord).flatMap((rule) => (isRecord(rule['http']) && Array.isArray(rule['http']['paths']) ? rule['http']['paths'].filter(isRecord).map((path) => path['backend']) : []))];
  for (const backend of backends) {
    if (!isRecord(backend) || !isRecord(backend['service'])) continue;
    const target = text(backend['service']['name']);
    if (target !== undefined && services.has(target)) backend['service']['name'] = named(target);
  }
};

/** What one file's documents declare, its names given a kustomization's prefix, suffix and namespace. */
export const readManifest = (source: string, file: string, kustomized: Kustomized = {}): Manifests => {
  const resources = resourcesOf(source.includes('{{') ? untemplated(source) : source, file);
  const services = new Set(resources.filter((each) => text(each.value['kind']) === 'Service').flatMap((each) => [...each.names]));
  for (const resource of resources) kustomizedResource(resource, kustomized, services);
  return manifestsOf(resources);
};

// ---------------------------------------------------------------- patches

/** The key a list is merged by in a strategic merge patch, by the list's name and what holds it. */
const mergeKeyOf = (path: readonly string[]): string | undefined => {
  const key = path[path.length - 1];
  if (key === 'containers' || key === 'initContainers' || key === 'env' || key === 'volumeMounts' || key === 'volumes' || key === 'imagePullSecrets') return 'name';
  if (key === 'ports') return path.includes('containers') || path.includes('initContainers') ? 'containerPort' : 'port';
  return undefined;
};

/** A strategic merge patch written over a resource, as the tool that applies it does for what a manifest's facts are read from. */
const strategicMerge = (base: unknown, patch: unknown, path: readonly string[]): unknown => {
  if (isRecord(base) && isRecord(patch)) {
    const out = base as Located;
    for (const [key, value] of Object.entries(patch)) {
      if (key === '$patch') continue;
      if (value === null) {
        delete out[key];
        continue;
      }
      out[key] = strategicMerge(out[key], value, [...path, key]);
    }
    // The patch's own lines say where what it changes is written.
    const at = whereOf(patch);
    if (at !== undefined && Object.keys(patch).length > 1) Object.defineProperty(out, AT, { value: at, enumerable: false, writable: true });
    return out;
  }
  const key = mergeKeyOf(path);
  if (Array.isArray(base) && Array.isArray(patch) && key !== undefined) {
    const out = [...base];
    for (const item of patch) {
      if (!isRecord(item)) continue;
      const index = out.findIndex((each) => isRecord(each) && String(each[key]) === String(item[key]));
      if (item['$patch'] === 'delete') {
        if (index >= 0) out.splice(index, 1);
        continue;
      }
      if (index >= 0) out[index] = strategicMerge(out[index], copied(item), path);
      else out.push(copied(item));
    }
    const at = whereOf(base);
    if (at !== undefined) Object.defineProperty(out, AT, { value: at, enumerable: false, writable: true });
    return out;
  }
  return copied(patch);
};

/** The steps of a JSON pointer: `/spec/ports/0/port`. */
const pointerOf = (pointer: string): string[] =>
  pointer
    .split('/')
    .slice(1)
    .map((step) => step.replace(/~1/g, '/').replace(/~0/g, '~'));

/** One operation of a JSON 6902 patch, or why it is not applied. */
const jsonPatch = (target: Located, operation: Record<string, unknown>): string | undefined => {
  const op = text(operation['op']);
  const path = text(operation['path']);
  if (op === undefined || path === undefined) return 'an operation names no op or path';
  if (op !== 'add' && op !== 'replace' && op !== 'remove') return `its ${op} operation is not applied`;
  const steps = pointerOf(path);
  const last = steps.pop();
  if (last === undefined) return 'it replaces the whole resource';
  let at: unknown = target;
  for (const step of steps) {
    at = Array.isArray(at) ? at[Number(step)] : isRecord(at) ? at[step] : undefined;
    if (at === undefined) return `${path} is not in the resource`;
  }
  const value = copied(operation['value']);
  if (Array.isArray(at)) {
    const index = last === '-' ? at.length : Number(last);
    if (!Number.isInteger(index)) return `${path} is not an index of a list`;
    if (op === 'add') at.splice(index, 0, value);
    else if (op === 'replace') at[index] = value;
    else at.splice(index, 1);
    return undefined;
  }
  if (!isRecord(at)) return `${path} is not in the resource`;
  if (op === 'remove') delete at[last];
  else at[last] = value;
  return undefined;
};

/** What a patch names the resources it applies to by: a kind and a name, either optional. */
interface Target {
  readonly kind?: string;
  readonly name?: string;
}

const targetOf = (value: unknown): Target | undefined => {
  if (!isRecord(value)) return undefined;
  const kind = text(value['kind']);
  const name = text(value['name']);
  return { ...(kind === undefined ? {} : { kind }), ...(name === undefined ? {} : { name }) };
};

const targets = (resources: readonly Resource[], target: Target): Resource[] =>
  resources.filter((each) => (target.kind === undefined || text(each.value['kind']) === target.kind) && (target.name === undefined || each.names.has(target.name)));

// ---------------------------------------------------------------- replacements

/** One step of a kustomize field path: a key, an index, every item, or the item of a list a key's value picks. */
type Step = { readonly key: string } | { readonly index: number } | { readonly every: true } | { readonly where: string; readonly is: string };

/** The steps of a field path: `spec.template.spec.containers.[name=orders].env.[name=PORT].value`, `[a.b/c]` a key with dots. */
const stepsOf = (path: string): Step[] => {
  const out: Step[] = [];
  for (const match of path.matchAll(/\[([^\]]*)\]|([^.[\]]+)/g)) {
    const bracketed = match[1];
    if (bracketed !== undefined) {
      const equals = bracketed.indexOf('=');
      out.push(equals > 0 ? { where: bracketed.slice(0, equals), is: bracketed.slice(equals + 1) } : { key: bracketed });
      continue;
    }
    const word = match[2] as string;
    out.push(word === '*' ? { every: true } : /^\d+$/.test(word) ? { index: Number(word) } : { key: word });
  }
  return out;
};

/** What one step reaches from a value: the values it names. */
const stepped = (value: unknown, step: Step): unknown[] => {
  if ('key' in step) return isRecord(value) && step.key in value ? [value[step.key]] : [];
  if (!Array.isArray(value)) return [];
  if ('index' in step) return step.index < value.length ? [value[step.index]] : [];
  if ('every' in step) return value;
  return value.filter((item) => isRecord(item) && String(item[step.where]) === step.is);
};

/** The value at a field path, where it reaches one. */
const fieldAt = (value: unknown, steps: readonly Step[]): unknown => {
  let at: unknown[] = [value];
  for (const step of steps) at = at.flatMap((each) => stepped(each, step));
  return at.length === 1 ? at[0] : undefined;
};

/** A value written at a field path, in every place it reaches; a missing key made where `create` says. */
const setFieldAt = (value: unknown, steps: readonly Step[], written: unknown, create: boolean, delimiter: string | undefined, index: number): boolean => {
  const [step, ...rest] = steps;
  if (step === undefined) return false;
  if (rest.length === 0) {
    const holder = value as Record<string | number, unknown>;
    const slot = 'key' in step && isRecord(value) && (step.key in value || create) ? step.key : 'index' in step && Array.isArray(value) && step.index < value.length ? step.index : undefined;
    if (slot === undefined) return false;
    const before = holder[slot];
    // A delimiter and an index replace one part of the value written there.
    if (delimiter === undefined || typeof before !== 'string') {
      holder[slot] = written;
      return true;
    }
    const parts = before.split(delimiter);
    if (index < 0 || index >= parts.length) return false;
    parts[index] = String(written);
    holder[slot] = parts.join(delimiter);
    return true;
  }
  let next = stepped(value, step);
  if (next.length === 0 && create && 'key' in step && isRecord(value)) {
    value[step.key] = {};
    next = [value[step.key]];
  }
  let any = false;
  for (const each of next) if (setFieldAt(each, rest, written, create, delimiter, index)) any = true;
  return any;
};

/** The resources a replacement's `source`, `select` or `reject` names by kind, name and namespace. */
const selectedBy = (resources: readonly Resource[], selector: Record<string, unknown>): Resource[] => {
  const kind = text(selector['kind']);
  const name = text(selector['name']);
  const namespace = text(selector['namespace']);
  return resources.filter((each) => {
    const metadata = isRecord(each.value['metadata']) ? each.value['metadata'] : {};
    return (kind === undefined || text(each.value['kind']) === kind) && (name === undefined || each.names.has(name)) && (namespace === undefined || text(metadata['namespace']) === namespace);
  });
};

/** The folder a kustomization keeps an inflated chart in: `<home>/<name>`, or `<home>/<name>-<version>/<name>` as newer kustomize pulls it. */
const chartHomeOf = (home: string, name: string, version: string | undefined): string | undefined =>
  [join(home, name), ...(version === undefined ? [] : [join(home, `${name}-${version}`, name)])].find((dir) => existsSync(join(dir, 'Chart.yaml')));

// ---------------------------------------------------------------- kustomizations

const KUSTOMIZATIONS = ['kustomization.yaml', 'kustomization.yml', 'Kustomization'];

/** A kustomization, as far as what it builds goes. */
interface Kustomization {
  readonly dir: string;
  readonly file: string;
  readonly value: Record<string, unknown>;
  readonly text: string;
  /** The other folders it builds on. */
  readonly folders: readonly string[];
  /** The files it lists, its patches included. */
  readonly files: readonly string[];
}

const kustomizationAt = (dir: string): Kustomization | undefined => {
  const name = KUSTOMIZATIONS.find((each) => existsSync(join(dir, each)));
  if (name === undefined) return undefined;
  let source: string;
  let value: unknown;
  try {
    source = readFileSync(join(dir, name), 'utf8');
    value = readYaml(source).value;
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const folders: string[] = [];
  const files: string[] = [];
  const listed = (key: string): string[] => (Array.isArray(value[key]) ? value[key] : []).flatMap((each) => (text(each) === undefined ? [] : [text(each) as string]));
  for (const written of [...listed('resources'), ...listed('bases'), ...listed('components')]) {
    if (/^[a-z]+:\/\//i.test(written) || written.startsWith('github.com')) continue;
    const path = resolve(dir, written);
    if (existsSync(path) && statSync(path).isDirectory()) folders.push(path);
    else files.push(path);
  }
  for (const written of listed('patchesStrategicMerge')) if (!written.includes('\n')) files.push(resolve(dir, written));
  for (const key of ['patches', 'patchesJson6902']) {
    for (const each of Array.isArray(value[key]) ? value[key] : []) {
      const path = isRecord(each) ? text(each['path']) : text(each);
      if (path !== undefined && !path.includes('\n')) files.push(resolve(dir, path));
    }
  }
  return { dir, file: join(dir, name), value, text: source, folders, files };
};

/** The line a kustomization writes a key on. */
const lineOfKey = (source: string, key: string): number => {
  const at = source.search(new RegExp(`^${key}\\s*:`, 'm'));
  return at < 0 ? 1 : source.slice(0, at).split('\n').length;
};

/** A row about a manifest, and what it is about. */
const row = (reason: ManifestRow['reason'], at: Where, message: string, hint: string, about: readonly string[]): ManifestRow => ({ reason, file: at.file, line: at.line, message, hint, about: [...new Set(about)].sort() });

const UNREAD_HINT = 'Write what the manifest says as a literal, or annotate the request with the service it reaches (/** @flowatlas-calls <service> METHOD /path */).';

/** Builds a kustomization as the tool that applies it does, for what a manifest's facts are read from. */
class Builder {
  readonly rows: ManifestRow[] = [];

  constructor(
    private readonly root: string,
    private readonly read: (path: string) => Resource[],
    /** A chart rendered with one reading, its dependencies with it (P263). */
    private readonly inflate: (dir: string, reading: ChartReading, rows: ManifestRow[]) => Resource[] = () => [],
  ) {}

  /** The documents of a patch file, lists of operations included. */
  private readPatch(path: string): unknown[] {
    const source = readText(path);
    return source === undefined ? [] : documentsOf(source, this.label(path));
  }

  private label(path: string): string {
    return relative(this.root, path).split(sep).join('/');
  }

  build(dir: string, seen: ReadonlySet<string> = new Set()): Resource[] {
    const kustomization = kustomizationAt(dir);
    if (kustomization === undefined || seen.has(dir) || seen.size > 12) return [];
    const inner = new Set([...seen, dir]);
    const value = kustomization.value;
    const at = (key: string): Where => ({ file: this.label(kustomization.file), line: lineOfKey(kustomization.text, key) });
    const resources: Resource[] = [];
    const listed = (key: string): string[] => (Array.isArray(value[key]) ? value[key] : []).flatMap((each) => (text(each) === undefined ? [] : [text(each) as string]));
    for (const written of [...listed('resources'), ...listed('bases'), ...listed('components')]) {
      if (/^[a-z]+:\/\//i.test(written) || written.startsWith('github.com')) {
        this.rows.push(row('manifest-unread', at('resources'), `${this.label(kustomization.file)} builds on ${written}, which is not in the project`, UNREAD_HINT, []));
        continue;
      }
      const path = resolve(dir, written);
      if (!existsSync(path)) continue;
      resources.push(...(statSync(path).isDirectory() ? this.build(path, inner) : this.read(path)));
    }
    // What it generates and inflates is part of what it builds, before any of it is transformed (P263).
    this.generate(kustomization, resources, at);
    resources.push(...this.helmCharts(kustomization, at));
    this.patch(kustomization, resources, at);
    this.images(value, resources);
    const given: Kustomized = {
      ...(text(value['namespace']) === undefined ? {} : { namespace: text(value['namespace']) as string }),
      ...(text(value['namePrefix']) === undefined ? {} : { prefix: text(value['namePrefix']) as string }),
      ...(text(value['nameSuffix']) === undefined ? {} : { suffix: text(value['nameSuffix']) as string }),
    };
    const services = new Set(resources.filter((each) => text(each.value['kind']) === 'Service').flatMap((each) => [...each.names]));
    for (const resource of resources) kustomizedResource(resource, given, services);
    // Replacements are the last transformer kustomize applies.
    this.replace(kustomization, resources, at);
    if (Array.isArray(value['vars']) && value['vars'].length > 0) {
      this.rows.push(row('manifest-unread', at('vars'), `${this.label(kustomization.file)} writes vars, which are not substituted; what they stand for is read as written`, 'Write the value as a literal, or as a replacement (replacements:), which is read.', resources.flatMap((each) => [...each.names])));
    }
    return resources;
  }

  /**
   * The config maps and secrets a kustomization generates (P263): one per
   * `configMapGenerator` / `secretGenerator` entry, its `literals` and the
   * keys of its `envs` (`env`) files, each key said at the file that writes
   * it; `behavior: merge` or `replace` changes the one of its name the bases
   * build. A generator's `files` are file contents, not an environment, and
   * are not read.
   */
  private generate(kustomization: Kustomization, resources: Resource[], at: (key: string) => Where): void {
    const value = kustomization.value;
    for (const [key, kind] of [['configMapGenerator', 'ConfigMap'], ['secretGenerator', 'Secret']] as const) {
      const where = at(key);
      for (const entry of (Array.isArray(value[key]) ? value[key] : []).filter(isRecord)) {
        const name = text(entry['name']);
        if (name === undefined) continue;
        const data: KeyedData = {};
        const keysAt: Record<string, Where> = {};
        for (const literal of Array.isArray(entry['literals']) ? entry['literals'] : []) {
          const written = text(literal);
          const equals = written?.indexOf('=') ?? -1;
          if (written === undefined || equals <= 0) continue;
          data[written.slice(0, equals)] = written.slice(equals + 1).replace(/^(['"])(.*)\1$/, '$2');
          keysAt[written.slice(0, equals)] = where;
        }
        const files = [...(Array.isArray(entry['envs']) ? entry['envs'] : []), ...(text(entry['env']) === undefined ? [] : [entry['env']])];
        for (const written of files) {
          const path = text(written) === undefined ? undefined : resolve(kustomization.dir, text(written) as string);
          const source = path === undefined ? undefined : readText(path);
          if (path === undefined || source === undefined) continue;
          source.split('\n').forEach((line, index) => {
            const assignment = /^\s*([A-Za-z_][\w.-]*)\s*=(.*)$/.exec(line);
            if (assignment === null || /^\s*#/.test(line)) return;
            data[assignment[1] as string] = (assignment[2] as string).trim().replace(/^(['"])(.*)\1$/, '$2');
            keysAt[assignment[1] as string] = { file: this.label(path), line: index + 1 };
          });
        }
        Object.defineProperty(data, KEYS_AT, { value: keysAt, enumerable: false, writable: true });
        located(data, where);
        const behavior = text(entry['behavior']) ?? 'create';
        const existing = behavior === 'create' ? undefined : resources.find((each) => text(each.value['kind']) === kind && each.names.has(name));
        if (existing !== undefined) {
          const before = isRecord(existing.value['data']) ? (existing.value['data'] as KeyedData) : {};
          const merged: KeyedData = behavior === 'merge' ? { ...before, ...data } : data;
          Object.defineProperty(merged, KEYS_AT, { value: { ...(behavior === 'merge' ? (before[KEYS_AT] ?? {}) : {}), ...keysAt }, enumerable: false, writable: true });
          located(merged, where);
          existing.value['data'] = merged;
          continue;
        }
        const namespace = text(entry['namespace']);
        const metadata = located({ name, ...(namespace === undefined ? {} : { namespace }) }, where);
        resources.push({ value: located({ apiVersion: 'v1', kind, metadata, data }, where), file: where.file, names: new Set([name]) });
      }
    }
  }

  /**
   * The charts a kustomization inflates (P263): each `helmCharts` entry whose
   * chart is under `helmGlobals.chartHome` (by default `charts`), rendered
   * with its values file, additional values files and inline values under its
   * release and namespace. A chart only a repository has is a row.
   */
  private helmCharts(kustomization: Kustomization, at: (key: string) => Where): Resource[] {
    const value = kustomization.value;
    const globals = isRecord(value['helmGlobals']) ? value['helmGlobals'] : {};
    const home = resolve(kustomization.dir, text(globals['chartHome']) ?? 'charts');
    const out: Resource[] = [];
    for (const entry of (Array.isArray(value['helmCharts']) ? value['helmCharts'] : []).filter(isRecord)) {
      const name = text(entry['name']);
      if (name === undefined) continue;
      const version = text(entry['version']);
      const dir = chartHomeOf(home, name, version);
      const where = at('helmCharts');
      if (dir === undefined) {
        this.rows.push(row('manifest-unread', where, `${where.file} inflates the chart ${name}${text(entry['repo']) === undefined ? '' : ` from ${text(entry['repo'])}`}, which is not in the project`, 'Keep the chart in the project under helmGlobals.chartHome, or annotate the request with the service it reaches (/** @flowatlas-calls <service> METHOD /path */).', [name]));
        continue;
      }
      const files = [entry['valuesFile'], ...(Array.isArray(entry['additionalValuesFiles']) ? entry['additionalValuesFiles'] : [])].flatMap((each) => (text(each) === undefined ? [] : [resolve(kustomization.dir, text(each) as string)]));
      const inline = isRecord(entry['valuesInline']) ? [entry['valuesInline']] : [];
      const reading = chartReadingOf(dir, [...files, ...inline], [], text(entry['releaseName']) ?? name, text(entry['namespace']), `${where.file}:${where.line}`);
      out.push(...this.inflate(dir, reading, this.rows));
    }
    return out;
  }

  /**
   * A kustomization's replacements (P263), inline or in the files `path`
   * names: the value at a source's field path, or the part of it a delimiter
   * and an index pick, written at each target's field paths, created where
   * `create` says. What does not apply is a row.
   */
  private replace(kustomization: Kustomization, resources: readonly Resource[], at: (key: string) => Where): void {
    const where = at('replacements');
    const entries = (Array.isArray(kustomization.value['replacements']) ? kustomization.value['replacements'] : []).filter(isRecord).flatMap((entry): unknown[] => {
      const path = text(entry['path']);
      if (path === undefined) return [entry];
      return this.readPatch(resolve(kustomization.dir, path)).flatMap((document) => (Array.isArray(document) ? document : [document]));
    });
    const said = (message: string, about: readonly string[]): void => {
      this.rows.push(row('manifest-unread', where, `${where.file} does not replace as written: ${message}`, UNREAD_HINT, about));
    };
    for (const entry of entries.filter(isRecord)) {
      const source = isRecord(entry['source']) ? entry['source'] : {};
      const selected = selectedBy(resources, source);
      const fieldPath = text(source['fieldPath']) ?? 'metadata.name';
      if (selected.length !== 1) {
        said(`its source ${text(source['kind']) ?? ''}/${text(source['name']) ?? '?'} is ${selected.length === 0 ? 'not built' : 'more than one resource'}`, []);
        continue;
      }
      const found = fieldAt((selected[0] as Resource).value, stepsOf(fieldPath));
      if (found === undefined || isRecord(found) || Array.isArray(found)) {
        said(`${fieldPath} of its source is not a value written`, [...(selected[0] as Resource).names]);
        continue;
      }
      const options = isRecord(source['options']) ? source['options'] : {};
      const delimiter = text(options['delimiter']);
      const picked = delimiter === undefined ? found : String(found).split(delimiter)[Number(text(options['index']) ?? 0)];
      if (picked === undefined) continue;
      for (const target of (Array.isArray(entry['targets']) ? entry['targets'] : []).filter(isRecord)) {
        const rejected = (Array.isArray(target['reject']) ? target['reject'] : []).filter(isRecord).flatMap((each) => selectedBy(resources, each));
        const chosen = selectedBy(resources, isRecord(target['select']) ? target['select'] : {}).filter((each) => !rejected.includes(each));
        const written = isRecord(target['options']) ? target['options'] : {};
        for (const resource of chosen) {
          for (const path of (Array.isArray(target['fieldPaths']) ? target['fieldPaths'] : []).flatMap((each) => (text(each) === undefined ? [] : [text(each) as string]))) {
            const set = setFieldAt(resource.value, stepsOf(path), picked, written['create'] === true, text(written['delimiter']), Number(text(written['index']) ?? 0));
            if (!set) said(`${path} is not in ${[...resource.names][0] ?? 'a resource'}`, [...resource.names]);
          }
        }
      }
    }
  }

  /** The documents of a patch: a file it names, or the text it writes inline. */
  private patchDocuments(dir: string, written: unknown, at: Where): unknown[] {
    const inline = text(written);
    if (inline === undefined) return [];
    if (inline.includes('\n') || inline.trimStart().startsWith('-') || inline.trimStart().startsWith('{')) return documentsOf(inline, at.file, () => at.line);
    const path = resolve(dir, inline);
    return existsSync(path) ? this.readPatch(path) : [];
  }

  private patch(kustomization: Kustomization, resources: Resource[], at: (key: string) => Where): void {
    const value = kustomization.value;
    const strategic = (patch: unknown, chosen?: readonly Resource[]): void => {
      if (!isRecord(patch)) return;
      const kind = text(patch['kind']);
      const name = text(isRecord(patch['metadata']) ? patch['metadata']['name'] : undefined);
      for (const each of chosen ?? targets(resources, { ...(kind === undefined ? {} : { kind }), ...(name === undefined ? {} : { name }) })) {
        const patched = copied(patch);
        // The patch names the resource; it does not rename it.
        if (isRecord(patched['metadata'])) delete patched['metadata']['name'];
        each.value = strategicMerge(each.value, patched, []) as Located;
      }
    };
    const operations = (patch: unknown, chosen: readonly Resource[], where: Where): void => {
      for (const operation of (Array.isArray(patch) ? patch : []).filter(isRecord)) {
        for (const each of chosen) {
          const why = jsonPatch(each.value, operation);
          if (why !== undefined) this.rows.push(row('manifest-unread', where, `${where.file} does not patch ${[...each.names][0] ?? 'a resource'} as written: ${why}`, UNREAD_HINT, [...each.names]));
        }
      }
    };
    for (const written of Array.isArray(value['patchesStrategicMerge']) ? value['patchesStrategicMerge'] : []) {
      for (const patch of this.patchDocuments(kustomization.dir, written, at('patchesStrategicMerge'))) strategic(patch);
    }
    for (const key of ['patches', 'patchesJson6902']) {
      for (const entry of (Array.isArray(value[key]) ? value[key] : []).filter(isRecord)) {
        const target = targetOf(entry['target']);
        const where = at(key);
        const written = entry['patch'] ?? entry['path'];
        const chosen = target === undefined ? undefined : targets(resources, target);
        const documents = this.patchDocuments(kustomization.dir, written, where);
        // A patch written as a list of operations is a JSON 6902 one; a mapping is a strategic merge.
        const list = documents.find((each) => Array.isArray(each));
        if (list !== undefined || key === 'patchesJson6902') {
          if (chosen === undefined) {
            this.rows.push(row('manifest-unread', where, `${where.file} writes a patch of operations that names no resource it applies to`, UNREAD_HINT, []));
            continue;
          }
          operations(list, chosen, whereOf(list) ?? where);
          continue;
        }
        for (const patch of documents) strategic(patch, chosen);
      }
    }
  }

  /** An `images` entry's new name or tag, given every container running the image it names. */
  private images(value: Record<string, unknown>, resources: readonly Resource[]): void {
    for (const entry of (Array.isArray(value['images']) ? value['images'] : []).filter(isRecord)) {
      const name = text(entry['name']);
      if (name === undefined) continue;
      const newName = text(entry['newName']);
      const newTag = text(entry['newTag']);
      for (const resource of resources) {
        const spec = isRecord(resource.value['spec']) && isRecord(resource.value['spec']['template']) ? resource.value['spec']['template']['spec'] : undefined;
        const containers = isRecord(spec) && Array.isArray(spec['containers']) ? spec['containers'].filter(isRecord) : [];
        for (const container of containers) {
          const image = text(container['image']);
          if (image === undefined) continue;
          const [repository, tag] = image.includes('@') ? [image.slice(0, image.indexOf('@')), undefined] : /^(.*?)(?::([^:/]+))?$/.exec(image)?.slice(1) ?? [image, undefined];
          if (repository !== name) continue;
          container['image'] = `${newName ?? repository}${newTag !== undefined ? `:${newTag}` : tag === undefined ? '' : `:${tag}`}`;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- charts

/** A command that installs a chart: the release, its namespace, the values files and `--set`s it gives (P260). */
export interface ChartInstall {
  /** The chart's directory, absolute. */
  readonly chart: string;
  readonly release?: string;
  readonly namespace?: string;
  /** Values files, absolute, or values written inline (a helmfile's, P263), in the order given. */
  readonly values: ReadonlyArray<string | Readonly<Record<string, unknown>>>;
  readonly sets: readonly string[];
  /** Where the command is written. */
  readonly file: string;
  readonly line: number;
  /** The environment it installs in, where what installs it names one (a helmfile's environment, P263). */
  readonly environment?: string;
}

/** What chooses among several ways a project's manifests can be built (P260). */
export interface ManifestChoice {
  /** The environment chosen under `settingFiles.environment`, in one spelling. */
  readonly environment?: string;
  /** The overlays the configuration names, absolute. */
  readonly overlays?: readonly string[];
  /** The values files the configuration names for a chart, by the chart's absolute directory. */
  readonly chartValues?: ReadonlyMap<string, readonly string[]>;
  /** Every command the project's scripts install a chart with. */
  readonly installs?: readonly ChartInstall[];
  /** The kustomizations the project's commands build or apply, absolute (P263). */
  readonly applied?: readonly string[];
  /** How a word of a file's or a folder's name is spelt as an environment. */
  readonly environmentOf?: (word: string) => string;
}

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

const yamlValue = (path: string): Record<string, unknown> => {
  const source = readText(path);
  if (source === undefined) return {};
  try {
    const value = readYaml(source).value;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
};

/** One way a chart is installed: its values, release and namespace, and where that is said. */
export interface ChartReading {
  readonly context: ChartContext;
  readonly label: string;
  /** The values files it is given past the chart's own, for an environment to choose by. */
  readonly files: readonly string[];
  /** The environment what installs it names (P263). */
  readonly environment?: string;
}

/** What a chart's `Chart.yaml` says of it, as a template reads `.Chart`. */
const chartMetaOf = (dir: string): ChartContext['chart'] => {
  const meta = yamlValue(join(dir, 'Chart.yaml'));
  return {
    ...(text(meta['name']) === undefined ? {} : { name: text(meta['name']) as string }),
    ...(text(meta['version']) === undefined ? {} : { version: text(meta['version']) as string }),
    ...(text(meta['appVersion']) === undefined ? {} : { appVersion: text(meta['appVersion']) as string }),
  };
};

/**
 * A chart installed with values files or inline values (in order) and sets
 * over its own `values.yaml`, under a release and a namespace. With nothing
 * naming the release, it is taken to be named for the chart.
 */
export const chartReadingOf = (
  dir: string,
  given: ReadonlyArray<string | Readonly<Record<string, unknown>>>,
  sets: readonly string[],
  release: string | undefined,
  namespace: string | undefined,
  label: string,
  environment?: string,
): ChartReading => {
  const chart = chartMetaOf(dir);
  let values = yamlValue(join(dir, 'values.yaml'));
  for (const each of given) values = mergedValues(values, typeof each === 'string' ? yamlValue(each) : (each as Record<string, unknown>));
  for (const set of sets) values = setValue(values, set);
  const name = release ?? chart.name;
  return {
    context: { values, release: { ...(name === undefined ? {} : { name }), ...(namespace === undefined ? {} : { namespace }) }, chart },
    label,
    files: given.filter((each): each is string => typeof each === 'string'),
    ...(environment === undefined ? {} : { environment }),
  };
};

/** The ways a chart is installed: as the configuration names, as each command does, or with its own values alone. */
const chartReadings = (dir: string, choice: ManifestChoice): ChartReading[] => {
  const configured = choice.chartValues?.get(dir);
  if (configured !== undefined) return [chartReadingOf(dir, configured, [], undefined, undefined, 'the configuration')];
  const installs = (choice.installs ?? []).filter((each) => each.chart === dir);
  if (installs.length === 0) return [chartReadingOf(dir, [], [], undefined, undefined, 'values.yaml')];
  return installs.map((each) =>
    chartReadingOf(dir, each.values, each.sets, each.release, each.namespace, `${each.file}:${each.line}${each.environment === undefined ? '' : ` (environment ${each.environment})`}`, each.environment),
  );
};

/** A chart a chart renders inside its own release (P263): the values key it is given under, and what leaves it out. */
interface Subchart {
  readonly dir: string;
  /** The key of the parent's values its own are under: its alias, or its name. */
  readonly key: string;
  readonly condition?: string;
  readonly tags: readonly string[];
}

/**
 * The charts a chart depends on that are in the project (P263): each
 * `dependencies` entry (of `Chart.yaml`, or an older `requirements.yaml`)
 * with a `file://` repository or unpacked in `charts/`, and every other chart
 * unpacked in `charts/`, which the tool that installs it renders too. A
 * packed (`.tgz`) or a repository's chart is not in the project.
 */
export const subchartsOf = (dir: string): Subchart[] => {
  const meta = yamlValue(join(dir, 'Chart.yaml'));
  const written = Array.isArray(meta['dependencies']) ? meta['dependencies'] : (yamlValue(join(dir, 'requirements.yaml'))['dependencies'] as unknown);
  const out: Subchart[] = [];
  for (const dependency of (Array.isArray(written) ? written : []).filter(isRecord)) {
    const name = text(dependency['name']);
    if (name === undefined) continue;
    const repository = text(dependency['repository']) ?? '';
    const path = repository.startsWith('file://') ? resolve(dir, repository.slice('file://'.length)) : join(dir, 'charts', name);
    if (!existsSync(join(path, 'Chart.yaml'))) continue;
    const condition = text(dependency['condition']);
    const tags = (Array.isArray(dependency['tags']) ? dependency['tags'] : []).flatMap((tag) => (text(tag) === undefined ? [] : [text(tag) as string]));
    out.push({ dir: path, key: text(dependency['alias']) ?? name, ...(condition === undefined ? {} : { condition }), tags });
  }
  let unpacked: string[];
  try {
    unpacked = readdirSync(join(dir, 'charts')).sort();
  } catch {
    unpacked = [];
  }
  for (const name of unpacked) {
    const path = join(dir, 'charts', name);
    if (out.some((each) => each.dir === path) || !existsSync(join(path, 'Chart.yaml'))) continue;
    out.push({ dir: path, key: chartMetaOf(path).name ?? name, tags: [] });
  }
  return out;
};

/** How deep a chart's dependencies are followed. */
const CHART_DEPTH = 4;

/** Whether a dependency is left out by the values: its condition's first path the values set is false, or every tag it names is. */
const leftOut = (values: Record<string, unknown>, sub: Subchart): boolean => {
  const at = (path: string): unknown => path.split('.').reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), values);
  for (const path of (sub.condition ?? '').split(',').map((each) => each.trim()).filter((each) => each !== '')) {
    const set = at(path);
    if (typeof set === 'boolean') return !set;
  }
  const tags = isRecord(values['tags']) ? values['tags'] : {};
  return sub.tags.length > 0 && sub.tags.every((tag) => tags[tag] === false);
};

/** The chart and every chart it renders inside its release, with the values each is given. */
const chartTree = (dir: string, reading: ChartReading, depth = 0): Array<{ dir: string; reading: ChartReading }> => {
  if (depth > CHART_DEPTH) return [];
  const out = [{ dir, reading }];
  const parent = reading.context.values;
  for (const sub of subchartsOf(dir)) {
    if (leftOut(parent, sub)) continue;
    const own = yamlValue(join(sub.dir, 'values.yaml'));
    const given = isRecord(parent[sub.key]) ? (parent[sub.key] as Record<string, unknown>) : {};
    const global = mergedValues(isRecord(own['global']) ? own['global'] : {}, isRecord(parent['global']) ? parent['global'] : {});
    const values = mergedValues(mergedValues(own, given), Object.keys(global).length === 0 ? {} : { global });
    out.push(...chartTree(sub.dir, { ...reading, context: { values, release: reading.context.release, chart: chartMetaOf(sub.dir) } }, depth + 1));
  }
  return out;
};

const templatesOf = (dir: string): string[] => {
  try {
    return readdirSync(join(dir, 'templates')).sort();
  } catch {
    return [];
  }
};

/**
 * Every template of a chart, and of every chart it depends on (P263),
 * rendered every way one reading makes it go; the helpers are the whole
 * tree's, as the tool that installs it shares them.
 */
const chartResources = (dir: string, reading: ChartReading, label: (path: string) => string, rows: ManifestRow[]): Resource[] => {
  const tree = chartTree(dir, reading);
  const helpers = definesOf(tree.flatMap((each) => templatesOf(each.dir).filter((name) => name.endsWith('.tpl')).flatMap((name) => readText(join(each.dir, 'templates', name)) ?? [])));
  return tree.flatMap((each) => templateResources(each.dir, each.reading, helpers, label, rows));
};

/** Every template of one chart, rendered every way one reading makes it go. */
const templateResources = (dir: string, reading: ChartReading, helpers: ReturnType<typeof definesOf>, label: (path: string) => string, rows: ManifestRow[]): Resource[] => {
  const templates = join(dir, 'templates');
  const names = templatesOf(dir);
  const out: Resource[] = [];
  for (const name of names.filter((each) => /\.ya?ml$/.test(each))) {
    const path = join(templates, name);
    const source = readText(path);
    if (source === undefined) continue;
    const file = label(path);
    const rendered = renderings(source, reading.context, helpers);
    if (rendered.kind === 'unread') {
      rows.push(row('manifest-unread', { file, line: 1 }, `${file} is not rendered with ${reading.label}: ${rendered.why}; its literal lines are read`, UNREAD_HINT, [basename(dir)]));
      out.push(...resourcesOf(untemplated(source), file));
      continue;
    }
    const ways = rendered.ways.map((way: Rendered) => resourcesOf(way.text, file, (line) => way.lines[line - 1] ?? way.lines[way.lines.length - 1] ?? line));
    const said = ways.map((resources) => JSON.stringify(manifestsOf(resources), (key, value: unknown) => (key === 'file' || key === 'line' ? undefined : value)));
    if (new Set(said).size > 1) {
      const lines = rendered.undecided.map((line) => `${file}:${line}`).join(', ');
      const about = ways.flatMap((resources) => resources.flatMap((each) => [...each.names]));
      rows.push(row('manifest-unread', { file, line: rendered.undecided[0] ?? 1 }, `${file} declares different ports, names or routes as conditions nothing in its values decides go (${lines}); its literal lines are read`, 'Give the value the condition reads in the chart\'s values.yaml, or a values file the install names.', about));
      out.push(...resourcesOf(untemplated(source), file));
      continue;
    }
    out.push(...(ways[0] ?? []));
  }
  return out;
};

/** The one reading of a chart an environment names by the values files it gives, if one does. */
const chosenBy = <T>(candidates: readonly T[], words: (candidate: T) => readonly string[], choice: ManifestChoice): T | undefined => {
  if (choice.environment === undefined || choice.environmentOf === undefined) return undefined;
  const spelt = choice.environmentOf;
  const matching = candidates.filter((candidate) => words(candidate).some((word) => spelt(word) === choice.environment));
  return matching.length === 1 ? matching[0] : undefined;
};

/** The words of a file's name, past its extension: `values-prod.yaml` is `values`, `prod`. */
const nameWords = (path: string): string[] =>
  basename(path)
    .replace(/\.ya?ml$/, '')
    .split(/[._-]/)
    .filter((word) => word !== '');

/** A set of resources, its facts compared without where each is written. */
const factsOf = (resources: readonly Resource[]): string => JSON.stringify(manifestsOf(resources), (key, value: unknown) => (key === 'file' || key === 'line' ? undefined : value));

/** The resources of a chart, read the one way it is installed, or where every way agrees. */
const readChart = (dir: string, choice: ManifestChoice, label: (path: string) => string, rows: ManifestRow[]): Resource[] => {
  const readings = chartReadings(dir, choice);
  // An install's environment chooses it as a values file named for it does (P263).
  const chosen = readings.length === 1 ? readings[0] : chosenBy(readings, (reading) => [...reading.files.flatMap(nameWords), ...(reading.environment === undefined ? [] : [reading.environment])], choice);
  if (chosen !== undefined) return chartResources(dir, chosen, label, rows);
  const read = readings.map((reading) => chartResources(dir, reading, label, rows));
  if (new Set(read.map(factsOf)).size === 1) return read[0] ?? [];
  const chart = label(join(dir, 'Chart.yaml'));
  rows.push(
    row(
      'manifest-overlay-unchosen',
      { file: chart, line: 1 },
      `${chart} is installed ${readings.length} ways that declare different ports, names or routes (${readings.map((reading) => reading.label).join(', ')}), and nothing chooses one; its own values are read`,
      'Choose the environment under settingFiles.environment (a values file named for it is then read), or name the values files under settingFiles.chartValues.',
      read.flatMap((resources) => resources.flatMap((each) => [...each.names])),
    ),
  );
  return chartResources(dir, chartReadings(dir, { ...choice, installs: [] })[0] as ChartReading, label, rows);
};

// ---------------------------------------------------------------- the walk

/** Directories no manifest of the project's own is kept in. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'out', 'target', 'tmp']);

const DEPTH = 6;

/** Whether a file's text may hold a manifest at all. */
const looksLikeManifest = (source: string): boolean =>
  /^\s*apiVersion\s*:/m.test(source) && /^\s*kind\s*:\s*(?:Service|Deployment|StatefulSet|DaemonSet|ReplicaSet|Ingress|HTTPRoute|Gateway|ConfigMap|Secret)\b/m.test(source);

/** What a walk of a directory finds: plain manifests, kustomizations and charts. */
interface Found {
  readonly files: string[];
  readonly kustomizations: string[];
  readonly charts: string[];
}

const walkOf = (root: string, skip: ReadonlySet<string>): Found => {
  const found: Found = { files: [], kustomizations: [], charts: [] };
  const walk = (dir: string, depth: number): void => {
    if (depth > DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    if (names.includes('Chart.yaml')) {
      // A chart's templates are read rendered; its own sub-charts are charts of their own.
      found.charts.push(dir);
      if (entries.some((entry) => entry.isDirectory() && entry.name === 'charts')) walk(join(dir, 'charts'), depth + 1);
      return;
    }
    if (KUSTOMIZATIONS.some((each) => names.includes(each))) found.kustomizations.push(dir);
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIPPED.has(entry.name) || skip.has(path)) continue;
        walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.ya?ml$/.test(entry.name) || KUSTOMIZATIONS.includes(entry.name) || /compose/.test(entry.name)) continue;
      found.files.push(path);
    }
  };
  walk(root, 0);
  return found;
};

/**
 * Every manifest under a directory, labelled relative to it: plain YAML files
 * that declare a workload, a service object or a way in, outside
 * dependencies, build output and hidden directories, and outside `skip` (the
 * directories of the project's services, read on their own); each chart
 * rendered; each kustomization built, the overlay chosen where several build
 * on one base.
 */
export const readManifestsUnder = (root: string, skip: ReadonlySet<string> = new Set(), choice: ManifestChoice = {}): Manifests => {
  const label = (path: string): string => relative(root, path).split(sep).join('/');
  const found = walkOf(root, skip);
  const rows: ManifestRow[] = [];
  const plain = (path: string): Resource[] => {
    const source = readText(path);
    if (source === undefined || !/^\s*(?:apiVersion|kind)\s*:/m.test(source)) return [];
    return resourcesOf(source.includes('{{') ? untemplated(source) : source, label(path));
  };
  const inflate = (dir: string, reading: ChartReading, into: ManifestRow[]): Resource[] => chartResources(dir, reading, label, into);
  const builder = new Builder(root, plain, inflate);
  const kustomizations = new Map(found.kustomizations.flatMap((dir) => (kustomizationAt(dir) === undefined ? [] : [[dir, kustomizationAt(dir) as Kustomization] as const])));
  // What each kustomization builds on, all the way down.
  const below = new Map<string, { folders: Set<string>; files: Set<string> }>();
  const under = (dir: string, seen: Set<string> = new Set()): { folders: Set<string>; files: Set<string> } => {
    const known = below.get(dir);
    if (known !== undefined) return known;
    const out = { folders: new Set<string>(), files: new Set<string>() };
    const kustomization = kustomizations.get(dir) ?? kustomizationAt(dir);
    if (kustomization === undefined || seen.has(dir)) return out;
    seen.add(dir);
    for (const file of kustomization.files) out.files.add(file);
    for (const folder of kustomization.folders) {
      out.folders.add(folder);
      const deeper = under(folder, seen);
      for (const each of deeper.folders) out.folders.add(each);
      for (const each of deeper.files) out.files.add(each);
    }
    below.set(dir, out);
    return out;
  };
  for (const dir of kustomizations.keys()) under(dir);
  const claimedFolders = new Set([...below.values()].flatMap((each) => [...each.folders]));
  const claimedFiles = new Set([...below.values()].flatMap((each) => [...each.files]));
  const resources: Resource[] = [];
  for (const path of found.files) {
    if (claimedFiles.has(path) || [...kustomizations.keys()].some((dir) => dirname(path) === dir)) continue;
    const source = readText(path);
    if (source === undefined || !looksLikeManifest(source)) continue;
    resources.push(...plain(path));
  }
  // A kustomization's own folder holds what it lists; a file there it does not list is read as plain.
  for (const [dir, kustomization] of kustomizations) {
    for (const path of found.files.filter((each) => dirname(each) === dir && !claimedFiles.has(each) && !kustomization.files.includes(each))) {
      const source = readText(path);
      if (source !== undefined && looksLikeManifest(source)) resources.push(...plain(path));
    }
  }
  // The kustomizations nothing builds on are what is applied; those that share a base are overlays of it.
  const roots = [...kustomizations.keys()].filter((dir) => !claimedFolders.has(dir)).sort();
  const groups: string[][] = [];
  const reaches = (dir: string): Set<string> => new Set([...under(dir).folders, ...under(dir).files]);
  for (const dir of roots) {
    const mine = reaches(dir);
    const group = groups.find((each) => each.some((other) => [...reaches(other)].some((path) => mine.has(path))));
    if (group === undefined) groups.push([dir]);
    else group.push(dir);
  }
  for (const every of groups) {
    if (every.length === 1) {
      resources.push(...builder.build(every[0] as string));
      continue;
    }
    // The overlays the project's commands apply are the ones among which one is applied (P263).
    const applied = every.filter((dir) => (choice.applied ?? []).includes(dir));
    const group = applied.length > 0 ? applied : every;
    const named = every.filter((dir) => (choice.overlays ?? []).includes(dir));
    const chosen = named.length === 1 ? named[0] : group.length === 1 ? group[0] : chosenBy(group, (dir) => relative(root, dir).split(sep).flatMap((part) => part.split(/[._-]/)), choice);
    if (chosen !== undefined) {
      resources.push(...builder.build(chosen));
      continue;
    }
    const built = group.map((dir) => builder.build(dir));
    if (new Set(built.map(factsOf)).size === 1) {
      resources.push(...(built[0] ?? []));
      continue;
    }
    // Where they differ, the base they share is read alone.
    const shared = [...under(group[0] as string).folders].filter((folder) => group.every((dir) => under(dir).folders.has(folder)));
    const bases = shared.filter((folder) => !shared.some((other) => other !== folder && under(other).folders.has(folder)));
    const where = group.map((dir) => label(kustomizations.get(dir)?.file ?? dir));
    rows.push(
      row(
        'manifest-overlay-unchosen',
        { file: where[0] as string, line: 1 },
        `${where.join(', ')} build ${bases.length === 0 ? 'the same resources' : bases.map(label).join(', ')} differently (ports, names or routes), and nothing chooses which is applied; ${bases.length === 0 ? 'none is read' : 'the base is read alone'}`,
        'Choose the environment under settingFiles.environment (an overlay named for it is then read), or name the overlay under settingFiles.overlays.',
        built.flatMap((each) => each.flatMap((resource) => [...resource.names])),
      ),
    );
    for (const base of bases) resources.push(...new Builder(root, plain, inflate).build(base));
  }
  rows.push(...builder.rows);
  // A chart another renders as its dependency, or a kustomization inflates,
  // is read through it, unless a command or the configuration installs it
  // itself (P263).
  const claimedCharts = new Set<string>();
  const claimBelow = (dir: string, depth = 0): void => {
    if (depth > CHART_DEPTH) return;
    for (const sub of subchartsOf(dir)) {
      claimedCharts.add(sub.dir);
      claimBelow(sub.dir, depth + 1);
    }
  };
  for (const chart of found.charts) claimBelow(chart);
  for (const kustomization of kustomizations.values()) {
    const globals = isRecord(kustomization.value['helmGlobals']) ? kustomization.value['helmGlobals'] : {};
    const home = resolve(kustomization.dir, text(globals['chartHome']) ?? 'charts');
    for (const entry of (Array.isArray(kustomization.value['helmCharts']) ? kustomization.value['helmCharts'] : []).filter(isRecord)) {
      const dir = text(entry['name']) === undefined ? undefined : chartHomeOf(home, text(entry['name']) as string, text(entry['version']));
      if (dir !== undefined) {
        claimedCharts.add(dir);
        claimBelow(dir);
      }
    }
  }
  const installed = (dir: string): boolean => choice.chartValues?.has(dir) === true || (choice.installs ?? []).some((each) => each.chart === dir);
  for (const chart of found.charts) if (!claimedCharts.has(chart) || installed(chart)) resources.push(...readChart(chart, choice, label, rows));
  const read = manifestsOf(resources);
  return { ...read, ...(rows.length === 0 ? {} : { rows }) };
};
