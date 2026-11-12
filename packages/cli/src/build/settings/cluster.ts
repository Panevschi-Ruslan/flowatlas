import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
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
  readonly reason: 'manifest-unread' | 'manifest-overlay-unchosen' | 'release-need-undefined';
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

/** A var a kustomization declares (deprecated `vars:`, P273): what it names, and where it is written. */
interface DeclaredVar {
  readonly name: string;
  readonly objref: Record<string, unknown>;
  readonly fieldpath: string;
  readonly at: Where;
}

/** A var's reference in a field kustomize substitutes vars in: `$(NAME)`. */
const VAR_REFERENCE = /\$\(([A-Za-z_][\w.-]*)\)/g;

/**
 * The fields of a resource kustomize substitutes vars in by default: a
 * container's (and an init container's) `command`, `args` and `env` values in
 * any pod template, an `Ingress`'s hosts, and a `ConfigMap`'s data. Each as
 * its holder and key, so the value is written back in place.
 */
const varFieldsOf = (value: Located): Array<{ holder: Record<string | number, unknown>; key: string | number }> => {
  const out: Array<{ holder: Record<string | number, unknown>; key: string | number }> = [];
  const strings = (holder: unknown, key: string | number): void => {
    const at = (holder as Record<string | number, unknown>)[key];
    if (typeof at === 'string') out.push({ holder: holder as Record<string | number, unknown>, key });
  };
  const kind = text(value['kind']);
  const spec = isRecord(value['spec']) ? value['spec'] : {};
  const podSpecs = [
    kind === 'Pod' ? spec : undefined,
    isRecord(spec['template']) ? spec['template']['spec'] : undefined,
    isRecord(spec['jobTemplate']) && isRecord(spec['jobTemplate']['spec']) && isRecord(spec['jobTemplate']['spec']['template']) ? spec['jobTemplate']['spec']['template']['spec'] : undefined,
  ].filter(isRecord);
  for (const pod of podSpecs) {
    for (const container of ['containers', 'initContainers'].flatMap((key) => (Array.isArray(pod[key]) ? pod[key] : [])).filter(isRecord)) {
      for (const key of ['command', 'args']) {
        const list = container[key];
        if (Array.isArray(list)) list.forEach((_, index) => strings(list, index));
      }
      for (const each of (Array.isArray(container['env']) ? container['env'] : []).filter(isRecord)) strings(each, 'value');
    }
  }
  if (kind === 'Ingress') {
    for (const rule of (Array.isArray(spec['rules']) ? spec['rules'] : []).filter(isRecord)) strings(rule, 'host');
    for (const tls of (Array.isArray(spec['tls']) ? spec['tls'] : []).filter(isRecord)) {
      const hosts = tls['hosts'];
      if (Array.isArray(hosts)) hosts.forEach((_, index) => strings(hosts, index));
    }
  }
  if (kind === 'ConfigMap' && isRecord(value['data'])) for (const key of Object.keys(value['data'])) strings(value['data'], key);
  return out;
};

/** A field a kustomize configuration names (P289): the kind it is in, where it says one, and its path, `spec/rules/backendRefs/name`. */
interface FieldSpec {
  readonly kind?: string;
  readonly path: readonly string[];
  /** Whether a transformer writing the field makes it where it is not there (P295). */
  readonly create?: boolean;
}

/** A configuration's `nameReference` (P289): the fields of other resources that name a resource of `kind`. */
interface NameReference {
  readonly kind: string;
  readonly fields: readonly FieldSpec[];
}

/** A field path written `spec/rules/backendRefs/name`, a list on the way written `[]` or not. */
const fieldPathOf = (path: string): string[] =>
  path
    .split('/')
    .map((step) => step.replace(/\[\]$/, ''))
    .filter((step) => step !== '');

const fieldSpecsOf = (written: unknown): FieldSpec[] =>
  (Array.isArray(written) ? written : []).filter(isRecord).flatMap((spec) => {
    const path = text(spec['path']);
    const kind = text(spec['kind']);
    return path === undefined ? [] : [{ ...(kind === undefined ? {} : { kind }), path: fieldPathOf(path), ...(spec['create'] === true ? { create: true } : {}) }];
  });

const specApplies = (spec: FieldSpec, value: Record<string, unknown>): boolean => spec.kind === undefined || text(value['kind']) === spec.kind;

/** The field specs written as `kind: path` pairs, for the defaults below. */
const specs = (create: boolean, kinds: readonly (string | undefined)[], ...paths: string[]): FieldSpec[] =>
  kinds.flatMap((kind) => paths.map((path) => ({ ...(kind === undefined ? {} : { kind }), path: fieldPathOf(path), ...(create ? { create: true } : {}) })));

const POD_OWNERS = ['Deployment', 'ReplicaSet', 'DaemonSet', 'StatefulSet'];

/** The fields a pod template's labels or annotations are written in, by the kinds that hold one. */
const TEMPLATE_METADATA = (field: 'labels' | 'annotations'): FieldSpec[] => [
  ...specs(true, [...POD_OWNERS, 'Job', 'ReplicationController'], `spec/template/metadata/${field}`),
  ...specs(true, ['CronJob'], `spec/jobTemplate/metadata/${field}`, `spec/jobTemplate/spec/template/metadata/${field}`),
  ...specs(true, ['StatefulSet'], `spec/volumeClaimTemplates/metadata/${field}`),
];

/**
 * The fields kustomize writes a kustomization's `commonLabels` in (P295), as
 * its built-in configuration says: every resource's labels, a service's
 * selector, a workload's selector and its pod template's labels.
 */
const COMMON_LABELS: readonly FieldSpec[] = [
  ...specs(true, [undefined], 'metadata/labels'),
  ...specs(true, ['Service', 'ReplicationController'], 'spec/selector'),
  ...specs(true, POD_OWNERS, 'spec/selector/matchLabels'),
  ...specs(false, ['Job'], 'spec/selector/matchLabels'),
  ...specs(false, ['CronJob'], 'spec/jobTemplate/spec/selector/matchLabels'),
  ...specs(false, ['PodDisruptionBudget'], 'spec/selector/matchLabels'),
  ...specs(false, ['NetworkPolicy'], 'spec/podSelector/matchLabels', 'spec/ingress/from/podSelector/matchLabels', 'spec/egress/to/podSelector/matchLabels'),
  ...TEMPLATE_METADATA('labels'),
];

