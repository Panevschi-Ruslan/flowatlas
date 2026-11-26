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
  /** The environment files it is started with (`--env-file`), as written, in order (P325). */
  readonly envFiles: readonly string[];
  /** The image it runs, as written: `orders:latest`. */
  readonly image?: string;
}

/**
 * An image a command builds with `docker build` (P325): the names it tags it
 * with (`-t`), without their tags; the Dockerfile (`-f`), as written; the
 * directory it is built from; the stage it builds (`--target`); and the
 * arguments it hands the build (`--build-arg NAME=value`).
 */
export interface DockerBuild {
  readonly names: readonly string[];
  readonly dockerfile?: string;
  readonly context: string;
  readonly target?: string;
  readonly args: Readonly<Record<string, string>>;
}

/** The words of a command, as the shared reader splits them, and where it is written. */
export type CommandAt = Pick<Command, 'words' | 'line' | 'file'> & Partial<Pick<Command, 'dirs' | 'env' | 'assumed'>>;

/** Where a `docker run` is written, beside what it runs, and the directories it may run in. */
export type DockerRunAt = DockerRun & { readonly file: string; readonly dirs?: readonly string[] };

/** Where a `docker build` is written, and the directories it may run in. */
export type DockerBuildAt = DockerBuild & { readonly file: string; readonly dirs?: readonly string[] };

const port = (value: string | undefined): number | undefined => {
  const number = Number(value);
  return value !== undefined && /^\d+$/.test(value) && number > 0 && number < 65536 ? number : undefined;
};

/** Options of `docker run` that take a value, so the image is the first word that is neither. */
const VALUED = /^(?:-[pelvwuh]|--(?:publish|env|env-file|label|volume|workdir|user|hostname|name|network|entrypoint|mount|platform|restart|memory|cpus))$/;

/** Options of `docker build` that take a value. */
const BUILD_VALUED = /^(?:-[tf]|--(?:tag|file|target|build-arg|platform|label|network|secret|ssh|cache-from|cache-to|output|progress|iidfile|add-host|build-context|shm-size|ulimit|memory|cpu-shares|isolation|cgroup-parent))$/;

/** An image's name as a run and a build both write it: without its registry and tag, lower case. */
export const imageName = (image: string): string => (image.split('/').pop() ?? image).split(':')[0]?.toLowerCase() ?? '';

/** A word that is a program, written bare or with its directory: `kubectl`, `bin/helm`. */
const isProgram = (word: string | undefined, program: string): boolean => word === program || (word ?? '').endsWith(`/${program}`);

/** The words of a command after the program it runs, if it runs it. */
const argumentsOf = (words: readonly string[], program: string): string[] | undefined => {
  const at = words.findIndex((word) => isProgram(word, program));
  return at < 0 ? undefined : words.slice(at + 1);
};

/**
 * The variables a command's own shell gives it as text (P337): those written
 * before it on its line (`PORT=4000 docker compose up`) and those an earlier
 * line of the same script exports or sets (`export PORT=4000`), in order, as
 * the command reader keeps them. A value the shell fills in is not known.
 */
export const shellVariables = (env: CommandAt['env']): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env ?? {})) if (typeof value === 'string') out[name] = value;
  return out;
};

/**
 * A word as the shell hands it on (P337): `$NAME`, `${NAME}` and
 * `${NAME:-default}` replaced by what the command's own shell gives `NAME`.
 * A variable it does not give is the shell's, as before, and left as written.
 */
export const expandWord = (word: string, variables: Readonly<Record<string, string>>): string =>
  word.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?)-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced: string | undefined, colon: string | undefined, fallback: string | undefined, bare: string | undefined) => {
    const given = variables[braced ?? bare ?? ''];
    if (given !== undefined && (colon !== ':' || given !== '')) return given;
    return match;
  });

/** A command's words with what its own shell gives filled in (P337). */
const expanded = (command: CommandAt): string[] => {
  const variables = shellVariables(command.env);
  return Object.keys(variables).length === 0 ? [...command.words] : command.words.map((word) => expandWord(word, variables));
};

/** An option written `--flag=value`, split; any other word as it is. */
const splitFlag = (word: string): [string, string | undefined] =>
  word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];

