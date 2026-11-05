import { readFileSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { NAMES_FORMAT_VERSION, type IndexedName, type NamesIndex } from './names.js';

/**
 * The search hook (P227): after an assistant searches, what the search could
 * not see.
 *
 * Claude Code runs it after a `Grep`, or a `Bash` command that is `grep`,
 * `rg`, `ag` or `git grep`, with the call on stdin. When the pattern names a
 * route, channel, deployed function or handler that something in another
 * repository calls, publishes or handles, it says so - which services, how
 * many - and the call that lists them, as context beside the search's result.
 * Otherwise it says nothing (D4).
 *
 * It never refuses a search and never fails one (D3): a missing index, an
 * input it cannot read, anything slower than `DEADLINE_MS` is silence and
 * exit 0. It reads one flat file and imports nothing of the command line, so a
 * search pays a process start and a file read (D6).
 */
export const DEADLINE_MS = 300;

/** Most names one search is told about. */
export const MAX_MATCHES = 3;

/** A literal shorter than this names too much to be worth a word. */
const MIN_LITERAL = 4;

export interface HookCall {
  tool_name?: unknown;
  tool_input?: { pattern?: unknown; command?: unknown };
  cwd?: unknown;
}

/** Shell words of a command line, quotes taken off; enough to find a search's pattern. */
export const shellWords = (line: string): string[] => {
  const words: string[] = [];
  let word = '';
  let quote: string | undefined;
  let has = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i] as string;
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
      else if (c === '\\' && quote === '"' && i + 1 < line.length) word += line[(i += 1)];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[(i += 1)];
      has = true;
    } else if (/\s/.test(c) || c === '|' || c === ';' || c === '&') {
      if (has || word !== '') words.push(word);
      word = '';
      has = false;
      if (c !== ' ' && c !== '\t' && c !== '\n') words.push(c);
    } else {
      word += c;
      has = true;
    }
  }
  if (has || word !== '') words.push(word);
  return words;
};

/** Flags of grep, rg and ag that take a value, so the value is not read as the pattern. */
const TAKES_VALUE = new Set(['-e', '-f', '-g', '--glob', '-t', '--type', '-A', '-B', '-C', '-m', '--max-count', '--include', '--exclude', '-d', '--directories']);

/** The patterns a search asks for: Grep's own, or the first argument of a grep-like command. */
export const patternsOf = (call: HookCall): string[] => {
  const input = call.tool_input ?? {};
  if (call.tool_name === 'Grep') return typeof input.pattern === 'string' ? [input.pattern] : [];
  if (call.tool_name !== 'Bash' || typeof input.command !== 'string') return [];
  const words = shellWords(input.command);
  const found: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] as string;
    const isSearch = /^(?:.*\/)?(?:grep|egrep|fgrep|rg|ag)$/.test(word) || (word === 'git' && words[i + 1] === 'grep');
    if (!isSearch) continue;
    let j = word === 'git' ? i + 2 : i + 1;
    // With `-e`, the patterns are the flag's; what follows is where to look.
    let byFlag = false;
    for (; j < words.length; j += 1) {
      const arg = words[j] as string;
      if (arg === '|' || arg === ';' || arg === '&') break;
      if (arg === '-e' && words[j + 1] !== undefined) {
        found.push(words[j + 1] as string);
        byFlag = true;
        j += 1;
        continue;
      }
      if (TAKES_VALUE.has(arg)) {
        j += 1;
        continue;
      }
      if (arg.startsWith('-')) continue;
      if (!byFlag) found.push(arg);
      break;
    }
    // Past this search's arguments: `git grep` must not be read again as `grep`.
    i = j;
  }
  return found;
};

/**
 * The longest run of a pattern a regular expression matches literally:
 * `OrdersService\.create\(` is `OrdersService.create`, `/orders/[0-9]+` is
 * `/orders/`. Escaped punctuation is literal; anything else special ends a run.
 */
export const longestLiteral = (pattern: string): string => {
  const runs: string[] = [];
  let run = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i] as string;
    if (c === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1] as string;
      if (/[^A-Za-z0-9]/.test(next)) {
        run += next;
        i += 1;
        continue;
      }
      runs.push(run);
      run = '';
      i += 1;
      continue;
    }
    // A bare `.` with no quantifier after it is how a name with a dot is
    // searched for (`order.created`, `OrdersService.create`): it matches the
    // dot, so it is kept. `.*`, `.+` and the like end the run.
    if (c === '.' && !'*+?{'.includes(pattern[i + 1] ?? '')) {
      run += c;
      continue;
    }
    if ('.*+?()[]{}|^$'.includes(c)) {
      runs.push(run);
      run = '';
      // A brace or bracket group is skipped whole.
      const close = c === '[' ? ']' : c === '{' ? '}' : undefined;
      if (close !== undefined) {
        const end = pattern.indexOf(close, i + 1);
        if (end > i) i = end;
      }
      continue;
    }
    run += c;
  }
  runs.push(run);
  return runs.reduce((best, item) => (item.length > best.length ? item : best), '');
};

