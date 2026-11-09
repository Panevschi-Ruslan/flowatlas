import type { Command } from '@flowatlas/serverless';
import type { Mapping } from './compose.js';

/**
 * What the commands of a repository run against a container or a cluster
 * (P254, P257, P260, P263), read from the commands the shared reader finds
 * (`commandsAround`: `package.json` scripts, Makefiles, shell scripts, GitHub
 * workflows, GitLab jobs), each where it is written.
 */

/**
 * A container a `package.json` script, a shell script or a Makefile starts
 * with `docker run` (P254, P257): the service whose repository holds it is run
 * in it, as a compose file's container is the service it is built from.
 *
 * `docker run -p 3001:3000 --name orders -e PORT=3000 orders:latest`: the
 * ports it publishes (`-p`, `--publish`, both sides), the name its network
 * reaches it by (`--name`), and the ports its environment gives a setting
 * (`-e`, `--env`). Nothing is expanded: `$PORT` is the shell's.
 */
export interface DockerRun {
  /** `--name`, or the image without its tag and registry. */
  readonly name: string;
  /** What its network reaches it by: the `--name` given, if any. */
  readonly names: readonly string[];
  readonly mappings: readonly Mapping[];
  readonly environment: ReadonlyArray<{ readonly name: string; readonly raw: string }>;
}

/** The words of a command, as the shared reader splits them, and where it is written. */
export type CommandAt = Pick<Command, 'words' | 'line' | 'file'> & Partial<Pick<Command, 'dirs'>>;

/** Where a `docker run` is written, beside what it runs. */
export type DockerRunAt = DockerRun & { readonly file: string };

const port = (value: string | undefined): number | undefined => {
  const number = Number(value);
  return value !== undefined && /^\d+$/.test(value) && number > 0 && number < 65536 ? number : undefined;
};

/** Options of `docker run` that take a value, so the image is the first word that is neither. */
const VALUED = /^(?:-[pelvwuh]|--(?:publish|env|env-file|label|volume|workdir|user|hostname|name|network|entrypoint|mount|platform|restart|memory|cpus))$/;

/** A word that is a program, written bare or with its directory: `kubectl`, `bin/helm`. */
const isProgram = (word: string | undefined, program: string): boolean => word === program || (word ?? '').endsWith(`/${program}`);

/** The words of a command after the program it runs, if it runs it. */
const argumentsOf = (words: readonly string[], program: string): string[] | undefined => {
  const at = words.findIndex((word) => isProgram(word, program));
  return at < 0 ? undefined : words.slice(at + 1);
};

/** An option written `--flag=value`, split; any other word as it is. */
const splitFlag = (word: string): [string, string | undefined] =>
  word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];

/** The `docker run` a command is, if it is one. */
const runOf = (words: readonly string[], line: number): DockerRun | undefined => {
  const run = words.findIndex((word, index) => word === 'run' && isProgram(words[index - 1], 'docker'));
  if (run < 0) return undefined;
  const mappings: Mapping[] = [];
  const environment: Array<{ name: string; raw: string }> = [];
  let name: string | undefined;
  let image: string | undefined;
  for (let index = run + 1; index < words.length; index += 1) {
    const word = words[index] as string;
    const [flag, inline] = splitFlag(word);
    const valued = VALUED.test(flag);
    const value = valued ? (inline ?? words[(index += 1)]) : undefined;
    if (flag === '-p' || flag === '--publish') {
      const sides = (value ?? '').replace(/\/\w+$/, '').split(':');
      const published = port(sides[sides.length - 2]);
      const container = port(sides[sides.length - 1]);
      if (published !== undefined && container !== undefined) mappings.push({ published, container, line });
    } else if (flag === '-e' || flag === '--env') {
      const equals = (value ?? '').indexOf('=');
      if (equals > 0) environment.push({ name: (value as string).slice(0, equals), raw: (value as string).slice(equals + 1) });
    } else if (flag === '--name') name = value;
    else if (!valued && !word.startsWith('-')) {
      image = word;
      break;
    }
  }
  const fromImage = image?.split('/').pop()?.split(':')[0];
  const called = name ?? fromImage;
  if (called === undefined || called === '' || called.includes('$')) return undefined;
  return { name: called, names: name === undefined || name.includes('$') ? [] : [name.toLowerCase()], mappings, environment };
};

