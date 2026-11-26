import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { checkoutTopOf, isWithinDir, loadConfig, toPosixPath, type LoadedConfig } from '@flowatlas/core';
import { Command } from 'commander';
import { CARD_NAMES_FILE } from '../agents/card-names.js';
import { EDITS_FILE } from '../agents/edit-match.js';
import { runEditHook } from '../agents/edit-hook.js';
import { NAMES_FILE } from '../agents/names.js';
import { runPromptHook } from '../agents/prompt-hook.js';
import { runSearchHook } from '../agents/search-hook.js';
import {
  hasGuideBlock,
  OWNED_TARGETS,
  ownedFile,
  ownedState,
  SHARED_TARGETS,
  sharedBlock,
  TARGET_PATH,
  withGuideBlock,
  withoutGuideBlock,
  type AgentGuide,
  type AgentTarget,
} from '../agents/template.js';
import { MCP_FILE, SERVER_KEY } from './mcp.js';
import { cannotRun } from '../exit.js';
import { ownBin } from '../own-path.js';

/**
 * Tells each assistant a repository uses when to ask the graph (P227).
 *
 * `.mcp.json` says the server exists; nothing said when to choose it, so an
 * assistant in one checkout searched that checkout and answered a question
 * about the whole project from half of it. `install` writes the guide where
 * each assistant reads its instructions, and with `--hook` three Claude Code
 * hooks: after a search naming something the graph joins across repositories,
 * what the search could not see; after an edit that takes out a name another
 * repository uses, who uses it (P387); and when a prompt names something the
 * graph holds, the graph's answer before the first turn (P386).
 *
 * Files flowatlas owns - a skill, a Cursor rule - are written by default;
 * files a team owns - `AGENTS.md`, `CLAUDE.md`, Copilot's instructions - get a
 * marked block only with `--instructions` (D1). Everything written is taken
 * out by `remove` and nothing else: a file edited by hand is kept and named.
 */
export interface AgentsOptions {
  config?: string;
  /** Where the configuration is looked for from without `config`: the working directory unless said. */
  cwd?: string;
  repo?: string;
  dryRun?: boolean;
  /** Also write the marked block into the files a team owns. */
  instructions?: boolean;
  /** Also add the search hook and the edit hook, and the prompt hook unless `promptCards` is false. */
  hook?: boolean;
  /**
   * With `hook`: the prompt hook too (P386), on unless said; `--no-prompt-cards`
   * leaves it out, and takes out one an earlier install wrote.
   */
  promptCards?: boolean;
  /** The hook in `.claude/settings.json`, committed, rather than `.claude/settings.local.json`. */
  shared?: boolean;
  /** Replace an owned file edited by hand, or one that is not flowatlas's. */
  force?: boolean;
  /**
   * The guide and the hooks for an assistant that asks the graph in a
   * terminal, with no server (P392): each question's command with
   * `--format json`, where the server's tools are named otherwise.
   */
  terminal?: boolean;
}

export type AgentFileState =
  | 'installed'
  | 'updated'
  | 'unchanged'
  | 'out of date'
  | 'missing'
  | 'edited by hand'
  | 'not flowatlas'
  | 'removed'
  | 'kept';

export interface AgentFileChange {
  services: string[];
  file: string;
  state: AgentFileState;
}

export interface AgentsRun {
  changes: AgentFileChange[];
}

/** One repository directory and the services in it, so a repository holding several gets one set of files. */
interface Repo {
  dir: string;
  services: string[];
}

const reposOf = (loaded: LoadedConfig, only: string | undefined): Repo[] => {
  const byDir = new Map<string, Repo>();
  for (const service of loaded.config.services) {
    if (only !== undefined && service.name !== only) continue;
    const dir = loaded.repoDir(service);
    if (!existsSync(dir)) continue;
    const known = byDir.get(dir);
    if (known === undefined) byDir.set(dir, { dir, services: [service.name] });
    else known.services.push(service.name);
  }
  if (only !== undefined && byDir.size === 0) throw cannotRun(`no service named ${JSON.stringify(only)} with a repository on disk`);
  return [...byDir.values()];
};