/** The `docker run` a command is, if it is one. */
const runOf = (words: readonly string[], line: number, shell: Readonly<Record<string, string>> = {}): DockerRun | undefined => {
  const run = words.findIndex((word, index) => word === 'run' && isProgram(words[index - 1], 'docker'));
  if (run < 0) return undefined;
  const mappings: Mapping[] = [];
  const environment: Array<{ name: string; raw: string }> = [];
  const envFiles: string[] = [];
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
      // `-e PORT` alone passes on what the command's own shell gives it (P337).
      else if (value !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && shell[value] !== undefined) environment.push({ name: value, raw: shell[value] as string });
    } else if (flag === '--env-file') {
      if (value !== undefined && value !== '' && !value.includes('$')) envFiles.push(value);
    } else if (flag === '--name') name = value;
    else if (!valued && !word.startsWith('-')) {
      image = word;
      break;
    }
  }
  const fromImage = image?.split('/').pop()?.split(':')[0];
  const called = name ?? fromImage;
  if (called === undefined || called === '' || called.includes('$')) return undefined;
  return {
    name: called,
    names: name === undefined || name.includes('$') ? [] : [name.toLowerCase()],
    mappings,
    environment,
    envFiles,
    ...(image === undefined || image.includes('$') ? {} : { image }),
  };
};

/** The `docker build` a command is, if it is one, with a directory to build from that the files settle. */
const buildOf = (words: readonly string[]): DockerBuild | undefined => {
  const at = words.findIndex((word, index) => word === 'build' && (isProgram(words[index - 1], 'docker') || (words[index - 1] === 'buildx' && isProgram(words[index - 2], 'docker'))));
  if (at < 0) return undefined;
  const names: string[] = [];
  const args: Record<string, string> = {};
  let dockerfile: string | undefined;
  let target: string | undefined;
  let context: string | undefined;
  for (let index = at + 1; index < words.length; index += 1) {
    const word = words[index] as string;
    const [flag, inline] = splitFlag(word);
    const valued = BUILD_VALUED.test(flag);
    const value = valued ? (inline ?? words[(index += 1)]) : undefined;
    if (value !== undefined && value.includes('$')) continue;
    if (flag === '-t' || flag === '--tag') {
      if (value !== undefined) names.push(imageName(value));
    } else if (flag === '-f' || flag === '--file') dockerfile = value;
    else if (flag === '--target') target = value;
    else if (flag === '--build-arg') {
      const equals = (value ?? '').indexOf('=');
      if (equals > 0) args[(value as string).slice(0, equals)] = (value as string).slice(equals + 1);
    } else if (!valued && !word.startsWith('-')) {
      context = word;
      break;
    }
  }
  if (context === undefined || context.includes('$') || context.includes('://') || names.length === 0) return undefined;
  return { names, ...(dockerfile === undefined ? {} : { dockerfile }), context, ...(target === undefined ? {} : { target }), args };
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
    const run = runOf(expanded(command), command.line, shellVariables(command.env));
    return run === undefined ? [] : [{ ...run, file: command.file, ...(command.dirs === undefined ? {} : { dirs: command.dirs }) }];
  });

/**
 * Every `docker build` the commands of a repository write that tags its
 * image (P325), so a `docker run` of that image is read with the
 * environment its Dockerfile gives. A pipeline's is read too: the image it
 * builds is the one a developer pulls and runs.
 */
export const dockerBuildsOf = (commands: readonly CommandAt[]): DockerBuildAt[] =>
  commands.flatMap((command) => {
    const build = buildOf(expanded(command));
    return build === undefined ? [] : [{ ...build, file: command.file, ...(command.dirs === undefined ? {} : { dirs: command.dirs }) }];
  });

/**
 * A `docker compose` (or `docker-compose`) a command runs (P331): the compose
 * files it names (`-f`, `--file`), the environment files it interpolates them
 * with (`--env-file`, in order, a later over an earlier, in place of the
 * `.env` beside the files), and the directory it takes as the project's
 * (`--project-directory`), each as written.
 */
export interface ComposeRun {
  readonly files: readonly string[];
  readonly envFiles: readonly string[];
  readonly projectDirectory?: string;
  /** A compose file or an environment file is named by what the shell fills (`--env-file $ENV_FILE`): its variables are not known. */
  readonly unsettled?: true;
  /**
   * What the command's own shell gives as text (P337): written before it,
   * `PORT=4000 docker compose up`, or exported earlier in the same script.
   * Compose interpolates with these over any environment file.
   */
  readonly shell?: Readonly<Record<string, string>>;
}

