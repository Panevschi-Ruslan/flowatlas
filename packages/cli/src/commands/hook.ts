import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from '@flowatlas/core';
import type { Command } from 'commander';
import { cannotRun } from '../exit.js';
import { ownBin } from '../own-path.js';
import { isOnPath } from './mcp.js';

/**
 * Git hooks that rebuild the graph in the background (P230).
 *
 * A graph is wrong by a lot after a checkout or a merge, when many files
 * change at once, so those are when the hooks run: `post-checkout` (a branch
 * checkout only, not `git checkout -- file`), `post-merge`, and
 * `post-rewrite` for a rebase. A commit changes no file on disk - the edit
 * before it did, and answers already say when a file they cite moved - so
 * `post-commit` is offered and never the default (D3).
 *
 * Each hook starts `flowatlas build --background` and returns at once: a
 * checkout must never wait for a build. The command is written inside a
 * marked block, so a hook a team already has keeps every line of its own and
 * `remove` takes out exactly what `install` put in. A repository whose hooks a
 * manager keeps (`core.hooksPath`: husky, lefthook, a team's folder) is not
 * written into at all; the line to add, and where, is printed instead.
 */
export const HOOK_EVENTS = ['checkout', 'merge', 'rewrite', 'commit'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** What `install` writes when nobody says (D3). */
export const DEFAULT_HOOK_EVENTS: readonly HookEvent[] = ['checkout', 'merge', 'rewrite'];

const HOOK_FILE: Record<HookEvent, string> = {
  checkout: 'post-checkout',
  merge: 'post-merge',
  rewrite: 'post-rewrite',
  commit: 'post-commit',
};

export const BLOCK_START = '# flowatlas:hook';
export const BLOCK_END = '# /flowatlas:hook';

/** A shell word, quoted for `sh`. */
const quoted = (word: string): string => `'${word.replace(/'/g, `'\\''`)}'`;

/** How a hook starts the command: the bare name when it is installed, the node and the script that run it otherwise. */
export const hookCommand = (onPath: boolean): string =>
  onPath ? 'flowatlas' : `${quoted(process.execPath)} ${quoted(ownBin(import.meta.url))}`;

/** The block one hook holds. */
export const hookBlock = (event: HookEvent, command: string, configPath: string): string => {
  const build = `${command} build --background --config ${quoted(configPath)} >/dev/null 2>&1 || true`;
  // post-checkout's third argument is 1 for a branch checkout and 0 for files.
  const body = event === 'checkout' ? `if [ "$3" = "1" ]; then ${build}; fi` : build;
  return [BLOCK_START, '# Rebuilds the flowatlas graph in the background; `flowatlas hook remove` takes this out.', body, BLOCK_END].join('\n');
};

const BLOCK = new RegExp(`\\n?${BLOCK_START.replace(/[/]/g, '\\/')}\\n[\\s\\S]*?${BLOCK_END.replace(/[/]/g, '\\/')}\\n?`);

/** Whether a hook file is a shell script a block can be added to. */
const isShell = (text: string): boolean => /^#!\s*\S*(?:\/|env\s+)(?:ba|z|da)?sh\b/.test(text);

/** A hook's text with the block put in, in place of an earlier one, or at its end. */
export const withBlock = (existing: string | undefined, block: string): string => {
  if (existing === undefined || existing.trim() === '') return `#!/bin/sh\n${block}\n`;
  if (BLOCK.test(existing)) return existing.replace(BLOCK, `\n${block}\n`);
  return `${existing.replace(/\n*$/, '\n')}${block}\n`;
};

/** A hook's text with the block taken out; undefined when nothing of the hook's own is left. */
export const withoutBlock = (existing: string): string | undefined => {
  const left = existing.replace(BLOCK, '\n');
  return left.replace(/^#!.*\n?/, '').trim() === '' ? undefined : left.replace(/\n{3,}/g, '\n\n');
};

/** One repository's hooks, as git would run them. */
interface HooksDir {
  /** The services whose repository it is. */
  services: string[];
  repoDir: string;
  /** Where git runs hooks from, or undefined when a manager keeps them (`hooksPath`). */
  dir?: string;
  hooksPath?: string;
  /** Not a checkout at all. */
  notGit?: true;
}

const git = (cwd: string, args: string[]): string | undefined => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch {
    return undefined;
  }
};

