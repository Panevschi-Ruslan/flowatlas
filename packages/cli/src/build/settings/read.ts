import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import {
  interpolationValue,
  keptValue,
  localHostsOf,
  looksSecret,
  portOf,
  proxyRule,
  type ContainerRun,
  type HostAlias,
  type ImageUnread,
  type IngressRoute,
  type PortValue,
  type ProxyRule,
  type RepoSettings,
  type RoutedName,
  type RoutedPort,
  type SecretSource,
  type ServiceBinding,
  type SettingValue,
  type Unresolved,
  workspacePackages,
  workspaceRootOf,
  packageSpecifierParts,
  workspaceMemberEntries,
} from '@flowatlas/core';
import { composeIncludes, readComposeFile, type ComposeLoader, type ComposeService, type Mapping } from './compose.js';
import { readWorkerJson, readWorkerToml, readServerlessFile, type DeploymentSettings } from './deployed.js';
import {
  readManifestsUnder,
  type ChartInstall,
  type ManifestChoice,
  type ManifestContainer,
  type ManifestPath,
  type ManifestRow,
  type ManifestService,
  type ManifestServicePort,
  type ManifestWorkload,
  type Manifests,
} from './cluster.js';
import { commandsAround, commandsOfPackageScript, commandsOfShellScript, type Command } from '@flowatlas/serverless';
import { composeRunsOf, dockerBuildsOf, dockerRunsOf, imageName, isStartingScript, serverStartsOf, type WorkspaceSelection, type ComposeRunAt, type ServerStart, readHelmfileRuns, readHelmInstalls, readKustomizeApplies, readPortForwards, type PortForward } from './docker-run.js';
import { dockerfileEnvironment } from './dockerfile.js';
import { readSkaffoldFile } from './skaffold.js';
import { helmfilesAt, helmfilesIn, readHelmfile } from './helmfile.js';
import { namesInEnvFile, readEnvFile, type Written } from './dotenv.js';
import { angularEnvironmentsOf } from './angular-environments.js';
import { composeEnvironment, envFileEnvironment, envFileReading, environmentName, isComposeFile, isExampleEnvFile } from './files.js';

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
  /** The names a cluster's network routes to its containers (P257). */
  routes: RoutedName[];
  /** The ways in from outside a cluster that reach it (P260). */
  ingress: IngressRoute[];
  /** What its manifests write that is not read (P260). */
  rows: Unresolved[];
}

const gathered = (): Gathered => ({ values: new Map(), namedOnly: new Map(), hosts: [], bindings: [], deployedAs: [], containers: [], ports: new Map(), routes: [], ingress: [], rows: [] });

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

/**
 * A name a cluster's network routes to the service's containers, and the
 * hosts it makes (P257): each spelling of the name alone, as a container's
 * name is a host, and at each port it routes, the `routed` side.
 */
const addRouted = (into: Gathered, routed: RoutedName): void => {
  into.routes.push(routed);
  for (const name of routed.names) into.hosts.push({ host: name, file: routed.file });
  for (const port of routed.ports) {
    for (const name of routed.names) {
      into.hosts.push({ host: `${name}:${port.port}`, file: routed.file, mapped: { published: port.port, container: port.target, side: 'routed' } });
    }
  }
};

const add = (into: Gathered, name: string, value: SettingValue): void => {
  const list = into.values.get(name) ?? [];
  if (!list.some((seen) => seen.value === value.value && seen.file === value.file && seen.within === value.within)) list.push(value);
  into.values.set(name, list);
};

/**
 * The hosts on this machine a port places the service at. An environment
 * file's is an example's offer (P309), or a file's whose value a run has only
 * where something loads it (P331), which the linker settles against what the
 * code is read loading.
 */