export type ComposeRunAt = ComposeRun & { readonly file: string; readonly line: number; readonly dirs?: readonly string[] };

/** Compose's own options before its command that take a value. */
const COMPOSE_VALUED = /^(?:-[fp]|--(?:file|env-file|project-name|project-directory|profile|ansi|progress|parallel))$/;

/**
 * The files a variable of compose's own names, as its shell gives it (P337):
 * `COMPOSE_ENV_FILES` (comma-separated) and `COMPOSE_FILE` (separated by
 * `COMPOSE_PATH_SEPARATOR`, else `:`). `unsettled` where the shell fills it
 * in when it runs; nothing where it is not given.
 */
export const composeVariableFiles = (env: CommandAt['env'], name: 'COMPOSE_ENV_FILES' | 'COMPOSE_FILE'): readonly string[] | 'unsettled' | undefined => {
  const value = env?.[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.includes('$')) return 'unsettled';
  const separator = name === 'COMPOSE_ENV_FILES' ? ',' : (typeof env?.['COMPOSE_PATH_SEPARATOR'] === 'string' ? (env['COMPOSE_PATH_SEPARATOR'] as string) : ':') || ':';
  return value.split(separator).map((each) => each.trim()).filter((each) => each !== '');
};

/** The `docker compose` a command is, if it is one, with every option before its command read. */
const composeOf = (words: readonly string[], env: CommandAt['env'] = {}): ComposeRun | undefined => {
  const at = words.findIndex((word, index) => isProgram(word, 'docker-compose') || (word === 'compose' && isProgram(words[index - 1], 'docker')));
  if (at < 0) return undefined;
  const files: string[] = [];
  const envFiles: string[] = [];
  let projectDirectory: string | undefined;
  let unsettled = false;
  for (let index = at + 1; index < words.length; index += 1) {
    const word = words[index] as string;
    const [flag, inline] = splitFlag(word);
    const valued = COMPOSE_VALUED.test(flag);
    // The command: what follows it is its own.
    if (!valued && !word.startsWith('-')) break;
    const value = valued ? (inline ?? words[(index += 1)]) : undefined;
    // A value the shell fills names no file read here.
    if (value === undefined || value === '' || value.includes('$')) {
      if (flag === '--env-file' || flag === '-f' || flag === '--file' || flag === '--project-directory') unsettled = true;
      continue;
    }
    if (flag === '-f' || flag === '--file') files.push(value);
    else if (flag === '--env-file') envFiles.push(value);
    else if (flag === '--project-directory') projectDirectory = value;
  }
  // Where the command names no file, compose's own variables may (P337).
  for (const [into, name] of [[envFiles, 'COMPOSE_ENV_FILES'], [files, 'COMPOSE_FILE']] as const) {
    if (into.length > 0) continue;
    const given = composeVariableFiles(env, name);
    if (given === 'unsettled') unsettled = true;
    else if (given !== undefined) into.push(...given);
  }
  const shell = shellVariables(env);
  return {
    files,
    envFiles,
    ...(projectDirectory === undefined ? {} : { projectDirectory }),
    ...(unsettled ? { unsettled: true as const } : {}),
    ...(Object.keys(shell).length === 0 ? {} : { shell }),
  };
};

/**
 * Every `docker compose` the commands of a repository run (P331), its
 * `package.json` scripts, Makefiles and shell scripts, so a compose file is
 * interpolated with the environment files the command hands it. A
 * pipeline's is not read, as a `docker run` in one is not: it runs on the
 * pipeline's machine.
 */
export const composeRunsOf = (commands: readonly CommandAt[]): ComposeRunAt[] =>
  commands.flatMap((command) => {
    if (isPipeline(command.file)) return [];
    const run = composeOf(expanded(command), command.env);
    return run === undefined ? [] : [{ ...run, file: command.file, line: command.line, ...(command.dirs === undefined ? {} : { dirs: command.dirs }) }];
  });

