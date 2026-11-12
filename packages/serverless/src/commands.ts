import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { readServiceYaml } from './document.js';
import { isRecord, textOf, Unread } from './variables.js';

/**
 * The commands a repository writes down for a person or a pipeline to run
 * (P259, P261), where a tool that deploys a template is run: the scripts of a
 * `package.json` and the recipes of a Makefile (`Makefile`, `makefile`,
 * `GNUmakefile`, `*.mk`, P263) in a directory, the shell
 * scripts (`*.sh`) beside them and in the repository's `scripts/` and `bin/`,
 * the steps of a GitHub Actions workflow (`.github/workflows/*.yml`) and the
 * scripts of a GitLab CI job (`.gitlab-ci.yml`).
 *
 * A command is read as a shell reads it, as far as the files settle it: split
 * at `&&`, `||`, `;` and `|`, a line ending in `\` joined to the next, quotes
 * taken off; a literal `cd` moves where the commands after it run; a literal
 * `export X=v`, a `X=v` written before a command, and a pipeline's `env:` or
 * `variables:` are its environment. A value with a shell variable or an
 * expression of the pipeline's in it (`$X`, `$(x)`, backticks, `${{ }}`) is
 * not known from the files, and is said so where it is used. A `cd` to such a
 * directory leaves the commands after it with no directory (`dirs` empty):
 * what they run is still read, and where they run is each caller's to decide.
 *
 * Read by every reader of the commands that deploy or run something - the
 * stacks a template is deployed as (`sam`), the charts and overlays a cluster
 * is installed from (the CLI's settings, P263) - so a pipeline's command and a
 * Makefile's are read alike, once.
 */

/** A value written on a command or in its environment, or why it is not known from the files. */
export type DeployedValue = string | Unread;

/** One command, where it is written and where it runs. */
export interface Command {
  /** The file it is written in, repo-relative. */
  readonly file: string;
  /** Its line, 1-based. */
  readonly line: number;
  /** What a person calls it: a script's or a recipe's name, a pipeline's job. */
  readonly label: string;
  /** The directories it may run in, repo-relative, the likeliest first: a shell script's own, then the repository's; none after a `cd` the files do not settle. */
  readonly dirs: readonly string[];
  /** Its words, quotes taken off, the environment written before it left out. */
  readonly words: readonly string[];
  /** The environment it runs with, as far as the files write it. */
  readonly env: Readonly<Record<string, DeployedValue>>;
}

const textAt = (repoDir: string, file: string): string | undefined => {
  try {
    return readFileSync(join(repoDir, file), 'utf8');
  } catch {
    return undefined;
  }
};

