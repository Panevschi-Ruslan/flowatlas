import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { stackOutputKey } from '@flowatlas/core';
import { Imported, isRecord, readServiceYaml, textOf, Unread } from '@flowatlas/serverless';
import { commandsAround, commandValue, isFilledIn, under, type Command, type DeployedValue } from './commands.js';
import { lookupIn, renderJinja, UNRENDERED, type Rendering } from './jinja.js';

export type { DeployedValue } from './commands.js';

/**
 * The tools that deploy a plain template with its values written down beside
 * it (P259, P261), read where what they are run with is written out.
 *
 * - **sceptre**: a project holds `templates/` and `config/`; each stack is a
 *   file `config/<group>/<stack>.yaml` naming its template (`template_path`,
 *   or `template: { path }`) and giving its `parameters` and
 *   `sceptre_user_data`, and each group's `config.yaml` what every stack below
 *   it inherits: `project_code`, `region`, and `parameters` and
 *   `sceptre_user_data` merged key by key, the nearer configuration winning,
 *   as sceptre merges them. The stack's name is its own `stack_name`, else the
 *   project's code and the stack's path, joined by `-`. Every file is
 *   rendered first, as sceptre renders it: `{{ var.x }}` with what the
 *   commands that launch the stack hand it (`--var`, `--var-file`) and the
 *   var files the configuration names, `{{ environment_variable.X }}` with
 *   the environment those commands run in. `!stack_output <stack>::<Output>`
 *   and `!stack_output_external <stack name>::<Output>` are the output of a
 *   stack another deployment - or this one - publishes, joined as an export
 *   is; `!environment_variable X` is X of the environment the stack is
 *   launched in.
 * - **rain**: `rain deploy <template> [<stack>] --params K=V,K2=V2 --config
 *   <file>` written in a script, a recipe, a shell script or a pipeline (see
 *   `commands.ts`) beside the template or above it; the stack is named after
 *   the template where the command names none, and the configuration file is
 *   a template configuration (`Parameters:`), read as any parameter file is.
 *
 * What a tool works out when it runs and the files do not give is not read:
 * any other resolver (`!file_contents`, `!stack_attr`, any `!tag`), a Jinja
 * expression this does not render - a filter, a call, a statement, a value
 * nothing gives - and a shell variable on a command are values not known from
 * the files, said as such rather than read as the parameter's default. A
 * stack configuration that does not read as YAML once rendered, or holds a
 * statement, names nothing this can see, and is passed over. Several stacks
 * or commands deploying one template are several environments: the one the
 * configuration names is read (`services[].infra.vars` naming its file or a
 * var file it is launched with, or `services[].infra.options.config_env` its
 * sceptre group), and otherwise none.
 */

/** One deployment of a template by a tool, as its files write it. */
export interface Deployer {
  /** Which tool, and the file that says so, repo-relative. */
  readonly tool: 'sceptre' | 'rain';
  readonly file: string;
  /** The line of the command or the stack, 1-based. */
  readonly line: number;
  /** What a person calls it: `prod/orders`, `deploy:prod`. */
  readonly label: string;
  /** The sceptre group the stack is in. */
  readonly group?: string;
  readonly values: Readonly<Record<string, DeployedValue>>;
  readonly stackName?: string;
  readonly region?: string;
  /** What a sceptre stack hands its template to render it with (`sceptre_user_data`), as written (P261). */
  readonly userData?: Readonly<Record<string, unknown>>;
  /** Parameter files it reads its values from (rain's `--config`), repo-relative. */
  readonly files: readonly string[];
  /** Var files a sceptre stack is launched with (P261), repo-relative: naming one under `infra.vars` chooses it. */
  readonly varFiles?: readonly string[];
  /** Every file read to know it, repo-relative, for the build cache. */
  readonly read: readonly string[];
}

