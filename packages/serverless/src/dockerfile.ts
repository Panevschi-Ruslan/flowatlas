/** One setting as a file writes it: its name and its value as written. */
interface Written {
  readonly name: string;
  readonly raw: string;
}

/**
 * The environment a Dockerfile gives the containers its image runs (P325):
 * every `ENV` of the stage built and of the stages it is built `FROM`, in the
 * order they are written, a later one over an earlier.
 *
 * `ENV PORT=4000`, `ENV PORT 4000` (the older form, one setting to the end of
 * the line), several `KEY=value` pairs on one line, quoted values, lines run
 * on with a backslash. A value is read with the build's arguments and the
 * settings before it put in: `$NAME`, `${NAME}`, `${NAME:-word}`,
 * `${NAME:+word}`, an `ARG` taking what the build hands it (`args`) over its
 * own default, a global `ARG` (before the first `FROM`) only where the stage
 * names it again. A value with anything nobody settles in it is not read,
 * and the setting is then unknown rather than the value before it.
 *
 * The stage built is the one `target` names, else the last. Nothing for a
 * file with no `FROM`.
 */
export const dockerfileEnvironment = (text: string, options: { readonly target?: string; readonly args?: Readonly<Record<string, string>> } = {}): Written[] | undefined => {
  const handed = options.args ?? {};
  const globals = new Map<string, string | undefined>();
  const stages: { readonly name?: string; readonly env: Map<string, string | undefined> }[] = [];
  let args: Map<string, string | undefined> | undefined;
  let env: Map<string, string | undefined> | undefined;
  for (const line of instructions(text)) {
    const match = /^(\w+)\s+([\s\S]*)$/.exec(line);
    if (match === null) continue;
    const word = (match[1] as string).toUpperCase();
    const rest = (match[2] as string).trim();
    if (word === 'FROM') {
      const parts = rest.split(/\s+/).filter((part) => !part.startsWith('--'));
      const base = parts[0]?.toLowerCase();
      const name = parts.length >= 3 && parts[1]?.toLowerCase() === 'as' ? parts[2]?.toLowerCase() : undefined;
      const from = stages.find((stage) => stage.name !== undefined && stage.name === base) ?? (base !== undefined && /^\d+$/.test(base) ? stages[Number(base)] : undefined);
      env = new Map(from?.env ?? []);
      args = new Map();
      stages.push({ ...(name === undefined ? {} : { name }), env });
      continue;
    }
    if (word === 'ARG') {
      const scope = args ?? globals;
      for (const [name, written] of pairs(rest, false)) {
        // What the build hands it, else its own default, else a global's.
        const own = written === undefined ? (args === undefined ? undefined : globals.get(name)) : expand(written, scope, env ?? new Map());
        scope.set(name, handed[name] ?? own);
      }
      continue;
    }
    if (word === 'ENV' && env !== undefined && args !== undefined) {
      const stageEnv = env;
      const stageArgs = args;
      const written = pairs(rest, true);
      // Every value of one `ENV` is read against what stood before it.
      const read = written.map(([name, raw]) => [name, raw === undefined ? undefined : expand(raw, stageArgs, stageEnv)] as const);
      for (const [name, value] of read) stageEnv.set(name, value);
    }
  }
  if (stages.length === 0) return undefined;
  const target = options.target?.toLowerCase();
  const built = (target === undefined ? undefined : stages.find((stage) => stage.name === target)) ?? stages[stages.length - 1];
  return [...(built?.env ?? new Map<string, string | undefined>()).entries()].flatMap(([name, raw]) => (raw === undefined ? [] : [{ name, raw }]));
};

/**
 * What the containers an image runs start with (P350): the `ENTRYPOINT` and
 * `CMD` of the stage built (`target`, else the last) or of the stage of the
 * file it is built `FROM`, as words - the exec form's (`["bun", "src/index.ts"]`)
 * as written, the shell form's split as the shell splits them, the command
 * after an `ENTRYPOINT` in exec form, nothing after one in shell form. An
 * `ENTRYPOINT` set in a stage drops the `CMD` it was built over, as Docker
 * documents. Nothing where neither is written in the file (an image's own
 * base is not read).
 */
