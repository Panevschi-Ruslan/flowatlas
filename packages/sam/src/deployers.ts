import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { stackOutputKey } from '@flowatlas/core';
import { commandsAround, commandValue, embeddedAt, embedding, Imported, isFilledIn, isRecord, readServiceYaml, textOf, under, Unread, type Command, type DeployedValue } from '@flowatlas/serverless';
import { lookupIn, renderJinja, UNRENDERED, type Loader, type Rendering } from './jinja.js';

export type { DeployedValue } from '@flowatlas/serverless';

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
 *   launched in. `{{ command_path }}` is the path the command launches,
 *   split into its parts, and the stack's own path where no command is
 *   written; a command launches the stacks it names and every stack they
 *   depend on (`dependencies`, and the stacks a `!stack_output` reads), as
 *   sceptre does; `!ssm` is a parameter of the account, said by its name
 *   (P289).
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

/**
 * The files a Jinja file sceptre renders names (P273), as the file loader
 * sceptre gives Jinja finds them: under the directory of the file rendered,
 * never above it, repo-relative.
 */
export const jinjaLoaderBeside =
  (repoDir: string, file: string): Loader =>
  (name) => {
    const parts = name.split('/').filter((part) => part !== '' && part !== '.');
    if (name.startsWith('/') || parts.length === 0 || parts.includes('..')) return undefined;
    const path = posix.join(posix.dirname(file), ...parts);
    const text = isDirectory(join(repoDir, path)) ? undefined : textAt(repoDir, path);
    return text === undefined ? undefined : { text, file: path };
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

/**
 * A value of a configuration file its Jinja's conditions decide, and the
 * files do not (P264): the ways they can go write it differently.
 */
class Undecided {
  constructor(readonly conditions: readonly string[]) {}

  get text(): string {
    return `it is written differently as ${this.conditions.join(' and ')} goes, which the files do not decide`;
  }
}

/** A plain mapping, as a configuration file's YAML reads one: not a resolver's value. */
const isMapping = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/** What every way a file renders agrees on, key by key; what they do not, {@link Undecided}. */
const agreed = (values: readonly unknown[], conditions: readonly string[]): unknown => {
  const [first] = values;
  if (values.every((value) => JSON.stringify(value) === JSON.stringify(first))) return first;
  if (!values.every(isMapping)) return new Undecided(conditions);
  const keys = [...new Set(values.flatMap((value) => Object.keys(value as Record<string, unknown>)))];
  return Object.fromEntries(keys.map((key) => [key, values.every((value) => key in (value as Record<string, unknown>)) ? agreed(values.map((value) => (value as Record<string, unknown>)[key]), conditions) : new Undecided(conditions)]));
};

/** What a stack's files are rendered with: the vars and the environment the commands that launch it give, or none. */
interface Launch {
  /** The command that launches it, where one is written. */
  readonly command?: Command;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly env: Readonly<Record<string, DeployedValue>>;
  readonly varFiles: readonly string[];
  /** The path the command names, split into its parts as sceptre gives a file `command_path` (P289): `['prod', 'orders.yaml']`. */
  readonly commandPath: readonly string[];
}

/** A sceptre configuration file, rendered and read, its resolvers kept apart; `undefined` where it does not read. */
interface SceptreFile {
  readonly value: Record<string, unknown>;
  readonly rendering: Rendering;
}

/**
 * A sceptre configuration file under a launch, rendered with its vars and
 * environment and the configuration of the groups above it
 * (`stack_group_config`, P264), every way its conditions can go, and read
 * where the ways agree.
 */
const readSceptreFile = (repoDir: string, project: Project, file: string, launch: Launch, groupConfig: Readonly<Record<string, unknown>> = {}): SceptreFile | undefined => {
  const text = textAt(repoDir, file);
  if (text === undefined) return undefined;
  const environment = Object.fromEntries(Object.entries(launch.env).filter(([, value]) => typeof value === 'string'));
  const rendering = renderJinja(text, lookupIn({ var: launch.vars, environment_variable: environment, stack_group_config: groupConfig, command_path: launch.commandPath }), project.files.indexOf(file) + 1, { load: jinjaLoaderBeside(repoDir, file) });
  // A statement not run here decides what the file is: nothing this does not run can say.
  if ([...rendering.unrendered.values()].some((written) => written.startsWith('{%'))) return undefined;
  try {
    const values = rendering.ways.map((way) => readServiceYaml(way, { otherTag: (tag, written) => new Resolved(tag, written) }).value);
    const value = values.length === 1 ? values[0] : agreed(values, rendering.undecided);
    return isMapping(value) ? { value, rendering } : undefined;
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

/** Every file below a directory whose name a pattern matches, repo-relative. */
const filesUnder = (repoDir: string, dir: string, name: RegExp, depth = 0): string[] => {
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
      if (entry.isDirectory()) return depth >= MOST_GROUP_DEPTH ? [] : filesUnder(repoDir, path, name, depth + 1);
      return name.test(entry.name) ? [path] : [];
    });
};

/** A file a Jinja file names by a literal in `extends`, `include`, `import` or `from`. */
const NAMED_FILE = /\{%-?\s*(?:extends|include|import|from)\s+(['"])([^'"]+)\1/g;

/**
 * What a Jinja file of a sceptre project is (P273): a template a stack's
 * configuration names (`template_path`, or `template: { path }`), a part
 * another Jinja file of the project includes, imports or extends, or
 * neither - `undefined` outside a sceptre project. Read from the text, before
 * anything is rendered.
 */
export const jinjaFileRole = (repoDir: string, file: string): 'template' | 'part' | 'neither' | undefined => {
  const root = sceptreRoot(repoDir, file);
  if (root === undefined) return undefined;
  for (const config of yamlFilesUnder(repoDir, under(root, 'config'))) {
    for (const match of (textAt(repoDir, config) ?? '').matchAll(/^\s*(?:template_path|path)\s*:\s*['"]?([^'"\s#{}]+)/gm)) {
      const path = match[1] as string;
      if (under(root, path.startsWith('templates/') ? path : `templates/${path}`) === file) return 'template';
    }
  }
  for (const other of filesUnder(repoDir, under(root, 'templates'), JINJA_TEMPLATE)) {
    if (other === file) continue;
    for (const match of (textAt(repoDir, other) ?? '').matchAll(NAMED_FILE)) {
      if (posix.join(posix.dirname(other), match[2] as string) === file) return 'part';
    }
  }
  return 'neither';
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

/**
 * A stack's configuration under a launch, merged with every group
 * configuration above it: the groups from the project's down, each rendered
 * with the configuration of those above it, and the stack's own with all of
 * theirs, as sceptre renders `stack_group_config` (P264).
 */
const stackOf = (repoDir: string, project: Project, file: string, launch: Launch): Stack | undefined => {
  const read = [file];
  let settings: Record<string, unknown> = {};
  let parameters: Record<string, unknown> = {};
  let userData: Record<string, unknown> = {};
  const unrendered = new Map<string, string>();
  const dirs: string[] = [];
  for (let dir = posix.dirname(file); dir.length >= project.configDir.length; dir = posix.dirname(dir)) {
    dirs.unshift(dir);
    if (dir === project.configDir) break;
  }
  for (const dir of dirs) {
    const group = project.groups.get(dir);
    if (group === undefined) continue;
    read.push(group);
    const reading = readSceptreFile(repoDir, project, group, launch, settings);
    if (reading === undefined) continue;
    const written = reading.value;
    read.push(...reading.rendering.loaded);
    for (const [at, expression] of reading.rendering.unrendered) unrendered.set(at, expression);
    settings = { ...settings, ...written };
    parameters = { ...parameters, ...recordAt(written, 'parameters') };
    userData = { ...userData, ...recordAt(written, 'sceptre_user_data') };
  }
  const own = readSceptreFile(repoDir, project, file, launch, settings);
  if (own === undefined) return undefined;
  read.push(...own.rendering.loaded);
  for (const [at, expression] of own.rendering.unrendered) unrendered.set(at, expression);
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

/** What a stack's resolvers are read with. */
interface Resolving {
  readonly unrendered: ReadonlyMap<string, string>;
  readonly launch: Launch;
  /** The name another stack of the project is launched under, by its path from `config/`. */
  readonly outputOf: (stackPath: string) => string | undefined;
  /** The stack's own configuration, merged with its groups': what `!stack_attr` reads (P264). */
  readonly config: Readonly<Record<string, unknown>>;
  /** The project's directory, repo-relative: what `!file` reads under. */
  readonly root: string;
  readonly repoDir: string;
  /** Every file a resolver read, repo-relative. */
  readonly read: string[];
}

/** That a resolver leaves the value out: `!no_value` (P264). */
const NO_VALUE = Symbol('no value');

/** A value of a stack's configuration as far as it is read: text, a list, another deployment's value, why not, or none. */
type Part = string | Unread | typeof NO_VALUE | readonly Part[];

/** How deep resolvers are followed into each other. */
const MOST_RESOLVER_DEPTH = 6;

/** The two arguments a resolver of a list is written with: `!join [",", [a, b]]`. */
const pairOf = (value: unknown): readonly [unknown, unknown] | undefined => (Array.isArray(value) && value.length === 2 ? [value[0], value[1]] : undefined);

/**
 * Text built of parts, each value another deployment publishes at its mark
 * (P259): the text, the import where it is the whole, or the text with each
 * one's stand-in in place for the reader of the name to finish.
 */
const built = (parts: readonly Part[], separator: string): Part => {
  const imports: Imported[] = [];
  const texts: string[] = [];
  for (const part of parts) {
    if (part === NO_VALUE) continue;
    if (part instanceof Imported) {
      texts.push(embeddedAt(imports.length));
      imports.push(part);
    } else if (part instanceof Unread) return part;
    else if (typeof part === 'string') texts.push(part);
    else return new Unread('it joins a list inside a list');
  }
  return embedding(texts.join(separator), imports, undefined);
};

/**
 * What a stack's configuration gives a value (P261, P264): its text; the
 * output of another stack, which its publisher's reading joins; a value of
 * the environment it is launched in; the contents of a file (`!file`); another
 * field of the stack (`!stack_attr`); the joins, splits, picks and formats of
 * sceptre's own resolvers (`!join`, `!split`, `!select`, `!sub`); or nothing
 * (`!no_value`). A command a resolver runs (`!rcmd`, `!cmd`), any other
 * resolver and an expression not rendered are why it is not known.
 */
const resolveValue = (value: unknown, at: Resolving, depth = 0): Part => {
  if (value === null || value === undefined) return NO_VALUE;
  if (depth > MOST_RESOLVER_DEPTH) return new Unread('its resolvers lead into each other too deep');
  if (value instanceof Undecided) return new Unread(value.text);
  if (value instanceof Resolved) return resolverValue(value, at, depth);
  if (Array.isArray(value)) return value.map((part) => resolveValue(part, at, depth + 1));
  const text = typeof value === 'boolean' || typeof value === 'number' ? String(value) : textOf(value);
  if (text === undefined) return new Unread('it is not text');
  const kept = UNRENDERED.exec(text);
  if (kept !== null) return new Unread(`it is a Jinja expression (${at.unrendered.get(kept[0]) ?? text.trim()}), rendered when sceptre runs with what the files do not give`);
  return text;
};

const resolverValue = (value: Resolved, at: Resolving, depth: number): Part => {
  const written = textOf(value.value)?.trim();
  switch (value.tag) {
    case '!stack_output':
    case '!stack_output_external': {
      const named = outputNamed(value.value);
      if (named === undefined) break;
      const stack = value.tag === '!stack_output' ? at.outputOf(named.stack) : named.stack;
      if (stack === undefined) return new Unread(`it is given by ${value.text}, a stack whose configuration is not read`);
      return new Imported(stackOutputKey(stack, named.output), `the value is the output ${named.output} of the stack ${stack}, which its deployment publishes`, value.text);
    }
    case '!environment_variable': {
      const given = written === undefined ? undefined : at.launch.env[written];
      if (typeof given === 'string') return given;
      break;
    }
    case '!no_value':
      return NO_VALUE;
    case '!ssm': {
      // sceptre-ssm-resolver: `!ssm /path/to/parameter`, or `!ssm { name: /path/to/parameter, profile, region }` (P289).
      const name = written ?? (isMapping(value.value) ? textOf(value.value['name'])?.trim() : undefined);
      if (name === undefined || UNRENDERED.test(name)) break;
      return new Unread(`it is the SSM parameter ${name}, which sceptre reads from the account when the stack is launched; the files do not give its value`);
    }
    case '!rcmd':
    case '!cmd':
      return new Unread(`it is what ${value.text} prints, a command sceptre runs when the stack is launched`);
    case '!file':
    case '!file_contents': {
      if (written === undefined || UNRENDERED.test(written)) break;
      const file = under(at.root, written);
      const text = textAt(at.repoDir, file);
      if (text === undefined) return new Unread(`it is the contents of ${file}, which is not in the repository`);
      at.read.push(file);
      if (!/\.(?:ya?ml|json)$/.test(file)) return text;
      try {
        return resolveValue(readServiceYaml(text).value, at, depth + 1);
      } catch {
        return new Unread(`it is the contents of ${file}, which does not read`);
      }
    }
    case '!stack_attr': {
      if (written === undefined) break;
      let found: unknown = at.config;
      for (const step of written.split('.')) found = isMapping(found) ? found[step] : undefined;
      if (found === undefined) return new Unread(`it is ${value.text}, a field the stack's configuration does not hold`);
      return resolveValue(found, at, depth + 1);
    }
    case '!join': {
      const pair = pairOf(value.value);
      const separator = pair === undefined ? undefined : textOf(pair[0]);
      const items = pair === undefined ? undefined : resolveValue(pair[1], at, depth + 1);
      if (separator === undefined || items === undefined || !Array.isArray(items)) break;
      return built(items, separator);
    }
    case '!split': {
      const pair = pairOf(value.value);
      const separator = pair === undefined ? undefined : textOf(pair[0]);
      const text = pair === undefined ? undefined : resolveValue(pair[1], at, depth + 1);
      if (separator === undefined || text === undefined) break;
      if (text instanceof Unread) return text;
      return typeof text === 'string' ? text.split(separator) : new Unread(`${value.tag} is handed what is not text`);
    }
    case '!select': {
      const pair = pairOf(value.value);
      const index = pair === undefined ? undefined : Number(textOf(pair[0]));
      const items = pair === undefined ? undefined : resolveValue(pair[1], at, depth + 1);
      if (index === undefined || !Number.isInteger(index) || items === undefined) break;
      if (items instanceof Unread) return items;
      return Array.isArray(items) && items[index] !== undefined ? (items[index] as Part) : new Unread(`${value.tag} picks what the list does not hold`);
    }
    case '!sub': {
      const pair = Array.isArray(value.value) ? pairOf(value.value) : [value.value, {}];
      const format = pair === undefined ? undefined : textOf(pair[0]);
      const vars = pair === undefined || !isMapping(pair[1]) ? undefined : pair[1];
      if (format === undefined || vars === undefined) break;
      // Python's format: `{name}` is a value handed in, `{{` and `}}` a brace.
      const parts: Part[] = [];
      let missing: string | undefined;
      let last = 0;
      for (const match of format.matchAll(/\{\{|\}\}|\{([A-Za-z_]\w*)\}/g)) {
        parts.push(format.slice(last, match.index));
        last = (match.index ?? 0) + match[0].length;
        if (match[1] === undefined) {
          parts.push(match[0][0] as string);
          continue;
        }
        if (!(match[1] in vars)) missing ??= match[1];
        parts.push(resolveValue(vars[match[1]], at, depth + 1));
      }
      parts.push(format.slice(last));
      if (missing !== undefined) return new Unread(`${value.tag} formats {${missing}}, which it is not handed`);
      return built(parts, '');
    }
    default:
      break;
  }
  return new Unread(`it is given by ${value.text}, and sceptre's ${value.tag} resolver runs when the stack is launched`);
};

/** What a stack's configuration gives a parameter, as the template is handed it: a list joined by commas, as sceptre joins one. */
const sceptreValue = (value: unknown, at: Resolving): DeployedValue | undefined => {
  const part = resolveValue(value, at);
  if (part === NO_VALUE) return undefined;
  if (!Array.isArray(part)) return part as DeployedValue;
  const joined = built(part as readonly Part[], ',');
  return joined === NO_VALUE ? undefined : (joined as DeployedValue);
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
  /** The path as the command writes it (P289): what `command_path` is. */
  readonly written: string;
  readonly varFiles: readonly string[];
  readonly vars: Readonly<Record<string, string | Unread>>;
  /** `--merge-vars`: successive var files merged key by key at every depth, not replaced at the top (P264). */
  readonly mergeVars: boolean;
}

/** Every sceptre command written around a project that launches its stacks. */
const sceptreRuns = (repoDir: string, root: string): SceptreRun[] =>
  commandsAround(repoDir, root).flatMap((command): SceptreRun[] => {
    const at = command.words.findIndex((word) => /(?:^|\/)sceptre$/.test(word));
    if (at < 0) return [];
    const varFiles: string[] = [];
    const vars: Record<string, string | Unread> = {};
    let dir = '.';
    let mergeVars = false;
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
      if (flag === '--merge-vars') mergeVars = true;
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
    return [{ command, dirs, path: posix.normalize(path.replace(/\.ya?ml$/, '')), written: path, varFiles: varFiles.map((file) => under(root, file)), vars, mergeVars }];
  });

/** Whether a run launches a stack: the whole project, the stack's group or one above it, or the stack. */
const launches = (run: SceptreRun, stackPath: string): boolean => run.path === '.' || run.path === stackPath || stackPath.startsWith(`${run.path}/`);

/** Two mappings merged key by key at every depth, the later winning where either is not a mapping: `--merge-vars` (P264). */
const mergedDeeply = (into: Record<string, unknown>, from: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...into };
  for (const [key, value] of Object.entries(from)) {
    const before = out[key];
    out[key] = isMapping(before) && isMapping(value) ? mergedDeeply(before, value) : value;
  }
  return out;
};

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
const launchesOf = (repoDir: string, runs: readonly SceptreRun[], stackPath: string, stackFile: string, named: readonly Record<string, unknown>[], launched: (run: SceptreRun) => ReadonlySet<string>): Launch[] => {
  const over = Object.assign({}, ...named) as Record<string, unknown>;
  // A run launches a stack it names, and every stack those depend on (P289).
  const covering = runs.filter((run) => launches(run, stackPath) || launched(run).has(stackPath));
  if (covering.length === 0) return [{ vars: over, env: {}, varFiles: [], commandPath: stackFile.split('/') }];
  return covering.map((run) => runLaunch(repoDir, run, over));
};

/** What a run hands the stacks it launches: its var files and vars, the configuration's over them, its environment and its path. */
const runLaunch = (repoDir: string, run: SceptreRun, over: Readonly<Record<string, unknown>>): Launch => {
  const files = run.varFiles.map((file) => readVarFile(repoDir, file) ?? {});
  const fromFiles = run.mergeVars ? files.reduce<Record<string, unknown>>((into, file) => mergedDeeply(into, file), {}) : (Object.assign({}, ...files) as Record<string, unknown>);
  // A var a shell variable fills in is not known: it is left out, and renders nothing.
  const given = Object.fromEntries(Object.entries(run.vars).filter(([, value]) => typeof value === 'string'));
  return { command: run.command, vars: { ...fromFiles, ...given, ...over }, env: run.command.env, varFiles: run.varFiles, commandPath: run.written === '.' ? [] : run.written.split('/').filter((part) => part !== '') };
};

/**
 * The stacks a stack depends on (P289), by their path from `config/`: the
 * `dependencies` its configuration and its groups' write, and every stack
 * whose output a `!stack_output` of it reads, as sceptre launches them first.
 */
const dependenciesOf = (stack: Stack): string[] => {
  const out = new Set<string>();
  const listed = (value: unknown): void => {
    for (const each of Array.isArray(value) ? value : []) {
      const path = plainOf(each);
      if (path !== undefined) out.add(posix.normalize(path.replace(/\.ya?ml$/, '')));
    }
  };
  listed(stack.settings['dependencies']);
  listed(stack.own.value['dependencies']);
  const outputs = (value: unknown, depth = 0): void => {
    if (depth > 8) return;
    if (value instanceof Resolved) {
      const named = value.tag === '!stack_output' ? outputNamed(value.value) : undefined;
      if (named !== undefined) out.add(posix.normalize(named.stack.replace(/\.ya?ml$/, '')));
      return;
    }
    if (Array.isArray(value)) for (const item of value) outputs(item, depth + 1);
    else if (isMapping(value)) for (const item of Object.values(value)) outputs(item, depth + 1);
  };
  outputs(stack.parameters);
  outputs(stack.userData);
  return [...out];
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
  const over = Object.assign({}, ...named) as Record<string, unknown>;
  const stackFiles = files.filter((file) => !GROUP_FILE.test(file));
  const pathOf = (file: string): string => file.slice(configDir.length + 1).replace(/\.ya?ml$/, '');
  // What each run launches: the stacks it names, then what they depend on, all the way down (P289).
  const closures = new Map<SceptreRun, ReadonlySet<string>>();
  const launched = (run: SceptreRun): ReadonlySet<string> => {
    const known = closures.get(run);
    if (known !== undefined) return known;
    const launch = runLaunch(repoDir, run, over);
    const out = new Set(stackFiles.map(pathOf).filter((path) => launches(run, path)));
    const queue = [...out];
    while (queue.length > 0) {
      const path = queue.shift() as string;
      const file = stackFiles.find((each) => pathOf(each) === path);
      const stack = file === undefined ? undefined : stackOf(repoDir, project, file, launch);
      for (const dependency of stack === undefined ? [] : dependenciesOf(stack)) {
        if (out.has(dependency) || !stackFiles.some((each) => pathOf(each) === dependency)) continue;
        out.add(dependency);
        queue.push(dependency);
      }
    }
    closures.set(run, out);
    return out;
  };
  const found: Deployer[] = [];
  for (const file of stackFiles) {
    const path = pathOf(file);
    for (const launch of launchesOf(repoDir, runs, path, file.slice(configDir.length + 1), named, launched)) {
      const stack = stackOf(repoDir, project, file, launch);
      if (stack === undefined || sceptreTemplate(root, stack.own.value) !== template) continue;
      /** The name another stack of the project is launched under, by its path from `config/`, under the same launch. */
      const outputOf = (other: string): string | undefined => {
        const at = files.find((one) => one === `${configDir}/${other}` || one === `${configDir}/${other}.yaml` || one === `${configDir}/${other}.yml`);
        const that = at === undefined ? undefined : stackOf(repoDir, project, at, launch);
        return that === undefined ? undefined : stackNameOf(that);
      };
      const values: Record<string, DeployedValue> = {};
      const resolving: Resolving = { unrendered: stack.unrendered, launch, outputOf, config: { ...stack.settings, ...stack.own.value, parameters: stack.parameters, sceptre_user_data: stack.userData }, root, repoDir, read: [] };
      for (const [name, value] of Object.entries(stack.parameters)) {
        const given = sceptreValue(value, resolving);
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
        read: [...new Set([...stack.read, ...launch.varFiles, ...namedFiles, ...resolving.read, ...(launch.command === undefined ? [] : [launch.command.file])])],
      });
    }
  }
  return found;
};

/** A var file is a mapping of values; a template configuration or a stack's is not one. */
const parameterless = (value: Record<string, unknown>): boolean => !('Parameters' in value) && !('template_path' in value) && !('template' in value);

/** A template rendered: its text, and the line of the file each of its lines comes from where they differ (P273). */
export interface JinjaRendered {
  readonly text: string;
  readonly lines: readonly number[];
}

/** A template sceptre renders with Jinja before it deploys it (P261). */
export const JINJA_TEMPLATE = /\.j2$/;

/**
 * A template sceptre renders with Jinja (`.j2`), rendered with what the stack
 * hands it (`sceptre_user_data`) where it is plain (P261); an `Unread` naming
 * what is not rendered where anything is not. The files it includes, imports
 * or extends are read beside it (P273), each handed to `loaded`; a template
 * whose undecided conditions render it differently is not read (P264).
 */
export const renderedTemplate = (text: string, userData: Readonly<Record<string, unknown>>, load?: Loader, loaded: (file: string) => void = () => undefined): JinjaRendered | Unread => {
  const plain = (value: unknown): unknown => (value instanceof Resolved ? undefined : Array.isArray(value) ? value.map(plain) : isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)])) : value);
  const rendering = renderJinja(text, lookupIn({ sceptre_user_data: plain(userData) }), 0, load === undefined ? {} : { load });
  for (const file of rendering.loaded) loaded(file);
  const [first] = rendering.unrendered.values();
  if (first !== undefined) return new Unread(`it is a Jinja template sceptre renders, and ${first} is not rendered from what the files give`);
  return rendering.ways.length === 1 ? { text: rendering.text, lines: rendering.lines } : new Unread(`it is a Jinja template sceptre renders, and ${rendering.undecided[0] ?? 'a condition'} is not decided by what the files give, which renders it differently`);
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