const textAt = (repoDir: string, file: string): string | undefined => {
  try {
    return readFileSync(join(repoDir, file), 'utf8');
  } catch {
    return undefined;
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- sceptre

/** A value of a stack configuration a tag of sceptre's is put on: a resolver, run when the stack is launched. */
class Resolved {
  constructor(
    readonly tag: string,
    readonly value: unknown,
  ) {}

  /** As written, for a person. */
  get text(): string {
    return `${this.tag} ${typeof this.value === 'string' ? this.value : ''}`.trim();
  }
}

/** What a stack's files are rendered with: the vars and the environment the commands that launch it give, or none. */
interface Launch {
  /** The command that launches it, where one is written. */
  readonly command?: Command;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly env: Readonly<Record<string, DeployedValue>>;
  readonly varFiles: readonly string[];
}

/** A sceptre configuration file, rendered and read, its resolvers kept apart; `undefined` where it does not read. */
interface SceptreFile {
  readonly value: Record<string, unknown>;
  readonly rendering: Rendering;
}

const readSceptreFile = (repoDir: string, project: Project, file: string, launch: Launch): SceptreFile | undefined => {
  const text = textAt(repoDir, file);
  if (text === undefined) return undefined;
  const environment = Object.fromEntries(Object.entries(launch.env).filter(([, value]) => typeof value === 'string'));
  const rendering = renderJinja(text, lookupIn({ var: launch.vars, environment_variable: environment }), project.files.indexOf(file) + 1);
  // A statement decides what the file is: nothing this does not run can say.
  if ([...rendering.unrendered.values()].some((written) => written.startsWith('{%'))) return undefined;
  try {
    const value = readServiceYaml(rendering.text, { otherTag: (tag, written) => new Resolved(tag, written) }).value;
    return isRecord(value) ? { value, rendering } : undefined;
  } catch {
    return undefined;
  }
};

/** The sceptre project a template is in: the directory holding both its `templates/` and a `config/`. */
const sceptreRoot = (repoDir: string, template: string): string | undefined => {
  const parts = template.split('/');
  for (let at = parts.lastIndexOf('templates'); at >= 0; at = parts.lastIndexOf('templates', at - 1)) {
    const root = at === 0 ? '.' : parts.slice(0, at).join('/');
    if (isDirectory(join(repoDir, root, 'config'))) return root;
    if (at === 0) break;
  }
  return undefined;
};

/** How deep below `config/` a stack's file is looked for. */
const MOST_GROUP_DEPTH = 4;

/** Every YAML file below a directory, repo-relative. */
const yamlFilesUnder = (repoDir: string, dir: string, depth = 0): string[] => {
  let entries;
  try {
    entries = readdirSync(join(repoDir, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return depth >= MOST_GROUP_DEPTH ? [] : yamlFilesUnder(repoDir, path, depth + 1);
      return /\.ya?ml$/.test(entry.name) ? [path] : [];
    });
};

const GROUP_FILE = /(?:^|\/)config\.ya?ml$/;

/** The template a stack's configuration names, repo-relative, or `undefined`. */
const sceptreTemplate = (root: string, stack: Record<string, unknown>): string | undefined => {
  const handler = isRecord(stack['template']) ? stack['template'] : undefined;
  if (handler !== undefined && textOf(handler['type']) !== undefined && textOf(handler['type']) !== 'file') return undefined;
  const path = textOf(stack['template_path']) ?? (handler === undefined ? undefined : textOf(handler['path']));
  if (path === undefined || UNRENDERED.test(path)) return undefined;
  // Older projects wrote the path from the project; newer ones from `templates/`.
  return under(root, path.startsWith('templates/') ? path : `templates/${path}`);
};

/** One sceptre project: where its configuration is, and its group files by directory. */
interface Project {
  readonly root: string;
  readonly configDir: string;
  readonly files: readonly string[];
  readonly groups: ReadonlyMap<string, string>;
}

/** A stack of a project read under one launch: its configuration merged with its groups', and the files read for it. */
interface Stack {
  readonly path: string;
  readonly file: string;
  readonly own: SceptreFile;
  /** The group configurations, merged from the project's down, the nearer winning. */
  readonly settings: Record<string, unknown>;
  /** `parameters` and `sceptre_user_data`, merged from the project's group down to the stack's own, key by key (P261). */
  readonly parameters: Record<string, unknown>;
  readonly userData: Record<string, unknown>;
  /** Every expression not rendered in its files, by its stand-in. */
  readonly unrendered: ReadonlyMap<string, string>;
  readonly read: readonly string[];
}

const recordAt = (value: Record<string, unknown> | undefined, key: string): Record<string, unknown> => (value !== undefined && isRecord(value[key]) ? (value[key] as Record<string, unknown>) : {});

/** A stack's configuration under a launch, merged with every group configuration above it. */
const stackOf = (repoDir: string, project: Project, file: string, launch: Launch): Stack | undefined => {
  const own = readSceptreFile(repoDir, project, file, launch);
  if (own === undefined) return undefined;
  const read = [file];
  let settings: Record<string, unknown> = {};
  let parameters: Record<string, unknown> = {};
  let userData: Record<string, unknown> = {};
  const unrendered = new Map(own.rendering.unrendered);
  const dirs: string[] = [];
  for (let dir = posix.dirname(file); dir.length >= project.configDir.length; dir = posix.dirname(dir)) {
    dirs.unshift(dir);
    if (dir === project.configDir) break;
  }
  for (const dir of dirs) {
    const group = project.groups.get(dir);
    if (group === undefined) continue;
    read.push(group);
    const reading = readSceptreFile(repoDir, project, group, launch);
    if (reading === undefined) continue;
    const written = reading.value;
    for (const [at, expression] of reading.rendering.unrendered) unrendered.set(at, expression);
    settings = { ...settings, ...written };
    parameters = { ...parameters, ...recordAt(written, 'parameters') };
    userData = { ...userData, ...recordAt(written, 'sceptre_user_data') };
  }
  return {
    path: file.slice(project.configDir.length + 1).replace(/\.ya?ml$/, ''),
    file,
    own,
    settings,
    parameters: { ...parameters, ...recordAt(own.value, 'parameters') },
    userData: { ...userData, ...recordAt(own.value, 'sceptre_user_data') },
    unrendered,
    read,
  };
};

/** A stack's text where it is plain: rendered, and neither a resolver nor an expression not rendered. */
const plainOf = (value: unknown): string | undefined => {
  const text = typeof value === 'boolean' || typeof value === 'number' ? String(value) : textOf(value);
  return text === undefined || UNRENDERED.test(text) ? undefined : text;
};

/** The name a stack is launched under: its own `stack_name`, else its project's code and its path. */
const stackNameOf = (stack: Stack): string | undefined => {
  const code = plainOf(stack.settings['project_code']);
  return plainOf(stack.own.value['stack_name']) ?? (code === undefined ? undefined : `${code}-${stack.path.replace(/\//g, '-')}`);
};

/** The output a `!stack_output` or `!stack_output_external` names: `<stack>::<Output>`. */
const outputNamed = (value: unknown): { readonly stack: string; readonly output: string } | undefined => {
  const text = textOf(value)?.trim().split(/\s+/)[0];
  const at = text?.indexOf('::') ?? -1;
  if (text === undefined || at <= 0 || UNRENDERED.test(text)) return undefined;
  return { stack: text.slice(0, at), output: text.slice(at + 2) };
};

/**
 * What a stack's configuration gives a parameter: its text; the output of
 * another stack, which its publisher's reading joins (P261); a value of the
 * environment it is launched in; or why it is not known from the files.
 */
const sceptreValue = (value: unknown, unrendered: ReadonlyMap<string, string>, launch: Launch, outputOf: (stackPath: string) => string | undefined): DeployedValue | undefined => {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Resolved) {
    const named = outputNamed(value.value);
    if ((value.tag === '!stack_output' || value.tag === '!stack_output_external') && named !== undefined) {
      const stack = value.tag === '!stack_output' ? outputOf(named.stack) : named.stack;
      if (stack === undefined) return new Unread(`it is given by ${value.text}, a stack whose configuration is not read`);
      return new Imported(stackOutputKey(stack, named.output), `the value is the output ${named.output} of the stack ${stack}, which its deployment publishes`, value.text);
    }
    const variable = textOf(value.value);
    const given = value.tag === '!environment_variable' && variable !== undefined ? launch.env[variable.trim()] : undefined;
    if (typeof given === 'string') return given;
    return new Unread(`it is given by ${value.text}, and sceptre's ${value.tag} resolver runs when the stack is launched`);
  }
  if (Array.isArray(value)) {
    const parts = value.map((part) => sceptreValue(part, unrendered, launch, outputOf));
    const unread = parts.find((part): part is Unread => part instanceof Unread);
    return unread ?? parts.map((part) => part ?? '').join(',');
  }
  const text = typeof value === 'boolean' || typeof value === 'number' ? String(value) : textOf(value);
  if (text === undefined) return new Unread('it is not text');
  const kept = UNRENDERED.exec(text);
  if (kept !== null) return new Unread(`it is a Jinja expression (${unrendered.get(kept[0]) ?? text.trim()}), rendered when sceptre runs with what the files do not give`);
  return text;
};

/** The sceptre subcommands that deploy a stack. */
const LAUNCHES = new Set(['launch', 'create', 'update']);

/** sceptre's options that take a value, before the subcommand and after it. */
const SCEPTRE_VALUED = new Set(['--var', '--var-file', '--dir', '--output', '--debug-level']);

/** A sceptre command that launches stacks of a project, read: where, what, and with what. */
interface SceptreRun {
  readonly command: Command;
  /** The project's directory, as the command is run. */
  readonly dirs: readonly string[];
  /** The stack or group it launches, from `config/`; `.` for the whole project. */
  readonly path: string;
  readonly varFiles: readonly string[];
  readonly vars: Readonly<Record<string, string | Unread>>;
}

/** Every sceptre command written around a project that launches its stacks. */
const sceptreRuns = (repoDir: string, root: string): SceptreRun[] =>
  commandsAround(repoDir, root).flatMap((command): SceptreRun[] => {
    const at = command.words.findIndex((word) => /(?:^|\/)sceptre$/.test(word));
    if (at < 0) return [];
    const varFiles: string[] = [];
    const vars: Record<string, string | Unread> = {};
    let dir = '.';
    let subcommand: string | undefined;
    const positional: string[] = [];
    const rest = command.words.slice(at + 1);
    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index] as string;
      const equals = word.indexOf('=');
      const flag = word.startsWith('-') ? (equals > 0 ? word.slice(0, equals) : word) : undefined;
      if (flag === undefined) {
        if (subcommand === undefined) subcommand = word;
        else positional.push(word);
        continue;
      }
      if (!SCEPTRE_VALUED.has(flag)) continue;
      const value = equals > 0 ? word.slice(equals + 1) : rest[(index += 1)];
      if (value === undefined) continue;
      if (flag === '--var') {
        const split = value.indexOf('=');
        if (split > 0) vars[value.slice(0, split)] = commandValue(value.slice(split + 1));
      } else if (flag === '--var-file') {
        if (isFilledIn(value)) return [];
        varFiles.push(value);
      } else if (flag === '--dir') {
        if (isFilledIn(value)) return [];
        dir = value;
      }
    }
    const [path] = positional;
    if (subcommand === undefined || !LAUNCHES.has(subcommand) || path === undefined || isFilledIn(path)) return [];
    const dirs = command.dirs.map((from) => under(from, dir)).filter((projectDir) => projectDir === root);
    if (dirs.length === 0) return [];
    return [{ command, dirs, path: posix.normalize(path.replace(/\.ya?ml$/, '')), varFiles: varFiles.map((file) => under(root, file)), vars }];
  });