/** Each repository's hooks folder, once however many services it holds. */
const hooksDirsOf = (services: ReadonlyArray<{ name: string; dir: string }>): HooksDir[] => {
  const byDir = new Map<string, HooksDir>();
  for (const service of services) {
    const top = git(service.dir, ['rev-parse', '--show-toplevel']);
    if (top === undefined) {
      byDir.set(`not-git:${service.dir}`, { services: [service.name], repoDir: service.dir, notGit: true });
      continue;
    }
    const hooksPath = git(top, ['config', '--get', 'core.hooksPath']);
    const common = git(top, ['rev-parse', '--git-common-dir']);
    const dir = common === undefined ? undefined : join(isAbsolute(common) ? common : resolve(top, common), 'hooks');
    const key = hooksPath === undefined || hooksPath === '' ? (dir ?? top) : `managed:${top}`;
    const known = byDir.get(key);
    if (known !== undefined) {
      known.services.push(service.name);
      continue;
    }
    byDir.set(key, {
      services: [service.name],
      repoDir: top,
      ...(hooksPath === undefined || hooksPath === '' ? (dir === undefined ? {} : { dir }) : { hooksPath }),
    });
  }
  return [...byDir.values()];
};

export interface HookOptions {
  config?: string;
  repo?: string;
  dryRun?: boolean;
  on?: string;
  print?: (line: string) => void;
}

/** One hook file and what was, or would be, done to it. */
export interface HookChange {
  services: string[];
  file: string;
  state: 'installed' | 'updated' | 'unchanged' | 'removed' | 'missing' | 'out of date' | 'not a shell script';
}

export interface HookRun {
  changes: HookChange[];
  /** Repositories whose hooks a manager keeps, each with the line to add there. */
  managed: Array<{ services: string[]; hooksPath: string; lines: string[] }>;
  /** Repositories that are not checkouts. */
  notGit: string[];
}

const eventsOf = (on: string | undefined): HookEvent[] => {
  if (on === undefined) return [...DEFAULT_HOOK_EVENTS];
  const asked = on.split(',').map((item) => item.trim()).filter((item) => item !== '');
  const wrong = asked.filter((item) => !(HOOK_EVENTS as readonly string[]).includes(item));
  if (wrong.length > 0 || asked.length === 0) throw cannotRun(`--on takes ${HOOK_EVENTS.join(', ')}, not ${JSON.stringify(on)}`);
  return asked as HookEvent[];
};

const servicesOf = (options: HookOptions) => {
  const loaded = loadConfig(options.config ?? process.cwd());
  const services = loaded.config.services
    .filter((service) => options.repo === undefined || service.name === options.repo)
    .map((service) => ({ name: service.name, dir: loaded.repoDir(service) }))
    .filter((service) => existsSync(service.dir));
  if (options.repo !== undefined && services.length === 0) throw cannotRun(`no service named ${JSON.stringify(options.repo)} with a repository on disk`);
  return { loaded, services };
};

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** Writes, or with `dryRun` says it would write, the hooks of every repository of the project. */
export const installHooks = (options: HookOptions = {}): HookRun => {
  const events = eventsOf(options.on);
  const { loaded, services } = servicesOf(options);
  const command = hookCommand(isOnPath());
  const run: HookRun = { changes: [], managed: [], notGit: [] };
  for (const hooks of hooksDirsOf(services)) {
    if (hooks.notGit === true) {
      run.notGit.push(...hooks.services);
      continue;
    }
    if (hooks.hooksPath !== undefined) {
      run.managed.push({
        services: hooks.services,
        hooksPath: hooks.hooksPath,
        lines: events.map((event) => `${HOOK_FILE[event]}: ${hookBlock(event, command, loaded.configPath).split('\n')[2]}`),
      });
      continue;
    }
    if (hooks.dir === undefined) continue;
    for (const event of events) {
      const file = join(hooks.dir, HOOK_FILE[event]);
      const existing = read(file);
      if (existing !== undefined && existing.trim() !== '' && !isShell(existing)) {
        run.changes.push({ services: hooks.services, file, state: 'not a shell script' });
        continue;
      }
      const next = withBlock(existing, hookBlock(event, command, loaded.configPath));
      const state = existing === next ? 'unchanged' : existing === undefined || !BLOCK.test(existing) ? 'installed' : 'updated';
      if (state !== 'unchanged' && options.dryRun !== true) {
        mkdirSync(hooks.dir, { recursive: true });
        writeFileSync(file, next, 'utf8');
        chmodSync(file, 0o755);
      }
      run.changes.push({ services: hooks.services, file, state });
    }
  }
  return run;
};

