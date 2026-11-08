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

/** Every `docker run` the scripts of a `package.json` write, with the line of the script's name. */
export const readDockerRuns = (text: string): DockerRun[] => {
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
    return runsIn(command, at < 0 ? 1 : text.slice(0, at).split('\n').length);
  });
};

/**
 * Every `docker run` a shell script or a Makefile of the repository writes
 * (P257), each at the line it starts on: a command continued with `\` is one
 * command, and a recipe's leading `@` or `-` is not part of it. A port written
 * as a variable (`$(PORT)`, `$PORT`) is the shell's, as in a script.
 */
export const readDockerRunsInScript = (text: string): DockerRun[] => {
  const lines = text.split('\n');
  const out: DockerRun[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = index;
    let command = lines[index] as string;
    while (command.trimEnd().endsWith('\\') && index + 1 < lines.length) {
      index += 1;
      command = `${command.trimEnd().slice(0, -1)} ${lines[index] as string}`;
    }
    if (/^\s*#/.test(command) || !/\bdocker\s+run\b/.test(command)) continue;
    out.push(...runsIn(command.replace(/^\s*[@-]+/, ''), start + 1));
  }
  return out;
};
