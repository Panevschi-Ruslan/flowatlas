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

/** `"3001:3000"`, `"127.0.0.1:3001:3000/tcp"`, `{ published: 3001 }`; a bare container port publishes nothing fixed. */
const publishedOf = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    if (isRecord(item)) {
      const port = Number(scalar(item['published']));
      if (Number.isInteger(port) && port > 0) out.push(port);
      continue;
    }
    const text = scalar(item);
    if (text === undefined) continue;
    const parts = text.replace(/\/\w+$/, '').split(':');
    if (parts.length < 2) continue;
    const port = Number(parts[parts.length - 2]);
    if (Number.isInteger(port) && port > 0) out.push(port);
  }
  return out;
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
    return [
      {
        name,
        aliases: [...new Set(aliases)],
        ...(context === undefined ? {} : { context }),
        published: publishedOf(value['ports']),
        environment: environmentOf(value['environment']),
        envFiles: listOf(value['env_file']),
      },
    ];
  });
};