export const dockerfileCommand = (text: string, options: { readonly target?: string } = {}): string[] | undefined => {
  interface Stage {
    readonly name?: string;
    entrypoint?: { readonly words: string[]; readonly exec: boolean };
    cmd?: string[];
    /** Whether the stage wrote its `CMD` itself, rather than took it from the stage it is built over. */
    ownCmd?: true;
  }
  const stages: Stage[] = [];
  let stage: Stage | undefined;
  const form = (rest: string): { words: string[]; exec: boolean } => {
    if (rest.startsWith('[')) {
      try {
        const parsed = JSON.parse(rest) as unknown;
        if (Array.isArray(parsed) && parsed.every((each) => typeof each === 'string')) return { words: parsed as string[], exec: true };
      } catch {
        // Not JSON: Docker runs it as a shell command.
      }
    }
    return { words: words(rest), exec: false };
  };
  for (const line of instructions(text)) {
    const match = /^(\w+)\s+([\s\S]*)$/.exec(line);
    if (match === null) continue;
    const word = (match[1] as string).toUpperCase();
    const rest = (match[2] as string).trim();
    if (word === 'FROM') {
      const parts = rest.split(/\s+/).filter((part) => !part.startsWith('--'));
      const base = parts[0]?.toLowerCase();
      const name = parts.length >= 3 && parts[1]?.toLowerCase() === 'as' ? parts[2]?.toLowerCase() : undefined;
      const from = stages.find((each) => each.name !== undefined && each.name === base) ?? (base !== undefined && /^\d+$/.test(base) ? stages[Number(base)] : undefined);
      stage = { ...(name === undefined ? {} : { name }), ...(from?.entrypoint === undefined ? {} : { entrypoint: from.entrypoint }), ...(from?.cmd === undefined ? {} : { cmd: from.cmd }) };
      stages.push(stage);
      continue;
    }
    if (stage === undefined) continue;
    if (word === 'ENTRYPOINT') {
      stage.entrypoint = form(rest);
      if (stage.ownCmd !== true) delete stage.cmd;
    } else if (word === 'CMD') {
      const written = form(rest);
      // The shell form runs under `sh -c`, which is what its words are.
      stage.cmd = written.words;
      stage.ownCmd = true;
    }
  }
  const target = options.target?.toLowerCase();
  const built = (target === undefined ? undefined : stages.find((each) => each.name === target)) ?? stages[stages.length - 1];
  if (built === undefined) return undefined;
  if (built.entrypoint !== undefined) return built.entrypoint.exec ? [...built.entrypoint.words, ...(built.cmd ?? [])] : built.entrypoint.words;
  return built.cmd;
};

/** Whether a path is Bun's program: `/usr/local/bin/bun`, `bun`. */
const isBunPath = (path: string): boolean => /(?:^|\/)bun$/.test(path);

/** Whether a path is where a program named `node` is put: `/usr/local/bin/node`, `/usr/bin/node`. */
const isNodePath = (path: string): boolean => /(?:^|\/)node$/.test(path);

/** An image whose name says it is Bun's own (`oven/bun`, `oven/bun:1-slim`, `bun@sha256:...`). */
const BUN_IMAGE = /(?:^|\/)bun(?:[:@]|$)/;

/**
 * Whether the program named `node` in an image is Bun (P356): `yes` where the
 * stage built (`target`, else the last), or one it is built over, puts Bun
 * there - `RUN ln -s /usr/local/bin/bun /usr/local/bin/node`, `ln -sf
 * $(which bun) /usr/bin/node`, `COPY --from=oven/bun /usr/local/bin/bun
 * /usr/local/bin/node`; `maybe` where it is built on an image of Bun's own,
 * whose files are not read, so whether its `node` is Bun is not known; and
 * nothing where neither is written, `node` being Node.
 */
