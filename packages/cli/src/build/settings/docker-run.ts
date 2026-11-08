import type { Mapping } from './compose.js';

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

const port = (value: string | undefined): number | undefined => {
  const number = Number(value);
  return value !== undefined && /^\d+$/.test(value) && number > 0 && number < 65536 ? number : undefined;
};

/** Options of `docker run` that take a value, so the image is the first word that is neither. */
const VALUED = /^(?:-[pelvwuh]|--(?:publish|env|env-file|label|volume|workdir|user|hostname|name|network|entrypoint|mount|platform|restart|memory|cpus))$/;

/** Every `docker run` one command line writes, each as written at `line`. */
const runsIn = (command: string, line: number): DockerRun[] => {
  const out: DockerRun[] = [];
  for (const part of command.split(/&&|\|\||;|\|/)) {
    const words = part.trim().split(/\s+/);
    const run = words.findIndex((word, index) => word === 'run' && words[index - 1] === 'docker');
    if (run < 0) continue;
    const mappings: Mapping[] = [];
    const environment: Array<{ name: string; raw: string }> = [];
    let name: string | undefined;
    let image: string | undefined;
    for (let index = run + 1; index < words.length; index += 1) {
      const word = words[index] as string;
      const [flag, inline] = word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
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
    if (called === undefined || called === '' || called.includes('$')) continue;
    out.push({ name: called, names: name === undefined || name.includes('$') ? [] : [name.toLowerCase()], mappings, environment });
  }
  return out;
};

/** One command line a script writes, and the line it starts on. */
export interface ScriptLine {
  readonly command: string;
  readonly line: number;
}

/** The scripts of a `package.json`, each at the line of its name. */
export const packageScriptLines = (text: string): ScriptLine[] => {
  let scripts: unknown;
  try {
    scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
  } catch {
    return [];
  }
  if (typeof scripts !== 'object' || scripts === null) return [];
  return Object.entries(scripts as Record<string, unknown>).flatMap(([script, command]) => {
    if (typeof command !== 'string') return [];
    const at = text.indexOf(JSON.stringify(script));
    return [{ command, line: at < 0 ? 1 : text.slice(0, at).split('\n').length }];
  });
};

/**
 * The commands of a shell script or a Makefile, each at the line it starts
 * on: a command continued with `\` is one command, a comment is none, and a
 * recipe's leading `@` or `-` is not part of it.
 */
export const scriptLines = (text: string): ScriptLine[] => {
  const lines = text.split('\n');
  const out: ScriptLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = index;
    let command = lines[index] as string;
    while (command.trimEnd().endsWith('\\') && index + 1 < lines.length) {
      index += 1;
      command = `${command.trimEnd().slice(0, -1)} ${lines[index] as string}`;
    }
    if (/^\s*#/.test(command)) continue;
    out.push({ command: command.replace(/^\s*[@-]+/, ''), line: start + 1 });
  }
  return out;
};

/** Every `docker run` the scripts of a `package.json` write, with the line of the script's name. */
export const readDockerRuns = (text: string): DockerRun[] => packageScriptLines(text).flatMap(({ command, line }) => runsIn(command, line));

/**
 * Every `docker run` a shell script or a Makefile of the repository writes
 * (P257), each at the line it starts on. A port written as a variable
 * (`$(PORT)`, `$PORT`) is the shell's, as in a script.
 */
export const readDockerRunsInScript = (text: string): DockerRun[] =>
  scriptLines(text).flatMap(({ command, line }) => (/\bdocker\s+run\b/.test(command) ? runsIn(command, line) : []));

/** The words of each command of a line, split at `&&`, `||`, `;` and `|`, quotes taken off. */
const commandsIn = (command: string): string[][] =>
  command
    .split(/&&|\|\||;|\|/)
    .map((part) => part.trim().split(/\s+/).filter((word) => word !== '').map((word) => word.replace(/^(['"])(.*)\1$/, '$2')));

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

/** Every `kubectl port-forward` a script writes, one per port it forwards (P260). */
export const readPortForwards = (lines: readonly ScriptLine[]): PortForward[] => {
  const out: PortForward[] = [];
  for (const { command, line } of lines) {
    if (!/\bport-forward\b/.test(command)) continue;
    for (const words of commandsIn(command)) {
      const at = words.indexOf('port-forward');
      if (at < 0 || !/(?:^|\/)kubectl$/.test(words[0] ?? '')) continue;
      let target: { kind: PortForward['kind']; name: string } | undefined;
      let namespace: string | undefined;
      const ports: Array<[number, number]> = [];
      for (let index = at + 1; index < words.length; index += 1) {
        const word = words[index] as string;
        if (word === '-n' || word === '--namespace') {
          namespace = words[(index += 1)];
          continue;
        }
        if (word.startsWith('--namespace=')) {
          namespace = word.slice('--namespace='.length);
          continue;
        }
        if (word.startsWith('-')) {
          if (word === '--address' || word === '--pod-running-timeout') index += 1;
          continue;
        }
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
      if (target === undefined || namespace?.includes('$') === true) continue;
      for (const [local, remote] of ports) out.push({ ...target, ...(namespace === undefined ? {} : { namespace }), local, remote, line });
    }
  }
  return out;
};

/**
 * A command that installs a chart (P260): `helm upgrade --install orders
 * ./charts/orders -f values-prod.yaml --set service.port=80 -n shop`, and
 * `helm template orders ./charts/orders`. Paths are as written; the caller
 * resolves them against where the script is run from.
 */
export interface HelmInstall {
  readonly release?: string;
  readonly chart: string;
  readonly namespace?: string;
  readonly values: readonly string[];
  readonly sets: readonly string[];
  readonly line: number;
}

/** Options of a chart install that take a value, so the release and the chart are the words that are neither. */
const HELM_VALUED = /^(?:-f|--values|--set|--set-string|--set-file|-n|--namespace|--version|--repo|--kube-context|--kubeconfig|--timeout|--post-renderer|--description|--name-template|-o|--output|--output-dir|--api-versions|-a|--history-max)$/;

/** Every chart a script installs or renders, with the values it gives (P260). */
export const readHelmInstalls = (lines: readonly ScriptLine[]): HelmInstall[] => {
  const out: HelmInstall[] = [];
  for (const { command, line } of lines) {
    if (!/\bhelm\b/.test(command)) continue;
    for (const words of commandsIn(command)) {
      if (!/(?:^|\/)helm$/.test(words[0] ?? '')) continue;
      const verb = words[1];
      if (verb !== 'install' && verb !== 'upgrade' && verb !== 'template') continue;
      const values: string[] = [];
      const sets: string[] = [];
      const plain: string[] = [];
      let namespace: string | undefined;
      for (let index = 2; index < words.length; index += 1) {
        const word = words[index] as string;
        const [flag, inline] = word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
        if (HELM_VALUED.test(flag)) {
          const value = inline ?? words[(index += 1)];
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
      });
    }
  }
  return out;
};