/** Whether a run launches a stack: the whole project, the stack's group or one above it, or the stack. */
const launches = (run: SceptreRun, stackPath: string): boolean => run.path === '.' || run.path === stackPath || stackPath.startsWith(`${run.path}/`);

/** A var file sceptre reads: a mapping of names to values. */
const readVarFile = (repoDir: string, file: string): Record<string, unknown> | undefined => {
  const text = textAt(repoDir, file);
  if (text === undefined) return undefined;
  try {
    const value = readServiceYaml(text).value;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The launches a stack of a project is read under: one per command that
 * launches it, with that command's var files, vars and environment; none
 * written, one with no command. The var files the configuration names
 * (`infra.vars`) apply over each, as the last `--var-file` would.
 */
const launchesOf = (repoDir: string, runs: readonly SceptreRun[], stackPath: string, named: readonly Record<string, unknown>[]): Launch[] => {
  const over = Object.assign({}, ...named) as Record<string, unknown>;
  const covering = runs.filter((run) => launches(run, stackPath));
  if (covering.length === 0) return [{ vars: over, env: {}, varFiles: [] }];
  return covering.map((run) => {
    const fromFiles = Object.assign({}, ...run.varFiles.map((file) => readVarFile(repoDir, file) ?? {})) as Record<string, unknown>;
    // A var a shell variable fills in is not known: it is left out, and renders nothing.
    const given = Object.fromEntries(Object.entries(run.vars).filter(([, value]) => typeof value === 'string'));
    return { command: run.command, vars: { ...fromFiles, ...given, ...over }, env: run.command.env, varFiles: run.varFiles };
  });
};

/** The deployments of a template by sceptre stacks of the project it is in, once per command that launches each. */
const sceptreDeployers = (repoDir: string, template: string, vars: readonly string[]): Deployer[] => {
  const root = sceptreRoot(repoDir, template);
  if (root === undefined) return [];
  const configDir = under(root, 'config');
  const files = yamlFilesUnder(repoDir, configDir);
  const project: Project = { root, configDir, files, groups: new Map(files.filter((file) => GROUP_FILE.test(file)).map((file) => [posix.dirname(file), file])) };
  const runs = sceptreRuns(repoDir, root);
  // A mapping the configuration names that is neither a stack's nor a group's nor a template configuration is a var file (P261).
  const namedFiles = vars.filter((file) => {
    if (!/\.ya?ml$/.test(file) || files.includes(file)) return false;
    const value = readVarFile(repoDir, file);
    return value !== undefined && parameterless(value);
  });
  const named = namedFiles.map((file) => readVarFile(repoDir, file) ?? {});
  const found: Deployer[] = [];
  for (const file of files) {
    if (GROUP_FILE.test(file)) continue;
    const path = file.slice(configDir.length + 1).replace(/\.ya?ml$/, '');
    for (const launch of launchesOf(repoDir, runs, path, named)) {
      const stack = stackOf(repoDir, project, file, launch);
      if (stack === undefined || sceptreTemplate(root, stack.own.value) !== template) continue;
      /** The name another stack of the project is launched under, by its path from `config/`, under the same launch. */
      const outputOf = (other: string): string | undefined => {
        const at = files.find((one) => one === `${configDir}/${other}` || one === `${configDir}/${other}.yaml` || one === `${configDir}/${other}.yml`);
        const that = at === undefined ? undefined : stackOf(repoDir, project, at, launch);
        return that === undefined ? undefined : stackNameOf(that);
      };
      const values: Record<string, DeployedValue> = {};
      for (const [name, value] of Object.entries(stack.parameters)) {
        const given = sceptreValue(value, stack.unrendered, launch, outputOf);
        if (given !== undefined) values[name] = given;
      }
      const stackName = stackNameOf(stack);
      const region = plainOf(stack.own.value['region']) ?? plainOf(stack.settings['region']);
      const run = launch.command === undefined ? '' : ` (${launch.command.label}, ${launch.command.file})`;
      found.push({
        tool: 'sceptre',
        file,
        line: 1,
        label: `${path}${run}`,
        group: posix.dirname(path) === '.' ? '' : posix.dirname(path),
        values,
        ...(stackName === undefined ? {} : { stackName }),
        ...(region === undefined ? {} : { region }),
        userData: stack.userData,
        files: [],
        varFiles: launch.varFiles,
        read: [...new Set([...stack.read, ...launch.varFiles, ...namedFiles, ...(launch.command === undefined ? [] : [launch.command.file])])],
      });
    }
  }
  return found;
};

/** A var file is a mapping of values; a template configuration or a stack's is not one. */
const parameterless = (value: Record<string, unknown>): boolean => !('Parameters' in value) && !('template_path' in value) && !('template' in value);

/** A template sceptre renders with Jinja before it deploys it (P261). */
export const JINJA_TEMPLATE = /\.j2$/;

/**
 * A template sceptre renders with Jinja (`.j2`), rendered with what the stack
 * hands it (`sceptre_user_data`) where it is plain (P261); an `Unread` naming
 * what is not rendered where anything is not.
 */
export const renderedTemplate = (text: string, userData: Readonly<Record<string, unknown>>): string | Unread => {
  const plain = (value: unknown): unknown => (value instanceof Resolved ? undefined : Array.isArray(value) ? value.map(plain) : isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)])) : value);
  const rendering = renderJinja(text, lookupIn({ sceptre_user_data: plain(userData) }));
  const [first] = rendering.unrendered.values();
  return first === undefined ? rendering.text : new Unread(`it is a Jinja template sceptre renders, and ${first} is not rendered from what the files give`);
};

