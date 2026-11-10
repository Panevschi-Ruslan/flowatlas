import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  keptValue,
  localHostsOf,
  looksSecret,
  portOf,
  proxyRule,
  type ContainerRun,
  type HostAlias,
  type IngressRoute,
  type PortValue,
  type ProxyRule,
  type RepoSettings,
  type RoutedName,
  type RoutedPort,
  type ServiceBinding,
  type SettingValue,
  type Unresolved,
  workspaceRootOf,
} from '@flowatlas/core';
import { readComposeFile, type ComposeService, type Mapping } from './compose.js';
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
import { commandsAround, type Command } from '@flowatlas/serverless';
import { dockerRunsOf, readHelmfileRuns, readHelmInstalls, readKustomizeApplies, readPortForwards, type PortForward } from './docker-run.js';
import { helmfilesAt, helmfilesIn, readHelmfile } from './helmfile.js';
import { namesInEnvFile, readEnvFile, type Written } from './dotenv.js';
import { angularEnvironmentsOf } from './angular-environments.js';
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
 * The containers the commands of a repository start with `docker run`: its
 * `package.json` scripts (P254), its shell scripts and Makefiles (P257), read
 * by the one command reader (P263).
 */
const readRuns = (into: Gathered, commands: readonly Command[]): void => {
  for (const run of dockerRunsOf(commands)) {
    addContainer(into, { name: run.name, names: run.names, file: run.file, ports: portsOf(run.mappings, run.file), environment: environmentPorts(run.environment) });
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
 * Each service object of the manifests, as the name it routes to one of the
 * project's services (P257): the service whose workload it selects - a
 * workload known by the service's name, or the only workload a service's own
 * repository declares - or the service of its own name where it selects
 * none. A named target port is the number the selected pods give that name;
 * one they do not name is not read. The environment is that of the container
 * the first port reaches.
 */
const routedNames = (manifests: ReadonlyArray<{ read: Manifests; owner?: string }>, names: ReadonlyMap<string, string>): { routed: Routed[]; workloads: Running[] } => {
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
          environment: environmentPorts(container?.environment ?? []),
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
    const readings = own.length === 0 ? [{}] : own.map(({ run, from }) => ({ environments: [run.environment], stateSets: run.stateSets, stateFiles: run.stateFiles.map((file) => resolve(from, file)), releases: run.releases, needs: run.needs }));
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

/**
 * The ports this machine forwards to a cluster's objects, as containers of
 * the services behind them (P260): `localhost:8080` reaches what the object
 * routes the remote port to, and the service is listening there as its
 * containers would be.
 */
const forwardedRuns = (forwards: readonly PortForward[], routed: readonly Routed[], workloads: readonly Running[]): Array<[string, ContainerRun]> =>
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
      return [[each.service, { name: `svc/${name}`, names: [], file, ports: [{ published: forward.local, container: port.target, file, line: forward.line }], environment: each.routed.environment, via: 'forwarded', environmentFrom: each.routed.environmentFrom ?? each.routed.file }]];
    }
    const found = workloads.filter((each) => each.workload.name.toLowerCase() === name && each.runs !== undefined && (forward.namespace === undefined || each.workload.namespace === undefined || each.workload.namespace === forward.namespace));
    if (found.length !== 1) return [];
    const { workload, runs } = found[0] as Running;
    const container = containerAt([workload], forward.remote);
    return [[runs as string, { name: `deploy/${name}`, names: [], file, ports: [{ published: forward.local, container: forward.remote, file, line: forward.line }], environment: environmentPorts(container?.environment ?? []), via: 'forwarded', environmentFrom: container?.environmentFile ?? workload.file }]];
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
    readRuns(into, scripts.find((each) => each.owner === service.name)?.commands ?? []);
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
  const { routed, workloads } = routedNames(manifests, names);
  for (const each of routed) {
    const into = byService.get(each.service) as Gathered;
    addRouted(into, each.routed);
    // The port each node opens for the object is this machine's where the cluster runs on it (P260).
    const opened = each.ports.flatMap(({ port, target }) => (port.nodePort === undefined ? [] : [{ published: port.nodePort, container: target, file: port.file, line: port.line }]));
    if (opened.length > 0) {
      const from = each.routed.environmentFrom;
      addContainer(into, { name: each.routed.name, names: [], file: each.routed.file, ports: opened, environment: each.routed.environment, via: 'node-port', ...(from === undefined ? {} : { environmentFrom: from }) });
    }
  }
  for (const [service, run] of forwardedRuns(forwards, routed, workloads)) addContainer(byService.get(service) as Gathered, run);
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
