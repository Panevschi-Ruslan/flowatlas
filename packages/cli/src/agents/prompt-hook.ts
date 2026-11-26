import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { MEMBER, readCardNamesAt, routeKey, type CardIndex, type CardName } from './card-names.js';

/**
 * Prompt cards (P386): before the first turn, what the graph says about the
 * things a prompt names.
 *
 * Claude Code runs this hook when a prompt is submitted, with the prompt on
 * stdin. Where the prompt names something the graph holds - a route said
 * aloud or as a path, `Class.method`, a backticked identifier, a channel, an
 * `UPPER_SNAKE` message type, a service named beside "dead", "unused" or
 * "nothing calls" - it adds the compact answer the tool for that thing gives,
 * rendered by the graph server's own tools, so a question the graph answers
 * needs no call to ask it. Otherwise it says nothing.
 *
 * Bounded so it never costs more than it saves: at most `MAX_NAMES` names and
 * `MAX_CARD_CHARS` characters, each name once per session, a name only where
 * it is spelled exactly as the graph holds it. Telling whether a prompt names
 * anything is one flat file read (`card-names.json`, written by `build`); the
 * graph server is loaded only when it does. The prompt is read here and
 * nowhere else: never written, never logged. Like the search hook it adds and
 * never refuses (P227 D3): anything it cannot do is silence and exit 0.
 */
export const MAX_NAMES = 3;
export const MAX_CARD_CHARS = 2000;
/** Past this the hook gives up and says nothing; a prompt waits for it. */
export const PROMPT_DEADLINE_MS = 5000;
/** A prompt this long is read up to here. */
const MAX_PROMPT = 20_000;
/** Sessions whose cards are remembered. */
const SESSIONS_KEPT = 50;
export const CARDS_SEEN_FILE = 'cards-seen.json';

/** A tool call a card makes. */
export interface CardCall {
  tool: string;
  args: Record<string, unknown>;
}

/** One name of the prompt and the calls that answer for it. */
export interface PlannedCard {
  /** Remembered per session: a node's id, or `dead:<service>`. */
  key: string;
  calls: CardCall[];
  /** Kept only where its answer reaches another repository (a method nothing else marks as crossing one). */
  crossingOnly?: true;
}

/** A name as a prompt writes it. */
interface Spelled {
  text: string;
  at: number;
  quoted: boolean;
}

const VERBS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
/** Words that make a service named beside them a question about what nothing uses. */
const UNUSED =
  /\b(?:dead|unused|not used|never (?:called|used)|uncalled|orphan(?:ed)?|(?:nothing|no ?one|nobody) (?:calls?|uses?)|still (?:used|called)|used anywhere|safe to (?:remove|delete))\b/i;

/** Trailing punctuation a sentence puts after a name, and a call's empty brackets. */
const trimmed = (word: string): string => word.replace(/\(\)$/, '').replace(/[.,:;!?]+$/, '').replace(/\(\)$/, '');