/** Whether a command is written in a pipeline: a GitHub workflow or a GitLab CI file. */
export const isPipeline = (file: string): boolean => file.startsWith('.github/') || /(?:^|\/)\.gitlab-ci\.ya?ml$/.test(file);

/**
 * Every `docker run` the commands of a repository write (P254, P257): its
 * `package.json` scripts, its Makefiles and shell scripts, each at the line
 * it starts on. A port written as a variable (`$(PORT)`, `$PORT`) is the
 * shell's. A pipeline's (P263) is not read: the container it starts runs on
 * the pipeline's machine, not where a developer runs the service.
 */
export const dockerRunsOf = (commands: readonly CommandAt[]): DockerRunAt[] =>
  commands.flatMap((command) => {
    if (isPipeline(command.file)) return [];
    const run = runOf(command.words, command.line);
    return run === undefined ? [] : [{ ...run, file: command.file }];
  });

/**
 * A port this machine forwards to a cluster's object (P260): `kubectl
 * port-forward svc/orders 8080:80` makes `localhost:8080` reach port 80 of the
 * service object `orders`; `deploy/orders 8080:3000` port 3000 of its pods.
 */
export interface PortForward {
  /** What it forwards to: a service object, or a workload's pods. */
  readonly kind: 'service' | 'workload';
  readonly name: string;
  readonly namespace?: string;
  /** The port on this machine. */
  readonly local: number;
  /** The port of the service object, or of the pods. */
  readonly remote: number;
  readonly line: number;
  /** The file the command is written in (P263). */
  readonly file: string;
}

const FORWARD_KINDS: Readonly<Record<string, PortForward['kind']>> = {
  svc: 'service',
  service: 'service',
  services: 'service',
  deploy: 'workload',
  deployment: 'workload',
  deployments: 'workload',
  sts: 'workload',
  statefulset: 'workload',
  statefulsets: 'workload',
  ds: 'workload',
  daemonset: 'workload',
  rs: 'workload',
  replicaset: 'workload',
};

/** Options of `kubectl` that take a value, wherever they are written. */
const KUBECTL_VALUED = new Set(['-n', '--namespace', '--context', '--kubeconfig', '--cluster', '--user', '-s', '--server', '--address', '--pod-running-timeout', '-f', '--filename', '-l', '--selector']);

/** A `kubectl` command's verb, its plain words, and its namespace where it writes one. */
const kubectlOf = (words: readonly string[]): { verb?: string; plain: string[]; namespace?: string; options: Map<string, string> } | undefined => {
  const rest = argumentsOf(words, 'kubectl');
  if (rest === undefined) return undefined;
  const plain: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const [flag, inline] = splitFlag(rest[index] as string);
    if (KUBECTL_VALUED.has(flag) || flag === '-k' || flag === '--kustomize') {
      const value = inline ?? rest[(index += 1)];
      if (value !== undefined) options.set(flag, value);
      continue;
    }
    if (!flag.startsWith('-')) plain.push(flag);
  }
  const namespace = options.get('-n') ?? options.get('--namespace');
  const [verb, ...others] = plain;
  return { ...(verb === undefined ? {} : { verb }), plain: others, ...(namespace === undefined ? {} : { namespace }), options };
};

