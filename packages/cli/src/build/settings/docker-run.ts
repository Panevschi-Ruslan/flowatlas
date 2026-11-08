import type { Mapping } from './compose.js';

/**
 * A container a `package.json` script starts with `docker run` (P254): the
 * service whose repository holds the script is run in it, as a compose file's
 * container is the service it is built from.
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

/** Every `docker run` the scripts of a `package.json` write, with the line of the script's name. */
export const readDockerRuns = (text: string): DockerRun[] => {
  let scripts: unknown;
  try {
    scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
  } catch {
    return [];
  }
  if (typeof scripts !== 'object' || scripts === null) return [];
  const out: DockerRun[] = [];
  for (const [script, command] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof command !== 'string') continue;
    const at = text.indexOf(JSON.stringify(script));
    const line = at < 0 ? 1 : text.slice(0, at).split('\n').length;
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
      out.push({ name: called, names: name === undefined ? [] : [name.toLowerCase()], mappings, environment });
    }
  }
  return out;
};