/**
 * A command that starts a server of the repository on this machine (P337):
 * `node dist/main.js`, `npm start`, `next start`, with the environment its
 * own shell gives it - the variables written before it on its line, and those
 * an earlier line of the same script exports or sets, in order.
 */
export interface ServerStart {
  readonly file: string;
  readonly line: number;
  readonly dirs?: readonly string[];
  /** What the shell gives it as text, by name. */
  readonly environment: Readonly<Record<string, string>>;
  /** What it runs (P343). */
  readonly runs: StartedProgram;
  /** The Makefile conditionals the files do not settle that it is read under (P356). */
  readonly assumed?: readonly string[];
}

/**
 * What a command that may start a server runs (P343): a runtime or a
 * framework the start list knows (`known`), with the file a runtime is handed
 * (`node ./scripts/serve.js`, `tsx watch src/server.ts`); a program it does
 * not know (`program`), by the word that runs it - a path (`./bin/server`)
 * or a name a package's `bin` may give; or a script of a `package.json` it
 * does not know (`script`, `npm run api`), which may be a `bin` too.
 */
export type StartedProgram =
  | { readonly kind: 'known'; readonly file?: string }
  | { readonly kind: 'program'; readonly program: string }
  | { readonly kind: 'script'; readonly name: string; readonly workspace?: WorkspaceSelection };

/**
 * The packages of a workspace a package manager is told to run a script in
 * (P350), instead of the one where it runs: pnpm's `--filter` / `-F`
 * selectors (`@shop/api`, `@shop/*`, `./apps/api`, `{./apps/api}`, a name
 * with pnpm's `...` taken off), npm's `--workspace` / `-w`, yarn's
 * `workspace <name>`, Bun's `--filter`; or the directory it is told to run in
 * (pnpm's `-C` / `--dir`, npm's `--prefix`), as written.
 */
export interface WorkspaceSelection {
  readonly selectors: readonly string[];
  readonly dir?: string;
}

/** Runtimes that run a file of the repository's own as its server. */
const RUNTIMES = new Set(['node', 'nodemon', 'ts-node', 'ts-node-dev', 'tsx', 'bun', 'deno']);

/** What a runtime is asked to do that starts nothing. */
const NOT_A_START = new Set(['install', 'add', 'remove', 'build', 'test', 'lint', 'i', 'ci', 'upgrade', 'x', 'fmt', 'check', 'compile']);

/** Framework commands that start a server, by program, with the verbs that do. */
const FRAMEWORK_STARTS: Readonly<Record<string, ReadonlySet<string> | 'any'>> = {
  next: new Set(['start', 'dev']),
  nuxt: new Set(['start', 'dev', 'preview']),
  nuxi: new Set(['start', 'dev', 'preview']),
  nest: new Set(['start']),
  fastify: new Set(['start']),
  strapi: new Set(['start', 'develop', 'dev']),
  'remix-serve': 'any',
  'react-router-serve': 'any',
};

/** The scripts a package manager runs that start the server. */
const STARTING_SCRIPT = /^(?:start|dev|serve)(?::[\w-]+)?$/;

/** Whether a script's name is one that starts the server (P350). */
export const isStartingScript = (name: string): boolean => STARTING_SCRIPT.test(name);

/** A runtime's options that take a value, so the file it runs is the first word that is neither. */
const RUNTIME_VALUED = /^(?:-r|--require|--import|--loader|--experimental-loader|--env-file|--conditions|-C|--tsconfig|--project|-P|--inspect-port|--watch-path|--ignore|-w)$/;

/** Verbs a runtime is given before the file it runs: `tsx watch`, `bun run`, `deno run`. */
const RUNTIME_VERBS = new Set(['watch', 'run', 'serve']);

/** The file a runtime is handed, as written: the first word after it that is no option, nor an option's value. */
const runtimeFile = (words: readonly string[]): string | undefined => {
  for (let index = 0; index < words.length; index += 1) {
    const [flag, inline] = splitFlag(words[index] as string);
    if (flag.startsWith('-')) {
      if (inline === undefined && RUNTIME_VALUED.test(flag)) index += 1;
      continue;
    }
    if (index === 0 && RUNTIME_VERBS.has(flag)) continue;
    return flag;
  }
  return undefined;
};

