import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, posix, resolve, win32 } from 'node:path';
import { countIn, EDITS_FORMAT_VERSION, fileKey, type EditIndex, type EditName } from './edit-match.js';

/**
 * The edit hook (P387): after an assistant edits a file, what the edit broke
 * in another repository.
 *
 * Claude Code runs it after `Edit`, `MultiEdit` and `Write`, with the call on
 * stdin. When the edit took out a name the graph says another repository uses
 * - a route declared in the file, a channel or a type of message published or
 * taken there, a field sent or read there, a deployed function's name - it
 * adds one line per name naming who uses it, as context beside the edit's
 * result. Otherwise it says nothing.
 *
 * A name is taken out when the edit's old text held it more often than its new
 * text, and the file now holds it less often than when the graph was built: a
 * name moved within the edit, or put back, says nothing. A route's line that
 * the file holds more than once is the edited one only where the edit was.
 *
 * Like the search hook it never refuses or fails an edit: a missing index, an
 * input it cannot read, anything slower than `EDIT_DEADLINE_MS` is silence and
 * exit 0. It reads one flat file and the edited file, and imports nothing of
 * the command line.
 */
export const EDIT_DEADLINE_MS = 300;

/** Most names one edit is told about; the rest are counted. */
export const MAX_EDIT_LINES = 3;

export interface EditCall {
  tool_name?: unknown;
  tool_input?: { file_path?: unknown; old_string?: unknown; new_string?: unknown; content?: unknown; edits?: unknown };
  tool_response?: unknown;
  cwd?: unknown;
}

/** One replacement an edit made: what was there, what is now, or for a whole file written, the file before when Claude Code says it. */
interface Replacement {
  before: string | undefined;
  after: string;
}

/** The replacements of an `Edit`, a `MultiEdit` or a `Write`; none for any other call. */
export const replacementsOf = (call: EditCall): Replacement[] => {
  const input = call.tool_input ?? {};
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  if (call.tool_name === 'Edit') {
    const after = text(input.new_string);
    return after === undefined ? [] : [{ before: text(input.old_string) ?? '', after }];
  }
  if (call.tool_name === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits.flatMap((edit: unknown) => {
      const each = (edit ?? {}) as { old_string?: unknown; new_string?: unknown };
      const after = text(each.new_string);
      return after === undefined ? [] : [{ before: text(each.old_string) ?? '', after }];
    });
  }
  if (call.tool_name === 'Write') {
    const after = text(input.content);
    const response = call.tool_response;
    const original = typeof response === 'object' && response !== null ? text((response as { originalFile?: unknown }).originalFile) : undefined;
    return after === undefined ? [] : [{ before: original, after }];
  }
  return [];
};

/** The lines of `text` a replacement now takes, first and last, 1-based; undefined where it is not found. */
const linesOf = (text: string, after: string): { from: number; to: number } | undefined => {
  if (after === '') return undefined;
  const at = text.indexOf(after);
  if (at === -1) return undefined;
  const from = text.slice(0, at).split('\n').length;
  return { from, to: from + after.split('\n').length - 1 };
};

/** Whether a name was taken out by these replacements, the file now holding `now`. */
const takenOut = (name: EditName, replacements: readonly Replacement[], now: string): boolean => {
  if (countIn(now, name) >= name.count) return false;
  return replacements.some((replacement) => {
    let before: number;
    let after: number;
    const at = replacement.after === '' ? -1 : now.indexOf(replacement.after);
    if (replacement.before === undefined) {
      before = name.count;
      after = countIn(replacement.after, name);
    } else if (at === -1) {
      before = countIn(replacement.before, name);
      after = countIn(replacement.after, name);
    } else {
      // The file as it was around the replacement and as it is: a name the replaced text spells only with what
      // stands beside it (`{ sku, …` replaced from `sku, …`) is counted whole.
      before = countIn(`${now.slice(0, at)}${replacement.before}${now.slice(at + replacement.after.length)}`, name);
      after = countIn(now, name);
    }
    if (before <= after) return false;
    // A line written more than once in the file is this one only where the edit was; a whole file written is everywhere.
    if (name.match !== 'line' || name.count === 1 || replacement.before === undefined) return true;
    const where = linesOf(now, replacement.after);
    const span = Math.max(replacement.before.split('\n').length, replacement.after.split('\n').length);
    return where === undefined || (name.line >= where.from - 1 && name.line <= where.from + span);
  });
};

/** The service a file is in and its path in that service's repository: the deepest service directory holding it. */
const placeOfFile = (index: EditIndex, file: string, platform: NodeJS.Platform): { service: string; path: string } | undefined => {
  const paths = platform === 'win32' ? win32 : posix;
  const here = platform === 'win32' ? win32.resolve(file).toLowerCase() : posix.resolve(file);
  let best: { service: string; path: string } | undefined;
  let length = -1;
  for (const [service, given] of Object.entries(index.services)) {
    const dir = platform === 'win32' ? win32.resolve(given).toLowerCase() : posix.resolve(given);
    const inside = here.startsWith(dir.endsWith(paths.sep) ? dir : `${dir}${paths.sep}`);
    if (inside && dir.length > length) {
      best = { service, path: paths.relative(dir, here).split(paths.sep).join('/') };
      length = dir.length;
    }
  }
  return best;
};