/** Every name the prompt spells, in order: backticked spans, routes with their verb, paths, and words. */
const spellingsOf = (prompt: string): { routes: Array<{ verb?: string; key: string; at: number }>; words: Spelled[] } => {
  const routes: Array<{ verb?: string; key: string; at: number }> = [];
  const words: Spelled[] = [];
  const said = new Set<number>();
  const route = (verb: string | undefined, path: string, at: number): void => {
    const key = routeKey(trimmed(path));
    if (!/[A-Za-z]/.test(key)) return;
    routes.push({ ...(verb === undefined ? {} : { verb: verb.toUpperCase() }), key, at });
  };
  for (const match of prompt.matchAll(/`([^`\n]{1,200})`/g)) {
    const inner = trimmed(match[1]!.trim());
    const at = match.index;
    const aloud = new RegExp(`^(${VERBS})\\s+(/\\S*)$`, 'i').exec(inner);
    if (aloud !== null) route(aloud[1], aloud[2]!, at);
    else if (inner.startsWith('/')) route(undefined, inner, at);
    else words.push({ text: inner, at, quoted: true });
    said.add(at);
  }
  for (const match of prompt.matchAll(new RegExp(`\\b(${VERBS})\\s+\`?(/[^\\s\`'",;()]*)`, 'gi'))) {
    route(match[1], match[2]!, match.index);
    said.add(match.index + match[0].indexOf('/'));
  }
  for (const match of prompt.matchAll(/(^|[\s('"])(\/[^\s`'",;()]+)/g)) {
    const at = match.index + match[1]!.length;
    if (!said.has(at)) route(undefined, match[2]!, at);
  }
  for (const match of prompt.matchAll(/[^\s,;()"'`<>]+/g)) {
    const text = trimmed(match[0]);
    if (text.length >= 4 && !text.startsWith('/')) words.push({ text, at: match.index, quoted: false });
  }
  return { routes, words };
};

/**
 * Whether a word written without backticks is a name rather than prose: it
 * holds something other than letters (`Class.method`, `order.created`,
 * `ORDER_PAID`, `shop:*:orders`). A plain word (`orders`, `PAID`,
 * `fetchOrders`) is a name only in backticks.
 */
const spelledLikeName = (text: string): boolean => /[^A-Za-z]/.test(text);

/** The calls that answer for a name, by what it is. */
export const callsFor = (name: CardName): PlannedCard => {
  switch (name.kind) {
    case 'route':
    case 'function':
      return { key: name.id, calls: [{ tool: 'who_calls', args: { symbol: name.id } }] };
    case 'handler':
      return { key: name.id, calls: [{ tool: 'impact', args: { symbol: name.id } }] };
    case 'client':
      return { key: name.id, calls: [{ tool: 'find_symbol', args: { query: name.id } }] };
    case 'method':
      return { key: name.id, calls: [{ tool: 'impact', args: { symbol: name.id } }], crossingOnly: true };
    case 'channel':
    case 'type':
      return {
        key: name.id,
        calls: [
          { tool: 'who_emits', args: { channel: name.id } },
          { tool: 'who_consumes', args: { channel: name.id } },
        ],
      };
  }
};

/** What a prompt names that the graph holds, in the order it names them: the cards to make, and the rest past `MAX_NAMES`. */
export const planCards = (prompt: string, index: CardIndex, seen: ReadonlySet<string> = new Set()): { cards: PlannedCard[]; more: PlannedCard[] } => {
  const text = prompt.slice(0, MAX_PROMPT);
  const byRoute = new Map<string, CardName[]>();
  const byText = new Map<string, CardName[]>();
  for (const name of index.names) {
    const into = name.kind === 'route' ? byRoute : byText;
    const keys = name.kind === 'route' ? [name.text, `${name.verb ?? ''} ${name.text}`] : [name.text];
    for (const key of keys) (into.get(key) ?? into.set(key, []).get(key)!).push(name);
  }
  const { routes, words } = spellingsOf(text);

  // A service a prompt names, by its name or its repository's folder: it picks among names several services hold.
  // Asked about as a whole only where it is spelled like a name (`shop-api`, `` `web` ``): "the web app" is prose.
  const services = new Set<string>();
  const asked = new Set<string>();
  for (const word of words) {
    const lower = word.text.toLowerCase();
    for (const service of index.services) {
      if (service.name.toLowerCase() !== lower && service.folder.toLowerCase() !== lower) continue;
      services.add(service.name);
      if (word.quoted || spelledLikeName(word.text)) asked.add(service.name);
    }
  }

  const hits: Array<{ at: number; names: CardName[] }> = [];
  for (const said of routes) {
    const names = byRoute.get(said.verb === undefined ? said.key : `${said.verb} ${said.key}`);
    if (names !== undefined) hits.push({ at: said.at, names });
  }
  for (const word of words) {
    const names = byText.get(word.text);
    if (names === undefined || (!word.quoted && !spelledLikeName(word.text))) continue;
    // A method is `Class.method` in prose; a plain function's name only in backticks.
    const fit = names.filter((name) => word.quoted || name.kind === 'channel' || name.kind === 'type' || name.kind === 'function' || MEMBER.test(name.text));
    if (fit.length > 0) hits.push({ at: word.at, names: fit });
  }
  hits.sort((a, b) => a.at - b.at);

  const planned: PlannedCard[] = [];
  const keys = new Set<string>();
  for (const hit of hits) {
    const inNamed = hit.names.filter((name) => name.service !== null && services.has(name.service));
    for (const name of inNamed.length > 0 ? inNamed : hit.names) {
      if (keys.has(name.id)) continue;
      keys.add(name.id);
      planned.push(callsFor(name));
    }
  }
  // A service asked about as a whole: what nothing uses in it, only when nothing in it is named.
  if (planned.length === 0 && UNUSED.test(text)) {
    for (const service of [...asked].sort()) planned.push({ key: `dead:${service}`, calls: [{ tool: 'dead', args: { service } }] });
  }
  const fresh = planned.filter((card) => !seen.has(card.key));
  return { cards: fresh.slice(0, MAX_NAMES), more: fresh.slice(MAX_NAMES) };
};

/** A call as the answers' own `next` writes one: `who_calls({symbol: "…"})`. */
export const callSaid = (call: CardCall): string =>
  `${call.tool}({${Object.entries(call.args)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')}})`;

/** How long ago the graph was built, as a person says it. */
export const ageSaid = (builtAt: string, now: number): string => {
  const ms = now - Date.parse(builtAt);
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.floor(hours / 24)} days ago`;
};

export const headerOf = (builtAt: string, now: number): string =>
  `flowatlas, from the graph of every repository (built ${ageSaid(builtAt, now)}): each answer below is what the call above it returns, ` +
  'complete unless it says otherwise. Call a tool only for what this does not say.';

/** The card a prompt gets, and the names it answered for; no text when it names nothing the graph holds. */
export interface PromptCard {
  text?: string;
  /** The names answered for, as `PlannedCard.key`. */
  keys: string[];
  /** Every call made into the card, as written there. */
  calls: string[];
}

/**
 * The card for a prompt, from the index at `cardsPath` and the database
 * beside it. `seen` leaves out names a session was already told about; `now`
 * is when the card is read, for the graph's age.
 */
export const promptCard = async (
  prompt: string,
  cardsPath: string,
  options: { seen?: ReadonlySet<string>; now?: number; index?: CardIndex } = {},
): Promise<PromptCard> => {
  const index = options.index ?? readCardNamesAt(cardsPath);
  if (index === undefined) return { keys: [], calls: [] };
  const { cards, more } = planCards(prompt, index, options.seen);
  if (cards.length === 0) return { keys: [], calls: [] };
  const { renderCards } = await import('./card-render.js');
  const header = headerOf(index.builtAt, options.now ?? Date.now());
  const rendered = await renderCards(join(dirname(cardsPath), 'graph.db'), cards, more, MAX_CARD_CHARS - header.length - 1);
  if (rendered.body === undefined) return { keys: [], calls: [] };
  return { text: `${header}\n${rendered.body}`, keys: rendered.keys, calls: rendered.calls };
};

/** The hook's stdout: the card, as Claude Code reads it when a prompt is submitted. */
export const promptHookOutput = (context: string): string =>
  `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } })}\n`;

interface SeenFile {
  sessions?: Record<string, { at: number; keys: string[] }>;
}

const readSeen = (path: string): SeenFile => {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SeenFile;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

/** Remembers what a session was told; only ids, never the prompt. The `SESSIONS_KEPT` latest sessions are kept. */
const recordSeen = (path: string, session: string, keys: readonly string[], now: number): void => {
  const file = readSeen(path);
  const sessions = { ...(file.sessions ?? {}) };
  sessions[session] = { at: now, keys: [...new Set([...(sessions[session]?.keys ?? []), ...keys])] };
  const kept = Object.entries(sessions)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, SESSIONS_KEPT);
  try {
    writeFileSync(path, `${JSON.stringify({ sessions: Object.fromEntries(kept) })}\n`, 'utf8');
  } catch {
    // A directory it cannot write to: names are said again, which is all that is lost.
  }
};

interface PromptCall {
  prompt?: unknown;
  session_id?: unknown;
  cwd?: unknown;
}

/** Where the index is: `--cards <path>`, absolute, or relative to the project the assistant has open. */
const cardsPathOf = (argv: readonly string[], projectDir: string | undefined): string | undefined => {
  const at = argv.indexOf('--cards');
  const given = at === -1 ? undefined : argv[at + 1];
  if (given === undefined) return undefined;
  return isAbsolute(given) ? given : resolve(projectDir ?? process.cwd(), given);
};

/**
 * Runs the hook: reads the prompt from stdin, writes a card or nothing, and
 * resolves once the card is written. Never throws. `stdin`, `write` and
 * `env` are for tests.
 */
export const runPromptHook = async (
  argv: readonly string[],
  io: { stdin?: () => Promise<string>; write?: (text: string) => Promise<void>; env?: NodeJS.ProcessEnv; now?: () => number } = {},
): Promise<void> => {
  try {
    const call = JSON.parse(await (io.stdin ?? readStdin)()) as PromptCall;
    if (typeof call.prompt !== 'string' || call.prompt.trim() === '') return;
    const env = io.env ?? process.env;
    const path = cardsPathOf(argv, env['CLAUDE_PROJECT_DIR'] ?? (typeof call.cwd === 'string' ? call.cwd : undefined));
    if (path === undefined) return;
    const session = typeof call.session_id === 'string' && call.session_id !== '' ? call.session_id : undefined;
    const seenPath = join(dirname(path), CARDS_SEEN_FILE);
    const seen = new Set(session === undefined ? [] : (readSeen(seenPath).sessions?.[session]?.keys ?? []));
    const now = (io.now ?? Date.now)();
    const card = await promptCard(call.prompt, path, { seen, now });
    if (card.text === undefined) return;
    await (io.write ?? writeStdout)(promptHookOutput(card.text));
    if (session !== undefined) recordSeen(seenPath, session, card.keys, now);
  } catch {
    // Silence: a prompt is never held up or refused by a card it could not make.
  }
};

const writeStdout = (text: string): Promise<void> => new Promise((done) => void process.stdout.write(text, () => done()));

const readStdin = (): Promise<string> =>
  new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdin.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // A prompt this large is read no further than its start.
      if (size <= 4 * 1024 * 1024) chunks.push(chunk);
    });
    process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => done('{}'));
  });

/** The entry the bundle runs: the hook under its deadline, then exit, whatever the graph server left open. */
export const promptHookMain = async (argv: readonly string[]): Promise<never> => {
  const deadline = setTimeout(() => process.exit(0), PROMPT_DEADLINE_MS);
  deadline.unref();
  await runPromptHook(argv);
  process.exit(0);
};