/** Every `kubectl port-forward` the commands write, one per port it forwards (P260), in a pipeline too (P263). */
export const readPortForwards = (commands: readonly CommandAt[]): PortForward[] => {
  const out: PortForward[] = [];
  for (const { words, line, file } of commands) {
    const kubectl = kubectlOf(words);
    if (kubectl?.verb !== 'port-forward' || kubectl.namespace?.includes('$') === true) continue;
    let target: { kind: PortForward['kind']; name: string } | undefined;
    const ports: Array<[number, number]> = [];
    for (const word of kubectl.plain) {
      const slash = /^([a-z]+)\/([\w.-]+)$/.exec(word);
      if (target === undefined && slash !== null) {
        const kind = FORWARD_KINDS[slash[1] as string];
        if (kind !== undefined) target = { kind, name: slash[2] as string };
        continue;
      }
      const sides = /^(\d+)(?::(\d+))?$/.exec(word);
      if (sides !== null) {
        const local = port(sides[1]);
        const remote = port(sides[2] ?? sides[1]);
        if (local !== undefined && remote !== undefined) ports.push([local, remote]);
      }
    }
    if (target === undefined) continue;
    for (const [local, remote] of ports) out.push({ ...target, ...(kubectl.namespace === undefined ? {} : { namespace: kubectl.namespace }), local, remote, line, file });
  }
  return out;
};

/**
 * A command that installs a chart (P260): `helm upgrade --install orders
 * ./charts/orders -f values-prod.yaml --set service.port=80 -n shop`, and
 * `helm template orders ./charts/orders`. Paths are as written; the caller
 * resolves them against where the command runs (`dirs`).
 */
export interface HelmInstall {
  readonly release?: string;
  readonly chart: string;
  readonly namespace?: string;
  readonly values: readonly string[];
  readonly sets: readonly string[];
  readonly line: number;
  /** The file the command is written in, and where it runs, repo-relative (P263). */
  readonly file: string;
  readonly dirs: readonly string[];
}

/** Options of a chart install that take a value, so the release and the chart are the words that are neither. */
const HELM_VALUED = /^(?:-f|--values|--set|--set-string|--set-file|-n|--namespace|--version|--repo|--kube-context|--kubeconfig|--timeout|--post-renderer|--description|--name-template|-o|--output|--output-dir|--api-versions|-a|--history-max)$/;

/** Every chart the commands install or render, with the values they give (P260), in a pipeline too (P263). */
export const readHelmInstalls = (commands: readonly CommandAt[]): HelmInstall[] => {
  const out: HelmInstall[] = [];
  for (const { words, line, file, dirs } of commands) {
    const rest = argumentsOf(words, 'helm');
    if (rest === undefined) continue;
    const verb = rest[0];
    if (verb !== 'install' && verb !== 'upgrade' && verb !== 'template') continue;
    const values: string[] = [];
    const sets: string[] = [];
    const plain: string[] = [];
    let namespace: string | undefined;
    for (let index = 1; index < rest.length; index += 1) {
      const word = rest[index] as string;
      const [flag, inline] = splitFlag(word);
      if (HELM_VALUED.test(flag)) {
        const value = inline ?? rest[(index += 1)];
        if (value === undefined) continue;
        if (flag === '-f' || flag === '--values') values.push(...value.split(','));
        else if (flag === '--set' || flag === '--set-string') sets.push(...value.split(','));
        else if (flag === '-n' || flag === '--namespace') namespace = value;
        continue;
      }
      if (!word.startsWith('-')) plain.push(word);
    }
    // `helm template` takes the release's name only where it is given; the others always do.
    const [release, chart] = plain.length >= 2 ? [plain[0], plain[1]] : verb === 'template' ? [undefined, plain[0]] : [undefined, undefined];
    // A chart of a repository (`bitnami/redis`) is no directory of the project's, which the caller finds out.
    if (chart === undefined || chart.includes('$')) continue;
    out.push({
      ...(release === undefined || release.includes('$') ? {} : { release }),
      chart,
      ...(namespace === undefined || namespace.includes('$') ? {} : { namespace }),
      values: values.filter((each) => !each.includes('$')),
      sets: sets.filter((each) => !each.includes('$')),
      line,
      file,
      dirs: dirs ?? ['.'],
    });
  }
  return out;
};

/**
 * A `helmfile` command (P263): `helmfile -f deploy/helmfile.yaml -e production
 * --state-values-set replicas=2 -l name=orders apply`. The environment it
 * chooses, the state values it sets, the releases its selectors keep.
 */