/** The files of a directory, repo-relative, sorted. */
const filesIn = (repoDir: string, dir: string): string[] => {
  try {
    return readdirSync(join(repoDir, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
      .map((name) => under(dir, name));
  } catch {
    return [];
  }
};

/** A path joined under a directory, `.` being the repository. */
export const under = (dir: string, path: string): string => posix.normalize(dir === '.' ? path : `${dir}/${path}`);

/** A command split into words as a shell splits it, quotes taken off. */
export const wordsOf = (command: string): string[] => [...command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');

/** Whether a value has something in it the shell or the pipeline fills in when it runs. */
export const isFilledIn = (written: string): boolean => /[$`]/.test(written);

/** What a value written on a command is: text, or why it is not known from the files. */
export const commandValue = (written: string): DeployedValue => (isFilledIn(written) ? new Unread(`it is ${written} on the command, which the shell fills in when it runs`) : written);

/** An assignment written as a shell writes one: `X=v`. */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/** `cd "$(dirname "$0")"` and its spellings: the script's own directory. */
const OWN_DIRECTORY = /^\$\(dirname\s+"?\$(?:0|\{BASH_SOURCE(?:\[0\])?\})"?\)$/;

/**
 * The commands of a script: a recipe, a pipeline's step, a shell script.
 * `at` is the line of its first line, `dirs` where it starts to run, `own` the
 * directory of the script's own file, `env` the environment it starts with.
 */
const commandsOfScript = (text: string, at: { file: string; line: number; label: string }, dirs: readonly string[], env: Readonly<Record<string, DeployedValue>>, own = dirs[0] ?? '.'): Command[] => {
  const found: Command[] = [];
  let where = [...dirs];
  const scope: Record<string, DeployedValue> = { ...env };
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = at.line + index;
    let written = lines[index] as string;
    // A line ending in a backslash goes on on the next.
    while (/\\\s*$/.test(written) && index + 1 < lines.length) {
      index += 1;
      written = `${written.replace(/\\\s*$/, ' ')}${lines[index] as string}`;
    }
    if (/^\s*#/.test(written)) continue;
    for (const part of written.split(/&&|\|\||;|\|/)) {
      const words = wordsOf(part.trim());
      const inline: Record<string, DeployedValue> = {};
      let first = 0;
      if (words[0] === 'export') first = 1;
      while (first < words.length && ASSIGNMENT.test(words[first] as string)) {
        const [, name, value] = ASSIGNMENT.exec(words[first] as string) as RegExpExecArray;
        inline[name as string] = commandValue(value as string);
        first += 1;
      }
      const command = words.slice(first);
      if (command.length === 0 || words[0] === 'export') {
        // Assignments alone, or exported: the environment of what follows.
        Object.assign(scope, inline);
        continue;
      }
      if (command[0] === 'cd') {
        const to = command[1];
        where = to === undefined ? ['.'] : OWN_DIRECTORY.test(to) ? [own] : isFilledIn(to) || to === '-' ? [] : where.map((dir) => under(dir, to));
        continue;
      }
      found.push({ file: at.file, line, label: at.label, dirs: where, words: command, env: { ...scope, ...inline } });
    }
  }
  return found;
};

/** The scripts of a `package.json`, each where its name is written. */
const packageScripts = (repoDir: string, dir: string): Command[] => {
  const manifest = under(dir, 'package.json');
  const json = textAt(repoDir, manifest);
  if (json === undefined) return [];
  let scripts: unknown;
  try {
    scripts = (JSON.parse(json) as { scripts?: unknown }).scripts;
  } catch {
    return [];
  }
  return Object.entries(isRecord(scripts) ? scripts : {}).flatMap(([name, script]) => {
    if (typeof script !== 'string') return [];
    const at = json.indexOf(JSON.stringify(name));
    return commandsOfScript(script, { file: manifest, line: at < 0 ? 1 : json.slice(0, at).split('\n').length, label: name }, [dir], {});
  });
};

/** The names a Makefile goes by, beside the included `*.mk` files. */
const MAKEFILES = /^(?:Makefile|makefile|GNUmakefile|.+\.mk)$/;

/** The recipes of every Makefile of a directory, each line where it is written. */
const makeRecipes = (repoDir: string, dir: string): Command[] => filesIn(repoDir, dir).filter((file) => MAKEFILES.test(posix.basename(file))).flatMap((file) => recipesOf(repoDir, file));

/** The recipes of one Makefile. */
const recipesOf = (repoDir: string, makefile: string): Command[] => {
  const make = textAt(repoDir, makefile);
  if (make === undefined) return [];
  const found: Command[] = [];
  let target = '';
  const lines = make.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] as string;
    const rule = /^([A-Za-z0-9_.\-/]+)\s*:(?!=)/.exec(raw);
    if (rule !== null) target = rule[1] as string;
    if (!raw.startsWith('\t')) continue;
    // A recipe line ending in a backslash goes on on the next, as the shell is handed it.
    const start = index;
    let written = raw.trim();
    while (/\\\s*$/.test(written) && index + 1 < lines.length) {
      index += 1;
      written = `${written.replace(/\\\s*$/, ' ')}${(lines[index] as string).trim()}`;
    }
    found.push(...commandsOfScript(written.replace(/^[@-]+/, ''), { file: makefile, line: start + 1, label: target }, [posix.dirname(makefile)], {}));
  }
  return found;
};

/** A shell script's commands: run from its own directory or from the repository's. */
const shellScript = (repoDir: string, file: string): Command[] => {
  const text = textAt(repoDir, file);
  if (text === undefined) return [];
  const own = posix.dirname(file);
  return commandsOfScript(text, { file, line: 1, label: posix.basename(file) }, own === '.' ? ['.'] : [own, '.'], {}, own);
};

/** The environment a pipeline writes: literal values, and what it fills in when it runs said as such. */
const pipelineEnv = (written: unknown): Record<string, DeployedValue> => {
  const out: Record<string, DeployedValue> = {};
  for (const [name, value] of Object.entries(isRecord(written) ? written : {})) {
    // GitLab writes a variable as `{ value, description }` too.
    const text = textOf(isRecord(value) ? value['value'] : value) ?? (typeof value === 'boolean' || typeof value === 'number' ? String(value) : undefined);
    out[name] = text === undefined ? new Unread(`${name} is not text in the pipeline`) : isFilledIn(text) ? new Unread(`${name} is ${text}, which the pipeline fills in when it runs`) : text;
  }
  return out;
};

/** A directory a pipeline step runs in, written literally; `undefined` where it is filled in when it runs. */
const workingDirectory = (written: unknown): string | undefined => {
  const text = textOf(written);
  return text === undefined ? '.' : isFilledIn(text) ? undefined : under('.', text);
};

/** The steps of a GitHub Actions workflow. */
const workflowSteps = (repoDir: string, file: string): Command[] => {
  const text = textAt(repoDir, file);
  if (text === undefined) return [];
  let document;
  try {
    document = readServiceYaml(text);
  } catch {
    return [];
  }
  const workflow = isRecord(document.value) ? document.value : {};
  const runDefaults = (owner: unknown): unknown => (isRecord(owner) && isRecord(owner['defaults']) && isRecord(owner['defaults']['run']) ? owner['defaults']['run']['working-directory'] : undefined);
  const found: Command[] = [];
  for (const [name, job] of Object.entries(isRecord(workflow['jobs']) ? workflow['jobs'] : {})) {
    if (!isRecord(job) || !Array.isArray(job['steps'])) continue;
    job['steps'].forEach((step, index) => {
      if (!isRecord(step) || typeof step['run'] !== 'string') return;
      const dir = workingDirectory(step['working-directory'] ?? runDefaults(job) ?? runDefaults(workflow));
      if (dir === undefined) return;
      const at = document.at(['jobs', name, 'steps', index, 'run'])?.line ?? 1;
      const run = step['run'];
      const env = { ...pipelineEnv(workflow['env']), ...pipelineEnv(job['env']), ...pipelineEnv(step['env']) };
      found.push(...commandsOfScript(run, { file, line: run.includes('\n') ? at + 1 : at, label: `${name}${typeof step['name'] === 'string' ? ` (${step['name']})` : ''}` }, [dir], env));
    });
  }
  return found;
};

/** Top-level keys of a GitLab CI file that are not jobs. */
const GITLAB_KEYWORDS = new Set(['stages', 'variables', 'default', 'include', 'workflow', 'image', 'services', 'cache', 'before_script', 'after_script']);

/** The scripts of the jobs of a GitLab CI file. */
const gitlabJobs = (repoDir: string, file: string): Command[] => {
  const text = textAt(repoDir, file);
  if (text === undefined) return [];
  let document;
  try {
    document = readServiceYaml(text);
  } catch {
    return [];
  }
  const pipeline = isRecord(document.value) ? document.value : {};
  const found: Command[] = [];
  for (const [name, job] of Object.entries(pipeline)) {
    if (GITLAB_KEYWORDS.has(name) || name.startsWith('.') || !isRecord(job)) continue;
    const env = { ...pipelineEnv(pipeline['variables']), ...pipelineEnv(job['variables']) };
    for (const key of ['before_script', 'script', 'after_script']) {
      const written = job[key];
      const items = Array.isArray(written) ? written : typeof written === 'string' ? [written] : [];
      items.forEach((item, index) => {
        if (typeof item !== 'string') return;
        const at = document.at(Array.isArray(written) ? [name, key, index] : [name, key])?.line ?? 1;
        found.push(...commandsOfScript(item, { file, line: at, label: name }, ['.'], env));
      });
    }
  }
  return found;
};

/** The pipelines and shell scripts kept at the top of the repository, read once wherever a template is. */
const topCommands = (repoDir: string): Command[] => [
  ...['scripts', 'bin'].flatMap((dir) => [...filesIn(repoDir, dir).filter((file) => file.endsWith('.sh')).flatMap((file) => shellScript(repoDir, file)), ...makeRecipes(repoDir, dir)]),
  ...filesIn(repoDir, '.github/workflows')
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => workflowSteps(repoDir, file)),
  ...gitlabJobs(repoDir, '.gitlab-ci.yml'),
];

/**
 * Every command that may run beside a directory: the scripts, recipes and
 * shell scripts of the directory and of each above it, and the pipelines and
 * scripts at the top of the repository.
 */
export const commandsAround = (repoDir: string, dir: string): Command[] => {
  const dirs: string[] = [];
  for (let at = dir === '' ? '.' : dir; ; at = posix.dirname(at)) {
    dirs.push(at);
    if (at === '.' || at === '') break;
  }
  const found = [
    ...dirs.flatMap((at) => [
      ...packageScripts(repoDir, at),
      ...makeRecipes(repoDir, at),
      ...(at === 'scripts' || at === 'bin' ? [] : filesIn(repoDir, at).filter((file) => file.endsWith('.sh')).flatMap((file) => shellScript(repoDir, file))),
    ]),
    ...topCommands(repoDir),
  ];
  const seen = new Set<string>();
  return found.filter((command) => {
    const key = `${command.file}:${command.line}:${command.words.join(' ')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