/**
 * The name the graph server is registered under in a repository (P366): the
 * key of the `.mcp.json` entry that starts `flowatlas mcp`, which is what
 * Claude Code names its tools after. `SERVER_KEY`, what `flowatlas mcp
 * install` writes, where the file says none.
 */
export const serverKeyIn = (repoDir: string): string => registeredServer(repoDir).key;

type ServerEntry = { command?: unknown; args?: unknown; alwaysLoad?: unknown };

/** The core tools an entry's `--upfront` names (P392), or undefined where it names none. */
const upfrontArg = (args: unknown): string[] | undefined => {
  if (!Array.isArray(args)) return undefined;
  const at = args.indexOf('--upfront');
  const given: unknown = at === -1 ? args.find((arg) => typeof arg === 'string' && arg.startsWith('--upfront=')) : args[at + 1];
  if (typeof given !== 'string') return undefined;
  return given
    .replace(/^--upfront=/, '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
};

/**
 * The graph server's entry in a repository's `.mcp.json` (P380): its key, and
 * whether it leaves the core tools upfront - not when the entry says
 * `"alwaysLoad": false` (Claude Code then defers every tool of the server) or
 * starts the server with `--no-always-load`; and whether there is one at
 * all (`registered`, P382), where Claude Code then reads the server's
 * instructions in every session.
 */
export const registeredServer = (repoDir: string): { key: string; alwaysLoad: boolean; registered: boolean; upfront?: string[] } => {
  const text = read(join(repoDir, MCP_FILE));
  if (text === undefined) return { key: SERVER_KEY, alwaysLoad: true, registered: false };
  const said = (key: string, entry: ServerEntry | undefined) => {
    const upfront = upfrontArg(entry?.args);
    return {
      key,
      registered: true,
      alwaysLoad: entry?.alwaysLoad !== false && !(Array.isArray(entry?.args) && entry.args.includes('--no-always-load')),
      ...(upfront === undefined ? {} : { upfront }),
    };
  };
  try {
    const servers = (JSON.parse(text) as { mcpServers?: Record<string, ServerEntry> }).mcpServers ?? {};
    if (SERVER_KEY in servers) return said(SERVER_KEY, servers[SERVER_KEY]);
    for (const [key, entry] of Object.entries(servers)) {
      const words = [entry?.command, ...(Array.isArray(entry?.args) ? entry.args : [])].filter((word): word is string => typeof word === 'string');
      if (words.includes('mcp') && words.some((word) => /flowatlas/.test(word))) return said(key, entry);
    }
  } catch {
    // Not JSON: the server is not registered there in any way a client reads.
  }
  return { key: SERVER_KEY, alwaysLoad: true, registered: false };
};

const guideFor = (loaded: LoadedConfig, repo: Repo, options: AgentsOptions = {}): AgentGuide => {
  const server = registeredServer(repo.dir);
  // The entry's `--upfront` before the configuration's, as the server reads them (P392).
  const upfront = server.upfront ?? loaded.config.mcp?.upfront;
  return {
    services: loaded.config.services.map((service) => ({ name: service.name, type: service.type })),
    here: repo.services,
    server: server.key,
    alwaysLoad: server.alwaysLoad && loaded.config.mcp?.alwaysLoad !== false,
    ...(upfront === undefined ? {} : { upfront }),
    registered: server.registered,
    ...(options.terminal === true ? { via: 'terminal' as const } : {}),
  };
};

/**
 * The configuration a run writes for, refusing one found from a checkout that
 * is not the project's (P366).
 *
 * Found from the working directory, a configuration is the nearest above it.
 * Run in a repository of its own that happens to sit below a project's root -
 * a new checkout made in a folder under it - that is the project's, and the
 * guide, the blocks and the hooks went into every one of the project's
 * repositories, none of which it was run for. So where the working directory
 * is inside a checkout that is neither the project's root, one of its
 * repositories, nor one holding either, the run is refused, naming the
 * configuration found and how to write into it. A configuration given with
 * `--config` is asked for by name and used as it is.
 */
export const loadForAgents = (options: AgentsOptions): LoadedConfig => {
  if (options.config !== undefined) return loadConfig(options.config);
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = loadConfig(cwd);
  const found = checkoutTopOf(cwd);
  if (found === undefined) return loaded;
  const checkout = realOf(found);
  // The project's checkouts are its root's and each repository's, or one holding them (a monorepo).
  const project = [loaded.rootDir, ...loaded.config.services.map((service) => loaded.repoDir(service))].map(realOf);
  if (project.some((dir) => isWithinDir(dir, checkout))) return loaded;
  throw cannotRun(
    `${cwd} is in the git repository ${found}, which is not one of the repositories of the flowatlas project found above it (${loaded.configPath}); ` +
      `nothing was written. To write the guide into that project's repositories, run this from ${loaded.rootDir} or pass --config ${JSON.stringify(loaded.configPath)}; ` +
      `to add this repository, add it to that configuration as a service, or give it a configuration of its own (flowatlas init).`,
  );
};

/** A directory as the disk really has it, so a link and its target compare as one; as given where it is not there. */
const realOf = (dir: string): string => {
  try {
    return realpathSync.native(dir);
  } catch {
    return resolve(dir);
  }
};

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

const write = (path: string, text: string, dryRun: boolean | undefined): void => {
  if (dryRun === true) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
};

/** The settings file the hook goes into. */
const settingsPath = (repoDir: string, shared: boolean | undefined): string =>
  join(repoDir, '.claude', shared === true ? 'settings.json' : 'settings.local.json');

/** The hooks' command markers: any hook entry whose command has one is ours. */
const HOOK_MARK = 'search-hook';
const EDIT_HOOK_MARK = 'edit-hook';

/**
 * How the hook is started. Personal settings name this machine's files, which
 * starts fastest (D6); settings a team commits cannot, so they name the
 * command and an index path relative to the repository.
 */
export const searchHookCommand = (repoDir: string, namesPath: string, shared: boolean | undefined, terminal?: boolean): string =>
  hookCommand(HOOK_MARK, '--names', repoDir, namesPath, shared, terminal);

/** How the edit hook is started (P387), the same way: this machine's files, or the command for settings a team commits. */
export const editHookCommand = (repoDir: string, editsPath: string, shared: boolean | undefined, terminal?: boolean): string =>
  hookCommand(EDIT_HOOK_MARK, '--edits', repoDir, editsPath, shared, terminal);

/** `--terminal` (P392): the hook names the command that prints the answer, not the server's tool. */
const hookCommand = (mark: string, flag: string, repoDir: string, indexPath: string, shared: boolean | undefined, terminal?: boolean): string => {
  const asked = terminal === true ? ' --terminal' : '';
  if (shared === true) return `flowatlas agents ${mark} ${flag} ${JSON.stringify(toPosixPath(relative(repoDir, indexPath)))}${asked}`;
  const script = join(dirname(ownBin(import.meta.url)), '..', 'dist', `${mark}.js`);
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(script)} ${flag} ${JSON.stringify(indexPath)}${asked}`;
};

/** The prompt hook's command marker (P386). */
const PROMPT_MARK = 'prompt-hook';

/**
 * How the prompt hook is started, as the search hook is: personal settings
 * run this machine's built file, which reads one flat file for a prompt that
 * names nothing; committed settings name the command, which starts the whole
 * command line on every prompt.
 */
export const promptHookCommand = (repoDir: string, cardsPath: string, shared: boolean | undefined): string => {
  if (shared === true) return `flowatlas agents ${PROMPT_MARK} --cards ${JSON.stringify(toPosixPath(relative(repoDir, cardsPath)))}`;
  const script = join(dirname(ownBin(import.meta.url)), '..', 'dist', `${PROMPT_MARK}.js`);
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(script)} --cards ${JSON.stringify(cardsPath)}`;
};

interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
}
interface Settings {
  hooks?: { PostToolUse?: HookEntry[]; UserPromptSubmit?: HookEntry[] } & Record<string, unknown>;
  [key: string]: unknown;
}

const parseSettings = (path: string, text: string | undefined): Settings => {
  if (text === undefined || text.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Settings;
  } catch {
    // Said below.
  }
  throw cannotRun(`${path} is not valid JSON; fix or remove it and run this again`);
};

const marked =
  (mark: string) =>
  (entry: HookEntry): boolean =>
    (entry.hooks ?? []).some((hook) => typeof hook.command === 'string' && hook.command.includes(mark));
const isOurs = (entry: HookEntry): boolean => marked(HOOK_MARK)(entry) || marked(EDIT_HOOK_MARK)(entry);
const isOurPrompt = marked(PROMPT_MARK);

/** Whether settings hold either hook `install` writes. */
const holdsOurs = (settings: Settings): boolean => (settings.hooks?.PostToolUse ?? []).some(isOurs) || (settings.hooks?.UserPromptSubmit ?? []).some(isOurPrompt);

/** The settings with `event`'s entries set to `entries`, the key dropped when none are left, and `hooks` when nothing is under it. */
const withEntries = (settings: Settings, event: 'PostToolUse' | 'UserPromptSubmit', entries: HookEntry[]): Settings => {
  const hooks: Record<string, unknown> = { ...(settings.hooks ?? {}) };
  if (entries.length > 0) hooks[event] = entries;
  else delete hooks[event];
  const next: Settings = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
};

