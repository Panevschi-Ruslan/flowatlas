import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readServiceYaml } from '@flowatlas/serverless';
import { readToml, TomlUnreadable } from './toml.js';

/**
 * What a SAM template is deployed with, as `samconfig.toml` (or the newer
 * `samconfig.yaml`) beside it writes it (P246), and as the options of a
 * service override it: the stack's name and region, and a value for each
 * parameter, `sam deploy --parameter-overrides` written down.
 *
 * The file holds one table per environment (`[default]`, `[prod]`) and, in
 * each, one per command (`global`, `build`, `deploy`, `sync`); the reader takes
 * the environment `services[].infra.options.config_env` names, else
 * `default`, `global` under `deploy`. Nothing here asks the account: a value
 * neither the file nor the options give is not known, and the parameter's own
 * `Default` is what the template says.
 */

/** The names the CLI looks for, in its order. */
export const CONFIG_FILES = ['samconfig.toml', 'samconfig.yaml', 'samconfig.yml'];

/** The names `sam` looks for a template under, in its order, where its `samconfig` names none. */
export const TEMPLATE_FILES = ['template.yaml', 'template.yml', 'template.json'];

/** The environment the CLI reads when none is named. */
export const DEFAULT_CONFIG_ENV = 'default';

export interface DeployConfig {
  /** Repo-relative path of the file read, when one was. */
  readonly file?: string;
  readonly stackName?: string;
  readonly region?: string;
  /** The template the file names, relative to its directory, when it names one. */
  readonly template?: string;
  /** A value per parameter, from the file's `parameter_overrides` and then the options. */
  readonly parameters: Readonly<Record<string, string>>;
  /** Where each value came from: `samconfig.toml` or the options. */
  readonly from: Readonly<Record<string, 'file' | 'option'>>;
  /** Why the file is not read, when it is there and is not. */
  readonly unreadable?: { readonly message: string; readonly line: number };
}

/** Options that are not parameters: what the CLI is run with besides them. */
const OWN_OPTIONS = new Set(['config_env', 'stack_name', 'region']);

const isTable = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `Stage=prod Prefix="shop prod"`, or the same as a list of pairs: what
 * `--parameter-overrides` takes, split where the CLI splits it.
 */
export const parameterOverrides = (written: unknown): Record<string, string> => {
  const pairs: string[] = [];
  const texts = Array.isArray(written) ? written.filter((item): item is string => typeof item === 'string') : typeof written === 'string' ? [written] : [];
  for (const text of texts) {
    for (const match of text.matchAll(/([A-Za-z0-9]+)=("((?:[^"\\]|\\.)*)"|'([^']*)'|(\S*))/g)) {
      const value = match[3] !== undefined ? match[3].replace(/\\(.)/g, '$1') : (match[4] ?? match[5] ?? '');
      pairs.push(`${match[1] as string}\u0000${value}`);
    }
  }
  return Object.fromEntries(pairs.map((pair) => pair.split('\u0000') as [string, string]));
};

const readConfigFile = (path: string): Record<string, unknown> => {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.toml')) return readToml(text);
  const value = readServiceYaml(text).value;
  return isTable(value) ? value : {};
};

/**
 * What the deployment of the template in `dir` is run with: the `samconfig`
 * there and the options, or the options alone where `withFile` is false - a
 * template the file beside it is not written for (P248).
 */
export const deployConfigOf = (repoDir: string, dir: string, options: Readonly<Record<string, string>>, withFile = true): DeployConfig => {
  const environment = options['config_env'] ?? DEFAULT_CONFIG_ENV;
  let file: string | undefined;
  let document: Record<string, unknown> = {};
  let unreadable: DeployConfig['unreadable'];
  for (const name of withFile ? CONFIG_FILES : []) {
    const relative = dir === '.' ? name : `${dir}/${name}`;
    try {
      document = readConfigFile(join(repoDir, relative));
      file = relative;
      break;
    } catch (cause) {
      if ((cause as { code?: string }).code === 'ENOENT') continue;
      file = relative;
      unreadable = { message: cause instanceof Error ? cause.message : String(cause), line: cause instanceof TomlUnreadable ? cause.line : 1 };
      break;
    }
  }
  const env = isTable(document[environment]) ? document[environment] : {};
  const section = (command: string): Record<string, unknown> => {
    const table = env[command];
    return isTable(table) && isTable(table['parameters']) ? table['parameters'] : {};
  };
  // `deploy` over `global`, as the CLI reads them for a deployment.
  const settings = { ...section('global'), ...section('build'), ...section('deploy') };
  const text = (key: string): string | undefined => (typeof settings[key] === 'string' ? (settings[key] as string) : undefined);
  const fromFile = parameterOverrides(settings['parameter_overrides']);
  const fromOptions = Object.fromEntries(Object.entries(options).filter(([key]) => !OWN_OPTIONS.has(key)));
  const stackName = options['stack_name'] ?? text('stack_name');
  const region = options['region'] ?? text('region');
  const template = text('template_file') ?? text('template');
  return {
    ...(file === undefined ? {} : { file }),
    ...(stackName === undefined ? {} : { stackName }),
    ...(region === undefined ? {} : { region }),
    ...(template === undefined ? {} : { template }),
    parameters: { ...fromFile, ...fromOptions },
    from: {
      ...Object.fromEntries(Object.keys(fromFile).map((key) => [key, 'file' as const])),
      ...Object.fromEntries(Object.keys(fromOptions).map((key) => [key, 'option' as const])),
    },
    ...(unreadable === undefined ? {} : { unreadable }),
  };
};