/** What each repository's hooks hold now. */
export const hookStatus = (options: HookOptions = {}): HookRun => {
  const events = eventsOf(options.on);
  const { loaded, services } = servicesOf(options);
  const command = hookCommand(isOnPath());
  const run: HookRun = { changes: [], managed: [], notGit: [] };
  for (const hooks of hooksDirsOf(services)) {
    if (hooks.notGit === true) run.notGit.push(...hooks.services);
    else if (hooks.hooksPath !== undefined) run.managed.push({ services: hooks.services, hooksPath: hooks.hooksPath, lines: [] });
    else if (hooks.dir !== undefined) {
      for (const event of events) {
        const file = join(hooks.dir, HOOK_FILE[event]);
        const existing = read(file);
        const state =
          existing === undefined || !BLOCK.test(existing)
            ? 'missing'
            : existing.includes(hookBlock(event, command, loaded.configPath))
              ? 'installed'
              : 'out of date';
        run.changes.push({ services: hooks.services, file, state });
      }
    }
  }
  return run;
};

/** Takes out exactly what `install` put in; a hook left with nothing of its own goes. */
export const removeHooks = (options: HookOptions = {}): HookRun => {
  const { services } = servicesOf(options);
  const run: HookRun = { changes: [], managed: [], notGit: [] };
  for (const hooks of hooksDirsOf(services)) {
    if (hooks.dir === undefined) continue;
    for (const event of HOOK_EVENTS) {
      const file = join(hooks.dir, HOOK_FILE[event]);
      const existing = read(file);
      if (existing === undefined || !BLOCK.test(existing)) continue;
      if (options.dryRun !== true) {
        const left = withoutBlock(existing);
        if (left === undefined) rmSync(file, { force: true });
        else writeFileSync(file, left, 'utf8');
      }
      run.changes.push({ services: hooks.services, file, state: 'removed' });
    }
  }
  return run;
};

const say = (run: HookRun, print: (line: string) => void, dryRun: boolean): void => {
  for (const change of run.changes) print(`${dryRun ? 'would be ' : ''}${change.state}: ${change.file} (${change.services.join(', ')})`);
  for (const item of run.managed) {
    print(`${item.services.join(', ')}: git runs hooks from ${item.hooksPath}, which another tool keeps; nothing written.`);
    for (const line of item.lines) print(`  add to ${line}`);
  }
  if (run.notGit.length > 0) print(`not a git checkout, so no hooks: ${run.notGit.join(', ')}`);
  if (run.changes.length === 0 && run.managed.length === 0 && run.notGit.length === 0) print('nothing to do');
};

export const registerHook = (program: Command): void => {
  const hook = program.command('hook').description('git hooks that rebuild the graph in the background after a checkout or a merge');
  const common = (command: Command): Command =>
    command
      .option('--config <path>', 'configuration file (default: found from the working directory)')
      .option('--repo <name>', 'only this service')
      .option('--dry-run', 'say what would change and write nothing');
  common(hook.command('install').description('add the hooks to every repository of the project'))
    .option('--on <events>', `which: ${HOOK_EVENTS.join(', ')} (default: ${DEFAULT_HOOK_EVENTS.join(', ')})`)
    .action((options: HookOptions) => say(installHooks(options), (line) => void process.stdout.write(`${line}\n`), options.dryRun === true));
  common(hook.command('status').description('say which repositories have the hooks'))
    .option('--on <events>', `which to look for (default: ${DEFAULT_HOOK_EVENTS.join(', ')})`)
    .action((options: HookOptions) => say(hookStatus(options), (line) => void process.stdout.write(`${line}\n`), false));
  common(hook.command('remove').description('take the hooks out again, and nothing else'))
    .action((options: HookOptions) => say(removeHooks(options), (line) => void process.stdout.write(`${line}\n`), options.dryRun === true));
};
