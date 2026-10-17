import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { FlowatlasError } from './errors.js';

/**
 * Which ref of each service runs in each environment (P117).
 *
 * A file the team commits beside its configuration, like the baseline:
 *
 *   {
 *     deployedFormatVersion: 1,
 *     environments: { prod: { orders: "v1.8.0", billing: "4f1c2a9" } }
 *   }
 *
 * A ref is anything `git rev-parse` resolves in that service's repository: a
 * tag, a branch, a sha. A service missing from an environment is not deployed
 * there. Nothing here asks a running system what it runs: the pipeline that
 * deploys knows, and says so with this file, `--pin` or `FLOWATLAS_PIN_*`.
 */
export const DEPLOYED_FILE = 'flowatlas.deployed.json';
export const DEPLOYED_FORMAT_VERSION = 1;

/** An environment's name: what `--env` takes and `check.<env>.json` is named by. */
const ENVIRONMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const refSchema = z.string().min(1).refine((ref) => !/\s/.test(ref), 'a ref has no spaces');

export const deployedSchema = z.strictObject({
  deployedFormatVersion: z.literal(DEPLOYED_FORMAT_VERSION),
  environments: z.record(
    z.string().regex(ENVIRONMENT_NAME, 'an environment is named with letters, digits, ".", "_" and "-"'),
    z.record(z.string().min(1), refSchema),
  ),
});

export type Deployed = z.infer<typeof deployedSchema>;

/** Where a pin came from, in the order a later one wins. */
export const PIN_SOURCES = ['file', 'env', 'flag'] as const;
export type PinSource = (typeof PIN_SOURCES)[number];

/** One service's ref in one environment, and who said so. */
export interface Pin {
  service: string;
  ref: string;
  from: PinSource;
  /** The ref a later source replaced, said in the header (§10). */
  replaced?: { ref: string; from: PinSource };
}

/** A pins file that cannot be used: unreadable, the wrong shape, or naming a service nobody configured. */
export class DeployedInvalidError extends FlowatlasError {
  readonly issues: readonly string[];