/** Whether a name is what a literal searches for. */
const matches = (name: IndexedName, literal: string): boolean => {
  if (name.kind === 'route') {
    if (name.text.includes(literal)) return true;
    // `/orders/` against `/orders/:param`: the address up to its first hole.
    const fixed = name.text.split('/:')[0] ?? name.text;
    return literal.startsWith('/') && fixed.length >= MIN_LITERAL && literal.startsWith(fixed);
  }
  // `OrdersService.create(` is a search for `OrdersService.create`: a name, then anything that is not more of it.
  return literal === name.text || (literal.startsWith(name.text) && !/[\w$]/.test(literal[name.text.length] ?? ''));
};

/** The service a working directory is in: the deepest service directory holding it. */
const serviceAt = (index: NamesIndex, cwd: string): string | undefined => {
  let best: string | undefined;
  let length = -1;
  for (const [service, dir] of Object.entries(index.services)) {
    const inside = cwd === dir || cwd.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);
    if (inside && dir.length > length) {
      best = service;
      length = dir.length;
    }
  }
  return best;
};

const counted = (across: Record<string, number>, leave: string | undefined): string[] =>
  Object.entries(across)
    .filter(([service]) => service !== leave)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([service, n]) => `${service} (${n})`);

/** What the hook says about one name, or nothing when everything about it is in the searched repository. */
const sentenceFor = (name: IndexedName, here: string | undefined): string | undefined => {
  const far = counted(name.across, here);
  if (far.length === 0) return undefined;
  const what = name.label ?? name.text;
  const owner = name.service === null ? '' : `, in ${name.service}`;
  const call =
    name.kind === 'channel'
      ? `who_emits({channel: ${JSON.stringify(name.text)}}) and who_consumes({channel: ${JSON.stringify(name.text)}})`
      : `who_calls({symbol: ${JSON.stringify(name.id)}})`;
  const command = name.kind === 'channel' ? `flowatlas channel ${JSON.stringify(name.text)}` : `flowatlas impact ${JSON.stringify(name.id)}`;
  return `\`${what}\`${owner}: ${name.role} in ${far.join(', ')}. ${call} ${name.kind === 'channel' ? 'list' : 'lists'} them (${command} in a terminal).`;
};

/**
 * The context to add after a search, or undefined for none. Pure: the call,
 * the index, and nothing read.
 */
export const contextFor = (call: HookCall, index: NamesIndex | undefined): string | undefined => {
  if (index === undefined || index.namesFormatVersion !== NAMES_FORMAT_VERSION) return undefined;
  const cwd = typeof call.cwd === 'string' ? resolve(call.cwd) : undefined;
  const here = cwd === undefined ? undefined : serviceAt(index, cwd);
  if (here === undefined) return undefined;
  const literals = patternsOf(call).map(longestLiteral).filter((literal) => literal.length >= MIN_LITERAL);
  if (literals.length === 0) return undefined;
  const said: string[] = [];
  const seen = new Set<string>();
  let more = 0;
  for (const name of index.names) {
    if (seen.has(name.id) || !literals.some((literal) => matches(name, literal))) continue;
    const sentence = sentenceFor(name, here);
    if (sentence === undefined) continue;
    seen.add(name.id);
    if (said.length < MAX_MATCHES) said.push(sentence);
    else more += 1;
  }
  if (said.length === 0) return undefined;
  return [
    `flowatlas: this search covered the ${here} checkout only; the project's graph sees the other repositories too.`,
    ...said.map((line) => `- ${line}`),
    ...(more === 0 ? [] : [`- and ${more} more names this pattern matches (search({query}) lists them).`]),
  ].join('\n');
};

/** The hook's stdout: the context, as Claude Code reads it after a tool call. */
export const hookOutput = (context: string): string =>
  `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } })}\n`;

const readIndex = (path: string): NamesIndex | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as NamesIndex;
  } catch {
    return undefined;
  }
};

/** Where the index is: `--names <path>`, absolute, or relative to the project the assistant has open. */
const namesPathOf = (argv: readonly string[], projectDir: string | undefined): string | undefined => {
  const at = argv.indexOf('--names');
  const given = at === -1 ? undefined : argv[at + 1];
  if (given === undefined) return undefined;
  return isAbsolute(given) ? given : resolve(projectDir ?? process.cwd(), given);
};

/**
 * Runs the hook: reads the call from stdin, writes the context or nothing,
 * exits 0 whatever happens. `stdin` and `write` are for tests.
 */
export const runSearchHook = async (
  argv: readonly string[],
  io: { stdin?: () => Promise<string>; write?: (text: string) => void; env?: NodeJS.ProcessEnv } = {},
): Promise<void> => {
  const deadline = setTimeout(() => process.exit(0), DEADLINE_MS);
  deadline.unref();
  try {
    const raw = await (io.stdin ?? readStdin)();
    const call = JSON.parse(raw) as HookCall;
    const env = io.env ?? process.env;
    const path = namesPathOf(argv, env['CLAUDE_PROJECT_DIR'] ?? (typeof call.cwd === 'string' ? call.cwd : undefined));
    if (path === undefined) return;
    const context = contextFor(call, readIndex(path));
    if (context !== undefined) (io.write ?? ((text: string) => void process.stdout.write(text)))(hookOutput(context));
  } catch {
    // Silence: a hook that fails a search would be the one thing worse than none.
  } finally {
    clearTimeout(deadline);
  }
};

const readStdin = (): Promise<string> =>
  new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdin.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // A call this large is not a search worth reading.
      if (size > 1024 * 1024) done('{}');
      else chunks.push(chunk);
    });
    process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => done('{}'));
  });
