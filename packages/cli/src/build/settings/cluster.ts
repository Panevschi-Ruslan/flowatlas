import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readYaml, type PositionedDocument } from '@flowatlas/core';
import { interpolated } from './compose.js';
import type { Written } from './dotenv.js';

/**
 * What a repository's cluster manifests say about where its containers are
 * reached (P257).
 *
 * A Kubernetes `Service` named `orders` that routes its port 80 to the
 * `targetPort` 3000 (or to a port the pods name `http`) of the pods a
 * `Deployment` or `StatefulSet` runs is how another service in the cluster
 * reaches orders: `http://orders/…`, `orders.shop.svc.cluster.local:80`.
 * Read here: every workload's containers (their named ports and the ports
 * their environment gives a setting) and every service object (its name, its
 * namespace, its selector and each port it routes), from plain YAML files,
 * several documents to a file.
 *
 * Only what is written as a literal is read. A Helm template's line whose
 * value is a template expression (`port: {{ .Values.port }}`) is not read,
 * and a line that is only a template directive is dropped, so the rest of
 * the document still reads; chart values files are not read. A kustomization
 * gives the files it lists its `namespace`, `namePrefix` and `nameSuffix`;
 * its patches are not read.
 */

/** A container of a workload's pods. */
export interface ManifestContainer {
  readonly name?: string;
  /** The image's own name, without registry, path or tag. */
  readonly image?: string;
  readonly ports: ReadonlyArray<{ readonly port: number; readonly name?: string }>;
  /** Its environment, values written as literals only. */
  readonly environment: readonly Written[];
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

/** A `Service`. */
export interface ManifestService {
  readonly name: string;
  readonly namespace?: string;
  readonly selector: Readonly<Record<string, string>>;
  readonly ports: ReadonlyArray<{ readonly port: number; readonly target?: number | string; readonly line: number }>;
  readonly file: string;
}

export interface Manifests {
  readonly workloads: readonly ManifestWorkload[];
  readonly services: readonly ManifestService[];
}

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet']);

/** What a line holding a template expression is read as: a value nobody wrote. */
const TEMPLATED = '\u0000templated';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? (value === TEMPLATED ? undefined : value) : typeof value === 'number' ? String(value) : undefined;

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

/** The documents of a file, each with the line it starts on. */
const documentsOf = (source: string): Array<{ document: PositionedDocument; first: number }> => {
  const lines = source.split('\n');
  const out: Array<{ document: PositionedDocument; first: number }> = [];
  let start = 0;
  const flush = (end: number): void => {
    const chunk = lines.slice(start, end).join('\n');
    if (chunk.trim() !== '') {
      try {
        out.push({ document: readYaml(untemplated(chunk)), first: start });
      } catch {
        // A document that is not YAML once its templates are out is not read.
      }
    }
  };
  lines.forEach((line, index) => {
    if (!/^---(?:\s|$)/.test(line)) return;
    flush(index);
    start = index + 1;
  });
  flush(lines.length);
  return out;
};

const containersOf = (spec: unknown): ManifestContainer[] => {
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
    const environment = (Array.isArray(container['env']) ? container['env'] : []).filter(isRecord).flatMap((each): Written[] => {
      const key = text(each['name']);
      const raw = text(each['value']);
      const settled = raw === undefined ? undefined : interpolated(raw);
      return key === undefined || settled === undefined || settled === '' ? [] : [{ name: key, raw: settled }];
    });
    return { ...(name === undefined ? {} : { name }), ...(image === undefined || image === '' ? {} : { image }), ports, environment };
  });
};