export interface HelmfileRun {
  /** `-f` / `--file`, as written. */
  readonly helmfile?: string;
  /** `-e` / `--environment`; `default` where none is written. */
  readonly environment: string;
  readonly stateSets: readonly string[];
  readonly stateFiles: readonly string[];
  /** The release names `-l name=…` keeps; empty for every release. */
  readonly releases: readonly string[];
  readonly line: number;
  readonly file: string;
  readonly dirs: readonly string[];
}

const HELMFILE_VALUED = new Set(['-f', '--file', '-e', '--environment', '--state-values-set', '--state-values-file', '-l', '--selector', '--kube-context', '-n', '--namespace', '-c', '--chart', '--helm-binary', '-b']);

/** Every `helmfile` command the commands write that installs or renders releases (P263). */
export const readHelmfileRuns = (commands: readonly CommandAt[]): HelmfileRun[] => {
  const out: HelmfileRun[] = [];
  for (const { words, line, file, dirs } of commands) {
    const rest = argumentsOf(words, 'helmfile');
    if (rest === undefined) continue;
    const options: Array<[string, string]> = [];
    const plain: string[] = [];
    for (let index = 0; index < rest.length; index += 1) {
      const [flag, inline] = splitFlag(rest[index] as string);
      if (HELMFILE_VALUED.has(flag)) {
        const value = inline ?? rest[(index += 1)];
        if (value !== undefined) options.push([flag, value]);
        continue;
      }
      if (!flag.startsWith('-')) plain.push(flag);
    }
    if (!plain.some((verb) => ['apply', 'sync', 'template', 'diff', 'deploy'].includes(verb))) continue;
    const valued = (...flags: string[]): string[] => options.filter(([flag]) => flags.includes(flag)).map(([, value]) => value);
    const environment = valued('-e', '--environment')[0] ?? 'default';
    const helmfile = valued('-f', '--file')[0];
    if (environment.includes('$') || helmfile?.includes('$') === true) continue;
    const releases = valued('-l', '--selector').flatMap((selector) => selector.split(',').flatMap((part) => (/^name=([\w.-]+)$/.exec(part)?.[1] === undefined ? [] : [/^name=([\w.-]+)$/.exec(part)?.[1] as string])));
    out.push({
      ...(helmfile === undefined ? {} : { helmfile }),
      environment,
      stateSets: valued('--state-values-set').flatMap((each) => each.split(',')).filter((each) => !each.includes('$')),
      stateFiles: valued('--state-values-file').filter((each) => !each.includes('$')),
      releases,
      line,
      file,
      dirs: dirs ?? ['.'],
    });
  }
  return out;
};

/**
 * A kustomization a command builds or applies (P263): `kubectl apply -k
 * deploy/overlays/production`, `kubectl kustomize overlays/staging`,
 * `kustomize build overlays/staging`. The folder as written; the caller
 * resolves it against where the command runs.
 */
export interface KustomizeApply {
  readonly folder: string;
  readonly line: number;
  readonly file: string;
  readonly dirs: readonly string[];
}

/** Every kustomization the commands build or apply (P263). */
export const readKustomizeApplies = (commands: readonly CommandAt[]): KustomizeApply[] =>
  commands.flatMap(({ words, line, file, dirs }): KustomizeApply[] => {
    const at = { line, file, dirs: dirs ?? ['.'] };
    const kubectl = kubectlOf(words);
    const kustomized = kubectl?.options.get('-k') ?? kubectl?.options.get('--kustomize');
    if (kubectl !== undefined && (kubectl.verb === 'apply' || kubectl.verb === 'create' || kubectl.verb === 'diff' || kubectl.verb === 'replace') && kustomized !== undefined) {
      return kustomized.includes('$') ? [] : [{ folder: kustomized, ...at }];
    }
    if (kubectl?.verb === 'kustomize') {
      const folder = kubectl.plain[0] ?? '.';
      return folder.includes('$') ? [] : [{ folder, ...at }];
    }
    const kustomize = argumentsOf(words, 'kustomize');
    if (kustomize?.[0] === 'build') {
      const folder = kustomize.slice(1).find((word) => !word.startsWith('-')) ?? '.';
      return folder.includes('$') ? [] : [{ folder, ...at }];
    }
    return [];
  });