/** The one call that lists every use of a name. */
const callFor = (name: EditName): string => {
  const id = JSON.stringify(name.id);
  const field = name.kind === 'field' ? `, field: ${JSON.stringify(name.text)}` : '';
  if (name.kind === 'route' || name.kind === 'function') return `impact({symbol: ${id}})`;
  return name.id.startsWith('entry:') ? `check_contract({edge: ${id}${field}})` : `check_contract({channel: ${id}${field}})`;
};

/** One name in one line: what went, where, who uses it, and the call that lists them all. */
const lineFor = (name: EditName): string => {
  const users = `${name.users.join(', ')}${name.more === undefined ? '' : ` and ${name.more} more`}`;
  const said = name.kind === 'route' ? `\`${name.said}\` (declared at line ${name.line})` : `\`${name.said}\``;
  return `flowatlas: this edit took out ${said}, ${name.role} ${users}. Change them too; ${callFor(name)} lists every use.`;
};

/**
 * The context to add after an edit, or undefined for none. Pure: the call,
 * the index and the file as it is now; `platform` says how paths compare.
 */
export const editContextFor = (call: EditCall, index: EditIndex | undefined, now: string | undefined, platform: NodeJS.Platform = process.platform): string | undefined => {
  if (index === undefined || index.editsFormatVersion !== EDITS_FORMAT_VERSION || now === undefined) return undefined;
  const file = call.tool_input?.file_path;
  if (typeof file !== 'string' || file === '') return undefined;
  const place = placeOfFile(index, isAbsolute(file) || typeof call.cwd !== 'string' ? file : resolve(call.cwd, file), platform);
  if (place === undefined) return undefined;
  const names = index.files[fileKey(place.service, place.path)];
  if (names === undefined || names.length === 0) return undefined;
  const replacements = replacementsOf(call);
  if (replacements.length === 0) return undefined;
  const lines: string[] = [];
  const seen = new Set<string>();
  let more = 0;
  for (const name of names) {
    const key = `${name.kind}\n${name.said}\n${name.role}`;
    if (seen.has(key) || !takenOut(name, replacements, now)) continue;
    seen.add(key);
    if (lines.length < MAX_EDIT_LINES) lines.push(lineFor(name));
    else more += 1;
  }
  if (lines.length === 0) return undefined;
  if (more > 0) lines.push(`flowatlas: and ${more} more names other repositories use; check_change lists every break.`);
  return lines.join('\n');
};

/** The hook's stdout, as Claude Code reads it after a tool call. */
export const editHookOutput = (context: string): string =>
  `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } })}\n`;

const readJson = (path: string): EditIndex | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as EditIndex;
  } catch {
    return undefined;
  }
};

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

const realOf = (path: string): string => {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
};

/** Where the index is: `--edits <path>`, absolute, or relative to the project the assistant has open. */
const editsPathOf = (argv: readonly string[], projectDir: string | undefined): string | undefined => {
  const at = argv.indexOf('--edits');
  const given = at === -1 ? undefined : argv[at + 1];
  if (given === undefined) return undefined;
  return isAbsolute(given) ? given : resolve(projectDir ?? process.cwd(), given);
};

/**
 * Runs the hook: reads the call from stdin, writes the context or nothing,
 * exits 0 whatever happens. `stdin`, `write` and `env` are for tests.
 */
export const runEditHook = async (
  argv: readonly string[],
  io: { stdin?: () => Promise<string>; write?: (text: string) => void; env?: NodeJS.ProcessEnv } = {},
): Promise<void> => {
  const deadline = setTimeout(() => process.exit(0), EDIT_DEADLINE_MS);
  deadline.unref();
  try {
    const call = JSON.parse(await (io.stdin ?? readStdin)()) as EditCall;
    const env = io.env ?? process.env;
    const path = editsPathOf(argv, env['CLAUDE_PROJECT_DIR'] ?? (typeof call.cwd === 'string' ? call.cwd : undefined));
    const file = call.tool_input?.file_path;
    if (path === undefined || typeof file !== 'string') return;
    const index = readJson(path);
    // Both sides by their real names: the index has the configured directories, the call the path the assistant used.
    const real = index === undefined || typeof index.services !== 'object' || index.services === null
      ? index
      : { ...index, services: Object.fromEntries(Object.entries(index.services).map(([service, dir]) => [service, realOf(dir)])) };
    const absolute = isAbsolute(file) ? file : resolve(typeof call.cwd === 'string' ? call.cwd : process.cwd(), file);
    const context = editContextFor({ ...call, tool_input: { ...call.tool_input, file_path: realOf(absolute) } }, real, readText(absolute));
    if (context !== undefined) (io.write ?? ((text: string) => void process.stdout.write(text)))(editHookOutput(context));
  } catch {
    // Silence: a hook that failed an edit would be worse than none.
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
      // A whole file written can be large; past this it is not read.
      if (size > 8 * 1024 * 1024) done('{}');
      else chunks.push(chunk);
    });
    process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => done('{}'));
  });