  constructor(path: string, issues: readonly string[]) {
    super(
      'deployed-invalid',
      `Invalid pins file ${path}:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
      'Fix the file, or record a deployment with `flowatlas deployed set <env> <service> <ref>`.',
    );
    this.issues = issues;
  }
}

/** An empty pins file, the one `deployed set` starts from. */
export const emptyDeployed = (): Deployed => ({ deployedFormatVersion: DEPLOYED_FORMAT_VERSION, environments: {} });

/**
 * A pins document checked against the schema and the configured services.
 *
 * An unknown service is refused rather than skipped: a typo in a pins file
 * read as "not deployed" would check a project nobody runs.
 */
export const parseDeployed = (value: unknown, services: readonly string[], path = DEPLOYED_FILE): Deployed => {
  const parsed = deployedSchema.safeParse(value);
  if (!parsed.success) {
    throw new DeployedInvalidError(
      path,
      parsed.error.issues.map((issue) => `${issue.path.length === 0 ? '(top)' : issue.path.join('.')}: ${issue.message}`),
    );
  }
  const known = new Set(services);
  const unknown = Object.entries(parsed.data.environments).flatMap(([environment, pins]) =>
    Object.keys(pins)
      .filter((service) => !known.has(service))
      .map((service) => `environments.${environment}.${service}: no service named ${JSON.stringify(service)} (known: ${[...known].sort().join(', ')})`),
  );
  if (unknown.length > 0) throw new DeployedInvalidError(path, unknown);
  return parsed.data;
};

/** The pins file a run reads: `--pins`, else `deployed.file`, else beside the configuration. */
export const deployedPathOf = (rootDir: string, configured?: string, given?: string): string => {
  const path = given ?? configured ?? DEPLOYED_FILE;
  return isAbsolute(path) ? path : given === undefined ? resolve(rootDir, path) : resolve(path);
};

/** The pins file at `path`, or null when there is none. A file that is there and wrong is an error, never "none". */
export const loadDeployed = (path: string, services: readonly string[]): Deployed | null => {
  if (!existsSync(path)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new DeployedInvalidError(path, [`not JSON: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
  return parseDeployed(value, services, path);
};

/** One environment's pin of one service set to `ref`, everything else kept. Pure. */
export const withPin = (deployed: Deployed, environment: string, service: string, ref: string): Deployed => ({
  ...deployed,
  environments: {
    ...deployed.environments,
    [environment]: { ...(deployed.environments[environment] ?? {}), [service]: ref },
  },
});

/** Writes the pins file whole, through a temporary, so a reader never sees half of it. */
export const writeDeployed = (path: string, deployed: Deployed): void => {
  const checked = deployedSchema.parse(deployed);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(checked, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
};

/** `FLOWATLAS_PIN_<SERVICE>`: the name upper-cased, every character that is not a letter or digit `_`. */
export const pinEnvName = (service: string): string => `FLOWATLAS_PIN_${service.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

/**
 * `--pin orders=v1.8.0`, read. A flag without `=`, or naming a service nobody
 * configured, is refused by the caller with the sentence this returns.
 */
export const parsePinFlags = (
  flags: readonly string[],
  services: readonly string[],
): { pins: Record<string, string>; problems: string[] } => {
  const known = new Set(services);
  const pins: Record<string, string> = {};
  const problems: string[] = [];
  for (const flag of flags) {
    const at = flag.indexOf('=');
    const service = at < 0 ? '' : flag.slice(0, at).trim();
    const ref = at < 0 ? '' : flag.slice(at + 1).trim();
    if (service === '' || ref === '' || /\s/.test(ref)) problems.push(`--pin ${JSON.stringify(flag)} is not <service>=<ref>`);
    else if (!known.has(service)) problems.push(`--pin ${JSON.stringify(flag)}: no service named ${JSON.stringify(service)}`);
    else pins[service] = ref;
  }
  return { pins, problems };
};

/** The pins `FLOWATLAS_PIN_*` sets for the configured services. */
export const pinsFromEnv = (env: Readonly<Record<string, string | undefined>>, services: readonly string[]): Record<string, string> => {
  const pins: Record<string, string> = {};
  for (const service of services) {
    const ref = env[pinEnvName(service)]?.trim();
    if (ref !== undefined && ref !== '') pins[service] = ref;
  }
  return pins;
};

/**
 * One environment's pins, from the file and then the overrides: an
 * environment variable over the file, a flag over both, each replacement
 * remembered so the header can say whose ref was used (§10). `known` is false
 * when nothing at all named this environment, which the caller refuses.
 */
export const pinsFor = (
  deployed: Deployed | null,
  environment: string,
  overrides: { env?: Readonly<Record<string, string>>; flags?: Readonly<Record<string, string>> } = {},
): { pins: Pin[]; known: boolean } => {
  const fromFile = deployed?.environments[environment];
  const pins = new Map<string, Pin>();
  for (const [service, ref] of Object.entries(fromFile ?? {})) pins.set(service, { service, ref, from: 'file' });
  const lay = (given: Readonly<Record<string, string>> | undefined, from: PinSource): void => {
    for (const [service, ref] of Object.entries(given ?? {})) {
      const held = pins.get(service);
      pins.set(service, {
        service,
        ref,
        from,
        ...(held === undefined || held.ref === ref ? {} : { replaced: { ref: held.ref, from: held.from } }),
      });
    }
  };
  lay(overrides.env, 'env');
  lay(overrides.flags, 'flag');
  return {
    pins: [...pins.values()].sort((a, b) => (a.service < b.service ? -1 : a.service > b.service ? 1 : 0)),
    known: fromFile !== undefined || pins.size > 0,
  };
};