/**
 * The settings with the prompt hook in (P386), beside every other hook. No
 * matcher: Claude Code runs every `UserPromptSubmit` hook on every prompt. A
 * prompt waits for it, so the time it is given is short; the hook itself
 * gives up sooner (`PROMPT_DEADLINE_MS`).
 */
export const withPromptHook = (settings: Settings, command: string): Settings =>
  withEntries(settings, 'UserPromptSubmit', [...(settings.hooks?.UserPromptSubmit ?? []).filter((entry) => !isOurPrompt(entry)), { hooks: [{ type: 'command', command, timeout: 10 }] }]);

/** The settings with the prompt hook taken out. */
export const withoutPromptHook = (settings: Settings): Settings =>
  withEntries(settings, 'UserPromptSubmit', (settings.hooks?.UserPromptSubmit ?? []).filter((entry) => !isOurPrompt(entry)));

/** The settings with the hooks in, merged beside every other hook (D1): the search hook, and the edit hook where one is given (P387). */
export const withSearchHook = (settings: Settings, command: string, editCommand?: string): Settings => {
  const post = (settings.hooks?.PostToolUse ?? []).filter((entry) => !isOurs(entry));
  // Bash too: an assistant often searches with grep or rg through the shell.
  post.push({ matcher: 'Grep|Bash', hooks: [{ type: 'command', command, timeout: 5 }] });
  if (editCommand !== undefined) post.push({ matcher: 'Edit|MultiEdit|Write', hooks: [{ type: 'command', command: editCommand, timeout: 5 }] });
  return { ...settings, hooks: { ...(settings.hooks ?? {}), PostToolUse: post } };
};

/** The settings with the hook taken out; the key dropped when nothing else is under it. */
export const withoutSearchHook = (settings: Settings): Settings =>
  withEntries(settings, 'PostToolUse', (settings.hooks?.PostToolUse ?? []).filter((entry) => !isOurs(entry)));

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Writes, or with `dryRun` says it would write, what each repository's assistants read. */
export const installAgents = (options: AgentsOptions = {}): AgentsRun => {
  const loaded = loadForAgents(options);
  const run: AgentsRun = { changes: [] };
  const say = (repo: Repo, file: string, state: AgentFileState): void => void run.changes.push({ services: repo.services, file, state });
  for (const repo of reposOf(loaded, options.repo)) {
    const guide = guideFor(loaded, repo, options);
    for (const target of OWNED_TARGETS) {
      const path = join(repo.dir, TARGET_PATH[target]);
      const existing = read(path);
      const next = ownedFile(target, guide);
      if (existing === next) {
        say(repo, path, 'unchanged');
        continue;
      }
      const state = existing === undefined ? undefined : ownedState(existing);
      if ((state === 'edited' || state === 'foreign') && options.force !== true) {
        say(repo, path, state === 'edited' ? 'edited by hand' : 'not flowatlas');
        continue;
      }
      write(path, next, options.dryRun);
      say(repo, path, existing === undefined ? 'installed' : 'updated');
    }
    if (options.instructions === true) {
      for (const target of SHARED_TARGETS) {
        const path = join(repo.dir, TARGET_PATH[target]);
        const existing = read(path);
        // Only AGENTS.md is made where there is none: the others are a tool's own file, and written only where it is used.
        if (existing === undefined && target !== 'agents-md') continue;
        const block = sharedBlock(guide, target);
        // Claude Code reads AGENTS.md only where there is no CLAUDE.md, so a CLAUDE.md gets the guide itself.
        const next = withGuideBlock(existing, block);
        if (next === existing) {
          say(repo, path, 'unchanged');
          continue;
        }
        write(path, next, options.dryRun);
        say(repo, path, existing === undefined || !hasGuideBlock(existing) ? 'installed' : 'updated');
      }
    }
    if (options.hook === true) {
      const path = settingsPath(repo.dir, options.shared);
      const existing = read(path);
      const settings = parseSettings(path, existing);
      const searching = withSearchHook(
        settings,
        searchHookCommand(repo.dir, join(loaded.outputDir, NAMES_FILE), options.shared, options.terminal),
        editHookCommand(repo.dir, join(loaded.outputDir, EDITS_FILE), options.shared, options.terminal),
      );
      const next = json(
        options.promptCards === false
          ? withoutPromptHook(searching)
          : withPromptHook(searching, promptHookCommand(repo.dir, join(loaded.outputDir, CARD_NAMES_FILE), options.shared)),
      );
      if (next === existing) say(repo, path, 'unchanged');
      else {
        write(path, next, options.dryRun);
        say(repo, path, existing === undefined || !holdsOurs(settings) ? 'installed' : 'updated');
      }
    }
  }
  return run;
};