// ---------------------------------------------------------------- rain

/** The options of `rain deploy` that take a value, by every spelling; every other option is a switch. */
const RAIN_VALUED = new Set(['--params', '--config', '-c', '--tags', '--region', '-r', '--profile', '-p', '--role-arn', '--s3-bucket', '--s3-prefix', '--node-style', '--format']);

/** The switches of `rain deploy` and rain's own: an option that takes no value. */
const RAIN_SWITCHES = new Set([
  '--yes',
  '-y',
  '--detach',
  '-d',
  '--keep',
  '--ignore-unknown-params',
  '--changeset',
  '--nested-change-set',
  '--termination-protection',
  '--precheck',
  '--experimental',
  '-x',
  '--debug',
  '--no-colour',
  '--no-color',
  '--help',
  '-h',
]);

/** A list of `K=V` as rain reads one: split at commas outside quotes. */
const pairsOf = (written: string): string[] => [...written.matchAll(/(?:"[^"]*"|[^,])+/g)].map((match) => match[0].replace(/"/g, ''));

/** The deployments of a template by `rain deploy` commands written beside it, above it, or in the repository's pipelines and scripts. */
const rainDeployers = (repoDir: string, template: string): Deployer[] => {
  const found: Deployer[] = [];
  for (const command of commandsAround(repoDir, posix.dirname(template))) {
    const { words } = command;
    const at = words.findIndex((word, index) => /(?:^|\/)rain$/.test(word) && words[index + 1] === 'deploy');
    if (at < 0) continue;
    const positional: string[] = [];
    const values: Record<string, DeployedValue> = {};
    let config: string | undefined;
    let region: string | undefined;
    /** A switch nothing here knows, written before a word: the word may be its value, so the stack is not read. */
    let unsure = false;
    const rest = words.slice(at + 2);
    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index] as string;
      const equals = word.indexOf('=');
      const flag = word.startsWith('-') ? (equals > 0 ? word.slice(0, equals) : word) : undefined;
      if (flag === undefined) {
        positional.push(word);
        continue;
      }
      if (!RAIN_VALUED.has(flag)) {
        if (!RAIN_SWITCHES.has(flag) && equals < 0) unsure = true;
        continue;
      }
      const value = equals > 0 ? word.slice(equals + 1) : rest[(index += 1)];
      if (value === undefined) continue;
      if (flag === '--params') {
        // Written more than once, every one counts, the later over the earlier.
        for (const pair of pairsOf(value)) {
          const split = pair.indexOf('=');
          if (split > 0) values[pair.slice(0, split)] = commandValue(pair.slice(split + 1));
        }
      } else if (flag === '--config' || flag === '-c') {
        config = value;
      } else if (flag === '--region' || flag === '-r') {
        region = isFilledIn(value) ? undefined : value;
      }
    }
    const [written, stack] = positional;
    if (written === undefined || isFilledIn(written)) continue;
    const dir = command.dirs.find((from) => under(from, written) === template);
    if (dir === undefined) continue;
    const stackName = stack === undefined ? (unsure ? undefined : posix.basename(template).replace(/\.[^.]+$/, '')) : isFilledIn(stack) || unsure ? undefined : stack;
    found.push({
      tool: 'rain',
      file: command.file,
      line: command.line,
      label: command.label,
      values,
      ...(stackName === undefined ? {} : { stackName }),
      ...(region === undefined ? {} : { region }),
      files: config === undefined || isFilledIn(config) ? [] : [under(dir, config)],
      read: [command.file],
    });
  }
  return found;
};