const addPort = (into: Gathered, port: number, file: string, from?: 'example' | 'environment-file'): void => {
  const how = from === 'example' ? { example: true as const } : from === 'environment-file' ? { environmentFile: true as const } : {};
  for (const host of localHostsOf(port)) into.hosts.push({ host, file, ...how });
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
 * environment its ports (`container`), and no port of this machine's: the
 * container is started with the file whatever it is called, so the port a
 * setting whose name is no secret's is given there is read even where the
 * file's other values are kept unread (P325).
 */
const readEnv = (into: Gathered, path: string, file: string, container?: Record<string, number>): void => {
  const reading = envFileReading(basename(path));
  if (reading === undefined && container === undefined) return;
  const text = read(path);
  if (text === undefined) return;
  if (reading !== 'values') {
    if (reading === 'names') for (const name of namesInEnvFile(text)) into.namedOnly.set(name, [...(into.namedOnly.get(name) ?? []), file]);
    if (container !== undefined) {
      for (const written of readEnvFile(text)) {
        const port = portSetting(written);
        if (port !== undefined) container[written.name] = port;
      }
    }
    return;
  }
  const environment = envFileEnvironment(basename(path));
  // An example's port is offered, not given (P309).
  const example = isExampleEnvFile(basename(path));
  for (const written of readEnvFile(text)) {
    const { name, raw } = written;
    const port = portSetting(written);
    if (port !== undefined && container !== undefined) container[name] = port;
    if (port !== undefined && container === undefined) {
      if (PORT_SETTINGS.has(name)) addPort(into, port, file, example ? 'example' : 'environment-file');
      // Any setting's port, for the code that reads it alone (P254).
      const list = into.ports.get(name) ?? [];
      if (!list.some((seen) => seen.port === port && seen.file === file)) {
        list.push({ port, file, ...(environment === undefined ? {} : { environment }), ...(example ? { example: true as const } : {}) });
      }
      into.ports.set(name, list);
    }
    const value = keptValue(name, raw);
    if (value !== undefined) add(into, name, { value, file, ...(environment === undefined ? {} : { environment }) });
  }
};

/**
 * What the environment files at the top of the workspace a service is a
 * package of say (P283), for the settings the service's own files do not:
 * a monorepo keeps one `.env.example` at its root for all of its packages,
 * and its build reads it from there (`envDir`, `dotenv -e ../../.env`). The
 * nearer file is the one that counts, as for dotenv itself, so a value from
 * the root never stands beside one the package gives. Only the values and
 * the names: a port written there is any package's, not this one's own.
 */
const readWorkspaceEnv = (into: Gathered, dir: string): void => {
  const root = workspaceRootOf(dir);
  if (root === undefined || realOf(root) === realOf(dir)) return;
  const shared = gathered();
  for (const name of filesAt(root).filter((each) => envFileReading(each) !== undefined)) {
    readEnv(shared, join(root, name), relative(dir, join(root, name)).split(sep).join('/'));
  }
  for (const [name, values] of shared.values) if (!into.values.has(name)) into.values.set(name, values);
  for (const [name, files] of shared.namedOnly) if (!into.values.has(name) && !into.namedOnly.has(name)) into.namedOnly.set(name, files);
};

/**
 * A container's environment as it is put together (P325): layers written
 * one over another, each setting naming the file its port is from where
 * that is not the file that starts the container.
 */
const containerEnvironment = (): {
  readonly layer: (ports: Readonly<Record<string, number>>, from?: string | Readonly<Record<string, string>>) => void;
  /** Settings a `Secret` gives, over every layer before: given, their values never read (P337). */
  readonly secret: (names: readonly string[], sources?: Readonly<Record<string, SecretSource>>) => void;
  readonly done: () => Pick<ContainerRun, 'environment' | 'environmentFiles' | 'environmentSecret' | 'environmentSecretFrom'>;
} => {
  const environment: Record<string, number> = {};
  const environmentFiles: Record<string, string> = {};
  const secret = new Set<string>();
  // Which Secret and key each is from, said so a reader knows where to look (P343).
  const secretFrom: Record<string, SecretSource> = {};
  return {
    layer: (ports, from) => {
      for (const [name, port] of Object.entries(ports)) {
        environment[name] = port;
        secret.delete(name);
        delete secretFrom[name];
        // One file for the layer, or each setting's own (P337).
        const file = typeof from === 'string' ? from : from?.[name];
        if (file === undefined) delete environmentFiles[name];
        else environmentFiles[name] = file;
      }
    },
    secret: (names, sources) => {
      for (const name of names) {
        delete environment[name];
        delete environmentFiles[name];
        secret.add(name);
        const source = sources?.[name];
        if (source === undefined) delete secretFrom[name];
        else secretFrom[name] = source;
      }
    },
    done: () => ({
      environment,
      ...(Object.keys(environmentFiles).length === 0 ? {} : { environmentFiles }),
      ...(secret.size === 0 ? {} : { environmentSecret: [...secret].sort() }),
      ...(Object.keys(secretFrom).length === 0 ? {} : { environmentSecretFrom: Object.fromEntries(Object.entries(secretFrom).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) }),
    }),
  };
};

/** How an image is built: its Dockerfile, read from disk or written inline, the stage built and the arguments handed it (P325). */
interface ImageBuild {
  /** The Dockerfile's path, absolute, where it is a file. */
  readonly path?: string;
  readonly inline?: string;
  readonly target?: string;
  readonly args: Readonly<Record<string, string>>;
}

/** The ports an image's Dockerfile gives a setting (P325), nothing where it cannot be read. */
const imagePorts = (build: ImageBuild): Record<string, number> | undefined => {
  const text = build.inline ?? (build.path === undefined ? undefined : read(build.path));
  if (text === undefined) return undefined;
  const written = dockerfileEnvironment(text, { ...(build.target === undefined ? {} : { target: build.target }), args: build.args });
  return written === undefined ? undefined : environmentPorts(written);
};

/** A path as a row names it: from the service's directory where it is inside it, else from the project's. */
const labelOf = (path: string, dir: string, rootDir: string): string =>
  (isWithin(dir, path) ? relative(dir, path) : relative(rootDir, path)).split(sep).join('/') || basename(path);

/** An image the project builds, by the names it is tagged with (P325, P331). */
interface BuiltImage extends ImageBuild {
  readonly names: readonly string[];
}

/** Every image the commands of the project build with `docker build -t` (P325), its Dockerfile where the files settle it. */
const builtImages = (scripts: readonly Commands[], rootDir: string): BuiltImage[] =>
  scripts.flatMap((each) =>
    dockerBuildsOf(each.commands).flatMap((build) => {
      // A command after a `cd` nobody settles runs nowhere the files say.
      if (build.dirs !== undefined && build.dirs.length === 0) return [];
      const dir = resolve(each.base, build.dirs?.[0] ?? '.');
      const path = build.dockerfile === undefined ? join(resolve(dir, build.context), 'Dockerfile') : resolve(dir, build.dockerfile);
      // A file outside the directories this project reads is somebody else's.
      if (![each.base, rootDir].some((within) => isWithin(within, path))) return [];
      return [{ names: build.names, path, ...(build.target === undefined ? {} : { target: build.target }), args: build.args }];
    }),
  );

/** The names Skaffold looks for its configuration under. */
const SKAFFOLD_FILES = ['skaffold.yaml', 'skaffold.yml'];

/**
 * Every image a Skaffold configuration at the top of a directory builds with
 * Docker (P331), its Dockerfile resolved from the artifact's context.
 */
const skaffoldImages = (dir: string): BuiltImage[] =>
  SKAFFOLD_FILES.flatMap((name) => {
    const text = read(join(dir, name));
    if (text === undefined) return [];
    return readSkaffoldFile(text).flatMap((artifact) => {
      const path = resolve(resolve(dir, artifact.context), artifact.dockerfile);
      // A file outside the directory the configuration is in is somebody else's.
      if (!isWithin(dir, path)) return [];
      return [{ names: [artifact.name], path, ...(artifact.target === undefined ? {} : { target: artifact.target }), args: artifact.args }];
    });
  });

/** What the image a container runs gives its environment: the ports of its Dockerfile and the file they are from, or why it is not read (P331). */
type ImageReading = { readonly ports: Record<string, number>; readonly path?: string } | { readonly unread: ImageUnread };

/**
 * The environment the image a container runs gives it (P325, P331): the
 * Dockerfile of a build of the project that tags the image with its name -
 * a `docker build -t`, a compose service's `build:` under its `image:`, a
 * Skaffold artifact - the first one read. An image nothing of the project
 * builds is pulled as it is, and its environment is not read; nor is one
 * whose Dockerfile is not in the project.
 */
const imageReading = (written: string, images: readonly BuiltImage[]): ImageReading => {
  const name = imageName(written);
  const builds = images.filter((image) => image.names.includes(name));
  if (builds.length === 0) return { unread: { image: written, why: 'nothing in the project builds it, and an image is never fetched' } };
  for (const build of builds) {
    const ports = imagePorts(build);
    if (ports !== undefined) return { ports, ...(build.path === undefined ? {} : { path: build.path }) };
  }
  return { unread: { image: written, why: 'the Dockerfile the project builds it from is not found' } };
};

/**
 * The containers the commands of a repository start with `docker run`: its
 * `package.json` scripts (P254), its shell scripts and Makefiles (P257), read
 * by the one command reader (P263). The environment is the image's, where a
 * build of the project tags it, under each `--env-file`, under each `-e`
 * (P325); an image nothing of the project builds is said to be unread (P331).
 */
const readRuns = (into: Gathered, commands: readonly Command[], base: string, rootDir: string, images: readonly BuiltImage[]): void => {
  for (const run of dockerRunsOf(commands)) {
    const environment = containerEnvironment();
    const image = run.image === undefined ? undefined : imageReading(run.image, images);
    if (image !== undefined && 'ports' in image) environment.layer(image.ports, image.path === undefined ? undefined : labelOf(image.path, base, rootDir));
    if (run.dirs === undefined || run.dirs.length > 0) {
      const dir = resolve(base, run.dirs?.[0] ?? '.');
      for (const written of run.envFiles) {
        const path = resolve(dir, written);
        // A file outside the directories this project reads is somebody else's.
        if (![base, rootDir].some((each) => isWithin(each, path))) continue;
        const ports: Record<string, number> = {};
        const label = labelOf(path, base, rootDir);
        readEnv(into, path, label, ports);
        environment.layer(ports, label);
      }
    }
    environment.layer(environmentPorts(run.environment));
    const unread = image !== undefined && 'unread' in image ? { imageUnread: image.unread } : {};
    addContainer(into, { name: run.name, names: run.names, file: run.file, ports: portsOf(run.mappings, run.file), ...environment.done(), ...unread });
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

/**
 * What one environment file lends a compose file's interpolation (P325,
 * P331), or nothing where it cannot be read: of each setting whose name is no
 * secret's, a port, an address or a host's name, which is all the graph keeps
 * of a value; a file whose values are otherwise never read (`.env`, P77)
 * gives nothing more.
 */
const variablesIn = (path: string): Record<string, string> | undefined => {
  const text = read(path);
  if (text === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const { name, raw } of readEnvFile(text)) {
    const value = interpolationValue(name, raw);
    if (value !== undefined) out[name] = value;
  }
  return out;
};

/** What several environment files lend an interpolation, a later over an earlier, each within the directories this project reads. */
const variablesOfFiles = (paths: readonly string[], within: readonly string[]): Record<string, string> => {
  const merged: Record<string, string> = {};
  for (const path of paths) {
    // A file outside the directories this project reads is somebody else's.
    if (!within.some((dir) => isWithin(dir, path))) continue;
    Object.assign(merged, variablesIn(path) ?? {});
  }
  return merged;
};

/**
 * What compose interpolates a file with where no command names environment
 * files (P325, P337): the `.env` of its project directory, or, where that
 * `.env` names `COMPOSE_ENV_FILES`, those files in its place - the one value
 * of a names-only file read as written, since it names files, not a setting
 * of the application.
 */
const dotEnvVariables = (dir: string, within: readonly string[]): Record<string, string> => {
  const text = read(join(dir, '.env'));
  const named = text === undefined ? undefined : readEnvFile(text).find((each) => each.name === 'COMPOSE_ENV_FILES')?.raw;
  if (named === undefined || named.includes('$')) return variablesIn(join(dir, '.env')) ?? {};
  return variablesOfFiles(named.split(',').map((each) => each.trim()).filter((each) => each !== '').map((each) => resolve(dir, each)), [dir, ...within]);
};

/** What a command's own shell lends an interpolation (P337): as an environment file lends it, a port, an address or a host's name under a name that is no secret's. */
const shellLends = (shell: Readonly<Record<string, string>> | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(shell ?? {})) {
    const value = interpolationValue(name, raw);
    if (value !== undefined) out[name] = value;
  }
  return out;
};

/** The names compose looks for where a command names no file (`-f`), each with its override. */
/** How deep compose files including others are followed (P337). */
const COMPOSE_INCLUDE_DEPTH = 8;

/**
 * The ports the commands of a repository start a server with (P337): a
 * command that starts a server in a service's directory - its own, or one
 * the project's command `cd`s into - with a setting its own shell gives a
 * port, `export PORT=4000` earlier in the same script or `PORT=4000` before
 * it, gives that service's setting the port, firmly: a run started that way
 * listens there. Labelled from the service's directory where the command is
 * in it.
 */
const readStarts = (each: Commands, services: SettingsInput['services'], byService: ReadonlyMap<string, Gathered>, rootDir: string): void => {
  const bins = binsOf(services, rootDir);
  // The packages of the workspace by name, for a program that listens through one (P356), read once when asked.
  let named: Map<string, string> | undefined;
  const packages = (): Map<string, string> => (named ??= packagesByName([each.base, rootDir], services));
  // The service whose directory holds a path, the deepest one.
  const holding = (path: string): SettingsInput['services'][number] | undefined => {
    const real = realOf(path);
    return services.filter((one) => realOf(one.dir) === real || isWithin(realOf(one.dir), real)).sort((a, b) => realOf(b.dir).length - realOf(a.dir).length)[0];
  };
  const give = (service: SettingsInput['services'][number], origin: { file: string; line?: number }, environment: Readonly<Record<string, string>>, assumed: readonly string[] = []): void => {
    const into = byService.get(service.name);
    if (into === undefined) return;
    const file = labelOf(resolve(each.base, origin.file), service.dir, rootDir);
    const given: string[] = [];
    for (const [name, raw] of Object.entries(environment)) {
      const port = portSetting({ name, raw });
      if (port === undefined) continue;
      given.push(`${name}=${raw}`);
      const list = into.ports.get(name) ?? [];
      if (!list.some((seen) => seen.port === port && seen.file === file && seen.started === true)) list.push({ port, file, started: true });
      into.ports.set(name, list);
    }
    // A port read under a Makefile conditional the files do not settle (P356): one reading of several, said so.
    if (assumed.length === 0 || given.length === 0) return;
    const line = origin.line ?? 1;
    const message = `${file}:${line} starts ${service.name} with ${given.join(', ')} under ${assumed.join(', ')}, which the files do not settle: each branch is read, and this is the port one of them gives`;
    if (into.rows.some((seen) => seen.reason === 'make-conditional-unsettled' && seen.message === message)) return;
    into.rows.push({
      service: service.name,
      file,
      line,
      reason: 'make-conditional-unsettled',
      level: 'info',
      message,
      hint: 'Set the variable the conditional tests in the Makefile, or give the port outside the conditional.',
      symbol: `${file}:${line}`,
    });
  };
  const within = (path: string): boolean => [each.base, rootDir].some((dir) => realOf(dir) === realOf(path) || isWithin(dir, path));
  // A program of the project's own that is not in the repository - a
  // package's `bin` that points at what a build writes, a path to a build's
  // output - started with a port: said, as its port is not read (P343).
  const unreadRow = (service: SettingsInput['services'][number] | undefined, origin: ServerStart, program: string, path: string, environment: Readonly<Record<string, string>>): void => {
    const into = service === undefined ? undefined : byService.get(service.name);
    const ports = Object.entries(environment).flatMap(([name, raw]) => (portSetting({ name, raw }) === undefined ? [] : [`${name}=${raw}`]));
    if (service === undefined || into === undefined || ports.length === 0) return;
    const file = labelOf(resolve(each.base, origin.file), rootDir, rootDir);
    if (into.rows.some((seen) => seen.file === file && seen.line === origin.line && seen.reason === 'server-start-unread')) return;
    const missing = labelOf(path, rootDir, rootDir);
    into.rows.push({
      service: service.name,
      file,
      line: origin.line,
      reason: 'server-start-unread',
      level: 'info',
      message: `${file}:${origin.line} starts ${program} with ${ports.join(', ')}, but ${missing} is not in the repository (what a build writes is not read), so where ${service.name} listens when started that way is not known`,
      hint: `Start the server from its source (node, tsx) in the script, or give ${service.name} the port in a file its code loads.`,
      symbol: `${file}:${origin.line}`,
    });
  };
  const follow = (commands: readonly Command[], origin: ServerStart | undefined, depth: number): void => {
    for (const start of serverStartsOf(commands)) {
      const from = origin ?? start;
      // A command after a `cd` nobody settles runs nowhere the files say.
      if (start.dirs !== undefined && start.dirs.length === 0) continue;
      const runsIn = (start.dirs ?? ['.']).map((dir) => resolve(each.base, dir));
      const byDirs = (): SettingsInput['services'][number] | undefined =>
        runsIn.map((dir) => services.find((one) => realOf(one.dir) === realOf(dir))).find((found) => found !== undefined);
      const { runs } = start;
      if (runs.kind === 'known') {
        // The service whose code the file it runs is, or that code listens in, else the one it runs in (P343).
        const path = runs.file === undefined ? undefined : runsIn.map((dir) => moduleFile(resolve(dir, runs.file as string))).find((found) => found !== undefined && within(found));
        const listening = path === undefined ? undefined : listeningFile(path, packages());
        const service = (listening === undefined ? undefined : holding(listening)) ?? (path === undefined ? undefined : holding(path)) ?? byDirs();
        if (service !== undefined) give(service, from, start.environment, from.assumed);
        continue;
      }
      if (depth >= START_DEPTH) continue;
      if (runs.kind === 'script' && runs.workspace !== undefined) {
        // A script of another package of the workspace, or of the directory named (P350).
        for (const dir of selectedPackages(runs.workspace, runsIn, services, rootDir)) {
          if (!within(dir)) continue;
          // `start`, `dev`, `serve` start that package's server, as they do run where it is (`known`).
          const service = isStartingScript(runs.name) ? services.find((one) => realOf(one.dir) === realOf(dir)) : undefined;
          if (service !== undefined) {
            give(service, from, start.environment, from.assumed);
            continue;
          }
          const nested = commandsOfPackageScript(each.base, relative(each.base, dir).split(sep).join('/') || '.', runs.name, start.environment);
          if (nested.length > 0) follow(nested, from, depth + 1);
        }
        continue;
      }
      if (runs.kind === 'script') {
        // A script of the package.json where it runs, its commands handed the environment.
        const dir = runsIn.find((at) => within(at) && existsSync(join(at, 'package.json')));
        const nested = dir === undefined ? [] : commandsOfPackageScript(each.base, relative(each.base, dir).split(sep).join('/') || '.', runs.name, start.environment);
        if (nested.length > 0) {
          follow(nested, from, depth + 1);
          continue;
        }
      }
      const name = runs.kind === 'script' ? runs.name : runs.program;
      // A path names a file where the command runs; a bare name, a package's `bin`.
      const isPath = name.includes('/');
      if (isPath && /(?:^|\/)node_modules\//.test(name)) continue;
      // The first directory it may run in that has the file, else the first it may run in at all.
      const candidates = isPath ? runsIn.map((dir) => resolve(dir, name)).filter((found) => within(found)) : [];
      const path = isPath ? (candidates.find((found) => existsSync(found)) ?? candidates[0]) : bins.get(name);
      if (path === undefined) continue;
      if (!existsSync(path)) {
        unreadRow(isPath ? byDirs() : holding(path), from, name, path, start.environment);
        continue;
      }
      if (isShellScript(path)) {
        // A shell script runs where it is started from, handed the environment, under what it exports itself.
        if (!isWithin(each.base, path)) continue;
        const dirs = (start.dirs ?? ['.']).map((dir) => posix.normalize(dir));
        follow(commandsOfShellScript(each.base, relative(each.base, path).split(sep).join('/'), start.environment, dirs), from, depth + 1);
        continue;
      }
      const listening = listeningFile(path, packages());
      if (listening === undefined) continue;
      const service = holding(listening) ?? holding(path);
      if (service !== undefined) give(service, from, start.environment, from.assumed);
    }
  };
  follow(each.commands, undefined, 0);
};

/** A selector of pnpm's or Bun's `--filter` as a pattern over a package's name: `@shop/*`. */
const selectorPattern = (selector: string): RegExp => new RegExp(`^${selector.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

/**
 * The directories of the packages a package manager is told to run a script
 * in (P350), absolute: by name among the packages of the workspace the
 * command runs in and of the project, and the services; by a path written
 * from where it runs (`./apps/api`, `{./apps/api}`, the directory `-C`
 * names). pnpm's `...` around a name (its dependents or dependencies as well)
 * and `^` are taken off, so the named package is read and those around it
 * are not; an exclusion (`!name`) selects nothing.
 */
/**
 * The packages of the workspace a set of directories are in, and of the
 * services, by the name each manifest gives (P350, P356): those of each
 * directory's own workspace and of the workspace it is a member of, the
 * nearest first, then each service's own package.
 */
const packagesByName = (dirs: readonly string[], services: SettingsInput['services']): Map<string, string> => {
  const roots = [...new Set(dirs.flatMap((dir) => [dir, workspaceRootOf(dir)]).filter((each): each is string => each !== undefined))];
  const named = new Map<string, string>();
  for (const root of roots) for (const pkg of workspacePackages(root)) if (!named.has(pkg.name)) named.set(pkg.name, pkg.dir);
  for (const service of services) {
    try {
      const name = (JSON.parse(read(join(service.dir, 'package.json')) ?? 'null') as { name?: unknown } | null)?.name;
      if (typeof name === 'string' && !named.has(name)) named.set(name, service.dir);
    } catch {
      // A manifest that does not parse names no package.
    }
  }
  return named;
};

const selectedPackages = (selection: WorkspaceSelection, runsIn: readonly string[], services: SettingsInput['services'], rootDir: string): string[] => {
  const where = runsIn[0] ?? rootDir;
  // A path from the first directory the command may run in where it names a package.
  const pathed = (path: string): string[] => {
    const candidates = (runsIn.length === 0 ? [rootDir] : runsIn).map((dir) => resolve(dir, path));
    return [candidates.find((dir) => existsSync(join(dir, 'package.json'))) ?? (candidates[0] as string)];
  };
  if (selection.dir !== undefined) return selection.dir.includes('$') ? [] : pathed(selection.dir);
  const named = packagesByName([where, rootDir], services);
  const found: string[] = [];
  for (const written of selection.selectors) {
    const selector = written.replace(/^\{(.*)\}$/, '$1').replace(/^\.\.\.(?=[^/])|\.\.\.$/g, '').replace(/^\^/, '');
    if (selector === '' || selector.startsWith('!') || selector.includes('$') || selector.startsWith('[')) continue;
    if (selector.startsWith('.')) {
      found.push(...pathed(selector));
      continue;
    }
    const pattern = selectorPattern(selector);
    for (const [name, dir] of named) if (pattern.test(name)) found.push(dir);
  }
  return [...new Set(found)];
};

/** How deep a script, a shell script or a program another starts is followed (P343). */
const START_DEPTH = 4;

/** What a server's code is read listening by: `app.listen(`, `server.listen(`, `createServer(`, `Bun.serve(`, `serve({`. */
const LISTENS = /\.listen\s*\(|\bcreateServer\s*\(|\b(?:Bun|Deno)\.serve\s*\(|\bserve\s*\(\s*\{/;

/** The extensions a module written without its own is looked for under. */
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];

/** The file a module path names, as a runtime or a bundler resolves it: as written, with an extension, its `.ts` for a `.js`, its `index`. */
const moduleFile = (path: string): string | undefined => {
  const bare = path.replace(/\.[cm]?jsx?$/, '');
  const candidates = [path, ...MODULE_EXTENSIONS.map((ext) => `${bare}${ext}`), ...MODULE_EXTENSIONS.map((ext) => join(path, `index${ext}`))];
  return candidates.find((each) => {
    try {
      return statSync(each).isFile();
    } catch {
      return false;
    }
  });
};

/** Whether a file is a shell script: by its name, or its `#!` line. */
const isShellScript = (path: string): boolean => /\.(?:sh|bash)$/.test(path) || /^#!\s*\S*\/(?:env\s+)?(?:ba|z|da)?sh\b/.test(read(path)?.slice(0, 80) ?? '');

/**
 * The file of a program's code that listens (P343): the file itself, or a
 * module it imports by a relative path, and on, as far as the files go.
 * Nothing where none is read listening.
 *
 * A module imported by a package's name (`require('@shop/server')`, P356)
 * is followed where `packages` names a package of the workspace by it: to
 * the file the workspace's link enters it through, its manifest's
 * `exports`, `module` or `main`, else the source that is built from
 * ({@link workspaceMemberEntries}), as an import of a workspace member is
 * resolved where nothing is installed. A package the workspace does not
 * hold is an install's, and not followed.
 */
const listeningFile = (path: string, packages: ReadonlyMap<string, string> = new Map(), seen: Set<string> = new Set()): string | undefined => {
  if (seen.has(path) || seen.size >= 64) return undefined;
  seen.add(path);
  const text = read(path);
  if (text === undefined) return undefined;
  if (LISTENS.test(text)) return path;
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\s]+)['"]/g)) {
    const specifier = match[1] as string;
    let found: string | undefined;
    if (/^\.{1,2}\//.test(specifier)) found = moduleFile(resolve(dirname(path), specifier));
    else {
      const parts = packageSpecifierParts(specifier);
      const dir = parts === undefined ? undefined : packages.get(parts.name);
      if (parts === undefined || dir === undefined) continue;
      found = workspaceMemberEntries(dir, parts.subpath)
        .map((entry) => moduleFile(entry))
        .find((file) => file !== undefined && !/\.d\.[cm]?ts$/.test(file));
    }
    const listening = found === undefined ? undefined : listeningFile(found, packages, seen);
    if (listening !== undefined) return listening;
  }
  return undefined;
};

/**
 * The programs the project's packages give by name (P343): each `bin` of the
 * `package.json` of every service and of the project, a single path under
 * the package's own name less its scope.
 */
const binsOf = (services: SettingsInput['services'], rootDir: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const dir of [...services.map((service) => service.dir), rootDir]) {
    let manifest: { name?: unknown; bin?: unknown };
    try {
      manifest = JSON.parse(read(join(dir, 'package.json')) ?? 'null') ?? {};
    } catch {
      continue;
    }
    const bin = manifest.bin;
    const named: Array<[string, unknown]> = typeof bin === 'string' ? (typeof manifest.name === 'string' ? [[manifest.name.split('/').pop() as string, bin]] : []) : typeof bin === 'object' && bin !== null ? Object.entries(bin) : [];
    for (const [name, path] of named) if (typeof path === 'string' && !out.has(name)) out.set(name, resolve(dir, path));
  }
  return out;
};

const DEFAULT_COMPOSE = new Set(['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml', 'compose.override.yaml', 'compose.override.yml', 'docker-compose.override.yaml', 'docker-compose.override.yml']);

/** A `docker compose` a command of the project runs, and the directory its command is read under. */
interface ComposeCommand {
  readonly run: ComposeRunAt;
  readonly base: string;
}

/**
 * What compose interpolates a file with (P325, P331): the `.env` beside it,
 * which compose loads itself, or, for a command of the project that runs the
 * file with `--env-file`, those files in order, a later over an earlier, in
 * place of the `.env`. Where several commands run the file with different
 * variables, only what they all agree on is read; a command whose files the
 * shell names agrees on nothing.
 *
 * `COMPOSE_ENV_FILES` and `COMPOSE_FILE` given by the command's shell, or by
 * the `.env`, name the files where the command does not (P337); and what the
 * command's own shell gives - written before it, or exported earlier in its
 * script - is written over every file, as compose prefers the shell's.
 */
const composeVariables = (dir: string, name: string, commands: readonly ComposeCommand[], rootDir: string): Record<string, string> => {
  const path = realOf(join(dir, name));
  const readings: Array<Record<string, string> | undefined> = [];
  for (const { run, base } of commands) {
    if (run.dirs !== undefined && run.dirs.length === 0) continue;
    // The directory it runs in, of those it may (a script's own, then the
    // repository's, P337), where it runs this file.
    const runsHere = (at: string): boolean => {
      const project = run.projectDirectory === undefined ? at : resolve(at, run.projectDirectory);
      const here = realOf(project) === realOf(dir);
      const names = run.files.length === 0 ? (here && DEFAULT_COMPOSE.has(name) ? [path] : []) : run.files.map((file) => realOf(resolve(at, file)));
      // A command whose files the shell names may run any compose file of its directory.
      return names.includes(path) || (run.unsettled === true && run.files.length === 0 && here);
    };
    const at = (run.dirs ?? ['.']).map((each) => resolve(base, each)).find(runsHere);
    if (at === undefined) continue;
    if (run.unsettled === true) {
      readings.push(undefined);
      continue;
    }
    const files = run.envFiles.length === 0 ? dotEnvVariables(dir, [base, rootDir]) : variablesOfFiles(run.envFiles.map((file) => resolve(at, file)), [base, rootDir]);
    readings.push({ ...files, ...shellLends(run.shell) });
  }
  if (readings.length === 0) return dotEnvVariables(dir, [rootDir]);
  if (readings.some((reading) => reading === undefined)) return {};
  const [first, ...rest] = readings as Array<Record<string, string>>;
  return Object.fromEntries(Object.entries(first ?? {}).filter(([key, value]) => rest.every((other) => other[key] === value)));
};

/**
 * How a compose file builds a container's image (P325): `build.dockerfile`
 * from the context, else the context's `Dockerfile`, or `dockerfile_inline`;
 * the stage `build.target` names and the `build.args`. Nothing where it
 * builds none, or from a Dockerfile outside its directory and the context.
 */
const composeBuild = (container: ComposeService, file: ComposeFile): ImageBuild | undefined => {
  const image = container.image;
  if (image === undefined) return undefined;
  const context = resolve(file.dir, container.context ?? '.');
  const path = image.inline === undefined ? resolve(context, image.dockerfile ?? 'Dockerfile') : undefined;
  if (path !== undefined && !isWithin(file.dir, path) && !isWithin(context, path)) return undefined;
  return { ...(path === undefined ? {} : { path }), ...(image.inline === undefined ? {} : { inline: image.inline }), ...(image.target === undefined ? {} : { target: image.target }), args: image.args };
};

/**
 * The images compose files build and tag with their `image:` (P331): compose
 * builds the image under that name, so a container elsewhere - a cluster's
 * workload, a `docker run` - running it runs what the Dockerfile builds.
 */
const composeImages = (files: readonly ComposeFile[]): BuiltImage[] =>
  files.flatMap((file) =>
    file.services.flatMap((container) => {
      const build = container.imageName === undefined ? undefined : composeBuild(container, file);
      return build === undefined ? [] : [{ ...build, names: [imageName(container.imageName as string)] }];
    }),
  );

/**
 * The ports the image a compose container runs gives a setting (P325,
 * P331): the Dockerfile compose builds it from, or, for an `image:` it
 * pulls, the Dockerfile a build of the project tags that image from.
 * Labelled as the compose file's environment files are, from its
 * directory. An image nothing of the project builds, or whose Dockerfile is
 * not found, is said to be unread.
 */
const composeImage = (container: ComposeService, file: ComposeFile, images: readonly BuiltImage[]): { readonly ports: Record<string, number>; readonly label: string } | { readonly unread: ImageUnread } | undefined => {
  const labelled = (path: string): string => relative(file.dir, path).split(sep).join('/') || basename(path);
  if (container.image === undefined) {
    if (container.imageName === undefined) return undefined;
    const reading = imageReading(container.imageName, images);
    if ('unread' in reading) return reading;
    return { ports: reading.ports, label: reading.path === undefined ? file.label : labelled(reading.path) };
  }
  const written = container.imageName ?? container.name;
  const build = composeBuild(container, file);
  if (build === undefined) return { unread: { image: written, why: 'the Dockerfile compose builds it from is outside the project' } };
  const ports = imagePorts(build);
  if (ports === undefined) return { unread: { image: written, why: 'the Dockerfile compose builds it from is not found' } };
  return { ports, label: build.path === undefined ? `${file.label} (dockerfile_inline)` : labelled(build.path) };
};

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

/** A path as the disk spells it; one that is not there, under the real spelling of the nearest directory that is (P343). */
const realOf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    const up = dirname(resolve(path));
    return up === resolve(path) ? resolve(path) : join(realOf(up), basename(path));
  }
};

/** The names a workload may be known by as one of the project's services: its own, its pods' `app` labels, its containers' and images' names. */
const workloadNames = (workload: ManifestWorkload): string[] => [
  workload.name,
  ...['app.kubernetes.io/name', 'app'].flatMap((key) => (workload.labels[key] === undefined ? [] : [workload.labels[key] as string])),
  ...workload.containers.flatMap((container) => [container.name, container.image].filter((name): name is string => name !== undefined)),
];

/** The one service a workload runs, by the names it is known by, or nothing where none or two answer. */
const serviceOfWorkload = (workload: ManifestWorkload, names: ReadonlyMap<string, string>): string | undefined => {
  const found = new Set(workloadNames(workload).flatMap((name) => (names.has(name.toLowerCase()) ? [names.get(name.toLowerCase()) as string] : [])));
  return found.size === 1 ? [...found][0] : undefined;
};

/**
 * Whether a service object selects a workload's pods: every label it selects
 * by, in the same namespace where both write one (a manifest that writes none
 * is applied to whichever namespace it is applied to).
 */
const selects = (service: ManifestService, workload: ManifestWorkload): boolean =>
  Object.keys(service.selector).length > 0 &&
  (service.namespace === undefined || workload.namespace === undefined || service.namespace === workload.namespace) &&
  Object.entries(service.selector).every(([key, value]) => workload.labels[key] === value);

/** The container a port of a service object reaches: the one declaring it, by number or name, or the only one. */
const containerAt = (workloads: readonly ManifestWorkload[], target: number | string): ManifestContainer | undefined => {
  const containers = workloads.flatMap((workload) => workload.containers);
  return containers.find((container) => container.ports.some((port) => port.port === target || port.name === target)) ?? (containers.length === 1 ? containers[0] : undefined);
};

/** Every spelling of a service object's name its cluster's network resolves. */
const spellingsOf = (service: ManifestService): string[] => {
  const name = service.name.toLowerCase();
  if (service.namespace === undefined) return [name];
  const namespace = service.namespace.toLowerCase();
  return [name, `${name}.${namespace}`, `${name}.${namespace}.svc`, `${name}.${namespace}.svc.cluster.local`];
};

/** A service object of the manifests, and the project's service it routes to (P257). */
interface Routed {
  readonly object: ManifestService;
  readonly service: string;
  readonly routed: RoutedName;
  /** Each port of the object read, with the number its target is, and the port each node opens for it. */
  readonly ports: ReadonlyArray<{ readonly port: ManifestServicePort; readonly target: number }>;
}

/** A workload of the manifests, and the project's service it runs, where one does. */
interface Running {
  readonly workload: ManifestWorkload;
  readonly runs?: string;
}

/**
 * The environment a workload's container runs with, for the service it runs
 * (P331): the Dockerfile of its image where the project builds it, under what
 * the manifest writes, or why the image's is not read.
 */
type ContainerEnvironmentOf = (container: ManifestContainer | undefined, service: string) => Pick<RoutedName, 'environment' | 'environmentFiles' | 'imageUnread' | 'environmentSecret' | 'environmentSecretFrom'>;

/** The environment as the manifest alone writes it, where no image is read. */
const manifestEnvironment: ContainerEnvironmentOf = (container) => {
  const environment = containerEnvironment();
  layerManifest(environment, container);
  return environment.done();
};

/**
 * What a workload's manifest gives its containers, over the image's (P331,
 * P337): each setting a config map or a value gives, said at its own file
 * where that is not the one the environment is written in, and each a
 * `Secret` gives, by name only - written in the pod spec's order already,
 * `envFrom` under `env`, as the cluster gives a pod them.
 */
const layerManifest = (environment: ReturnType<typeof containerEnvironment>, container: ManifestContainer | undefined): void => {
  environment.secret(container?.secretSettings ?? [], container?.secretSources);
  environment.layer(environmentPorts(container?.environment ?? []), container?.environmentFiles ?? {});
};

/** Why the image of a workload's container whose name a template value leaves unsettled is not read (P337). */
const UNSETTLED_IMAGE = 'its name is a template value the chart\'s values and the files do not settle, and an image is never fetched';

/**
 * Each service object of the manifests, as the name it routes to one of the
 * project's services (P257): the service whose workload it selects - a
 * workload known by the service's name, or the only workload a service's own
 * repository declares - or the service of its own name where it selects
 * none. A named target port is the number the selected pods give that name;
 * one they do not name is not read. The environment is that of the container
 * the first port reaches, its image's Dockerfile under it (P331).
 */
const routedNames = (
  manifests: ReadonlyArray<{ read: Manifests; owner?: string }>,
  names: ReadonlyMap<string, string>,
  environmentOf: ContainerEnvironmentOf = manifestEnvironment,
): { routed: Routed[]; workloads: Running[] } => {
  const workloads: Running[] = manifests.flatMap(({ read, owner }) =>
    read.workloads.map((workload) => {
      const runs = serviceOfWorkload(workload, names) ?? (owner !== undefined && read.workloads.length === 1 ? owner : undefined);
      return { workload, ...(runs === undefined ? {} : { runs }) };
    }),
  );
  const out: Routed[] = [];
  for (const { read } of manifests) {
    for (const service of read.services) {
      const selected = workloads.filter(({ workload }) => selects(service, workload));
      const runs = [...new Set(selected.flatMap((each) => (each.runs === undefined ? [] : [each.runs])))];
      const target = runs.length === 1 ? runs[0] : runs.length === 0 && selected.length === 0 ? names.get(service.name.toLowerCase()) : undefined;
      if (target === undefined) continue;
      const pods = selected.map((each) => each.workload);
      const read = service.ports.flatMap((each) => {
        const written = each.target ?? each.port;
        const number = typeof written === 'number' ? written : containerAt(pods, written)?.ports.find((port) => port.name === written)?.port;
        return number === undefined ? [] : [{ port: each, target: number }];
      });
      const ports: RoutedPort[] = read.map(({ port, target: number }) => ({ port: port.port, target: number, file: port.file, line: port.line }));
      if (ports.length === 0) continue;
      const container = containerAt(pods, (ports[0] as RoutedPort).target);
      const from = container?.environmentFile;
      out.push({
        object: service,
        service: target,
        routed: {
          name: service.name.toLowerCase(),
          names: spellingsOf(service),
          file: service.file,
          ports,
          ...environmentOf(container, target),
          ...(from === undefined || from === service.file ? {} : { environmentFrom: from }),
        },
        ports: read,
      });
    }
  }
  return { routed: out, workloads };
};

/** The service objects a name, in a namespace where one is written, may be. */
const objectsNamed = (routed: readonly Routed[], name: string, namespace: string | undefined): Routed[] =>
  routed.filter((each) => each.object.name === name && (namespace === undefined || each.object.namespace === undefined || each.object.namespace === namespace));

/** The port of a service object a way in or a forward names, by number or by name. */
const portNamed = (routed: Routed, port: number | string | undefined) =>
  port === undefined ? (routed.ports.length === 1 ? routed.ports[0] : undefined) : routed.ports.find((each) => each.port.port === port || each.port.name === port);

/** How a way in rewrites a path it matches, as a proxy rule's rewrite. */
const ingressRule = (path: ManifestPath, target: string): ProxyRule | undefined => {
  const at = { file: path.file, line: path.line };
  if (path.match === 'pattern') {
    const rewrite = path.rewrite?.kind === 'pattern' ? { rewrite: { source: path.rewrite.source, flags: path.rewrite.flags, with: path.rewrite.with, whole: true as const } } : {};
    const base = proxyRule('/', target, { kind: 'strip' }, at);
    return base === undefined ? undefined : { ...base, path: path.path, match: { source: path.path, ...(path.flags === undefined || path.flags === '' ? {} : { flags: path.flags }) }, ...rewrite };
  }
  if (path.rewrite?.kind === 'pattern') {
    const base = proxyRule(path.path, target, { kind: 'strip' }, at);
    return base === undefined ? undefined : { ...base, to: '', rewrite: { source: path.rewrite.source, ...(path.rewrite.flags === '' ? {} : { flags: path.rewrite.flags }), with: path.rewrite.with, whole: true }, ...(path.match === 'exact' ? { exact: true as const } : {}) };
  }
  const rewrite = path.rewrite?.kind === 'prefix' ? ({ kind: 'replace', with: path.rewrite.with } as const) : ({ kind: 'keep' } as const);
  const rule = proxyRule(path.path, target, rewrite, at);
  return rule === undefined ? undefined : { ...rule, ...(path.match === 'exact' ? { exact: true as const } : {}) };
};

/**
 * The ways in the manifests write, each path handed to the service behind
 * the service object it sends to (P260): its target the object's name at
 * the port the path names. A path that sends to objects of two of the
 * project's services, by weight, is a row.
 */
const waysIn = (manifests: readonly Manifests[], routed: readonly Routed[]): { routes: Array<[string, IngressRoute]>; rows: ManifestRow[] } => {
  const routes: Array<[string, IngressRoute]> = [];
  const rows: ManifestRow[] = [];
  for (const ingress of manifests.flatMap((each) => each.ingresses ?? [])) {
    for (const path of ingress.paths) {
      const reached = path.backends.flatMap((backend) =>
        objectsNamed(routed, backend.name, ingress.namespace).flatMap((each) => {
          const port = portNamed(each, backend.port);
          return port === undefined ? [] : [{ routed: each, port }];
        }),
      );
      const services = [...new Set(reached.map((each) => each.routed.service))];
      if (services.length === 0) continue;
      if (services.length > 1) {
        rows.push({
          reason: 'manifest-unread',
          file: path.file,
          line: path.line,
          message: `${path.file} sends ${path.path} on ${ingress.hosts.join(', ')} to ${services.join(' and ')} by weight, so a request to it is not one service's`,
          hint: 'Name the request\'s service with an annotation (/** @flowatlas-calls <service> METHOD /path */).',
          about: services,
        });
        continue;
      }
      const first = reached[0] as (typeof reached)[number];
      const rule = ingressRule(path, `http:${'/'.repeat(2)}${first.routed.object.name.toLowerCase()}:${first.port.port.port}`);
      if (rule === undefined) continue;
      // A path is a way in at its own rule's hosts (P263); `*` at any host the controller is reached at.
      for (const host of path.hosts ?? ingress.hosts) routes.push([first.routed.service, { host, rule, object: `${ingress.kind}/${ingress.name}` }]);
    }
  }
  return { routes, rows };
};

/** The commands of one repository (a service's, or the project's), and the directory they are read under. */
interface Commands {
  readonly base: string;
  readonly owner?: string;
  readonly commands: readonly Command[];
}

/**
 * Where a command runs, absolute and the likeliest first: each directory the
 * command reader says, under its repository; the repository where a `cd` the
 * files do not settle leaves it nowhere; and the project's directory.
 */
const runsAt = (base: string, dirs: readonly string[] | undefined, rootDir: string): string[] => [...new Set([...(dirs ?? []).map((dir) => resolve(base, dir)), ...((dirs ?? []).length === 0 ? [base] : []), base, rootDir])];

/** A command that installs a chart, resolved against where it runs (P260), in a pipeline too (P263). */
const chartInstalls = (each: Commands, rootDir: string): ChartInstall[] =>
  readHelmInstalls(each.commands).flatMap((install) => {
    const base = runsAt(each.base, install.dirs, rootDir).find((dir) => existsSync(join(resolve(dir, install.chart), 'Chart.yaml')));
    if (base === undefined) return [];
    return [
      {
        chart: resolve(base, install.chart),
        ...(install.release === undefined ? {} : { release: install.release }),
        ...(install.namespace === undefined ? {} : { namespace: install.namespace }),
        values: install.values.map((value) => resolve(base, value)),
        sets: install.sets,
        file: install.file,
        line: install.line,
      },
    ];
  });

/**
 * What the helmfiles of a repository install (P263): its own `helmfile.yaml`
 * (or `helmfile.d/`), and one a `helmfile -f` command names, each read for
 * the environments, state values and releases its commands give, or for
 * every environment it declares where no command runs it.
 */
const helmfileInstalls = (each: Commands, rootDir: string): { installs: ChartInstall[]; rows: ManifestRow[] } => {
  const runs = readHelmfileRuns(each.commands).flatMap((run) => {
    const at = runsAt(each.base, run.dirs, rootDir);
    // `-f` names a helmfile, or a folder of them read as `helmfile.d/` is (P273).
    const named = run.helmfile === undefined ? undefined : at.map((dir) => resolve(dir, run.helmfile as string)).find((path) => existsSync(path));
    const files = run.helmfile === undefined ? (at.map(helmfilesAt).find((found) => found.length > 0) ?? []) : named === undefined ? [] : helmfilesIn(named).length > 0 ? helmfilesIn(named) : [named];
    return files.map((path) => ({ path, run, from: at[0] as string }));
  });
  const files = [...new Set([...helmfilesAt(each.base), ...runs.map((each) => each.path)])].sort();
  const installs: ChartInstall[] = [];
  const rows: ManifestRow[] = [];
  const label = (path: string): string => relative(each.base, path).split(sep).join('/');
  for (const path of files) {
    const own = runs.filter((found) => found.path === path);
    const readings = own.length === 0 ? [{}] : own.map(({ run, from }) => ({ environments: [run.environment], stateSets: run.stateSets, stateFiles: run.stateFiles.map((file) => resolve(from, file)), releases: run.releases, selectors: run.selectors, needs: run.needs, explicitSelectors: run.explicitSelectors }));
    for (const reading of readings) {
      const read = readHelmfile(path, label, reading);
      for (const install of read.installs) {
        if (!installs.some((seen) => seen.chart === install.chart && seen.line === install.line && seen.environment === install.environment && seen.file === install.file)) installs.push(install);
      }
      for (const row of read.rows) if (!rows.some((seen) => seen.line === row.line && seen.file === row.file)) rows.push(row);
    }
  }
  return { installs, rows };
};

/** The kustomizations a repository's commands build or apply, absolute (P263). */
const appliedKustomizations = (each: Commands, rootDir: string): string[] =>
  readKustomizeApplies(each.commands).flatMap((apply) => {
    const dir = runsAt(each.base, apply.dirs, rootDir)
      .map((at) => resolve(at, apply.folder))
      .find((path) => ['kustomization.yaml', 'kustomization.yml', 'Kustomization'].some((name) => existsSync(join(path, name))));
    return dir === undefined ? [] : [dir];
  });

export interface SettingsInput {
  /** Every service with a repository to look in, by name, with its directory. */
  readonly services: ReadonlyArray<{ readonly name: string; readonly dir: string }>;
  /** The directory the configuration is in, where a compose file for the whole project is kept. */
  readonly rootDir: string;
  /** The environment chosen under `settingFiles.environment`. */
  readonly environment?: string;
  /** The overlays chosen under `settingFiles.overlays`, absolute (P260). */
  readonly overlays?: readonly string[];
  /** The values files each chart is installed with under `settingFiles.chartValues`, by the chart's absolute folder (P260). */
  readonly chartValues?: Readonly<Record<string, readonly string[]>>;
}

/** A row a manifest reader made, as the row of a service. */
const manifestRow = (row: ManifestRow, service: string, file: string): Unresolved => ({
  service,
  file,
  line: row.line,
  reason: row.reason,
  message: row.message,
  hint: row.hint,
  symbol: `${file}:${row.line}`,
});

/** A routed name's containers' environment, as a container forwarded to them has it (P331). */
const routedEnvironment = (routed: RoutedName): Pick<ContainerRun, 'environment' | 'environmentFiles' | 'imageUnread' | 'environmentSecret' | 'environmentSecretFrom'> => ({
  environment: routed.environment,
  ...(routed.environmentFiles === undefined ? {} : { environmentFiles: routed.environmentFiles }),
  ...(routed.imageUnread === undefined ? {} : { imageUnread: routed.imageUnread }),
  ...(routed.environmentSecret === undefined ? {} : { environmentSecret: routed.environmentSecret }),
  ...(routed.environmentSecretFrom === undefined ? {} : { environmentSecretFrom: routed.environmentSecretFrom }),
});

/**
 * The ports this machine forwards to a cluster's objects, as containers of
 * the services behind them (P260): `localhost:8080` reaches what the object
 * routes the remote port to, and the service is listening there as its
 * containers would be.
 */
const forwardedRuns = (forwards: readonly PortForward[], routed: readonly Routed[], workloads: readonly Running[], environmentOf: ContainerEnvironmentOf = manifestEnvironment): Array<[string, ContainerRun]> =>
  forwards.flatMap((forward): Array<[string, ContainerRun]> => {
    const { file } = forward;
    const name = forward.name.toLowerCase();
    if (forward.kind === 'service') {
      const found = objectsNamed(routed, name, forward.namespace).flatMap((each) => {
        const port = portNamed(each, forward.remote);
        return port === undefined ? [] : [{ each, port }];
      });
      if (found.length !== 1) return [];
      const { each, port } = found[0] as (typeof found)[number];
      return [[each.service, { name: `svc/${name}`, names: [], file, ports: [{ published: forward.local, container: port.target, file, line: forward.line }], ...routedEnvironment(each.routed), via: 'forwarded', environmentFrom: each.routed.environmentFrom ?? each.routed.file }]];
    }
    const found = workloads.filter((each) => each.workload.name.toLowerCase() === name && each.runs !== undefined && (forward.namespace === undefined || each.workload.namespace === undefined || each.workload.namespace === forward.namespace));
    if (found.length !== 1) return [];
    const { workload, runs } = found[0] as Running;
    const container = containerAt([workload], forward.remote);
    return [[runs as string, { name: `deploy/${name}`, names: [], file, ports: [{ published: forward.local, container: forward.remote, file, line: forward.line }], ...environmentOf(container, runs as string), via: 'forwarded', environmentFrom: container?.environmentFile ?? workload.file }]];
  });

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
  const manifests: Array<{ read: Manifests; owner?: string }> = [];
  // A compose file another `extends:` a service from, read where it is the project's (P337).
  const loaderAt = (dir: string, within: string): ComposeLoader => (path) => {
    const file = resolve(dir, path);
    return [within, input.rootDir].some((each) => isWithin(each, file)) ? read(file) : undefined;
  };
  /**
   * A compose file, and each file it includes (P337), as compose reads them
   * into one project: an included file is interpolated with its `env_file`,
   * or the `.env` of its project directory, under what the including file is
   * interpolated with, and its relative paths are its project directory's.
   */
  const composeRead = (file: { path: string; dir: string; label: string; within: string; owner?: string }, variables: Readonly<Record<string, string>>, seen: ReadonlySet<string>): void => {
    const text = read(file.path);
    if (text === undefined) return;
    const environment = composeEnvironment(basename(file.path));
    composeFiles.push({
      dir: file.dir,
      label: file.label,
      services: readComposeFile(text, variables, loaderAt(dirname(file.path), file.within)),
      ...(environment === undefined ? {} : { environment }),
      ...(file.owner === undefined ? {} : { owner: file.owner }),
    });
    if (seen.size >= COMPOSE_INCLUDE_DEPTH) return;
    // As compose resolves an `include:` (P343, compose-go's loader): its
    // paths, `project_directory` and `env_file` from the including project's
    // directory; its project directory the first path's directory where none
    // is written; its variables its `env_file`s, else the `.env` of its
    // project directory, as defaults only - the including project's
    // environment (its shell, its `.env` or `--env-file`s) is kept over them.
    const from = file.dir;
    const labelFrom = dirname(file.path);
    for (const include of composeIncludes(text)) {
      const first = include.paths[0];
      if (first === undefined) continue;
      const dir = include.projectDirectory === undefined ? dirname(resolve(from, first)) : resolve(from, include.projectDirectory);
      const own = include.envFiles.length === 0 ? (variablesIn(join(dir, '.env')) ?? {}) : variablesOfFiles(include.envFiles.map((each) => resolve(from, each)), [file.within, input.rootDir]);
      for (const written of include.paths) {
        const path = resolve(from, written);
        // A file outside the directories this project reads is somebody else's, and a file is included once.
        if (![file.within, input.rootDir].some((each) => isWithin(each, path)) || seen.has(realOf(path))) continue;
        const label = posix.normalize(posix.join(posix.dirname(file.label), relative(labelFrom, path).split(sep).join('/')));
        composeRead({ path, dir, label, within: file.within, ...(file.owner === undefined ? {} : { owner: file.owner }) }, { ...own, ...variables }, new Set([...seen, realOf(path)]));
      }
    }
  };
  const composeAt = (dir: string, label: (name: string) => string, owner?: string): void => {
    const names = filesAt(dir).filter(isComposeFile);
    // A file another of the directory includes is read as part of that one (P337).
    const included = new Set(names.flatMap((name) => composeIncludes(read(join(dir, name)) ?? '').flatMap((each) => each.paths.map((path) => realOf(resolve(dir, path))))));
    for (const name of names) {
      const path = join(dir, name);
      if (included.has(realOf(path))) continue;
      composeRead({ path, dir, label: label(name), within: dir, ...(owner === undefined ? {} : { owner }) }, composeVariables(dir, name, composeCommands, input.rootDir), new Set([realOf(path)]));
    }
  };

  // What the commands of each service and of the project run - scripts,
  // Makefiles, pipelines (P263): the charts and helmfiles they install, the
  // overlays they apply, and the ports they forward to a cluster (P260).
  const rootIsService = input.services.some((service) => realOf(service.dir) === realOf(input.rootDir));
  const scripts: Commands[] = [
    ...input.services.map((service) => ({ base: service.dir, owner: service.name, commands: commandsAround(service.dir, '.') })),
    ...(rootIsService ? [] : [{ base: input.rootDir, commands: commandsAround(input.rootDir, '.') }]),
  ];
  const helmfiles = scripts.map((each) => ({ owner: each.owner, ...helmfileInstalls(each, input.rootDir) }));
  const installs = [...scripts.flatMap((each) => chartInstalls(each, input.rootDir)), ...helmfiles.flatMap((each) => each.installs)];
  const forwards = scripts.flatMap((each) => readPortForwards(each.commands));
  const images = builtImages(scripts, input.rootDir);
  const composeCommands: ComposeCommand[] = scripts.flatMap((each) => composeRunsOf(each.commands).map((run) => ({ run, base: each.base })));
  const choice: ManifestChoice = {
    ...(input.environment === undefined ? {} : { environment: environmentName(input.environment) }),
    ...(input.overlays === undefined ? {} : { overlays: input.overlays.map((each) => resolve(each)) }),
    ...(input.chartValues === undefined ? {} : { chartValues: new Map(Object.entries(input.chartValues).map(([chart, files]) => [resolve(chart), files.map((each) => resolve(each))])) }),
    installs,
    applied: [...new Set(scripts.flatMap((each) => appliedKustomizations(each, input.rootDir)))],
    environmentOf: environmentName,
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
    // An Angular application's environment files, by the key its code reads (P280).
    for (const { file, environment, written } of angularEnvironmentsOf(service.dir)) {
      for (const { name, raw } of written) {
        const value = keptValue(name, raw);
        if (value !== undefined) add(into, name, { value, file, ...(environment === undefined ? {} : { environment }) });
      }
    }
    readWorkspaceEnv(into, service.dir);
    manifests.push({ read: readManifestsUnder(service.dir, new Set(), choice), owner: service.name });
    composeAt(service.dir, (name) => name, service.name);
  }
  // The compose files at the top of each workspace a service is a package of,
  // where the configuration is kept elsewhere (P283): the containers they
  // start are built from the packages, as those beside the configuration are.
  const workspaceRoots = new Map<string, string>();
  for (const service of input.services) {
    const root = workspaceRootOf(service.dir);
    if (root !== undefined && realOf(root) !== realOf(input.rootDir) && !byDir.has(realOf(root)) && !workspaceRoots.has(realOf(root))) workspaceRoots.set(realOf(root), resolve(root));
  }
  for (const root of [...workspaceRoots.values()].sort()) composeAt(root, (name) => relative(resolve(input.rootDir), join(root, name)).split(sep).join('/'));
  if (!byDir.has(realOf(input.rootDir))) {
    composeAt(input.rootDir, (name) => name);
    manifests.push({ read: readManifestsUnder(input.rootDir, new Set(input.services.map((service) => resolve(service.dir))), choice) });
  }
  // Every image the project builds (P325, P331): by a command, by a compose
  // file under its `image:`, by a Skaffold configuration.
  const allImages = [
    ...images,
    ...composeImages(composeFiles),
    ...[...new Set([...input.services.map((service) => resolve(service.dir)), resolve(input.rootDir)])].flatMap(skaffoldImages),
  ];
  for (const service of input.services) {
    readRuns(byService.get(service.name) as Gathered, scripts.find((each) => each.owner === service.name)?.commands ?? [], service.dir, input.rootDir, allImages);
  }
  for (const each of scripts) readStarts(each, input.services, byService, input.rootDir);
  const dirOf = new Map(input.services.map((service) => [service.name, service.dir]));
  // A workload's containers' environment (P331): the Dockerfile of the image
  // they run, where the project builds it, under what the manifest writes.
  const environmentOf: ContainerEnvironmentOf = (container, service) => {
    const environment = containerEnvironment();
    const image: ImageReading | undefined =
      container?.image !== undefined
        ? imageReading(container.image, allImages)
        : container?.imageUnsettled !== undefined
          ? { unread: { image: container.imageUnsettled, why: UNSETTLED_IMAGE } }
          : undefined;
    if (image !== undefined && 'ports' in image) environment.layer(image.ports, image.path === undefined ? undefined : labelOf(image.path, dirOf.get(service) ?? input.rootDir, input.rootDir));
    layerManifest(environment, container);
    return { ...environment.done(), ...(image !== undefined && 'unread' in image ? { imageUnread: image.unread } : {}) };
  };
  const { routed, workloads } = routedNames(manifests, names, environmentOf);
  for (const each of routed) {
    const into = byService.get(each.service) as Gathered;
    addRouted(into, each.routed);
    // The port each node opens for the object is this machine's where the cluster runs on it (P260).
    const opened = each.ports.flatMap(({ port, target }) => (port.nodePort === undefined ? [] : [{ published: port.nodePort, container: target, file: port.file, line: port.line }]));
    if (opened.length > 0) {
      const { environmentFrom: from } = each.routed;
      addContainer(into, {
        name: each.routed.name,
        names: [],
        file: each.routed.file,
        ports: opened,
        ...routedEnvironment(each.routed),
        via: 'node-port',
        ...(from === undefined ? {} : { environmentFrom: from }),
      });
    }
  }
  for (const [service, run] of forwardedRuns(forwards, routed, workloads, environmentOf)) addContainer(byService.get(service) as Gathered, run);
  const ways = waysIn(
    manifests.map((each) => each.read),
    routed,
  );
  for (const [service, way] of ways.routes) (byService.get(service) as Gathered).ingress.push(way);
  // A row about a manifest is said by the services it is about, or by the one whose repository holds it.
  const objectServices = new Map<string, string[]>();
  for (const each of routed) objectServices.set(each.object.name, [...(objectServices.get(each.object.name) ?? []), each.service]);
  for (const each of workloads) if (each.runs !== undefined) objectServices.set(each.workload.name, [...(objectServices.get(each.workload.name) ?? []), each.runs]);
  const rowsOf = (rows: readonly ManifestRow[], owner?: string): void => {
    for (const row of rows) {
      const about = [...new Set(row.about.flatMap((name) => [...(objectServices.get(name) ?? []), ...(names.has(name.toLowerCase()) ? [names.get(name.toLowerCase()) as string] : [])]))];
      for (const service of about.length > 0 ? about : owner === undefined ? [] : [owner]) {
        const into = byService.get(service) as Gathered;
        if (!into.rows.some((seen) => seen.file === row.file && seen.line === row.line && seen.reason === row.reason)) into.rows.push(manifestRow(row, service, row.file));
      }
    }
  };
  for (const { read, owner } of manifests) rowsOf(read.rows ?? [], owner);
  for (const { rows, owner } of helmfiles) rowsOf(rows, owner);
  rowsOf(ways.rows);

  for (const file of composeFiles) {
    for (const container of file.services) {
      const service = serviceOfContainer(container, file, byDir, names);
      if (service === undefined) continue;
      const into = byService.get(service) as Gathered;
      for (const host of [container.name, ...container.aliases]) into.hosts.push({ host: host.toLowerCase(), file: file.label });
      // The container's environment (P325): its image's Dockerfile, under
      // each `env_file:` in order, a later file over an earlier as compose
      // reads them, under `environment:`, written over the files' values. An
      // image whose Dockerfile is not read is said to be (P331).
      const environment = containerEnvironment();
      const fromImage = composeImage(container, file, allImages);
      if (fromImage !== undefined && 'ports' in fromImage) environment.layer(fromImage.ports, fromImage.label);
      for (const written of container.envFiles) {
        const path = isAbsolute(written) ? written : join(file.dir, written);
        // A file outside the directories this project reads is somebody else's.
        if (![file.dir, input.rootDir].some((dir) => isWithin(dir, path))) continue;
        const ports: Record<string, number> = {};
        const label = relative(file.dir, path).split(sep).join('/') || basename(path);
        readEnv(into, path, label, ports);
        environment.layer(ports, label);
      }
      environment.layer(environmentPorts(container.environment));
      // A published port with the port inside the container it reaches is a
      // mapping, both of whose sides are hosts (P254); one written alone is
      // still this machine's.
      addContainer(into, {
        name: container.name,
        names: [container.name, ...container.aliases].map((name) => name.toLowerCase()),
        file: file.label,
        ports: portsOf(container.mappings, file.label),
        ...environment.done(),
        ...(fromImage !== undefined && 'unread' in fromImage ? { imageUnread: fromImage.unread } : {}),
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
    const routes = into.routes;
    const ingress = into.ingress;
    const rows = into.rows;
    const sizes = [Object.keys(values), Object.keys(namedOnly), hosts, bindings, deployedAs, containers, Object.keys(ports), routes, ingress, rows];
    if (sizes.every((each) => each.length === 0)) continue;
    out[service] = {
      values,
      namedOnly,
      hosts,
      ...(bindings.length === 0 ? {} : { bindings }),
      ...(deployedAs.length === 0 ? {} : { deployedAs }),
      ...(containers.length === 0 ? {} : { containers }),
      ...(routes.length === 0 ? {} : { routes }),
      ...(ingress.length === 0 ? {} : { ingress }),
      ...(Object.keys(ports).length === 0 ? {} : { ports }),
      ...(rows.length === 0 ? {} : { rows }),
    };
  }
  return out;
};