/** What each repository's assistants are told now, against what `install` would write. */
export const agentsStatus = (options: AgentsOptions = {}): AgentsRun => {
  const loaded = loadForAgents(options);
  const run: AgentsRun = { changes: [] };
  for (const repo of reposOf(loaded, options.repo)) {
    const guide = guideFor(loaded, repo, options);
    for (const target of [...OWNED_TARGETS, ...SHARED_TARGETS]) {
      const path = join(repo.dir, TARGET_PATH[target]);
      const existing = read(path);
      let state: AgentFileState;
      if (OWNED_TARGETS.includes(target)) {
        const owned = existing === undefined ? undefined : ownedState(existing);
        state =
          existing === undefined
            ? 'missing'
            : existing === ownedFile(target, guide)
              ? 'installed'
              : owned === 'edited'
                ? 'edited by hand'
                : owned === 'foreign'
                  ? 'not flowatlas'
                  : 'out of date';
      } else {
        if (existing === undefined || !hasGuideBlock(existing)) continue;
        state = existing.includes(sharedBlock(guide, target)) ? 'installed' : 'out of date';
      }
      run.changes.push({ services: repo.services, file: path, state });
    }
    for (const shared of [false, true]) {
      const path = settingsPath(repo.dir, shared);
      const existing = read(path);
      if (existing === undefined) continue;
      if (holdsOurs(parseSettings(path, existing))) run.changes.push({ services: repo.services, file: path, state: 'installed' });
    }
  }
  return run;
};

/** Takes out exactly what `install` wrote; a file edited by hand is kept and named. */
export const removeAgents = (options: AgentsOptions = {}): AgentsRun => {
  const loaded = loadForAgents(options);
  const run: AgentsRun = { changes: [] };
  for (const repo of reposOf(loaded, options.repo)) {
    for (const target of OWNED_TARGETS) {
      const path = join(repo.dir, TARGET_PATH[target]);
      const existing = read(path);
      if (existing === undefined || ownedState(existing) === 'foreign') continue;
      if (ownedState(existing) === 'edited' && options.force !== true) {
        run.changes.push({ services: repo.services, file: path, state: 'kept' });
        continue;
      }
      if (options.dryRun !== true) rmSync(path, { force: true });
      run.changes.push({ services: repo.services, file: path, state: 'removed' });
    }
    for (const target of SHARED_TARGETS) {
      const path = join(repo.dir, TARGET_PATH[target]);
      const existing = read(path);
      if (existing === undefined || !hasGuideBlock(existing)) continue;
      if (options.dryRun !== true) {
        const left = withoutGuideBlock(existing);
        if (left === undefined) rmSync(path, { force: true });
        else writeFileSync(path, left, 'utf8');
      }
      run.changes.push({ services: repo.services, file: path, state: 'removed' });
    }
    for (const shared of [false, true]) {
      const path = settingsPath(repo.dir, shared);
      const existing = read(path);
      if (existing === undefined) continue;
      const settings = parseSettings(path, existing);
      if (!holdsOurs(settings)) continue;
      const left = withoutPromptHook(withoutSearchHook(settings));
      if (options.dryRun !== true) {
        if (Object.keys(left).length === 0) rmSync(path, { force: true });
        else writeFileSync(path, json(left), 'utf8');
      }
      run.changes.push({ services: repo.services, file: path, state: 'removed' });
    }
  }
  return run;
};