/** A word that may name a program: a path, or a name a package's `bin` gives. */
const PROGRAM_WORD = /^(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*$/;

/** Package managers' own commands, which run no script and no program of the project's. */
const MANAGER_COMMANDS = new Set([...NOT_A_START, 'publish', 'pack', 'link', 'outdated', 'audit', 'version', 'why', 'list', 'ls', 'config', 'cache', 'dlx', 'create', 'init', 'login', 'logout', 'prune', 'rebuild', 'store', 'update', 'workspace', 'workspaces', 'up', 'run-script']);

/** A package manager's options that take a value, the workspace selecting ones read (P350). */
const MANAGER_VALUED = /^(?:--filter|-F|-C|--dir|-w|--workspace|--prefix|--loglevel|--reporter|--registry|--cwd|--filter-prod|--test-pattern)$/;

/**
 * A package manager's words after its program (P350): the words that are no
 * option, nor an option's value, up to a `--`; and the workspace packages or
 * the directory it is told to run in, where it is told. yarn's
 * `workspace <name> <script>` is read as the selection of `<name>`.
 */
const managerWords = (program: string, words: readonly string[]): { positional: string[]; selection?: WorkspaceSelection } => {
  const positional: string[] = [];
  const selectors: string[] = [];
  let dir: string | undefined;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (word === '--') {
      positional.push(...words.slice(index + 1));
      break;
    }
    // Once the script is named, what follows is its own - but npm reads its own options up to a `--`.
    const named = positional.length > 0 && !['run', 'run-script', 'workspace'].includes(positional[0] as string) ? 1 : 2;
    if (program !== 'npm' && positional.length >= named) {
      positional.push(word);
      continue;
    }
    const [flag, inline] = word.startsWith('--') ? splitFlag(word) : [word, undefined];
    if (!flag.startsWith('-')) {
      positional.push(word);
      continue;
    }
    const value = MANAGER_VALUED.test(flag) ? (inline ?? words[(index += 1)]) : inline;
    if (value === undefined) continue;
    if (flag === '--filter' || flag === '-F' || flag === '-w' || flag === '--workspace') selectors.push(value);
    else if (flag === '-C' || flag === '--dir' || flag === '--prefix' || flag === '--cwd') dir = value;
  }
  if (program === 'yarn' && positional[0] === 'workspace' && positional[1] !== undefined) {
    selectors.push(positional[1]);
    positional.splice(0, 2);
  }
  const selection = selectors.length > 0 || dir !== undefined ? { selectors, ...(dir === undefined ? {} : { dir }) } : undefined;
  return { positional, ...(selection === undefined ? {} : { selection }) };
};

/** What a command's words run, where it may start a server of the repository (P337, P343). */
const startedProgram = (words: readonly string[]): StartedProgram | undefined => {
  let at = 0;
  while (['exec', 'npx', 'pnpx', 'bunx', 'nohup', 'time', 'env'].includes(words[at] ?? '')) at += 1;
  const word = words[at] ?? '';
  const program = word.split('/').pop() ?? '';
  const verb = words[at + 1];
  // `bun --filter api dev` runs a package's script, as pnpm's `--filter` does (P350).
  const bunFiltered = program === 'bun' && words.slice(at + 1).some((each) => /^--filter(?:=|$)/.test(each));
  if (RUNTIMES.has(program) && !bunFiltered) {
    if (verb === undefined || NOT_A_START.has(verb)) return undefined;
    const file = runtimeFile(words.slice(at + 1));
    return { kind: 'known', ...(file === undefined || isFilledInWord(file) ? {} : { file }) };
  }
  if (program === 'npm' || program === 'pnpm' || program === 'yarn' || bunFiltered) {
    const { positional, selection } = managerWords(program, words.slice(at + 1));
    const first = positional[0];
    // `npm exec x`, `pnpm exec x`: a program of a package's `bin`.
    if (first === 'exec') return positional[1] === undefined || !PROGRAM_WORD.test(positional[1]) ? undefined : { kind: 'program', program: positional[1] };
    const named = first === 'run' || first === 'run-script' ? positional[1] : first;
    if (named === undefined) return undefined;
    if (selection !== undefined) {
      // In another package: its script of that name, which the reader looks up there (P350).
      if ((program === 'npm' && first !== 'run' && first !== 'run-script' && named !== 'start' && named !== 'restart') || MANAGER_COMMANDS.has(named) || named.startsWith('-')) return undefined;
      return { kind: 'script', name: named, workspace: selection };
    }
    if (program === 'bun') return undefined;
    if (STARTING_SCRIPT.test(named)) return { kind: 'known' };
    // `npm` runs a script only with `run`; pnpm and yarn run one by its name.
    if ((program === 'npm' && first !== 'run' && first !== 'run-script') || MANAGER_COMMANDS.has(named) || named.startsWith('-')) return undefined;
    return { kind: 'script', name: named };
  }
  const verbs = FRAMEWORK_STARTS[program];
  if (verbs === 'any' || (verbs !== undefined && verb !== undefined && verbs.has(verb))) return { kind: 'known' };
  if (verbs !== undefined || !PROGRAM_WORD.test(word)) return undefined;
  return { kind: 'program', program: word };
};

