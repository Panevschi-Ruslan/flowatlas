import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  keptValue,
  localHostsOf,
  looksSecret,
  portOf,
  type ContainerRun,
  type HostAlias,
  type PortValue,
  type RepoSettings,
  type ServiceBinding,
  type SettingValue,
} from '@flowatlas/core';
import { readComposeFile, type ComposeService, type Mapping } from './compose.js';
import { readWorkerJson, readWorkerToml, readServerlessFile, type DeploymentSettings } from './deployed.js';
import { readDockerRuns } from './docker-run.js';
import { namesInEnvFile, readEnvFile, type Written } from './dotenv.js';
import { composeEnvironment, envFileEnvironment, envFileReading, environmentName, isComposeFile } from './files.js';

/**
 * Reads what the files at the top of each repository say its settings are
 * (P77), for the linker to complete a base address with.
 *
 * Only the top of a repository, where a project keeps what configures all of
 * it; a file deeper down configures something else. Each kind of file is one
 * entry of `READERS`, keyed by what its name looks like, so a new kind is a new
 * row rather than a new branch. A compose file is the one that is not read in
 * place: the containers it starts belong to whichever services they are built
 * from, which may be other repositories, so those are gathered first and
 * handed out once every repository has been listed.
 */

/** The settings a service listens on, read where a developer's own machine runs it. */
const PORT_SETTINGS = new Set(['PORT', 'APP_PORT', 'HTTP_PORT', 'SERVER_PORT']);

/** What one service's files have said so far. */
interface Gathered {
  values: Map<string, SettingValue[]>;
  namedOnly: Map<string, string[]>;
  hosts: HostAlias[];
  /** The workers its deployment binds it to (P91). */
  bindings: ServiceBinding[];
  /** The names its deployment files deploy it under (P91). */
  deployedAs: string[];
  /** The containers it is run in (P254). */
  containers: ContainerRun[];
  /** The ports its example environment files give a setting (P254). */
  ports: Map<string, PortValue[]>;
}

const gathered = (): Gathered => ({ values: new Map(), namedOnly: new Map(), hosts: [], bindings: [], deployedAs: [], containers: [], ports: new Map() });

/** A port a setting is given, where the setting's name is no secret's: `PORT=3000`. */
const portSetting = ({ name, raw }: Written): number | undefined => (looksSecret(name) ? undefined : portOf(raw));

/** The ports an environment gives a setting, by name. */
const environmentPorts = (written: readonly Written[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const each of written) {
    const port = portSetting(each);
    if (port !== undefined) out[each.name] = port;
  }
  return out;
};

/**
 * A container of a service, and the hosts its port mappings make (P254):
 * each published port at this machine's addresses, the `published` side, and
 * the container's port at each name its network reaches it by, the
 * `container` side.
 */
const addContainer = (into: Gathered, run: ContainerRun): void => {
  into.containers.push(run);
  for (const mapping of run.ports) {
    const mapped = { published: mapping.published, container: mapping.container };
    for (const host of localHostsOf(mapping.published)) into.hosts.push({ host, file: run.file, mapped: { ...mapped, side: 'published' } });
    for (const name of run.names) into.hosts.push({ host: `${name}:${mapping.container}`, file: run.file, mapped: { ...mapped, side: 'container' } });
  }
};

const portsOf = (mappings: readonly Mapping[], file: string) => mappings.map((mapping) => ({ ...mapping, file }));

const add = (into: Gathered, name: string, value: SettingValue): void => {
  const list = into.values.get(name) ?? [];
  if (!list.some((seen) => seen.value === value.value && seen.file === value.file && seen.within === value.within)) list.push(value);
  into.values.set(name, list);
};

const addPort = (into: Gathered, port: number, file: string): void => {
  for (const host of localHostsOf(port)) into.hosts.push({ host, file });
};

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * The values of an environment file, or its names, by what the policy allows
 * of it. A file a container is started with gives that container's
 * environment its ports (`container`), and no port of this machine's.
 */
const readEnv = (into: Gathered, path: string, file: string, container?: Record<string, number>): void => {
  const reading = envFileReading(basename(path));
  if (reading === undefined) return;
  const text = read(path);
  if (text === undefined) return;
  if (reading === 'names') {
    for (const name of namesInEnvFile(text)) into.namedOnly.set(name, [...(into.namedOnly.get(name) ?? []), file]);
    return;
  }
  const environment = envFileEnvironment(basename(path));
  for (const written of readEnvFile(text)) {
    const { name, raw } = written;
    const port = portSetting(written);
    if (port !== undefined && container !== undefined) container[name] ??= port;
    if (port !== undefined && container === undefined) {
      if (PORT_SETTINGS.has(name)) addPort(into, port, file);
      // Any setting's port, for the code that reads it alone (P254).
      const list = into.ports.get(name) ?? [];
      if (!list.some((seen) => seen.port === port && seen.file === file)) list.push({ port, file, ...(environment === undefined ? {} : { environment }) });
      into.ports.set(name, list);
    }
    const value = keptValue(name, raw);
    if (value !== undefined) add(into, name, { value, file, ...(environment === undefined ? {} : { environment }) });
  }
};