const say = (run: AgentsRun, dryRun: boolean): void => {
  for (const change of run.changes) process.stdout.write(`${dryRun ? 'would be ' : ''}${change.state}: ${change.file} (${change.services.join(', ')})\n`);
  if (run.changes.length === 0) process.stdout.write('nothing to do\n');
};

export const registerAgents = (program: Command): void => {
  const agents = program.command('agents').description('tell the assistants in each repository when to ask the graph');
  const common = (command: Command): Command =>
    command
      .option('--config <path>', 'configuration file (default: found from the working directory)')
      .option('--repo <name>', 'only this service')
      .option('--dry-run', 'say what would change and write nothing')
      .option('--terminal', 'the guide for an assistant that asks in a terminal, with no graph server: each question’s command, with --format json');
  common(agents.command('install').description('write the guide for each assistant into every repository'))
    .option('--instructions', 'also add the guide, as a marked block, to AGENTS.md, CLAUDE.md and Copilot instructions')
    .option('--hook', 'also add the Claude Code hooks: what a search could not see, who uses a name an edit took out, and the graph’s answer for what a prompt names')
    .option('--no-prompt-cards', 'with --hook, leave out the prompt hook (and take out one written before)')
    .option('--shared', 'put the hook in .claude/settings.json, committed, not settings.local.json')
    .option('--force', 'replace a guide edited by hand, or a file of that name that is not flowatlas’s')
    .action((options: AgentsOptions) => say(installAgents(options), options.dryRun === true));
  common(agents.command('status').description('say what each repository’s assistants are told')).action((options: AgentsOptions) =>
    say(agentsStatus(options), false),
  );
  common(agents.command('remove').description('take out what install wrote, and nothing else'))
    .option('--force', 'remove a guide edited by hand too')
    .action((options: AgentsOptions) => say(removeAgents(options), options.dryRun === true));
  // What a hook in committed settings runs (P227); personal settings run the built file directly.
  agents.addCommand(
    new Command(HOOK_MARK)
      .description('the search hook: reads a Claude Code hook call on stdin')
      .allowUnknownOption()
      .option('--names <path>', 'the name index')
      .option('--terminal', 'name the command, not the graph server’s tool')
      .action(async (options: { names?: string; terminal?: boolean }) => {
        await runSearchHook([...(options.names === undefined ? [] : ['--names', options.names]), ...(options.terminal === true ? ['--terminal'] : [])]);
      }),
    { hidden: true },
  );
  // What a prompt hook in committed settings runs (P386); personal settings run the built file directly.
  agents.addCommand(
    new Command(PROMPT_MARK)
      .description('the prompt hook: reads a Claude Code prompt on stdin')
      .allowUnknownOption()
      .option('--cards <path>', 'the card name index')
      .action(async (options: { cards?: string }) => {
        await runPromptHook(options.cards === undefined ? [] : ['--cards', options.cards]);
        // The graph server it started may hold a handle a little longer; the answer is written.
        process.exit(0);
      }),
    { hidden: true },
  );
  agents.addCommand(
    new Command(EDIT_HOOK_MARK)
      .description('the edit hook: reads a Claude Code hook call on stdin')
      .allowUnknownOption()
      .option('--edits <path>', 'the edit index')
      .option('--terminal', 'name the command, not the graph server’s tool')
      .action(async (options: { edits?: string; terminal?: boolean }) => {
        await runEditHook([...(options.edits === undefined ? [] : ['--edits', options.edits]), ...(options.terminal === true ? ['--terminal'] : [])]);
      }),
    { hidden: true },
  );
};
