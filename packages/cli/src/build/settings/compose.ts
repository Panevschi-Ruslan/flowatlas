import { parse } from 'yaml';
import type { Written } from './dotenv.js';

/**
 * One container a compose file starts, as far as an address is concerned:
 * what it is called on the network, which directory it is built from, the
 * ports it publishes, and the environment it is started with.
 */
export interface ComposeService {
  /** Its key under `services:`. */
  readonly name: string;
  /** Every other name it answers to on the network: `container_name`, `hostname`, network aliases. */
  readonly aliases: readonly string[];
  /** The directory it is built from, as written, relative to the file. */
  readonly context?: string;
  /** Ports published on the machine running it. */
  readonly published: readonly number[];
  /** Each published port with the port inside the container it reaches, and the line it is written on (P254). */
  readonly mappings: readonly Mapping[];
  /** The environment it is started with, `${VAR:-default}` read as its default. */
  readonly environment: readonly Written[];
  /** Environment files it is started with, as written, relative to the file. */
  readonly envFiles: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const scalar = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;

/**
 * A value as the container is given it, where the file settles it.
 *
 * Compose fills `${VAR}` from the shell it is run in, which is nobody's to
 * know here; `${VAR:-default}` and `${VAR-default}` are read as their default,
 * and `$$` as one `$`. A value with any other placeholder is not settled.
 */
export const interpolated = (raw: string): string | undefined => {
  let unsettled = false;
  const out = raw.replace(/\$\$|\$\{([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced: string | undefined) => {
    if (match === '$$') return '$';
    const fallback = braced === undefined ? undefined : /^[A-Za-z_][A-Za-z0-9_]*:?-(.*)$/.exec(braced)?.[1];
    if (fallback === undefined) unsettled = true;
    return fallback ?? '';
  });
  return unsettled ? undefined : out;
};

/** `KEY=value` items, or a mapping of them. */
const environmentOf = (value: unknown): Written[] => {
  const out: Written[] = [];
  const push = (name: string, raw: string | undefined): void => {
    if (raw === undefined) return;
    const settled = interpolated(raw);
    if (settled !== undefined && settled !== '') out.push({ name, raw: settled });
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = scalar(item);
      if (text === undefined) continue;
      const equals = text.indexOf('=');
      if (equals > 0) push(text.slice(0, equals).trim(), text.slice(equals + 1));
    }
  } else if (isRecord(value)) {
    for (const [name, raw] of Object.entries(value)) push(name, scalar(raw));
  }
  return out;
};

/** A port published on the machine, the port inside the container it reaches, and where it is written (P254). */
export interface Mapping {
  readonly published: number;
  readonly container: number;
  readonly line: number;
}

const portNumber = (value: string | undefined): number | undefined => {
  const port = Number(value);
  return value !== undefined && /^\d+$/.test(value.trim()) && port > 0 && port < 65536 ? port : undefined;
};

/** The line an offset of a text is on. */
const lineAt = (text: string, offset: number): number => (offset < 0 ? 1 : text.slice(0, offset).split('\n').length);

/**
 * `"3001:3000"`, `"127.0.0.1:3001:3000/tcp"`, `{ published: 3001, target: 3000 }`:
 * both sides of each mapping, and its line, looked for after `from` (where the
 * container is written). A bare container port publishes nothing fixed, and a
 * range is not one port.
 */
const mappingsOf = (value: unknown, text: string, from: number): Mapping[] => {
  if (!Array.isArray(value)) return [];
  const out: Mapping[] = [];
  for (const item of value) {
    if (isRecord(item)) {
      const published = portNumber(scalar(item['published']));
      const container = portNumber(scalar(item['target']));
      if (published === undefined) continue;
      const at = new RegExp(`published\\s*:\\s*['"]?${published}\\b`).exec(text.slice(from));
      out.push({ published, container: container ?? published, line: lineAt(text, at === null ? -1 : from + at.index) });
      continue;
    }
    const written = scalar(item);
    if (written === undefined) continue;
    const parts = written.replace(/\/\w+$/, '').split(':');
    if (parts.length < 2) continue;
    const published = portNumber(parts[parts.length - 2]);
    const container = portNumber(parts[parts.length - 1]);
    if (published === undefined || container === undefined) continue;
    out.push({ published, container, line: lineAt(text, text.indexOf(written, from)) });
  }
  return out;
};

/** Where a container's key is written under `services:`, so its own lines are found after it. */
const keyAt = (text: string, name: string): number => {
  const at = new RegExp(`^\\s+['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*:`, 'm').exec(text);
  return at === null ? 0 : at.index;
};

const listOf = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    const path = isRecord(item) ? scalar(item['path']) : undefined;
    return path === undefined ? [] : [path];
  });
};

/** Network aliases, under any network. */
const aliasesOf = (networks: unknown): string[] =>
  isRecord(networks)
    ? Object.values(networks).flatMap((network) => (isRecord(network) ? listOf(network['aliases']) : []))
    : [];

/** The containers a compose file starts. Nothing for a file that is not one. */
export const readComposeFile = (text: string): ComposeService[] => {
  let document: unknown;
  try {
    document = parse(text, { logLevel: 'silent', merge: true });
  } catch {
    return [];
  }
  const services = isRecord(document) ? document['services'] : undefined;
  if (!isRecord(services)) return [];
  return Object.entries(services).flatMap(([name, value]) => {
    if (!isRecord(value)) return [];
    const build = value['build'];
    const context = typeof build === 'string' ? build : isRecord(build) ? scalar(build['context']) : undefined;
    const aliases = [scalar(value['container_name']), scalar(value['hostname']), ...aliasesOf(value['networks'])]
      .filter((alias): alias is string => alias !== undefined && alias !== '' && alias !== name);
    const mappings = mappingsOf(value['ports'], text, keyAt(text, name));
    return [
      {
        name,
        aliases: [...new Set(aliases)],
        ...(context === undefined ? {} : { context }),
        published: [...new Set(mappings.map((mapping) => mapping.published))],
        mappings,
        environment: environmentOf(value['environment']),
        envFiles: listOf(value['env_file']),
      },
    ];
  });
};