export const dockerfileNodeIsBun = (text: string, options: { readonly target?: string } = {}): 'yes' | 'maybe' | undefined => {
  const stages: { readonly name?: string; node?: 'yes' | 'maybe' }[] = [];
  let stage: (typeof stages)[number] | undefined;
  for (const line of instructions(text)) {
    const match = /^(\w+)\s+([\s\S]*)$/.exec(line);
    if (match === null) continue;
    const word = (match[1] as string).toUpperCase();
    const rest = (match[2] as string).trim();
    if (word === 'FROM') {
      const parts = rest.split(/\s+/).filter((part) => !part.startsWith('--'));
      const base = parts[0]?.toLowerCase() ?? '';
      const name = parts.length >= 3 && parts[1]?.toLowerCase() === 'as' ? parts[2]?.toLowerCase() : undefined;
      const from = stages.find((each) => each.name !== undefined && each.name === base) ?? (/^\d+$/.test(base) ? stages[Number(base)] : undefined);
      const node = from !== undefined ? from.node : BUN_IMAGE.test(base) ? 'maybe' : undefined;
      stage = { ...(name === undefined ? {} : { name }), ...(node === undefined ? {} : { node }) };
      stages.push(stage);
      continue;
    }
    if (stage === undefined) continue;
    if (word === 'RUN') {
      // `ln -s <bun> <node>`, each command of the line on its own.
      for (const part of rest.split(/&&|;|\|\|/)) {
        // `$(which bun)`, `` `command -v bun` ``: Bun's path, as one word.
        const each = words(part.trim().replace(/\$\((?:which|command\s+-v)\s+bun\)|`(?:which|command\s+-v)\s+bun`/g, 'bun'));
        if (each[0] !== 'ln' || !each.some((flag) => /^-[a-zA-Z]*s/.test(flag))) continue;
        const paths = each.slice(1).filter((path) => !path.startsWith('-'));
        if (paths.length === 2 && isBunPath(paths[0] as string) && isNodePath(paths[1] as string)) stage.node = 'yes';
      }
    } else if (word === 'COPY' || word === 'ADD') {
      const paths = words(rest).filter((path) => !path.startsWith('--'));
      if (paths.length === 2 && isBunPath(paths[0] as string) && isNodePath(paths[1] as string)) stage.node = 'yes';
    }
  }
  const target = options.target?.toLowerCase();
  const built = (target === undefined ? undefined : stages.find((each) => each.name === target)) ?? stages[stages.length - 1];
  return built?.node;
};

/** The file's instructions, one per entry: comments and blank lines left out, lines run on with a backslash joined. */
const instructions = (text: string): string[] => {
  const out: string[] = [];
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const continued = /\\\s*$/.test(line);
    current += `${continued ? line.replace(/\\\s*$/, '') : line} `;
    if (continued) continue;
    if (current.trim() !== '') out.push(current.trim());
    current = '';
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
};

/** The words of an instruction, quotes taken off and a backslash keeping the next character. */
const words = (text: string): string[] => {
  const out: string[] = [];
  let word = '';
  let quote: string | undefined;
  let started = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else if (char === '\\' && quote === '"' && index + 1 < text.length) word += text[(index += 1)];
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && index + 1 < text.length) {
      word += text[(index += 1)];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) out.push(word);
      word = '';
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) out.push(word);
  return out;
};

/**
 * The settings an `ENV` or an `ARG` writes, in order: `KEY=value` pairs, or
 * for `ENV` the older `KEY value` with the rest of the line the value; an
 * `ARG` with no `=` names the argument and gives it nothing of its own.
 */
const pairs = (text: string, isEnv: boolean): [string, string | undefined][] => {
  const all = words(text);
  const first = all[0];
  if (first === undefined) return [];
  if (isEnv && !first.includes('=')) {
    const trimmed = text.trim();
    const at = trimmed.search(/\s/);
    return [[first, at < 0 ? '' : words(trimmed.slice(at)).join(' ')]];
  }
  return all.flatMap((each): [string, string | undefined][] => {
    const equals = each.indexOf('=');
    if (equals === 0) return [];
    return equals < 0 ? (isEnv ? [] : [[each, undefined] as [string, undefined]]) : [[each.slice(0, equals), each.slice(equals + 1)] as [string, string]];
  });
};

/** A value with the arguments and settings before it put in, or nothing where one it names is not settled. */
const expand = (raw: string, args: ReadonlyMap<string, string | undefined>, env: ReadonlyMap<string, string | undefined>): string | undefined => {
  let unsettled = false;
  const valueOf = (name: string): string | undefined => (env.has(name) ? env.get(name) : args.get(name));
  const known = (name: string): boolean => (env.has(name) || args.has(name)) && valueOf(name) !== undefined;
  const out = raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([-+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced: string | undefined, how: string | undefined, word: string | undefined, bare: string | undefined) => {
    const name = (braced ?? bare) as string;
    const value = valueOf(name);
    if (how === '-') return known(name) && value !== '' ? (value as string) : (word ?? '');
    if (how === '+') return known(name) && value !== '' ? (word ?? '') : '';
    if (!known(name)) {
      // An argument declared with no value and handed none is empty, as the build makes it.
      if (args.has(name) && !env.has(name)) return '';
      unsettled = true;
      return '';
    }
    return value as string;
  });
  return unsettled ? undefined : out;
};
