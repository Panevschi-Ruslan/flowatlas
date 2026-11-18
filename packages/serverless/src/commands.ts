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
  /**
   * The conditionals of a Makefile (`ifeq`, `ifdef`, ...) whose operands the
   * files do not settle that this command, or a value of its environment, is
   * read under (P356): each such conditional's branches are all read, so the
   * command is one reading of several, as written in the file (`ifdef CI
   * (Makefile:4)`).
   */
  readonly assumed?: readonly string[];
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

/** Programs that run the rest of their words with the assignments written first as its environment (P350). */
const ENV_SETTERS = new Set(['env', 'cross-env', 'cross-env-shell']);

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
      // `env X=v cmd`, `cross-env X=v cmd` (P350): the program's environment, as written before it.
      while (ENV_SETTERS.has(words[first] ?? '') && ASSIGNMENT.test(words[first + 1] ?? '')) {
        first += 1;
        while (first < words.length && ASSIGNMENT.test(words[first] as string)) {
          const [, name, value] = ASSIGNMENT.exec(words[first] as string) as RegExpExecArray;
          inline[name as string] = commandValue(value as string);
          first += 1;
        }
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

/**
 * The recipes of every Makefile of a directory, each line where it is
 * written. A file another Makefile of the directory includes is read as part
 * of that one, with its variables and its targets' (P350), not again on its
 * own: make reads it only where it is included.
 */
const makeRecipes = (repoDir: string, dir: string): Command[] => {
  const files = filesIn(repoDir, dir).filter((file) => MAKEFILES.test(posix.basename(file)));
  const read = new Map(files.map((file) => [file, makeReadings(repoDir, file)] as const));
  const included = new Set([...read.values()].flatMap((readings) => readings.flatMap((variables) => variables.included)));
  return files.filter((file) => !included.has(file)).flatMap((file) => recipesOf(repoDir, file, read.get(file) as MakeVariables[]));
};

/** How deep a Makefile's `include` is followed, and a variable's value expanded. */
const MAKE_DEPTH = 8;

/** How many readings of one recipe line are made: its own target's, and those of the targets that build it as a prerequisite (P350). */
const MAKE_GOALS = 16;

/** How many readings of one Makefile are made for one goal, a branch of each conditional the files do not settle in each (P356). */
const MAKE_READINGS = 16;

/** A Makefile's variable assignment, as make writes one: `[export] [override] [private] NAME op value`. */
const MAKE_ASSIGNMENT = /^(?:(export)\s+)?(?:override\s+)?(?:(private)\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*(::?=|:::=|\?=|\+=|!=|=)\s*(.*)$/;

/** A variable of a Makefile: its value as written (`=`, expanded when used) or already expanded (`:=`), or a shell's (`!=`) that is not known. */
interface MakeVariable {
  readonly value: string;
  readonly simple: boolean;
  readonly shell?: true;
  /** The conditionals the files do not settle its assignment is read under (P356). */
  readonly assumed?: readonly string[];
}

/** Where a line of a Makefile stands in its conditionals (P356): whether make reads it, and the unsettled conditionals it is read under. */
interface LineState {
  readonly active: boolean;
  readonly assumed: readonly string[];
}

/** A target's own variable: whether it is exported, and whether it is `private`, kept from the targets it builds (P350). */
type TargetVariable = MakeVariable & { readonly exported: boolean; readonly private?: true };

/**
 * What a Makefile says its variables are (P343): each assignment, in order,
 * the files it `include`s read where they are written; the names it exports
 * (`export NAME = v`, `export NAME`, every one after a bare `export` or
 * `.EXPORT_ALL_VARIABLES:`), less those it `unexport`s; and each target's own
 * (`serve: export PORT = 4500`). And (P350) the files it includes, in the
 * order make reads them, and each target's prerequisites.
 */
interface MakeVariables {
  readonly values: Map<string, MakeVariable>;
  readonly exported: Set<string>;
  readonly unexported: Set<string>;
  exportAll: boolean;
  /** Each target's own variables, and whether each is exported. */
  readonly targets: Map<string, Map<string, TargetVariable>>;
  /** The files it includes, repo-relative, each once, as make reads them. */
  readonly included: string[];
  /** Each target's prerequisites, as its rules write them, over every file read. */
  readonly prerequisites: Map<string, Set<string>>;
  /** The goal make is asked for, what `$(MAKECMDGOALS)` is; none where the reading is for no one goal (P356). */
  readonly goal?: string;
  /** The branch taken of each conditional the files do not settle, by where it is written; one not named takes its first (P356). */
  readonly choices: ReadonlyMap<string, boolean>;
  /** The conditionals the files do not settle met in this reading and not named in `choices`, by where each is written (P356). */
  readonly unknowns: string[];
  /** Each line of every file read, where it stands in its conditionals (P356). */
  readonly lines: Map<string, LineState[]>;
}

/** A Makefile's variables, read from it and every file it includes (P343, P350), for a goal and a choice of the unsettled conditionals' branches (P356). */
const makeVariablesOf = (repoDir: string, makefile: string, goal?: string, choices: ReadonlyMap<string, boolean> = new Map()): MakeVariables => {
  const variables: MakeVariables = {
    values: new Map(),
    exported: new Set(),
    unexported: new Set(),
    exportAll: false,
    targets: new Map(),
    included: [],
    prerequisites: new Map(),
    ...(goal === undefined ? {} : { goal }),
    choices,
    unknowns: [],
    lines: new Map(),
  };
  readMakeVariables(repoDir, makefile, variables);
  return variables;
};

/**
 * The readings of a Makefile for a goal (P356): where a conditional's
 * operands are not settled by the files (a variable only the environment or
 * the command line gives, `$(shell ...)`), make may take either branch, so
 * each is read - one reading with the first branch of every such
 * conditional, then one with each other branch, up to {@link MAKE_READINGS}.
 */
const makeReadings = (repoDir: string, makefile: string, goal?: string): MakeVariables[] => {
  const readings: MakeVariables[] = [];
  const queue: Map<string, boolean>[] = [new Map()];
  const queued = new Set<string>(['']);
  while (queue.length > 0 && readings.length < MAKE_READINGS) {
    const choices = queue.shift() as Map<string, boolean>;
    const variables = makeVariablesOf(repoDir, makefile, goal, choices);
    readings.push(variables);
    for (const key of variables.unknowns) {
      const other = new Map([...choices, [key, false]]);
      const name = [...other].map(([at, taken]) => `${at}=${taken}`).sort().join('\0');
      if (queued.has(name)) continue;
      queued.add(name);
      queue.push(other);
    }
  }
  return readings;
};

/** A value's words, as make splits them. */
const makeWords = (text: string): string[] => text.split(/\s+/).filter((word) => word !== '');

/** Whether a word matches a pattern of make's (`%-dev`, `%.o`): the `%` any text at all, a pattern without one the word itself. */
const makePatternMatches = (pattern: string, word: string): boolean => {
  const at = pattern.indexOf('%');
  if (at < 0) return pattern === word;
  const head = pattern.slice(0, at);
  const tail = pattern.slice(at + 1);
  return word.length >= head.length + tail.length && word.startsWith(head) && word.endsWith(tail);
};

/**
 * Make's text functions a conditional is written with (P356), as the GNU make
 * manual documents them ("Functions for String Substitution and Analysis"):
 * each with how many arguments it takes, the last taking any comma left.
 */
const MAKE_FUNCTIONS: Readonly<Record<string, { readonly arity: number; readonly apply: (args: readonly string[]) => string }>> = {
  strip: { arity: 1, apply: ([text = '']) => makeWords(text).join(' ') },
  firstword: { arity: 1, apply: ([text = '']) => makeWords(text)[0] ?? '' },
  lastword: { arity: 1, apply: ([text = '']) => makeWords(text).at(-1) ?? '' },
  words: { arity: 1, apply: ([text = '']) => String(makeWords(text).length) },
  findstring: { arity: 2, apply: ([find = '', text = '']) => (text.includes(find) ? find : '') },
  filter: { arity: 2, apply: ([patterns = '', text = '']) => makeWords(text).filter((word) => makeWords(patterns).some((pattern) => makePatternMatches(pattern, word))).join(' ') },
  'filter-out': { arity: 2, apply: ([patterns = '', text = '']) => makeWords(text).filter((word) => !makeWords(patterns).some((pattern) => makePatternMatches(pattern, word))).join(' ') },
  subst: { arity: 3, apply: ([from = '', to = '', text = '']) => (from === '' ? text : text.split(from).join(to)) },
};

/** The index of the bracket closing the one opened at `open`, nested ones of either kind counted; -1 where none does. */
const closingOf = (text: string, open: number): number => {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const char = text[at];
    if (char === '(' || char === '{') depth += 1;
    else if (char === ')' || char === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
};

/** A function's arguments, split at the commas outside brackets, the last one taking the rest. */
const makeArguments = (text: string, arity: number): string[] => {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length && out.length < arity - 1; at += 1) {
    const char = text[at];
    if (char === '(' || char === '{') depth += 1;
    else if (char === ')' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      out.push(text.slice(from, at));
      from = at + 1;
    }
  }
  out.push(text.slice(from));
  return out;
};

/**
 * A value with make's own references in it filled from its variables:
 * `$(PORT)`, `${PORT}`, `$$` as one `$`, and the text functions of
 * {@link MAKE_FUNCTIONS} (P356). A reference to a variable it does not set,
 * one the shell gives (`!=`), or a function it does not read is left as
 * written, and the value said not settled.
 */
const makeExpanded = (text: string, lookup: (name: string) => MakeVariable | undefined, depth = 0): { text: string; settled: boolean } => {
  let out = '';
  let settled = true;
  for (let at = 0; at < text.length; ) {
    const char = text[at] as string;
    const next = text[at + 1];
    if (char !== '$' || next === undefined) {
      out += char;
      at += 1;
      continue;
    }
    if (next === '$') {
      out += '$';
      at += 2;
      continue;
    }
    if (next !== '(' && next !== '{') {
      // `$@`, `$<`, `$X`: make's own one-letter names, not read.
      out += `$${next}`;
      settled = false;
      at += 2;
      continue;
    }
    const close = closingOf(text, at + 1);
    if (close < 0) {
      out += text.slice(at);
      settled = false;
      break;
    }
    const written = text.slice(at, close + 1);
    const inner = text.slice(at + 2, close);
    at = close + 1;
    if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(inner)) {
      const found = lookup(inner);
      if (found === undefined || found.shell === true || depth >= MAKE_DEPTH) {
        out += written;
        settled = false;
      } else if (found.simple) out += found.value;
      else {
        const value = makeExpanded(found.value, lookup, depth + 1);
        out += value.text;
        settled &&= value.settled;
      }
      continue;
    }
    const call = /^([a-z-]+)\s+([\s\S]*)$/.exec(inner);
    const fn = call === null ? undefined : MAKE_FUNCTIONS[call[1] as string];
    if (call === null || fn === undefined || depth >= MAKE_DEPTH) {
      out += written;
      settled = false;
      continue;
    }
    const args = makeArguments(call[2] as string, fn.arity).map((arg) => makeExpanded(arg, lookup, depth + 1));
    if (args.some((arg) => !arg.settled)) {
      out += written;
      settled = false;
      continue;
    }
    out += fn.apply(args.map((arg) => arg.text));
  }
  return { text: out, settled };
};

/** A value with make's own references in it filled from its variables, as {@link makeExpanded} fills them; what it does not settle left as written. */
const makeExpand = (text: string, lookup: (name: string) => MakeVariable | undefined, depth = 0): string => makeExpanded(text, lookup, depth).text;

/** A value written after an assignment, its comment taken off. */
const makeValue = (written: string): string => written.replace(/(^|[^\\])#.*$/, '$1').trim();

/** One assignment, onto a set of variables, as make makes it; `assumed` the unsettled conditionals it is read under (P356). */
const assign = (into: Map<string, MakeVariable>, name: string, op: string, written: string, lookup: (name: string) => MakeVariable | undefined, assumed: readonly string[] = []): void => {
  const value = makeValue(written);
  const before = into.get(name);
  const marked = (variable: MakeVariable, also: readonly string[] = []): MakeVariable => {
    const all = [...new Set([...also, ...assumed])];
    return { value: variable.value, simple: variable.simple, ...(variable.shell === true ? { shell: true as const } : {}), ...(all.length === 0 ? {} : { assumed: all }) };
  };
  if (op === '?=') {
    if (before === undefined) into.set(name, marked({ value, simple: false }));
  } else if (op === '+=') {
    if (before === undefined) into.set(name, marked({ value, simple: false }));
    else into.set(name, marked({ ...before, value: `${before.value} ${before.simple ? makeExpand(value, lookup) : value}`.trim() }, before.assumed));
  } else if (op === '!=') into.set(name, marked({ value, simple: true, shell: true }));
  else if (op === '=') into.set(name, marked({ value, simple: false }));
  else into.set(name, marked({ value: makeExpand(value, lookup), simple: true }));
};

/**
 * One conditional's test (P356), as the GNU make manual's "Syntax of
 * Conditionals" writes it: `ifeq (a,b)`, `ifeq "a" "b"`, `ifeq 'a' "b"`,
 * `ifneq` the same, `ifdef NAME`, `ifndef NAME` (a variable with a value
 * that is not empty, unexpanded, is defined). Whether it holds, or
 * `undefined` where its operands are not settled by the files: a variable
 * the Makefile does not set (the environment or the command line may),
 * `$(shell ...)`, a function not read.
 */
const conditionHolds = (directive: string, written: string, lookup: (name: string) => MakeVariable | undefined): boolean | undefined => {
  if (directive === 'ifdef' || directive === 'ifndef') {
    const name = makeExpanded(written.trim(), lookup);
    if (!name.settled) return undefined;
    const found = lookup(name.text.trim());
    if (found === undefined) return undefined;
    const defined = found.value !== '';
    return directive === 'ifdef' ? defined : !defined;
  }
  let operands: [string, string] | undefined;
  const text = written.trim();
  if (text.startsWith('(')) {
    const close = closingOf(text, 0);
    if (close < 0) return undefined;
    const [first = '', second] = makeArguments(text.slice(1, close), 2);
    if (second === undefined) return undefined;
    // Whitespace around each operand is not part of it.
    operands = [first.trim(), second.trim()];
  } else {
    const quoted = /^(["'])(.*?)\1\s+(["'])(.*?)\3\s*$/.exec(text);
    if (quoted === null) return undefined;
    operands = [quoted[2] as string, quoted[4] as string];
  }
  const [a, b] = operands.map((operand) => makeExpanded(operand, lookup)) as [{ text: string; settled: boolean }, { text: string; settled: boolean }];
  if (!a.settled || !b.settled) return undefined;
  const equal = a.text === b.text;
  return directive === 'ifeq' ? equal : !equal;
};

/** One open conditional while a Makefile is read (P356). */
interface OpenConditional {
  /** Whether the lines around it are read at all. */
  readonly outer: boolean;
  /** The unsettled conditionals the lines around it are read under. */
  readonly outerAssumed: readonly string[];
  /** Whether a branch of it has been taken, the one being read or one before. */
  taken: boolean;
  /** Whether the branch being read is read. */
  active: boolean;
  /** The unsettled tests of this conditional met so far, each as written and where. */
  readonly unsettled: string[];
}

/** The lines of a Makefile make reads (P356): where a line stands among the conditionals. */
const stateOf = (open: readonly OpenConditional[]): LineState => {
  const top = open.at(-1);
  return top === undefined ? { active: true, assumed: [] } : { active: top.active, assumed: [...top.outerAssumed, ...top.unsettled] };
};

/** A wildcard of make's (`*`, `?`) in a file's name, as a pattern over that name. */
const wildcardPattern = (name: string): RegExp =>
  new RegExp(`^${name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);

/**
 * The files one word of an `include` names (P350), from the directory make
 * runs in, the including Makefile's: the file, or every file a wildcard in
 * its name matches (`include mk/*.mk`), sorted, as make's `wildcard` hands
 * them.
 */
const includedFiles = (repoDir: string, dir: string, word: string): string[] => {
  const path = under(dir, word);
  if (!/[*?]/.test(posix.basename(path))) return [path];
  if (/[*?]/.test(posix.dirname(path))) return [];
  const pattern = wildcardPattern(posix.basename(path));
  return filesIn(repoDir, posix.dirname(path)).filter((file) => pattern.test(posix.basename(file)));
};

/** Reads a Makefile's variables, and those of the files it includes, into `into` (P343). */
const readMakeVariables = (repoDir: string, makefile: string, into: MakeVariables, depth = 0): void => {
  const make = textAt(repoDir, makefile);
  if (make === undefined) return;
  // `$(MAKECMDGOALS)` is the goal asked (P356), where the Makefile does not set it itself.
  const lookup = (name: string): MakeVariable | undefined =>
    into.values.get(name) ?? (name === 'MAKECMDGOALS' && into.goal !== undefined ? { value: into.goal, simple: true } : undefined);
  const lines = make.split('\n');
  const states: LineState[] = [];
  into.lines.set(makefile, states);
  const open: OpenConditional[] = [];
  // One test of a conditional (P356): one the files do not settle takes the branch `choices` names, else its first.
  const decide = (entry: OpenConditional, holds: boolean | undefined, at: number, written: string): void => {
    if (!entry.outer || entry.taken) {
      entry.active = false;
      return;
    }
    let taken = holds;
    if (taken === undefined) {
      const key = `${makefile}:${at + 1}`;
      entry.unsettled.push(`${written} (${makefile}:${at + 1})`);
      taken = into.choices.get(key);
      if (taken === undefined) {
        taken = true;
        if (!into.unknowns.includes(key)) into.unknowns.push(key);
      }
    }
    entry.active = taken;
    if (taken) entry.taken = true;
  };
  let defining = false;
  for (let index = 0; index < lines.length; index += 1) {
    let raw = lines[index] as string;
    const start = index;
    states[index] = stateOf(open);
    if (defining) {
      if (/^\s*endef\b/.test(raw)) defining = false;
      continue;
    }
    // A recipe line is the shell's, not make's.
    if (raw.startsWith('\t') || /^\s*#/.test(raw)) continue;
    while (/\\\s*$/.test(raw) && index + 1 < lines.length) {
      index += 1;
      states[index] = stateOf(open);
      raw = `${raw.replace(/\\\s*$/, ' ')}${(lines[index] as string).trim()}`;
    }
    const line = raw.trim();
    // A conditional (P356): `ifeq`, `ifneq`, `ifdef`, `ifndef`, `else [if...]`, `endif`, nested as make nests them.
    const directive = makeValue(line);
    const opening = /^(ifeq|ifneq|ifdef|ifndef)(?:\s+|(?=[("']))(.*)$/.exec(directive);
    if (opening !== null) {
      const around = stateOf(open);
      const entry: OpenConditional = { outer: around.active, outerAssumed: around.assumed, taken: false, active: false, unsettled: [] };
      decide(entry, around.active ? conditionHolds(opening[1] as string, opening[2] as string, lookup) : false, start, directive);
      open.push(entry);
      continue;
    }
    const otherwise = /^else(?:\s+(ifeq|ifneq|ifdef|ifndef)(?:\s+|(?=[("']))(.*))?$/.exec(directive);
    if (otherwise !== null) {
      const entry = open.at(-1);
      if (entry === undefined) continue;
      if (otherwise[1] === undefined) {
        entry.active = entry.outer && !entry.taken;
        entry.taken = true;
      } else decide(entry, entry.outer && !entry.taken ? conditionHolds(otherwise[1], otherwise[2] as string, lookup) : false, start, directive.replace(/^else\s+/, ''));
      continue;
    }
    if (/^endif\b/.test(directive)) {
      open.pop();
      continue;
    }
    // A branch make does not take is not read.
    const state = stateOf(open);
    if (!state.active) {
      if (/^(?:export\s+|override\s+)*define\b/.test(line)) defining = true;
      continue;
    }
    const assumed = state.assumed;
    if (/^(?:export\s+|override\s+)*define\b/.test(line)) {
      defining = true;
      continue;
    }
    const included = /^(?:-include|sinclude|include)\s+(.+)$/.exec(line);
    if (included !== null) {
      if (depth >= MAKE_DEPTH) continue;
      for (const word of makeExpand(makeValue(included[1] as string), lookup).split(/\s+/)) {
        if (word === '' || isFilledIn(word) || word.startsWith('/')) continue;
        for (const file of includedFiles(repoDir, posix.dirname(makefile), word)) {
          if (file === makefile || into.included.includes(file)) continue;
          into.included.push(file);
          readMakeVariables(repoDir, file, into, depth + 1);
        }
      }
      continue;
    }
    if (line === 'export') {
      into.exportAll = true;
      continue;
    }
    if (/^\.EXPORT_ALL_VARIABLES\s*:/.test(line)) {
      into.exportAll = true;
      continue;
    }
    const names = /^(export|unexport)\s+([A-Za-z_][A-Za-z0-9_.\-\s]*)$/.exec(line);
    if (names !== null) {
      for (const name of (names[2] as string).split(/\s+/).filter((each) => each !== '')) {
        if (names[1] === 'export') {
          into.exported.add(name);
          into.unexported.delete(name);
        } else {
          into.unexported.add(name);
          into.exported.delete(name);
        }
      }
      continue;
    }
    const assignment = MAKE_ASSIGNMENT.exec(line);
    if (assignment !== null) {
      const [, exported, , name, op, value] = assignment as unknown as [string, string | undefined, string | undefined, string, string, string];
      assign(into.values, name, op, value, lookup, assumed);
      if (exported !== undefined) {
        into.exported.add(name);
        into.unexported.delete(name);
      }
      continue;
    }
    // A target's own variable: `serve: export PORT = 4500`, `a b: PORT := 1`, `dev: private DEBUG = 1`;
    // a pattern's (`%-dev: MODE = development`, P356), kept under the pattern for every target it matches.
    const rule = /^([^:=#]+?)\s*:(?![:=])\s*(.*)$/.exec(line);
    const own = rule === null ? null : MAKE_ASSIGNMENT.exec((rule[2] as string).replace(/^override\s+/, ''));
    if (rule !== null && own !== null) {
      const [, exported, kept, name, op, value] = own as unknown as [string, string | undefined, string | undefined, string, string, string];
      for (const target of (rule[1] as string).split(/\s+/).filter((each) => each !== '')) {
        const vars = into.targets.get(target) ?? new Map<string, TargetVariable>();
        const scratch = new Map<string, MakeVariable>(vars);
        // `+=` on a target appends to the file's own value.
        const global = lookup(name);
        if (op === '+=' && !scratch.has(name) && global !== undefined) scratch.set(name, global);
        assign(scratch, name, op, value, (each) => vars.get(each) ?? lookup(each), assumed);
        vars.set(name, {
          ...(scratch.get(name) as MakeVariable),
          exported: exported !== undefined || vars.get(name)?.exported === true,
          ...(kept === undefined ? {} : { private: true as const }),
        });
        into.targets.set(target, vars);
      }
      continue;
    }
    // A rule: its targets and their prerequisites (P350); a recipe written after `;` is the shell's.
    if (rule !== null) {
      const prerequisites = makeExpand((rule[2] as string).replace(/;.*$/, ''), lookup)
        .split(/\s+/)
        .filter((each) => each !== '' && each !== '|' && !isFilledIn(each));
      for (const target of makeExpand(rule[1] as string, lookup).split(/\s+/)) {
        if (target === '' || target.startsWith('.') || target.includes('%')) continue;
        const list = into.prerequisites.get(target) ?? new Set<string>();
        for (const each of prerequisites) list.add(each);
        into.prerequisites.set(target, list);
      }
    }
  }
};

/**
 * A target's own variables (P343), over those of every pattern it matches
 * (`%-dev: MODE = development`, P356): as the GNU make manual's
 * "Pattern-specific Variable Values" has it, a target's own over a
 * pattern's, and of several patterns the one with the shorter stem - the
 * more specific - over the others.
 */
const targetVariablesOf = (variables: MakeVariables, target: string): Map<string, TargetVariable> | undefined => {
  const patterns = [...variables.targets]
    .filter(([pattern]) => pattern.includes('%') && makePatternMatches(pattern, target))
    .sort(([a], [b]) => a.length - b.length);
  const own = variables.targets.get(target);
  if (patterns.length === 0) return own;
  return new Map([...patterns.flatMap(([, vars]) => [...vars]), ...(own ?? [])]);
};

/**
 * The environment a Makefile gives a target's recipe (P343): every variable
 * it exports, at its final value as make has read the whole file, the
 * target's own variables over them - those it exports, and those whose name
 * the file exports anyway. A value make fills from the shell (`!=`,
 * `$(shell ...)`) or from a variable it does not set is said so where used.
 *
 * `chain` is the target and after it the targets that build it as a
 * prerequisite, nearest first (P350): a target's variables are in effect for
 * its prerequisites as well, as make documents it ("Target-specific Variable
 * Values"), the nearer target's over the farther's, except one written
 * `private`. The last of the chain is the goal asked, `$(MAKECMDGOALS)`
 * (P356). `assumed` gathers the unsettled conditionals of every value
 * looked up, the environment's and, as the caller expands it, the line's.
 */
const recipeEnvironment = (
  variables: MakeVariables,
  chain: readonly string[],
): { env: Record<string, DeployedValue>; lookup: (name: string) => MakeVariable | undefined; assumed: Set<string> } => {
  const owns = chain.map((target, at) => {
    const own = targetVariablesOf(variables, target);
    return at === 0 || own === undefined ? own : new Map([...own].filter(([, variable]) => variable.private !== true));
  });
  const goal = chain[chain.length - 1] as string;
  const assumed = new Set<string>();
  const found = (name: string): MakeVariable | undefined => {
    for (const own of owns) {
      const each = own?.get(name);
      if (each !== undefined) return each;
    }
    return variables.values.get(name) ?? (name === 'MAKECMDGOALS' ? { value: goal, simple: true } : undefined);
  };
  const lookup = (name: string): MakeVariable | undefined => {
    const variable = found(name);
    for (const each of variable?.assumed ?? []) assumed.add(each);
    return variable;
  };
  const exports = (name: string): boolean => !variables.unexported.has(name) && (variables.exported.has(name) || (variables.exportAll && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)));
  const env: Record<string, DeployedValue> = {};
  const give = (name: string, variable: MakeVariable): void => {
    for (const each of variable.assumed ?? []) assumed.add(each);
    env[name] = variable.shell === true ? new Unread(`${name} is what the shell prints for ${variable.value} in the Makefile`) : commandValue(variable.simple ? variable.value : makeExpand(variable.value, lookup));
  };
  for (const [name, variable] of variables.values) if (exports(name)) give(name, variable);
  // The value in effect, from the nearest target that sets it; exported by it or by any farther one.
  for (const name of new Set(owns.flatMap((own) => [...(own?.keys() ?? [])]))) {
    const variable = found(name) as MakeVariable;
    if (exports(name) || owns.some((own) => own?.get(name)?.exported === true)) give(name, variable);
  }
  return { env, lookup, assumed };
};

/**
 * The targets a recipe runs for (P350): its own, `make serve`, and each
 * target that builds it as a prerequisite, `make dev` building `serve`, with
 * that target's variables in effect - each chain the target, then the ones
 * building it, nearest first, up to {@link MAKE_GOALS} of them.
 */
const recipeChains = (variables: MakeVariables, target: string): string[][] => {
  const builtBy = new Map<string, string[]>();
  for (const [goal, prerequisites] of variables.prerequisites) {
    for (const each of prerequisites) builtBy.set(each, [...(builtBy.get(each) ?? []), goal]);
  }
  const chains: string[][] = [[target]];
  const walk = (chain: string[]): void => {
    if (chain.length > MAKE_DEPTH) return;
    for (const goal of builtBy.get(chain[chain.length - 1] as string) ?? []) {
      if (chains.length >= MAKE_GOALS) return;
      if (chain.includes(goal)) continue;
      const longer = [...chain, goal];
      chains.push(longer);
      walk(longer);
    }
  };
  walk([target]);
  return chains;
};

/** A command's environment as text, to tell two readings of one line apart. */
const envKey = (env: Readonly<Record<string, DeployedValue>>): string =>
  JSON.stringify(Object.entries(env).map(([name, value]) => [name, typeof value === 'string' ? value : `?${value.text}`]));

/** One recipe line of a Makefile as one reading of it has it: its target, where it is, and the line the shell is handed, continuations joined. */
interface RecipeLine {
  readonly file: string;
  readonly line: number;
  /** The targets of the rule it is written under, each of which runs it (P356). */
  readonly targets: readonly string[];
  readonly written: string;
  /** The unsettled conditionals the line itself is written under (P356). */
  readonly assumed: readonly string[];
}

/** The recipe lines a reading of a Makefile has, those of branches make does not take left out (P356). */
const recipeLinesOf = (repoDir: string, makefile: string, variables: MakeVariables): RecipeLine[] => {
  const found: RecipeLine[] = [];
  for (const file of [makefile, ...variables.included]) {
    const make = textAt(repoDir, file);
    if (make === undefined) continue;
    const states = variables.lines.get(file) ?? [];
    let targets: string[] = [''];
    const lines = make.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index] as string;
      const state = states[index] ?? { active: true, assumed: [] };
      if (!state.active) continue;
      const rule = /^([A-Za-z0-9_.\-/]+(?:\s+[A-Za-z0-9_.\-/]+)*)\s*:(?![:=])/.exec(raw);
      // Each target of `dev serve:` runs the recipe (P356).
      if (rule !== null && !MAKE_ASSIGNMENT.test(raw.trim())) targets = (rule[1] as string).split(/\s+/);
      if (!raw.startsWith('\t')) continue;
      // A recipe line ending in a backslash goes on on the next, as the shell is handed it.
      const start = index;
      let written = raw.trim();
      while (/\\\s*$/.test(written) && index + 1 < lines.length) {
        index += 1;
        written = `${written.replace(/\\\s*$/, ' ')}${(lines[index] as string).trim()}`;
      }
      found.push({ file, line: start + 1, targets, written, assumed: state.assumed });
    }
  }
  return found;
};

/** Whether a Makefile or a file it includes names `$(MAKECMDGOALS)`, so that it reads differently for each goal (P356). */
const readsGoals = (repoDir: string, makefile: string, readings: readonly MakeVariables[]): boolean =>
  [...new Set([makefile, ...readings.flatMap((variables) => variables.included)])].some((file) => textAt(repoDir, file)?.includes('MAKECMDGOALS') === true);

/**
 * The recipes of one Makefile and of every file it includes (P350), each
 * with the environment the Makefile gives it (P343): as its own target runs
 * it, and again for each target that builds that one as a prerequisite and
 * hands it another environment or another line, labelled with that target.
 *
 * And (P356) as each reading of the Makefile has them, a branch of every
 * conditional the files do not settle in each ({@link makeReadings}), the
 * command saying which it is read under; where the Makefile reads
 * `$(MAKECMDGOALS)`, once for each goal, that goal being what it holds.
 */
const recipesOf = (repoDir: string, makefile: string, readings: readonly MakeVariables[] = makeReadings(repoDir, makefile)): Command[] => {
  const found: Command[] = [];
  const seen = new Set<string>();
  const read = (variables: MakeVariables, goal: string | undefined): void => {
    for (const recipe of recipeLinesOf(repoDir, makefile, variables)) {
      for (const chain of recipe.targets.flatMap((target) => recipeChains(variables, target))) {
        const label = chain[chain.length - 1] as string;
        if (goal !== undefined && label !== goal) continue;
        // Make fills its own variables in before the shell is handed the line.
        const { env, lookup, assumed } = recipeEnvironment(variables, chain);
        const line = makeExpand(recipe.written.replace(/^[@-]+/, ''), lookup);
        const key = `${recipe.file}\0${recipe.line}\0${envKey(env)}\0${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const conditions = [...new Set([...recipe.assumed, ...assumed])];
        // An included file's recipe runs where make runs: the including Makefile's directory.
        for (const command of commandsOfScript(line, { file: recipe.file, line: recipe.line, label }, [posix.dirname(makefile)], env)) {
          found.push(conditions.length === 0 ? command : { ...command, assumed: conditions });
        }
      }
    }
  };
  if (!readsGoals(repoDir, makefile, readings)) {
    for (const variables of readings) read(variables, undefined);
    return found;
  }
  // Each goal a recipe runs for, as any reading has it, read with `$(MAKECMDGOALS)` holding it.
  const goals = new Set<string>();
  for (const variables of readings) {
    for (const recipe of recipeLinesOf(repoDir, makefile, variables)) for (const chain of recipe.targets.flatMap((target) => recipeChains(variables, target))) goals.add(chain[chain.length - 1] as string);
  }
  for (const goal of [...goals].slice(0, MAKE_GOALS * 4)) for (const variables of makeReadings(repoDir, makefile, goal)) read(variables, goal);
  return found;
};

/** A shell script's commands: run from its own directory or from the repository's. */
const shellScript = (repoDir: string, file: string, env: Readonly<Record<string, DeployedValue>> = {}): Command[] => {
  const text = textAt(repoDir, file);
  if (text === undefined) return [];
  const own = posix.dirname(file);
  return commandsOfScript(text, { file, line: 1, label: posix.basename(file) }, own === '.' ? ['.'] : [own, '.'], env, own);
};

/**
 * The commands of a shell script another command of the project runs
 * (`./bin/server`, P343), with the environment that command hands it, under
 * what the script itself exports; `dirs` where the command runs it from.
 */
export const commandsOfShellScript = (repoDir: string, file: string, env: Readonly<Record<string, DeployedValue>>, dirs?: readonly string[]): Command[] => {
  const text = textAt(repoDir, file);
  if (text === undefined) return [];
  const own = posix.dirname(file);
  return commandsOfScript(text, { file, line: 1, label: posix.basename(file) }, dirs ?? (own === '.' ? ['.'] : [own, '.']), env, own);
};

/**
 * The commands of one `package.json` script a command of the project runs
 * (`npm run api`, P343), with the environment that command hands it; nothing
 * where the manifest writes no such script.
 */
export const commandsOfPackageScript = (repoDir: string, dir: string, name: string, env: Readonly<Record<string, DeployedValue>>): Command[] => {
  const manifest = under(dir, 'package.json');
  const json = textAt(repoDir, manifest);
  if (json === undefined) return [];
  let scripts: unknown;
  try {
    scripts = (JSON.parse(json) as { scripts?: unknown }).scripts;
  } catch {
    return [];
  }
  const script = isRecord(scripts) ? scripts[name] : undefined;
  if (typeof script !== 'string') return [];
  const at = json.indexOf(JSON.stringify(name));
  return commandsOfScript(script, { file: manifest, line: at < 0 ? 1 : json.slice(0, at).split('\n').length, label: name }, [dir], env);
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
    const key = `${command.file}:${command.line}:${command.label}:${command.words.join(' ')}:${envKey(command.env)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