/** Whether a word holds something the shell fills in. */
const isFilledInWord = (word: string): boolean => /[$`]/.test(word);

/**
 * Every command of a repository that may start a server with a variable its
 * own shell gives it (P337): `export PORT=4000` earlier in a script, then
 * `npm start`; `PORT=4000 node dist/main.js`. Only within one script, and
 * only after the export, as the command reader keeps the environment. A
 * pipeline's is not read: it runs on the pipeline's machine. A program or a
 * script the start list does not know is kept with what it runs (P343), for
 * the reader to follow to a file of the repository whose code listens.
 */
export const serverStartsOf = (commands: readonly CommandAt[]): ServerStart[] =>
  commands.flatMap((command) => {
    if (isPipeline(command.file)) return [];
    const runs = startedProgram(command.words);
    if (runs === undefined) return [];
    const environment = shellVariables(command.env);
    if (Object.keys(environment).length === 0) return [];
    return [{ file: command.file, line: command.line, ...(command.dirs === undefined ? {} : { dirs: command.dirs }), environment, runs, ...(command.assumed === undefined || command.assumed.length === 0 ? {} : { assumed: command.assumed }) }];
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
  /** Every selector `-l` writes, as written (P289): `tier=api,name!=cache`; a release any of them matches is kept. */
  readonly selectors: readonly string[];
  /** What else keeping releases by name keeps (P273): `--include-needs`, `--include-transitive-needs`. */
  readonly needs: 'none' | 'direct' | 'transitive';
  /**
   * Whether it runs with helmfile's explicit selector inheritance
   * (`HELMFILE_EXPERIMENTAL=explicit-selector-inheritance`, or `true`, every
   * experimental feature) (P295): a sub-helmfile writing no selectors then
   * keeps every release of its own, unless it writes `selectorsInherited`.
   */
  readonly explicitSelectors: boolean;
  readonly line: number;
  readonly file: string;
  readonly dirs: readonly string[];
}

/** The value of helmfile's experimental features a command runs with, written in its environment or after `env` before it. */
const experimentalOf = (words: readonly string[], env: CommandAt['env']): string | undefined => {
  const at = words.findIndex((word) => isProgram(word, 'helmfile'));
  const inline = words.slice(0, Math.max(at, 0)).find((word) => word.startsWith('HELMFILE_EXPERIMENTAL='));
  if (inline !== undefined) return inline.slice('HELMFILE_EXPERIMENTAL='.length);
  const set = env?.['HELMFILE_EXPERIMENTAL'];
  return typeof set === 'string' ? set : undefined;
};

const HELMFILE_VALUED = new Set(['-f', '--file', '-e', '--environment', '--state-values-set', '--state-values-file', '-l', '--selector', '--kube-context', '-n', '--namespace', '-c', '--chart', '--helm-binary', '-b']);

/** Every `helmfile` command the commands write that installs or renders releases (P263). */
export const readHelmfileRuns = (commands: readonly CommandAt[]): HelmfileRun[] => {
  const out: HelmfileRun[] = [];
  for (const { words, line, file, dirs, env } of commands) {
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
      selectors: valued('-l', '--selector').filter((each) => !each.includes('$')),
      needs: rest.includes('--include-transitive-needs') ? 'transitive' : rest.includes('--include-needs') ? 'direct' : 'none',
      explicitSelectors: /^(?:true|.*\bexplicit-selector-inheritance\b.*)$/.test(experimentalOf(words, env) ?? ''),
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