/** The containers the scripts of a repository's `package.json` start with `docker run` (P254). */
const readRuns = (into: Gathered, path: string, file: string): void => {
  const text = read(path);
  if (text === undefined || !text.includes('docker')) return;
  for (const run of readDockerRuns(text)) {
    addContainer(into, { name: run.name, names: run.names, file, ports: portsOf(run.mappings, file), environment: environmentPorts(run.environment) });
  }
};

const fromDeployment = (into: Gathered, settings: DeploymentSettings, file: string): void => {
  for (const { name, raw, within, environment } of settings.declared) {
    const value = keptValue(name, raw);
    if (value === undefined) continue;
    add(into, name, {
      value,
      file,
      ...(environment === undefined ? {} : { environment: environmentName(environment) }),
      ...(within === undefined ? {} : { within }),
    });
  }
  for (const port of settings.ports) addPort(into, port, file);
  for (const { binding, service, entrypoint, environment } of settings.bindings ?? []) {
    into.bindings.push({
      binding,
      service,
      file,
      ...(entrypoint === undefined ? {} : { entrypoint }),
      ...(environment === undefined ? {} : { environment: environmentName(environment) }),
    });
  }
  for (const name of settings.names ?? []) if (!into.deployedAs.includes(name)) into.deployedAs.push(name);
};

/** One kind of file at the top of a repository, by its name. */
interface Reader {
  readonly matches: (name: string) => boolean;
  readonly read: (into: Gathered, path: string, file: string) => void;
}

const deploymentReader = (parse: (text: string) => DeploymentSettings) => (into: Gathered, path: string, file: string) => {
  const text = read(path);
  if (text !== undefined) fromDeployment(into, parse(text), file);
};

const READERS: readonly Reader[] = [
  { matches: (name) => envFileReading(name) !== undefined, read: (into, path, file) => readEnv(into, path, file) },
  { matches: (name) => name === 'package.json', read: readRuns },
  { matches: (name) => name === 'serverless.yml' || name === 'serverless.yaml', read: deploymentReader(readServerlessFile) },
  { matches: (name) => name === 'wrangler.json' || name === 'wrangler.jsonc', read: deploymentReader(readWorkerJson) },
  { matches: (name) => name === 'wrangler.toml', read: deploymentReader(readWorkerToml) },
];

/** A compose file found at the top of a repository or beside the configuration. */
interface ComposeFile {
  readonly dir: string;
  /** How a value from it is labelled: relative to the repository or the configuration it was found beside. */
  readonly label: string;
  readonly environment?: string;
  readonly services: readonly ComposeService[];
  /** The service whose repository holds it, when one does. */
  readonly owner?: string;
}

const filesAt = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