/** What one file's documents declare, its names given a kustomization's prefix, suffix and namespace. */
export const readManifest = (source: string, file: string, kustomized: Kustomized = {}): Manifests => {
  const workloads: ManifestWorkload[] = [];
  const services: ManifestService[] = [];
  const named = (name: string): string => `${kustomized.prefix ?? ''}${name}${kustomized.suffix ?? ''}`;
  for (const { document, first } of documentsOf(source)) {
    const value = document.value;
    if (!isRecord(value)) continue;
    const kind = text(value['kind']);
    const metadata = isRecord(value['metadata']) ? value['metadata'] : {};
    const name = text(metadata['name']);
    if (kind === undefined || name === undefined) continue;
    const namespace = kustomized.namespace ?? text(metadata['namespace']);
    const spec = isRecord(value['spec']) ? value['spec'] : {};
    if (WORKLOADS.has(kind)) {
      const template = isRecord(spec['template']) ? spec['template'] : {};
      const templateMeta = isRecord(template['metadata']) ? template['metadata'] : {};
      workloads.push({
        name: named(name),
        ...(namespace === undefined ? {} : { namespace }),
        labels: labelsOf(templateMeta['labels']),
        containers: containersOf(template['spec']),
        file,
      });
      continue;
    }
    if (kind !== 'Service') continue;
    const ports = (Array.isArray(spec['ports']) ? spec['ports'] : []).flatMap((each, index) => {
      if (!isRecord(each)) return [];
      const port = portNumber(each['port']);
      if (port === undefined) return [];
      const written = each['targetPort'];
      const target = written === undefined ? port : (portNumber(written) ?? text(written));
      // A target written as a template expression is not read.
      if (written !== undefined && target === undefined) return [];
      const line = (document.at(['spec', 'ports', index])?.line ?? 1) + first;
      return [{ port, ...(target === undefined ? {} : { target }), line }];
    });
    services.push({ name: named(name), ...(namespace === undefined ? {} : { namespace }), selector: labelsOf(spec['selector']), ports, file });
  }
  return { workloads, services };
};

/** What a kustomization gives the files it lists. */
export interface Kustomized {
  readonly namespace?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

/** Directories no manifest of the project's own is kept in. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'out', 'target', 'tmp']);

const DEPTH = 6;

/** Whether a file's text may hold a manifest at all. */
const looksLikeManifest = (source: string): boolean => /^\s*apiVersion\s*:/m.test(source) && /^\s*kind\s*:\s*(?:Service|Deployment|StatefulSet|DaemonSet|ReplicaSet)\b/m.test(source);

const KUSTOMIZATIONS = ['kustomization.yaml', 'kustomization.yml', 'Kustomization'];

/** What each file a kustomization in `dir` lists is given, by its absolute path. */
const kustomizationIn = (dir: string, files: readonly string[]): Map<string, Kustomized> => {
  const out = new Map<string, Kustomized>();
  const name = KUSTOMIZATIONS.find((each) => files.includes(each));
  if (name === undefined) return out;
  let value: unknown;
  try {
    value = readYaml(readFileSync(join(dir, name), 'utf8')).value;
  } catch {
    return out;
  }
  if (!isRecord(value)) return out;
  const given: Kustomized = {
    ...(text(value['namespace']) === undefined ? {} : { namespace: text(value['namespace']) as string }),
    ...(text(value['namePrefix']) === undefined ? {} : { prefix: text(value['namePrefix']) as string }),
    ...(text(value['nameSuffix']) === undefined ? {} : { suffix: text(value['nameSuffix']) as string }),
  };
  for (const resource of Array.isArray(value['resources']) ? value['resources'] : []) {
    const written = text(resource);
    if (written !== undefined && /\.ya?ml$/.test(written)) out.set(join(dir, written), given);
  }
  return out;
};

/**
 * Every manifest under a directory, labelled relative to it: plain YAML files
 * that declare a workload or a service object, outside dependencies, build
 * output and hidden directories, and outside `skip` (the directories of the
 * project's services, read on their own).
 */
export const readManifestsUnder = (root: string, skip: ReadonlySet<string> = new Set()): Manifests => {
  const workloads: ManifestWorkload[] = [];
  const services: ManifestService[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const kustomized = kustomizationIn(dir, names);
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIPPED.has(entry.name) || skip.has(path)) continue;
        walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.ya?ml$/.test(entry.name) || KUSTOMIZATIONS.includes(entry.name) || /compose/.test(entry.name)) continue;
      let source: string;
      try {
        source = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      if (!looksLikeManifest(source)) continue;
      const label = relative(root, path).split(sep).join('/');
      const read = readManifest(source, label, kustomized.get(path) ?? {});
      workloads.push(...read.workloads);
      services.push(...read.services);
    }
  };
  walk(root, 0);
  return { workloads, services };
};
