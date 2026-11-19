import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { loadConfig, toPosixPath, type LoadedConfig } from '@flowatlas/core';
import { Command } from 'commander';
import { NAMES_FILE } from '../agents/names.js';
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
import { cannotRun } from '../exit.js';
import { ownBin } from '../own-path.js';

/**
 * Tells each assistant a repository uses when to ask the graph (P227).
 *
 * `.mcp.json` says the server exists; nothing said when to choose it, so an
 * assistant in one checkout searched that checkout and answered a question
 * about the whole project from half of it. `install` writes the guide where
 * each assistant reads its instructions, and with `--hook` a Claude Code hook
 * that, after a search naming something the graph joins across repositories,
 * adds what the search could not see.
 *
 * Files flowatlas owns - a skill, a Cursor rule - are written by default;
 * files a team owns - `AGENTS.md`, `CLAUDE.md`, Copilot's instructions - get a
 * marked block only with `--instructions` (D1). Everything written is taken
 * out by `remove` and nothing else: a file edited by hand is kept and named.
 */
export interface AgentsOptions {
  config?: string;
  repo?: string;
  dryRun?: boolean;
  /** Also write the marked block into the files a team owns. */
  instructions?: boolean;
  /** Also add the search hook. */
  hook?: boolean;
  /** The hook in `.claude/settings.json`, committed, rather than `.claude/settings.local.json`. */
  shared?: boolean;
  /** Replace an owned file edited by hand, or one that is not flowatlas's. */
  force?: boolean;
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

const guideFor = (loaded: LoadedConfig, repo: Repo): AgentGuide => ({
  services: loaded.config.services.map((service) => ({ name: service.name, type: service.type })),
  here: repo.services,
});

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

/** The hook's command marker: any hook entry whose command has it is ours. */
const HOOK_MARK = 'search-hook';

/**
 * How the hook is started. Personal settings name this machine's files, which
 * starts fastest (D6); settings a team commits cannot, so they name the
 * command and an index path relative to the repository.
 */
export const searchHookCommand = (repoDir: string, namesPath: string, shared: boolean | undefined): string => {
  if (shared === true) return `flowatlas agents ${HOOK_MARK} --names ${JSON.stringify(toPosixPath(relative(repoDir, namesPath)))}`;
  const script = join(dirname(ownBin(import.meta.url)), '..', 'dist', `${HOOK_MARK}.js`);
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(script)} --names ${JSON.stringify(namesPath)}`;
};

interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
}
interface Settings {
  hooks?: { PostToolUse?: HookEntry[] } & Record<string, unknown>;
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

const isOurs = (entry: HookEntry): boolean => (entry.hooks ?? []).some((hook) => typeof hook.command === 'string' && hook.command.includes(HOOK_MARK));

/** The settings with the hook in, merged beside every other hook (D1). */
export const withSearchHook = (settings: Settings, command: string): Settings => {
  const post = (settings.hooks?.PostToolUse ?? []).filter((entry) => !isOurs(entry));
  // Bash too: an assistant often searches with grep or rg through the shell.
  post.push({ matcher: 'Grep|Bash', hooks: [{ type: 'command', command, timeout: 5 }] });
  return { ...settings, hooks: { ...(settings.hooks ?? {}), PostToolUse: post } };
};

/** The settings with the hook taken out; the key dropped when nothing else is under it. */
export const withoutSearchHook = (settings: Settings): Settings => {
  const post = (settings.hooks?.PostToolUse ?? []).filter((entry) => !isOurs(entry));
  const hooks: Record<string, unknown> = { ...(settings.hooks ?? {}) };
  if (post.length > 0) hooks['PostToolUse'] = post;
  else delete hooks['PostToolUse'];
  const next: Settings = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Writes, or with `dryRun` says it would write, what each repository's assistants read. */
export const installAgents = (options: AgentsOptions = {}): AgentsRun => {
  const loaded = loadConfig(options.config ?? process.cwd());
  const run: AgentsRun = { changes: [] };
  const say = (repo: Repo, file: string, state: AgentFileState): void => void run.changes.push({ services: repo.services, file, state });
  for (const repo of reposOf(loaded, options.repo)) {
    const guide = guideFor(loaded, repo);
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
        const block = sharedBlock(guide);
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
      const next = json(withSearchHook(settings, searchHookCommand(repo.dir, join(loaded.outputDir, NAMES_FILE), options.shared)));
      if (next === existing) say(repo, path, 'unchanged');
      else {
        write(path, next, options.dryRun);
        say(repo, path, existing === undefined || !(settings.hooks?.PostToolUse ?? []).some(isOurs) ? 'installed' : 'updated');
      }
    }
  }
  return run;
};

/** What each repository's assistants are told now, against what `install` would write. */
export const agentsStatus = (options: AgentsOptions = {}): AgentsRun => {
  const loaded = loadConfig(options.config ?? process.cwd());
  const run: AgentsRun = { changes: [] };
  for (const repo of reposOf(loaded, options.repo)) {
    const guide = guideFor(loaded, repo);
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
        state = existing.includes(sharedBlock(guide)) ? 'installed' : 'out of date';
      }
      run.changes.push({ services: repo.services, file: path, state });
    }
    for (const shared of [false, true]) {
      const path = settingsPath(repo.dir, shared);
      const existing = read(path);
      if (existing === undefined) continue;
      if (parseSettings(path, existing).hooks?.PostToolUse?.some(isOurs) === true) run.changes.push({ services: repo.services, file: path, state: 'installed' });
    }
  }
  return run;
};

/** Takes out exactly what `install` wrote; a file edited by hand is kept and named. */
export const removeAgents = (options: AgentsOptions = {}): AgentsRun => {
  const loaded = loadConfig(options.config ?? process.cwd());
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
      if (settings.hooks?.PostToolUse?.some(isOurs) !== true) continue;
      const left = withoutSearchHook(settings);
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
      .option('--dry-run', 'say what would change and write nothing');
  common(agents.command('install').description('write the guide for each assistant into every repository'))
    .option('--instructions', 'also add the guide, as a marked block, to AGENTS.md, CLAUDE.md and Copilot instructions')
    .option('--hook', 'also add the Claude Code hook that says what a search could not see')
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
      .action(async (options: { names?: string }) => {
        await runSearchHook(options.names === undefined ? [] : ['--names', options.names]);
      }),
    { hidden: true },
  );
};