/** The fields kustomize writes `commonAnnotations` in (P295): every resource's annotations and its pod template's. */
const COMMON_ANNOTATIONS: readonly FieldSpec[] = [...specs(true, [undefined], 'metadata/annotations'), ...TEMPLATE_METADATA('annotations')];

/** The fields an image is written in (P295): each container's and init container's, in any pod template. */
const IMAGE_FIELDS: readonly FieldSpec[] = specs(false, [undefined], 'spec/containers/image', 'spec/initContainers/image', 'spec/template/spec/containers/image', 'spec/template/spec/initContainers/image', 'spec/jobTemplate/spec/template/spec/containers/image', 'spec/jobTemplate/spec/template/spec/initContainers/image');

/** A resource's name, which a name prefix and suffix write by default. */
const NAME_FIELD: readonly FieldSpec[] = specs(false, [undefined], 'metadata/name');

/** The fields kustomize renames with the service object they name by default: an `Ingress`'s backends. */
const SERVICE_REFERENCES: NameReference = {
  kind: 'Service',
  fields: specs(false, ['Ingress'], 'spec/defaultBackend/service/name', 'spec/rules/http/paths/backend/service/name', 'spec/backend/serviceName', 'spec/rules/http/paths/backend/serviceName'),
};

/** Every text at a kustomize field path (P289), each as its holder and key: a list on the way is every item of it, as kustomize walks one. */
const stringsAtPath = (value: unknown, path: readonly string[]): Array<{ holder: Record<string | number, unknown>; key: string | number }> => {
  const [step, ...rest] = path;
  if (step === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => stringsAtPath(item, path));
  if (!isRecord(value) || !(step in value)) return [];
  const at = value[step];
  if (rest.length > 0) return stringsAtPath(at, rest);
  if (typeof at === 'string') return [{ holder: value as Record<string | number, unknown>, key: step }];
  return Array.isArray(at) ? at.flatMap((item, index) => (typeof item === 'string' ? [{ holder: at as unknown as Record<string | number, unknown>, key: index }] : [])) : [];
};

/** Every mapping at a field path (P295), made where it is not there and `create` says so; a list on the way is every item of it. */
const mapsAtPath = (value: unknown, path: readonly string[], create: boolean): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) return value.flatMap((item) => mapsAtPath(item, path, create));
  if (!isRecord(value)) return [];
  const [step, ...rest] = path;
  if (step === undefined) return [value];
  if (value[step] === undefined || value[step] === null) {
    if (!create) return [];
    value[step] = {};
  }
  return mapsAtPath(value[step], rest, create);
};

/** The texts at each field path of the specs that apply to a resource, and where `create` says, the field made empty. */
const textFields = (value: Located, fields: readonly FieldSpec[]): Array<{ holder: Record<string | number, unknown>; key: string | number }> => {
  const out: Array<{ holder: Record<string | number, unknown>; key: string | number }> = [];
  for (const spec of fields) {
    if (!specApplies(spec, value)) continue;
    const last = spec.path[spec.path.length - 1];
    if (last === undefined) continue;
    if (spec.create === true) for (const holder of mapsAtPath(value, spec.path.slice(0, -1), true)) if (holder[last] === undefined) holder[last] = '';
    for (const found of stringsAtPath(value, spec.path)) if (!out.some((seen) => seen.holder === found.holder && seen.key === found.key)) out.push(found);
  }
  return out;
};

/** Pairs written into the mappings at each field path of the specs that apply to a resource (P295): labels or annotations. */
const pairsWritten = (value: Located, pairs: Readonly<Record<string, string>>, fields: readonly FieldSpec[]): void => {
  if (Object.keys(pairs).length === 0) return;
  for (const spec of fields) {
    if (!specApplies(spec, value)) continue;
    for (const holder of mapsAtPath(value, spec.path, spec.create === true)) Object.assign(holder, pairs);
  }
};

/** An image written over as an `images` entry or an `ImageTagTransformer` says (P295): its new name, tag or digest, where its repository is the one named. */
const imageWritten = (image: string, entry: Record<string, unknown>): string | undefined => {
  const name = text(entry['name']);
  if (name === undefined) return undefined;
  const [repository, tag] = image.includes('@') ? [image.slice(0, image.indexOf('@')), undefined] : (/^(.*?)(?::([^:/]+))?$/.exec(image)?.slice(1) ?? [image, undefined]);
  if (repository !== name) return undefined;
  const newName = text(entry['newName']);
  const newTag = text(entry['newTag']);
  const digest = text(entry['digest']);
  return `${newName ?? repository}${digest !== undefined ? `@${digest}` : newTag !== undefined ? `:${newTag}` : tag === undefined ? '' : `:${tag}`}`;
};

/** The fields of a configuration that add to where a kustomization's own transformers write (P295). */
const CONFIGURED_FIELDS = ['commonLabels', 'commonAnnotations', 'namespace', 'namePrefix', 'nameSuffix', 'images'] as const;

type ConfiguredField = (typeof CONFIGURED_FIELDS)[number];

const emptyConfigured = (): Record<ConfiguredField, FieldSpec[]> => ({ commonLabels: [], commonAnnotations: [], namespace: [], namePrefix: [], nameSuffix: [], images: [] });

/** The transformers kustomize has built in that change nothing a manifest's facts are read from (P295): replicas, hashes and order. */
const TRANSFORMERS_NOTHING_DRAWN = new Set(['ReplicaCountTransformer', 'HashTransformer', 'SortOrderTransformer']);

/** A transformer's or a generator's configuration (P295), and where it is written. */
interface PluginConfig {
  readonly config: Record<string, unknown>;
  readonly at: Where;
}