/** Whether a path is in a directory or under it. */
const isWithin = (dir: string, path: string): boolean => {
  const rel = relative(dir, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

const realOf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

export interface SettingsInput {
  /** Every service with a repository to look in, by name, with its directory. */
  readonly services: ReadonlyArray<{ readonly name: string; readonly dir: string }>;
  /** The directory the configuration is in, where a compose file for the whole project is kept. */
  readonly rootDir: string;
  /** The environment chosen under `settingFiles.environment`. */
  readonly environment?: string;
}

/**
 * The service a container is, if it is one: the one whose repository it is
 * built from, or else the one with its name. A container neither describes -
 * a database, a cache - is nobody's.
 */
const serviceOfContainer = (
  container: ComposeService,
  file: ComposeFile,
  byDir: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, string>,
): string | undefined => {
  if (container.context !== undefined) {
    const built = byDir.get(realOf(isAbsolute(container.context) ? container.context : join(file.dir, container.context)));
    if (built !== undefined) return built;
  }
  return names.get(container.name.toLowerCase());
};

/** Reads every service's files, and hands out what each compose file says to the service it is about. */
export const readProjectSettings = (input: SettingsInput): Record<string, RepoSettings> => {
  const byService = new Map<string, Gathered>();
  const byDir = new Map<string, string>();
  const names = new Map<string, string>();
  const composeFiles: ComposeFile[] = [];
  const composeAt = (dir: string, label: (name: string) => string, owner?: string): void => {
    for (const name of filesAt(dir).filter(isComposeFile)) {
      const text = read(join(dir, name));
      if (text === undefined) continue;
      const environment = composeEnvironment(name);
      composeFiles.push({
        dir,
        label: label(name),
        services: readComposeFile(text),
        ...(environment === undefined ? {} : { environment }),
        ...(owner === undefined ? {} : { owner }),
      });
    }
  };

  for (const service of input.services) {
    const into = gathered();
    byService.set(service.name, into);
    byDir.set(realOf(service.dir), service.name);
    names.set(service.name.toLowerCase(), service.name);
    for (const name of filesAt(service.dir)) {
      const reader = READERS.find((each) => each.matches(name));
      reader?.read(into, join(service.dir, name), name);
    }
    composeAt(service.dir, (name) => name, service.name);
  }
  if (!byDir.has(realOf(input.rootDir))) composeAt(input.rootDir, (name) => name);

  for (const file of composeFiles) {
    for (const container of file.services) {
      const service = serviceOfContainer(container, file, byDir, names);
      if (service === undefined) continue;
      const into = byService.get(service) as Gathered;
      for (const host of [container.name, ...container.aliases]) into.hosts.push({ host: host.toLowerCase(), file: file.label });
      // A published port with the port inside the container it reaches is a
      // mapping, both of whose sides are hosts (P254); one written alone is
      // still this machine's.
      const environment = environmentPorts(container.environment);
      addContainer(into, {
        name: container.name,
        names: [container.name, ...container.aliases].map((name) => name.toLowerCase()),
        file: file.label,
        ports: portsOf(container.mappings, file.label),
        environment,
      });
      for (const port of container.published) addPort(into, port, file.label);
      for (const { name, raw } of container.environment) {
        const value = keptValue(name, raw);
        if (value === undefined) continue;
        add(into, name, {
          value,
          file: file.label,
          within: container.name,
          ...(file.environment === undefined ? {} : { environment: file.environment }),
        });
      }
      for (const written of container.envFiles) {
        const path = isAbsolute(written) ? written : join(file.dir, written);
        // A file outside the directories this project reads is somebody else's.
        if (![file.dir, input.rootDir].some((dir) => isWithin(dir, path))) continue;
        // `environment:` is written over the file's values, as compose does.
        readEnv(into, path, relative(file.dir, path).split(sep).join('/') || basename(path), environment);
      }
    }
  }

  const chosen = input.environment === undefined ? undefined : environmentName(input.environment);
  const out: Record<string, RepoSettings> = {};
  for (const [service, into] of [...byService.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const values: Record<string, SettingValue[]> = {};
    for (const name of [...into.values.keys()].sort()) {
      const all = into.values.get(name) as SettingValue[];
      // A file for an environment nobody chose says nothing about this one, and
      // where the chosen environment has a value of its own, it is the value.
      const kept =
        chosen === undefined
          ? all
          : all.some((value) => value.environment === chosen)
            ? all.filter((value) => value.environment === chosen)
            : all.filter((value) => value.environment === undefined);
      if (kept.length > 0) values[name] = kept;
    }
    const namedOnly: Record<string, string[]> = {};
    for (const name of [...into.namedOnly.keys()].sort()) namedOnly[name] = [...new Set(into.namedOnly.get(name))].sort();
    const seen = new Set<string>();
    const hosts = into.hosts.filter((alias) => {
      const key = `${alias.host}\0${alias.file}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // A binding for an environment nobody chose says nothing about this one,
    // as a value does; where the chosen one declares the binding, it is the binding.
    const bindings = into.bindings.filter((each) => {
      if (chosen === undefined) return true;
      const forChosen = into.bindings.some((other) => other.binding === each.binding && other.environment === chosen);
      return forChosen ? each.environment === chosen : each.environment === undefined;
    });
    const deployedAs = [...into.deployedAs].sort();
    // A port an environment's file gives is chosen as a value is.
    const ports: Record<string, PortValue[]> = {};
    for (const name of [...into.ports.keys()].sort()) {
      const all = into.ports.get(name) as PortValue[];
      const kept =
        chosen === undefined
          ? all
          : all.some((value) => value.environment === chosen)
            ? all.filter((value) => value.environment === chosen)
            : all.filter((value) => value.environment === undefined);
      if (kept.length > 0) ports[name] = kept;
    }
    const containers = into.containers;
    const sizes = [Object.keys(values), Object.keys(namedOnly), hosts, bindings, deployedAs, containers, Object.keys(ports)];
    if (sizes.every((each) => each.length === 0)) continue;
    out[service] = {
      values,
      namedOnly,
      hosts,
      ...(bindings.length === 0 ? {} : { bindings }),
      ...(deployedAs.length === 0 ? {} : { deployedAs }),
      ...(containers.length === 0 ? {} : { containers }),
      ...(Object.keys(ports).length === 0 ? {} : { ports }),
    };
  }
  return out;
};