// ---------------------------------------------------------------- choice

const valueText = (value: DeployedValue): string => (typeof value === 'string' ? value : value instanceof Imported ? value.key : value.text);

/** Two deployments that give a template the same values are one. */
const sameDeployment = (a: Deployer, b: Deployer): boolean =>
  a.tool === b.tool &&
  a.stackName === b.stackName &&
  a.region === b.region &&
  JSON.stringify(a.files) === JSON.stringify(b.files) &&
  JSON.stringify(Object.entries(a.values).map(([name, value]) => [name, valueText(value)])) === JSON.stringify(Object.entries(b.values).map(([name, value]) => [name, valueText(value)])) &&
  JSON.stringify(a.userData ?? {}) === JSON.stringify(b.userData ?? {});

/** What reading a template's deployers settled: the one it is deployed by, several nothing chose between, or none. */
export type DeployerChoice = { readonly one: Deployer } | { readonly several: readonly Deployer[] } | undefined;

/**
 * The deployment of a template by sceptre or rain, as its files write it
 * (P259, P261): the one the configuration names - a stack's file or a var
 * file it is launched with among `services[].infra.vars`, a group as
 * `services[].infra.options.config_env` - else the only one there is.
 */
export const deployerOf = (repoDir: string, template: string, vars: readonly string[], options: Readonly<Record<string, string>>): DeployerChoice => {
  const all = [...sceptreDeployers(repoDir, template, vars), ...rainDeployers(repoDir, template)].filter((deployer, index, list) => list.findIndex((other) => sameDeployment(other, deployer)) === index);
  if (all.length === 0) return undefined;
  const named = all.filter((deployer) => vars.includes(deployer.file) || (deployer.varFiles ?? []).some((file) => vars.includes(file)));
  const env = options['config_env'];
  const grouped = env === undefined ? [] : all.filter((deployer) => deployer.group !== undefined && (deployer.group === env || deployer.group.startsWith(`${env}/`)));
  const chosen = named.length > 0 ? named : grouped.length > 0 ? grouped : all;
  const [one] = chosen;
  return chosen.length === 1 && one !== undefined ? { one } : { several: chosen };
};