/** Builds a kustomization as the tool that applies it does, for what a manifest's facts are read from. */
class Builder {
  readonly rows: ManifestRow[] = [];
  /** The vars the kustomizations of one build declare, its bases' included (P273). */
  #vars: DeclaredVar[] = [];
  /** The name and var reference fields the kustomizations of one build add (`configurations:`, P289), its bases' included. */
  #nameReferences: NameReference[] = [];
  #varReferences: FieldSpec[] = [];
  /** The fields the configurations of one build add to those its kustomizations' own transformers write (P295), its bases' included. */
  #configured: Record<ConfiguredField, FieldSpec[]> = emptyConfigured();

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
    // Vars are declared anywhere in the tree and substituted once the whole of it is built, as kustomize does.
    const top = seen.size === 0;
    if (top) {
      this.#vars = [];
      this.#nameReferences = [];
      this.#varReferences = [];
      this.#configured = emptyConfigured();
    }
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
    // What it generates and inflates is part of what it builds, before any of it is transformed (P263), its generator plugins' last (P295).
    this.configure(kustomization, at);
    for (const [key, kind] of [['configMapGenerator', 'ConfigMap'], ['secretGenerator', 'Secret']] as const) {
      for (const entry of (Array.isArray(value[key]) ? value[key] : []).filter(isRecord)) this.generateOne(kustomization.dir, entry, kind, resources, at(key));
    }
    resources.push(...this.helmCharts(kustomization, at));
    for (const plugin of this.pluginConfigs(kustomization, 'generators', at)) this.generator(kustomization, plugin, resources);
    this.patch(kustomization, resources, at);
    // Its own fields' transformers, in the order kustomize runs them, each writing the fields its configurations add (P295).
    const namespace = text(value['namespace']);
    if (namespace !== undefined) for (const resource of resources) namespaced(resource, namespace, [...specs(true, [undefined], 'metadata/namespace'), ...this.#configured.namespace], false);
    const prefix = text(value['namePrefix']);
    const suffix = text(value['nameSuffix']);
    for (const resource of resources) affixed(resource, prefix === undefined ? [] : [...NAME_FIELD, ...this.#configured.namePrefix], prefix ?? '', suffix === undefined ? [] : [...NAME_FIELD, ...this.#configured.nameSuffix], suffix ?? '');
    for (const resource of resources) {
      pairsWritten(resource.value, labelsOf(value['commonLabels']), [...COMMON_LABELS, ...this.#configured.commonLabels]);
      for (const entry of (Array.isArray(value['labels']) ? value['labels'] : []).filter(isRecord)) {
        // `labels:` writes a resource's own labels, its pod templates' where `includeTemplates` says, and its selectors too where `includeSelectors` does.
        const fields = entry['includeSelectors'] === true ? [...COMMON_LABELS, ...this.#configured.commonLabels] : [...specs(true, [undefined], 'metadata/labels'), ...(entry['includeTemplates'] === true ? TEMPLATE_METADATA('labels') : [])];
        pairsWritten(resource.value, labelsOf(entry['pairs']), [...fields, ...fieldSpecsOf(entry['fields'])]);
      }
      pairsWritten(resource.value, labelsOf(value['commonAnnotations']), [...COMMON_ANNOTATIONS, ...this.#configured.commonAnnotations]);
    }
    for (const entry of (Array.isArray(value['images']) ? value['images'] : []).filter(isRecord)) this.imaged(resources, entry, [...IMAGE_FIELDS, ...this.#configured.images]);
    // Replacements are the last of its own fields' transformers; its transformer plugins run after them (P295).
    this.replace(kustomization, kustomization.value['replacements'], resources, at('replacements'));
    for (const plugin of this.pluginConfigs(kustomization, 'transformers', at)) this.transformer(kustomization, plugin, resources);
    // A field naming a resource by a name it had is renamed with it, once every transformer has run (P289).
    this.renameReferences(resources);
    for (const entry of (Array.isArray(value['vars']) ? value['vars'] : []).filter(isRecord)) {
      const name = text(entry['name']);
      const fieldref = isRecord(entry['fieldref']) ? entry['fieldref'] : {};
      if (name === undefined) continue;
      this.#vars.push({ name, objref: isRecord(entry['objref']) ? entry['objref'] : {}, fieldpath: text(fieldref['fieldpath']) ?? 'metadata.name', at: at('vars') });
    }
    if (top) this.substitute(resources);
    return resources;
  }

  /**
   * The fields a kustomization's `configurations:` files add (P289): each
   * `nameReference` - the fields of other kinds that name a resource of its
   * kind, renamed with it - and each `varReference`, a field vars are
   * substituted in - and the fields its `commonLabels`, `commonAnnotations`,
   * `namespace`, `namePrefix`, `nameSuffix` and `images` say the
   * kustomization's own transformers write besides their own (P295). A file
   * not read is a row.
   */
  private configure(kustomization: Kustomization, at: (key: string) => Where): void {
    const written = kustomization.value['configurations'];
    for (const each of Array.isArray(written) ? written : []) {
      const name = text(each);
      if (name === undefined) continue;
      const path = resolve(kustomization.dir, name);
      const documents = existsSync(path) ? this.readPatch(path) : [];
      if (documents.length === 0) {
        const where = at('configurations');
        this.rows.push(row('manifest-unread', where, `${where.file} adds the configuration ${name}, which is ${existsSync(path) ? 'not read' : 'not in the project'}`, UNREAD_HINT, []));
        continue;
      }
      for (const document of documents.filter(isRecord)) {
        for (const reference of (Array.isArray(document['nameReference']) ? document['nameReference'] : []).filter(isRecord)) {
          const kind = text(reference['kind']);
          if (kind === undefined) continue;
          this.#nameReferences.push({ kind, fields: fieldSpecsOf(reference['fieldSpecs']) });
        }
        this.#varReferences.push(...fieldSpecsOf(document['varReference']));
        for (const field of CONFIGURED_FIELDS) this.#configured[field].push(...fieldSpecsOf(document[field]));
      }
    }
  }

  /**
   * The fields that name a resource, renamed with it once every transformer
   * of a level has run: an `Ingress`'s backends by default, and the fields a
   * configuration says (P289). A text there that is a name the resource had -
   * before this level's prefix or suffix, or a base's (P295), as kustomize
   * keeps every name a resource had - is its name now; a name another
   * resource of the kind has now is left as it is.
   */
  private renameReferences(resources: readonly Resource[]): void {
    for (const reference of [SERVICE_REFERENCES, ...this.#nameReferences]) {
      const referred = resources.filter((resource) => text(resource.value['kind']) === reference.kind);
      const nameOf = (resource: Resource): string | undefined => text(isRecord(resource.value['metadata']) ? resource.value['metadata']['name'] : undefined);
      const current = new Set(referred.flatMap((resource) => nameOf(resource) ?? []));
      const renamed = new Map<string, string>();
      for (const resource of referred) {
        const now = nameOf(resource);
        if (now === undefined) continue;
        for (const old of resource.names) if (!current.has(old) && !renamed.has(old)) renamed.set(old, now);
      }
      if (renamed.size === 0) continue;
      for (const resource of resources) {
        for (const spec of reference.fields) {
          if (!specApplies(spec, resource.value)) continue;
          for (const { holder, key } of stringsAtPath(resource.value, spec.path)) {
            const now = renamed.get(holder[key] as string);
            if (now !== undefined) holder[key] = now;
          }
        }
      }
    }
  }

  /**
   * The vars of a build substituted (P273): each the value at its `fieldref`
   * (by default `metadata.name`) of the one resource its `objref` names, once
   * every transformer has run - so a name carries its prefix - written for
   * `$(NAME)` in the fields kustomize substitutes vars in. A var whose
   * resource or field is not there is a row, and its references are left as
   * written; a `$(NAME)` no var declares is the container's own, left as it is.
   */
  private substitute(resources: readonly Resource[]): void {
    const values = new Map<string, string>();
    for (const declared of this.#vars) {
      const kind = text(declared.objref['kind']);
      const name = text(declared.objref['name']);
      const said = (why: string, about: readonly string[]): void => {
        this.rows.push(row('manifest-unread', declared.at, `${declared.at.file} declares the var ${declared.name}, which is not substituted: ${why}`, 'Write the value as a literal, or as a replacement (replacements:), which is read.', about));
      };
      if (kind === undefined || name === undefined) {
        said('it names no resource (objref: kind and name)', []);
        continue;
      }
      const selected = selectedBy(resources, declared.objref);
      if (selected.length !== 1) {
        said(`${kind}/${name} is ${selected.length === 0 ? 'not built' : 'more than one resource'}`, [name]);
        continue;
      }
      const found = fieldAt((selected[0] as Resource).value, stepsOf(declared.fieldpath.replace(/\[(\d+)\]/g, '.$1')));
      if (found === undefined || found === null || isRecord(found) || Array.isArray(found)) {
        said(`${declared.fieldpath} of ${kind}/${name} is not a value written`, [...(selected[0] as Resource).names]);
        continue;
      }
      values.set(declared.name, String(found));
    }
    if (values.size === 0) return;
    for (const resource of resources) {
      const configured = this.#varReferences.filter((spec) => specApplies(spec, resource.value)).flatMap((spec) => stringsAtPath(resource.value, spec.path));
      for (const { holder, key } of [...varFieldsOf(resource.value), ...configured]) {
        holder[key] = (holder[key] as string).replace(VAR_REFERENCE, (whole, name: string) => values.get(name) ?? whole);
      }
    }
  }

  /**
   * The config maps and secrets a kustomization generates (P263): one per
   * `configMapGenerator` / `secretGenerator` entry, its `literals` and the
   * keys of its `envs` (`env`) files, each key said at the file that writes
   * it; `behavior: merge` or `replace` changes the one of its name the bases
   * build. A generator's `files` are keys too (P289): each file's whole text
   * under its name, or under the key written before it (`key=path`), said at
   * the file's first line.
   */
  private generateOne(dir: string, entry: Record<string, unknown>, kind: 'ConfigMap' | 'Secret', resources: Resource[], where: Where): void {
    const name = text(entry['name']);
    if (name === undefined) return;
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
      const path = text(written) === undefined ? undefined : resolve(dir, text(written) as string);
      const source = path === undefined ? undefined : readText(path);
      if (path === undefined || source === undefined) continue;
      source.split('\n').forEach((line, index) => {
        const assignment = /^\s*([A-Za-z_][\w.-]*)\s*=(.*)$/.exec(line);
        if (assignment === null || /^\s*#/.test(line)) return;
        data[assignment[1] as string] = (assignment[2] as string).trim().replace(/^(['"])(.*)\1$/, '$2');
        keysAt[assignment[1] as string] = { file: this.label(path), line: index + 1 };
      });
    }
    for (const written of Array.isArray(entry['files']) ? entry['files'] : []) {
      const named = text(written);
      if (named === undefined) continue;
      const equals = named.indexOf('=');
      const file = equals > 0 ? named.slice(equals + 1) : named;
      const path = resolve(dir, file);
      const source = readText(path);
      if (source === undefined) continue;
      const key = equals > 0 ? named.slice(0, equals) : basename(path);
      data[key] = source;
      keysAt[key] = { file: this.label(path), line: 1 };
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
      return;
    }
    const namespace = text(entry['namespace']);
    const metadata = located({ name, ...(namespace === undefined ? {} : { namespace }) }, where);
    resources.push({ value: located({ apiVersion: 'v1', kind, metadata, data }, where), file: where.file, names: new Set([name]) });
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
    return (Array.isArray(value['helmCharts']) ? value['helmCharts'] : []).filter(isRecord).flatMap((entry) => this.inflateOne(kustomization.dir, entry, home, at('helmCharts')));
  }

  /** One chart a kustomization inflates: a `helmCharts` entry, or a `HelmChartInflationGenerator`'s configuration (P295). */
  private inflateOne(dir: string, entry: Record<string, unknown>, home: string, where: Where): Resource[] {
    const name = text(entry['name']);
    if (name === undefined) return [];
    const chart = chartHomeOf(home, name, text(entry['version']));
    if (chart === undefined) {
      this.rows.push(row('manifest-unread', where, `${where.file} inflates the chart ${name}${text(entry['repo']) === undefined ? '' : ` from ${text(entry['repo'])}`}, which is not in the project`, 'Keep the chart in the project under helmGlobals.chartHome, or annotate the request with the service it reaches (/** @flowatlas-calls <service> METHOD /path */).', [name]));
      return [];
    }
    const files = [entry['valuesFile'], ...(Array.isArray(entry['additionalValuesFiles']) ? entry['additionalValuesFiles'] : [])].flatMap((each) => (text(each) === undefined ? [] : [resolve(dir, text(each) as string)]));
    const inline = isRecord(entry['valuesInline']) ? [entry['valuesInline']] : [];
    const reading = chartReadingOf(chart, [...files, ...inline], [], text(entry['releaseName']) ?? name, text(entry['namespace']), `${where.file}:${where.line}`);
    return this.inflate(chart, reading, this.rows);
  }

  /**
   * A kustomization's replacements (P263), inline or in the files `path`
   * names: the value at a source's field path, or the part of it a delimiter
   * and an index pick, written at each target's field paths, created where
   * `create` says. What does not apply is a row. A `ReplacementTransformer`
   * writes its own (P295).
   */
  private replace(kustomization: Kustomization, written: unknown, resources: readonly Resource[], where: Where): void {
    const entries = (Array.isArray(written) ? written : []).filter(isRecord).flatMap((entry): unknown[] => {
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
    if (inline.includes('\n') || inline.trimStart().startsWith('-') || inline.trimStart().startsWith('{') || inline.trimStart().startsWith('[')) return documentsOf(inline, at.file, () => at.line);
    const path = resolve(dir, inline);
    return existsSync(path) ? this.readPatch(path) : [];
  }

  /** A strategic merge patch over the resources it names by kind and name, or over those chosen. */
  private strategic(resources: readonly Resource[], patch: unknown, chosen?: readonly Resource[]): void {
    if (!isRecord(patch)) return;
    const kind = text(patch['kind']);
    const name = text(isRecord(patch['metadata']) ? patch['metadata']['name'] : undefined);
    for (const each of chosen ?? targets(resources, { ...(kind === undefined ? {} : { kind }), ...(name === undefined ? {} : { name }) })) {
      const patched = copied(patch);
      // The patch names the resource; it does not rename it.
      if (isRecord(patched['metadata'])) delete patched['metadata']['name'];
      each.value = strategicMerge(each.value, patched, []) as Located;
    }
  }

  /**
   * One `patches` or `patchesJson6902` entry, or a `PatchTransformer` /
   * `PatchJson6902Transformer` (P295): the patch it writes or the file it
   * names, over the resources its target names. A list of operations is a
   * JSON 6902 patch, a mapping a strategic merge.
   */
  private patchEntry(dir: string, entry: Record<string, unknown>, json6902: boolean, resources: readonly Resource[], where: Where): void {
    const target = targetOf(entry['target']);
    const chosen = target === undefined ? undefined : targets(resources, target);
    const documents = this.patchDocuments(dir, entry['patch'] ?? entry['path'], where);
    const list = documents.find((each) => Array.isArray(each));
    if (list === undefined && !json6902) {
      for (const patch of documents) this.strategic(resources, patch, chosen);
      return;
    }
    if (chosen === undefined) {
      this.rows.push(row('manifest-unread', where, `${where.file} writes a patch of operations that names no resource it applies to`, UNREAD_HINT, []));
      return;
    }
    const at = whereOf(list) ?? where;
    for (const operation of (Array.isArray(list) ? list : []).filter(isRecord)) {
      for (const each of chosen) {
        const why = jsonPatch(each.value, operation);
        if (why !== undefined) this.rows.push(row('manifest-unread', at, `${at.file} does not patch ${[...each.names][0] ?? 'a resource'} as written: ${why}`, UNREAD_HINT, [...each.names]));
      }
    }
  }

  private patch(kustomization: Kustomization, resources: Resource[], at: (key: string) => Where): void {
    const value = kustomization.value;
    for (const written of Array.isArray(value['patchesStrategicMerge']) ? value['patchesStrategicMerge'] : []) {
      for (const patch of this.patchDocuments(kustomization.dir, written, at('patchesStrategicMerge'))) this.strategic(resources, patch);
    }
    for (const key of ['patches', 'patchesJson6902']) {
      for (const entry of (Array.isArray(value[key]) ? value[key] : []).filter(isRecord)) this.patchEntry(kustomization.dir, entry, key === 'patchesJson6902', resources, at(key));
    }
  }

  /** An `images` entry, or an `ImageTagTransformer`'s `imageTag` (P295), written over every image it names at the fields given. */
  private imaged(resources: readonly Resource[], entry: Record<string, unknown>, fields: readonly FieldSpec[]): void {
    for (const resource of resources) {
      for (const { holder, key } of textFields(resource.value, fields)) {
        const now = imageWritten(holder[key] as string, entry);
        if (now !== undefined) holder[key] = now;
      }
    }
  }

  /**
   * The configurations a kustomization's `transformers:` or `generators:`
   * name (P295), in order: each document of a file it lists, of the files a
   * folder's kustomization lists as its resources, or written inline. One
   * outside the project, or not there, is a row.
   */
  private pluginConfigs(kustomization: Kustomization, key: 'transformers' | 'generators', at: (key: string) => Where): PluginConfig[] {
    const where = at(key);
    const out: PluginConfig[] = [];
    const said = (message: string): void => {
      this.rows.push(row('manifest-unread', where, `${where.file} ${message}`, UNREAD_HINT, []));
    };
    const documents = (path: string): void => {
      const read = this.readPatch(path).filter(isRecord);
      if (read.length === 0) said(`lists ${this.label(path)} under ${key}, which is not read`);
      for (const config of read) out.push({ config, at: whereOf(config) ?? { file: this.label(path), line: 1 } });
    };
    for (const each of Array.isArray(kustomization.value[key]) ? kustomization.value[key] : []) {
      const written = text(each);
      if (written === undefined) continue;
      if (written.includes('\n')) {
        for (const config of documentsOf(written, where.file, () => where.line).filter(isRecord)) out.push({ config, at: where });
        continue;
      }
      if (/^[a-z]+:\/\//i.test(written) || written.startsWith('github.com')) {
        said(`lists ${written} under ${key}, which is not in the project`);
        continue;
      }
      const path = resolve(kustomization.dir, written);
      if (!existsSync(path)) {
        said(`lists ${written} under ${key}, which is not in the project`);
        continue;
      }
      if (!statSync(path).isDirectory()) {
        documents(path);
        continue;
      }
      // A folder is a kustomization whose resources are the configurations.
      const inner = kustomizationAt(path);
      if (inner === undefined) {
        said(`lists the folder ${written} under ${key}, which holds no kustomization`);
        continue;
      }
      for (const listed of Array.isArray(inner.value['resources']) ? inner.value['resources'] : []) {
        const file = text(listed) === undefined ? undefined : resolve(path, text(listed) as string);
        if (file !== undefined && existsSync(file) && !statSync(file).isDirectory()) documents(file);
      }
    }
    return out;
  }

  /**
   * Whether a plugin's configuration is one of kustomize's own (`apiVersion:
   * builtin`), which is read; an exec or Go plugin, or a KRM function, is
   * run by kustomize rather than written in the project, and is a row.
   */
  private builtin(plugin: PluginConfig, role: 'transformer' | 'generator'): boolean {
    const { config, at } = plugin;
    const apiVersion = text(config['apiVersion']);
    const kind = text(config['kind']) ?? 'a configuration with no kind';
    const metadata = isRecord(config['metadata']) ? config['metadata'] : {};
    const annotations = isRecord(metadata['annotations']) ? metadata['annotations'] : {};
    const function_ = annotations['config.kubernetes.io/function'] !== undefined || annotations['config.k8s.io/function'] !== undefined;
    if (apiVersion === 'builtin' && !function_) return true;
    this.rows.push(
      row(
        'manifest-unread',
        at,
        `${at.file} configures the ${role} ${kind}${apiVersion === undefined ? '' : ` (${apiVersion})`}, ${function_ ? 'a KRM function' : 'an exec or Go plugin'} kustomize runs; what it does to the resources is not read`,
        'Write what it does with a kustomization field or a built-in transformer (namePrefix, labels, patches, images, configMapGenerator), or annotate the request with the service it reaches (/** @flowatlas-calls <service> METHOD /path */).',
        [],
      ),
    );
    return false;
  }

  /** One of a kustomization's `generators:` (P295): a `ConfigMapGenerator`, `SecretGenerator` or `HelmChartInflationGenerator`, read as the field it stands for. */
  private generator(kustomization: Kustomization, plugin: PluginConfig, resources: Resource[]): void {
    if (!this.builtin(plugin, 'generator')) return;
    const { config, at } = plugin;
    const kind = text(config['kind']);
    const metadata = isRecord(config['metadata']) ? config['metadata'] : {};
    if (kind === 'ConfigMapGenerator' || kind === 'SecretGenerator') {
      this.generateOne(kustomization.dir, { ...config, name: metadata['name'], namespace: metadata['namespace'] }, kind === 'ConfigMapGenerator' ? 'ConfigMap' : 'Secret', resources, at);
      return;
    }
    if (kind === 'HelmChartInflationGenerator') {
      resources.push(...this.inflateOne(kustomization.dir, config, resolve(kustomization.dir, text(config['chartHome']) ?? 'charts'), at));
      return;
    }
    this.rows.push(row('manifest-unread', at, `${at.file} configures the built-in generator ${kind ?? '?'}, which is not read`, UNREAD_HINT, []));
  }

  /**
   * One of a kustomization's `transformers:` (P295): kustomize's built-in
   * transformers, each over the fields its `fieldSpecs` name - a prefix and a
   * suffix, labels, annotations, a namespace, an image - and its patches and
   * replacements as the fields that write them. Those that change nothing
   * read here (replicas, hashes, order) are passed; any other is a row.
   */
  private transformer(kustomization: Kustomization, plugin: PluginConfig, resources: Resource[]): void {
    if (!this.builtin(plugin, 'transformer')) return;
    const { config, at } = plugin;
    const kind = text(config['kind']) ?? '';
    const fields = fieldSpecsOf(config['fieldSpecs']);
    switch (kind) {
      case 'PrefixSuffixTransformer':
        for (const resource of resources) affixed(resource, fields, text(config['prefix']) ?? '', fields, text(config['suffix']) ?? '');
        return;
      case 'LabelTransformer':
        for (const resource of resources) pairsWritten(resource.value, labelsOf(config['labels']), fields);
        return;
      case 'AnnotationsTransformer':
        for (const resource of resources) pairsWritten(resource.value, labelsOf(config['annotations']), fields);
        return;
      case 'NamespaceTransformer': {
        const namespace = text(isRecord(config['metadata']) ? config['metadata']['namespace'] : undefined);
        if (namespace !== undefined) for (const resource of resources) namespaced(resource, namespace, fields, config['unsetOnly'] === true);
        return;
      }
      case 'ImageTagTransformer':
        if (isRecord(config['imageTag'])) this.imaged(resources, config['imageTag'], fields.length === 0 ? IMAGE_FIELDS : fields);
        return;
      case 'PatchTransformer':
        this.patchEntry(kustomization.dir, config, false, resources, at);
        return;
      case 'PatchJson6902Transformer':
        this.patchEntry(kustomization.dir, { ...config, patch: config['jsonOp'] ?? config['patch'] }, true, resources, at);
        return;
      case 'PatchStrategicMergeTransformer':
        for (const written of [...(Array.isArray(config['paths']) ? config['paths'] : []), ...(config['patches'] === undefined ? [] : [config['patches']])]) {
          for (const patch of this.patchDocuments(kustomization.dir, written, at)) this.strategic(resources, patch);
        }
        return;
      case 'ReplacementTransformer':
        this.replace(kustomization, config['replacements'], resources, at);
        return;
      default:
        if (TRANSFORMERS_NOTHING_DRAWN.has(kind)) return;
        this.rows.push(row('manifest-unread', at, `${at.file} configures the built-in transformer ${kind || '?'}, which is not read`, UNREAD_HINT, []));
    }
  }
}

/**
 * A resource's fields written with a prefix and a suffix (P295): each text
 * at the fields its specs name (by default its name), the prefix where the
 * prefix's specs name it and the suffix where the suffix's do. A name written
 * is one the resource is known by.
 */
const affixed = (resource: Resource, before: readonly FieldSpec[], prefix: string, after: readonly FieldSpec[], suffix: string): void => {
  // A prefix is written over what is there; it makes no field.
  const prefixed = prefix === '' ? [] : textFields(resource.value, before.map(({ create: _, ...spec }) => spec));
  const suffixed = suffix === '' ? [] : textFields(resource.value, after.map(({ create: _, ...spec }) => spec));
  const same = (a: { holder: unknown; key: unknown }) => (b: { holder: unknown; key: unknown }): boolean => a.holder === b.holder && a.key === b.key;
  for (const field of [...prefixed, ...suffixed.filter((each) => !prefixed.some(same(each)))]) {
    const was = field.holder[field.key];
    if (typeof was !== 'string' || was === '') continue;
    field.holder[field.key] = `${prefixed.some(same(field)) ? prefix : ''}${was}${suffixed.some(same(field)) ? suffix : ''}`;
  }
  const name = text(isRecord(resource.value['metadata']) ? resource.value['metadata']['name'] : undefined);
  if (name !== undefined) resource.names.add(name);
};

/** A namespace written at the fields its specs name (P295), made where they say; only where none is written, with `unsetOnly`. */
const namespaced = (resource: Resource, namespace: string, fields: readonly FieldSpec[], unsetOnly: boolean): void => {
  if (!isRecord(resource.value['metadata'])) return;
  for (const { holder, key } of textFields(resource.value, fields)) {
    if (unsetOnly && holder[key] !== '') continue;
    holder[key] = namespace;
  }
};

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
  /** The releases it is installed after: what a helmfile's release `needs` (P273). */
  readonly needs?: readonly string[];
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

/** The files of each packed chart read so far, by the archive's absolute path: each file's text by its path inside the archive (P289). */
const PACKED = new Map<string, ReadonlyMap<string, string> | null>();

/** How large a packed chart is read, unpacked; larger is not read. */
const MOST_PACKED_BYTES = 32 * 1024 * 1024;

/**
 * The files of a packed chart (`charts/<name>-<version>.tgz`), as helm reads
 * one (P289): a gzipped tar of the chart's folder. Regular files only, their
 * names as the archive writes them (a long name by its pax or GNU header);
 * `undefined` where it does not unpack.
 */
export const packedFiles = (archive: string): ReadonlyMap<string, string> | undefined => {
  const cached = PACKED.get(archive);
  if (cached !== undefined) return cached ?? undefined;
  let files: Map<string, string> | null = null;
  try {
    const data = gunzipSync(readFileSync(archive), { maxOutputLength: MOST_PACKED_BYTES });
    files = new Map();
    let at = 0;
    let longName: string | undefined;
    while (at + 512 <= data.length) {
      const header = data.subarray(at, at + 512);
      if (header.every((byte) => byte === 0)) break;
      const field = (from: number, length: number): string => header.subarray(from, from + length).toString('utf8').replace(/\0.*$/s, '');
      const size = Number.parseInt(field(124, 12).trim() || '0', 8);
      const type = field(156, 1);
      const prefix = field(345, 155);
      const name = longName ?? (prefix === '' ? field(0, 100) : `${prefix}/${field(0, 100)}`);
      longName = undefined;
      const body = data.subarray(at + 512, at + 512 + size);
      if (type === 'x') {
        const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1];
        if (path !== undefined) longName = path;
      } else if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '');
      else if (type === '0' || type === '' || type === '7') files.set(name.replace(/^\.\//, ''), body.toString('utf8'));
      at += 512 + Math.ceil(size / 512) * 512;
    }
  } catch {
    files = null;
  }
  PACKED.set(archive, files);
  return files ?? undefined;
};

/** The archive a path is inside, and its path in the archive, where it is one of a packed chart's (`…/charts/redis-1.2.3.tgz/redis/values.yaml`). */
const insidePacked = (path: string): { archive: string; inner: string } | undefined => {
  const at = path.search(/\.tgz(?:[\\/]|$)/);
  if (at < 0) return undefined;
  const archive = path.slice(0, at + 4);
  return { archive, inner: path.slice(at + 5).split(sep).join('/') };
};

const readText = (path: string): string | undefined => {
  const packed = insidePacked(path);
  if (packed !== undefined) return packedFiles(packed.archive)?.get(packed.inner);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** Whether a chart's file is there, in a folder or in a packed chart (P289). */
const chartFileExists = (path: string): boolean => {
  const packed = insidePacked(path);
  if (packed === undefined) return existsSync(path);
  return packedFiles(packed.archive)?.has(packed.inner) === true;
};

/** The names a chart's folder holds, in a folder or in a packed chart (P289), sorted. */
const chartEntries = (dir: string): string[] => {
  const packed = insidePacked(dir);
  if (packed === undefined) {
    try {
      return readdirSync(dir).sort();
    } catch {
      return [];
    }
  }
  const prefix = packed.inner === '' ? '' : `${packed.inner}/`;
  const names = new Set<string>();
  for (const path of packedFiles(packed.archive)?.keys() ?? []) if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0] as string);
  return [...names].sort();
};

/** The chart a packed archive holds: the folder inside it with a `Chart.yaml` (P289). */
const packedChart = (archive: string): string | undefined => {
  const top = [...(packedFiles(archive)?.keys() ?? [])].map((path) => path.split('/')).find((parts) => parts.length === 2 && parts[1] === 'Chart.yaml');
  return top === undefined ? undefined : join(archive, top[0] as string);
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
  /** The values it hands its parent (P289): each `import-values` entry, the child's path and the parent's (`.` its root). */
  readonly imports: readonly { readonly child: string; readonly parent: string }[];
}

/** What a dependency's `import-values` hands its parent (P289): `data` is the child's `exports.data` at the parent's root; `{ child, parent }` a path to a path. */
const importsOf = (written: unknown): Subchart['imports'] =>
  (Array.isArray(written) ? written : []).flatMap((entry) => {
    if (text(entry) !== undefined) return [{ child: `exports.${text(entry) as string}`, parent: '.' }];
    if (!isRecord(entry) || text(entry['child']) === undefined) return [];
    return [{ child: text(entry['child']) as string, parent: text(entry['parent']) ?? '.' }];
  });

/** A dependency of a chart only a chart repository has (P295): nothing fetched it into the project, and no repository is read. */
interface Unfetched {
  readonly name: string;
  readonly repository: string;
  readonly version?: string;
  readonly condition?: string;
  readonly tags: readonly string[];
  /** The `Chart.yaml` (or `requirements.yaml`) naming it, absolute, and the line. */
  readonly file: string;
  readonly line: number;
}

/** The packed archive of a dependency in `charts/`: `<name>-<version>.tgz`, or the one `<name>-*.tgz` there is (P289). */
const packedDependency = (dir: string, name: string, version: string | undefined): string | undefined => {
  const archives = chartEntries(join(dir, 'charts')).filter((entry) => entry.endsWith('.tgz') && entry.startsWith(`${name}-`));
  const exact = version === undefined ? undefined : archives.find((entry) => entry === `${name}-${version}.tgz`);
  const chosen = exact ?? (archives.length === 1 ? archives[0] : undefined);
  return chosen === undefined ? undefined : packedChart(join(dir, 'charts', chosen));
};

/**
 * The charts a chart depends on that are in the project (P263): each
 * `dependencies` entry (of `Chart.yaml`, or an older `requirements.yaml`)
 * with a `file://` repository, unpacked in `charts/` or packed there as
 * `<name>-<version>.tgz` (P289), and every other chart unpacked or packed in
 * `charts/`, which the tool that installs it renders too. A repository's
 * chart nothing has fetched into the project is not in it: it is handed to
 * `unfetched`, for the caller to say so (P295).
 */
export const subchartsOf = (dir: string, unfetched?: Unfetched[]): Subchart[] => {
  const meta = yamlValue(join(dir, 'Chart.yaml'));
  const own = Array.isArray(meta['dependencies']);
  const written = own ? meta['dependencies'] : (yamlValue(join(dir, 'requirements.yaml'))['dependencies'] as unknown);
  const out: Subchart[] = [];
  for (const dependency of (Array.isArray(written) ? written : []).filter(isRecord)) {
    const name = text(dependency['name']);
    if (name === undefined) continue;
    const repository = text(dependency['repository']) ?? '';
    const version = text(dependency['version']);
    const unpacked = repository.startsWith('file://') ? resolve(dir, repository.slice('file://'.length)) : join(dir, 'charts', name);
    const path = chartFileExists(join(unpacked, 'Chart.yaml')) ? unpacked : packedDependency(dir, name, version);
    const condition = text(dependency['condition']);
    const tags = (Array.isArray(dependency['tags']) ? dependency['tags'] : []).flatMap((tag) => (text(tag) === undefined ? [] : [text(tag) as string]));
    if (path === undefined) {
      const file = join(dir, own ? 'Chart.yaml' : 'requirements.yaml');
      const line = (readText(file) ?? '').split('\n').findIndex((each) => each.replace(/^\s*-?\s*name:\s*/, '').replace(/^['"]|['"]?\s*$/g, '') === name && /^\s*-?\s*name:/.test(each));
      unfetched?.push({ name, repository, ...(version === undefined ? {} : { version }), ...(condition === undefined ? {} : { condition }), tags, file, line: line < 0 ? 1 : line + 1 });
      continue;
    }
    out.push({ dir: path, key: text(dependency['alias']) ?? name, ...(condition === undefined ? {} : { condition }), tags, imports: importsOf(dependency['import-values']) });
  }
  for (const name of chartEntries(join(dir, 'charts'))) {
    const path = name.endsWith('.tgz') ? packedChart(join(dir, 'charts', name)) : join(dir, 'charts', name);
    if (path === undefined || out.some((each) => each.dir === path || (insidePacked(path) !== undefined && insidePacked(each.dir)?.archive === insidePacked(path)?.archive)) || !chartFileExists(join(path, 'Chart.yaml'))) continue;
    out.push({ dir: path, key: chartMetaOf(path).name ?? name, tags: [], imports: [] });
  }
  return out;
};

/** How deep a chart's dependencies are followed. */
const CHART_DEPTH = 4;

/** The value at a dotted path of values. */
const valueAtPath = (values: Record<string, unknown>, path: string): unknown => path.split('.').filter((key) => key !== '').reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), values);

/** Whether a dependency is left out by the values: its condition's first path the values set is false, or every tag it names is. */
const leftOut = (values: Record<string, unknown>, sub: Pick<Subchart, 'condition' | 'tags'>): boolean => {
  for (const path of (sub.condition ?? '').split(',').map((each) => each.trim()).filter((each) => each !== '')) {
    const set = valueAtPath(values, path);
    if (typeof set === 'boolean') return !set;
  }
  const tags = isRecord(values['tags']) ? values['tags'] : {};
  return sub.tags.length > 0 && sub.tags.every((tag) => tags[tag] === false);
};

/**
 * The chart and every chart it renders inside its release, with the values
 * each is given. What a dependency's `import-values` hands up is merged under
 * the parent's own values (P289), the parent's winning, as helm imports them;
 * a dependency's own tree is settled first, so what its dependencies hand it
 * is among what it hands up (P295). A dependency the values keep that only a
 * chart repository has is handed to `unfetched` (P295).
 */
const chartTree = (dir: string, reading: ChartReading, unfetched: (dependency: Unfetched) => void, depth = 0): Array<{ dir: string; reading: ChartReading }> => {
  if (depth > CHART_DEPTH) return [];
  const parent = reading.context.values;
  const below: Array<{ dir: string; reading: ChartReading }> = [];
  let imported: Record<string, unknown> = {};
  const missing: Unfetched[] = [];
  for (const sub of subchartsOf(dir, missing)) {
    if (leftOut(parent, sub)) continue;
    const own = yamlValue(join(sub.dir, 'values.yaml'));
    const given = isRecord(parent[sub.key]) ? (parent[sub.key] as Record<string, unknown>) : {};
    const global = mergedValues(isRecord(own['global']) ? own['global'] : {}, isRecord(parent['global']) ? parent['global'] : {});
    const values = mergedValues(mergedValues(own, given), Object.keys(global).length === 0 ? {} : { global });
    const tree = chartTree(sub.dir, { ...reading, context: { values, release: reading.context.release, chart: chartMetaOf(sub.dir) } }, unfetched, depth + 1);
    const settled = tree[0]?.reading.context.values ?? values;
    for (const each of sub.imports) {
      const handed = valueAtPath(settled, each.child);
      if (handed === undefined) continue;
      const at = each.parent.split('.').filter((key) => key !== '');
      if (at.length === 0 && !isRecord(handed)) continue;
      let nested: unknown = handed;
      for (const key of [...at].reverse()) nested = { [key]: nested };
      imported = mergedValues(imported, nested as Record<string, unknown>);
    }
    below.push(...tree);
  }
  for (const each of missing) if (!leftOut(parent, each)) unfetched(each);
  const values = Object.keys(imported).length === 0 ? parent : mergedValues(imported, parent);
  const own = values === parent ? reading : { ...reading, context: { ...reading.context, values } };
  return [{ dir, reading: own }, ...below];
};

const templatesOf = (dir: string): string[] => chartEntries(join(dir, 'templates'));

/**
 * Every template of a chart, and of every chart it depends on (P263),
 * rendered every way one reading makes it go; the helpers are the whole
 * tree's, as the tool that installs it shares them. A dependency only a chart
 * repository has is a row (P295): no repository is fetched.
 */
const chartResources = (dir: string, reading: ChartReading, label: (path: string) => string, rows: ManifestRow[]): Resource[] => {
  const tree = chartTree(dir, reading, (dependency) => {
    const file = label(dependency.file);
    const message = `${file} depends on the chart ${dependency.name}${dependency.version === undefined ? '' : ` ${dependency.version}`}${dependency.repository === '' ? '' : ` from ${dependency.repository}`}, which nothing has fetched into the project (charts/ holds no ${dependency.name}); no chart repository is read, so its templates are not rendered`;
    if (rows.some((seen) => seen.file === file && seen.line === dependency.line && seen.message === message)) return;
    rows.push(row('manifest-unread', { file, line: dependency.line }, message, 'Keep the chart in the project (helm dependency build writes it to charts/), or annotate the request with the service it reaches (/** @flowatlas-calls <service> METHOD /path */).', [dependency.name, ...(reading.context.release.name === undefined ? [] : [reading.context.release.name]), ...(chartMetaOf(dir).name === undefined ? [] : [chartMetaOf(dir).name as string])]));
  });
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
