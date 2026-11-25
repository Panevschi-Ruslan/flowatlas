import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_HABITS, AGENT_QUESTIONS, agentQuestionsLine, TEXT_IS_A_GREP, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { INSTRUCTIONS } from '@flowatlas/mcp';
import { afterAll, describe, expect, it } from 'vitest';
import { agentsStatus, installAgents, registeredServer, removeAgents, serverKeyIn, withSearchHook, withoutSearchHook } from '../commands/agents.js';
import { namesOf, NAMES_FORMAT_VERSION, type NamesIndex } from './names.js';
import { contextFor, hookOutput, longestLiteral, patternsOf, runSearchHook, shellWords } from './search-hook.js';
import {
  ALWAYS_LOAD_SINCE,
  CORE_TOOLS,
  GUIDE_MAX_LINES,
  guideBody,
  guideDescription,
  ownedFile,
  ownedState,
  SHARED_MAX_CHARS,
  sharedBlock,
  toolSearchQuery,
  withGuideBlock,
  withoutGuideBlock,
} from './template.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-agents-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const GUIDE = {
  services: [
    { name: 'gateway', type: 'nestjs' },
    { name: 'orders', type: 'nestjs' },
    { name: 'web', type: 'angular' },
  ],
  here: ['web'],
};

describe('the guide every assistant is given (P227)', () => {
  it('fits the ceiling, names the other repositories and lists every question', () => {
    const body = guideBody(GUIDE);
    expect(body.split('\n').length).toBeLessThanOrEqual(GUIDE_MAX_LINES);
    expect(body).toContain('the graph also sees gateway, orders');
    for (const question of AGENT_QUESTIONS) expect(body).toContain(`| ${question.ask} | \`${question.tool}\` | \`${question.command}\` |`);
  });

  it('asks the same questions the graph server’s instructions ask', () => {
    expect(INSTRUCTIONS.split('\n')).toContain(agentQuestionsLine());
  });

  // P396: a plain-text question went to find_symbol first and to a grep anyway, one turn more than a grep alone.
  it('says text in code is a grep, in the block, the guide, the terminal guide and the description', () => {
    expect(sharedBlock(GUIDE)).toContain(TEXT_IS_A_GREP);
    expect(guideBody(GUIDE)).toContain(TEXT_IS_A_GREP);
    expect(guideBody({ ...GUIDE, via: 'terminal' })).toContain(TEXT_IS_A_GREP);
    expect(guideDescription(GUIDE)).toContain("A constant's value is a grep.");
  });

  it('writes a skill and a Cursor rule an assistant loads by description, with a mark that tells a hand edit apart', () => {
    const skill = ownedFile('claude-skill', GUIDE);
    expect(skill).toMatch(/^---\nname: flowatlas\ndescription: "Use for questions that cross this project's repositories/);
    expect(ownedFile('cursor-rule', GUIDE)).toMatch(/\nalwaysApply: false\n---\n/);
    expect(ownedState(skill)).toBe('ours');
    expect(ownedState(skill.replace('One call per question', 'Read'))).toBe('edited');
    expect(ownedState('# my own skill\n')).toBe('foreign');
  });

  it('keeps the block a team’s file holds short, and says in it how to spend few turns (P366)', () => {
    const block = sharedBlock(GUIDE);
    expect(block.length).toBeLessThanOrEqual(SHARED_MAX_CHARS);
    for (const habit of AGENT_HABITS) expect(block).toContain(`- ${habit}`);
    expect(block).toContain('`complete: true`');
    expect(block).toContain('`verbose: true`');
    // No line points at the full guide (P382): the skill loads itself, and a pointer invited a Read.
    expect(block).not.toContain('SKILL.md');
    // The table is the full guide's: loaded when used, not on every turn.
    expect(block).not.toContain('| Question |');
    const skill = ownedFile('claude-skill', GUIDE);
    for (const habit of AGENT_HABITS) expect(skill).toContain(`- ${habit}`);
    expect(skill).toContain('ToolSearch call');
  });

  /**
   * The server lists its core tools to load upfront (P380), so the block read
   * on every turn spends no turn and no characters on a ToolSearch call for
   * them: it says they are loaded, and to load any other with every tool
   * needed in one call. The skill, read when used, keeps the call for a
   * Claude Code too old to load them; where the server leaves them deferred,
   * both say the call.
   */
  it('tells no ToolSearch call for the core tools where the server loads them upfront, and the one call where it does not (P380)', () => {
    const select = `\`${toolSearchQuery()}\``;
    expect(select).toBe(`\`select:${CORE_TOOLS.map((tool) => `mcp__flowatlas__${tool}`).join(',')}\``);
    expect(CORE_TOOLS).toContain('check_contract');
    expect(CORE_TOOLS).not.toContain('who_emits');
    const block = sharedBlock(GUIDE);
    expect(block).toContain('- In Claude Code the core graph tools are loaded already; load any other in ONE ToolSearch call with every tool you need.');
    expect(block).not.toContain('select:');
    const skill = ownedFile('claude-skill', GUIDE);
    expect(skill).toContain(`loaded already; load any other in ONE ToolSearch call with every tool you need. Before Claude Code ${ALWAYS_LOAD_SINCE}: ${select}.`);

    const deferred = { ...GUIDE, alwaysLoad: false };
    expect(sharedBlock(deferred)).toContain(`- In Claude Code, load the tools in ONE ToolSearch call: ${select}.`);
    expect(sharedBlock(deferred).length).toBeLessThanOrEqual(SHARED_MAX_CHARS);
    expect(ownedFile('claude-skill', deferred)).toContain(`load the tools in ONE ToolSearch call: ${select}.\n`);
    expect(ownedFile('claude-skill', deferred)).not.toContain('loaded already');
  });

  /**
   * Claude Code reads `CLAUDE.md` beside the server's instructions where the
   * repository's `.mcp.json` registers the server (P382): those say the
   * questions, the call for each and the habits on every turn already, so
   * the block keeps the services and the one habit for an edit. `AGENTS.md`
   * and Copilot's file, read by assistants that may never start the server,
   * keep the whole block.
   */
  it('shrinks the CLAUDE.md block where the server is registered, and keeps the whole block elsewhere (P382)', () => {
    const registered = { ...GUIDE, registered: true };
    const claude = sharedBlock(registered, 'claude-md');
    expect(claude.length).toBeLessThanOrEqual(450);
    expect(claude).toContain('one of 3 that the flowatlas graph joins (gateway, orders, web)');
    expect(claude).toContain(`- ${AGENT_HABITS[0]}`);
    expect(AGENT_HABITS[0]).toContain('`impact` first');
    expect(claude).not.toContain('`complete: true`');
    expect(sharedBlock(registered, 'agents-md')).toBe(sharedBlock(GUIDE));
    expect(sharedBlock(registered, 'copilot')).toBe(sharedBlock(GUIDE));
    expect(sharedBlock(GUIDE, 'claude-md')).toBe(sharedBlock(GUIDE));
    expect(sharedBlock({ ...registered, alwaysLoad: false }, 'claude-md')).toContain(`ONE ToolSearch call: \`${toolSearchQuery()}\``);
  });

  /** A question is one call (P382): no rule teaches a lookup first, and the habits name each tool's own key for several. */
  it('teaches one call per question and names each tool\'s key for several at once (P382)', () => {
    const skill = ownedFile('claude-skill', GUIDE);
    expect(skill).not.toContain('Narrow, then read');
    expect(skill).not.toContain('Begin with');
    expect(skill).toContain('One call per question');
    expect(AGENT_HABITS.join(' ')).toContain('who_calls and impact `symbols`, dead `ids`, find_symbol and search `queries`, get_type `types`');
    expect(AGENT_HABITS.join(' ')).not.toContain('`ids: [...]`');
    expect(INSTRUCTIONS).toContain('Before changing a route, handler, body type or message payload: impact first.');
  });

  it('reads from .mcp.json whether the server leaves the core tools upfront (P380)', () => {
    const dir = join(scratch, 'upfront');
    mkdirSync(dir, { recursive: true });
    expect(registeredServer(dir)).toEqual({ key: 'flowatlas', alwaysLoad: true, registered: false });
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { flowatlas: { command: 'flowatlas', args: ['mcp'], alwaysLoad: false } } }));
    expect(registeredServer(dir)).toEqual({ key: 'flowatlas', alwaysLoad: false, registered: true });
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { graph: { command: 'npx', args: ['flowatlas', 'mcp', '--no-always-load'] } } }));
    expect(registeredServer(dir)).toEqual({ key: 'graph', alwaysLoad: false, registered: true });
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { flowatlas: { command: 'flowatlas', args: ['mcp'], alwaysLoad: true } } }));
    expect(registeredServer(dir)).toEqual({ key: 'flowatlas', alwaysLoad: true, registered: true });
  });

  it('names the core tools loaded upfront where fewer than all are, from mcp.upfront or the entry’s --upfront (P392)', () => {
    const four = { ...GUIDE, upfront: ['who_calls', 'impact', 'search', 'get_flow'] };
    expect(sharedBlock(four)).toContain('In Claude Code who_calls, impact, search and get_flow are loaded already; load any other graph tool in ONE ToolSearch call');
    expect(guideBody(four)).toContain(`Before Claude Code ${ALWAYS_LOAD_SINCE}: \`${toolSearchQuery()}\``);
    expect(sharedBlock({ ...GUIDE, upfront: [...CORE_TOOLS] })).toContain('the core graph tools are loaded already');
    expect(sharedBlock({ ...GUIDE, upfront: [] })).toContain(`load the tools in ONE ToolSearch call: \`${toolSearchQuery()}\``);
    const dir = join(scratch, 'upfront-entry');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { flowatlas: { command: 'flowatlas', args: ['mcp', '--upfront', 'impact,search'] } } }));
    expect(registeredServer(dir)).toEqual({ key: 'flowatlas', alwaysLoad: true, registered: true, upfront: ['impact', 'search'] });
  });

  it('spells the commands, and no tool, ToolSearch or server, for an assistant that asks in a terminal (P392)', () => {
    const terminal = { ...GUIDE, via: 'terminal' as const };
    const block = sharedBlock(terminal);
    expect(block.length).toBeLessThanOrEqual(SHARED_MAX_CHARS);
    for (const question of AGENT_QUESTIONS) expect(block).toContain(`- ${question.short}: \`${question.command}\``);
    expect(block).toContain('`--format json`');
    for (const tool of ['ToolSearch', 'who_calls', 'verbose: true', '.mcp.json']) expect(block).not.toContain(tool);
    // A CLAUDE.md beside a registered server still gets the commands: no server's instructions are read in a terminal.
    expect(sharedBlock({ ...terminal, registered: true }, 'claude-md')).toBe(sharedBlock(terminal, 'claude-md'));
    const body = guideBody(terminal);
    expect(body.split('\n').length).toBeLessThanOrEqual(GUIDE_MAX_LINES);
    expect(body).toContain('| Question | Terminal |');
    for (const tool of ['ToolSearch', 'Graph server (MCP)', 'who_calls(']) expect(body).not.toContain(tool);
  });

  it('writes the ToolSearch line with the name the server is registered under', () => {
    expect(toolSearchQuery('graph.map')).toMatch(new RegExp(`^select:mcp__graph_map__${CORE_TOOLS[0]},mcp__graph_map__${CORE_TOOLS[1]},`));
    const dir = join(scratch, 'registered');
    mkdirSync(dir, { recursive: true });
    expect(serverKeyIn(dir)).toBe('flowatlas');
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' }, graph: { command: 'npx', args: ['flowatlas', 'mcp', '--config', 'c.json'] } } }));
    expect(serverKeyIn(dir)).toBe('graph');
    writeFileSync(join(dir, '.mcp.json'), 'not json');
    expect(serverKeyIn(dir)).toBe('flowatlas');
  });

  it('puts a block in a team’s file and takes it out leaving the file as it was, byte for byte', () => {
    const theirs = '# Team notes\n\nUse pnpm.\n';
    const block = sharedBlock(GUIDE);
    const ours = withGuideBlock(theirs, block);
    expect(ours.startsWith(theirs)).toBe(true);
    expect(withGuideBlock(ours, block)).toBe(ours);
    expect(withoutGuideBlock(ours)).toBe(theirs);
    expect(withoutGuideBlock(withGuideBlock(undefined, block))).toBeUndefined();
  });
});

/** A project of `gateway` and `web`, each a directory, `web` with a CLAUDE.md of its own. */
const project = (name: string): { config: string; dir: (service: string) => string } => {
  const root = join(scratch, name);
  for (const service of ['gateway', 'web']) mkdirSync(join(root, service), { recursive: true });
  writeFileSync(join(root, 'web', 'CLAUDE.md'), '# Web\n\nRun the tests before a commit.\n');
  const config = join(root, 'flowatlas.config.json');
  writeFileSync(config, JSON.stringify({ services: [{ name: 'gateway', repo: './gateway', type: 'nestjs' }, { name: 'web', repo: './web', type: 'angular' }] }));
  return { config, dir: (service) => join(root, service) };
};

describe('flowatlas agents install, status and remove', () => {
  it('writes the files flowatlas owns, and nothing of a team’s without --instructions', () => {
    const { config, dir } = project('plain');
    const run = installAgents({ config });
    expect(run.changes.map((change) => change.state)).toEqual(['installed', 'installed', 'installed', 'installed']);
    expect(existsSync(join(dir('web'), '.claude', 'skills', 'flowatlas', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir('gateway'), '.cursor', 'rules', 'flowatlas.mdc'))).toBe(true);
    expect(readFileSync(join(dir('web'), 'CLAUDE.md'), 'utf8')).toBe('# Web\n\nRun the tests before a commit.\n');
    expect(existsSync(join(dir('web'), 'AGENTS.md'))).toBe(false);
    expect(installAgents({ config }).changes.every((change) => change.state === 'unchanged')).toBe(true);
    expect(agentsStatus({ config }).changes.every((change) => change.state === 'installed')).toBe(true);
  });

  it('with --instructions adds the block to CLAUDE.md and AGENTS.md, and remove gives both back as they were', () => {
    const { config, dir } = project('instructions');
    installAgents({ config, instructions: true });
    const claude = readFileSync(join(dir('web'), 'CLAUDE.md'), 'utf8');
    expect(claude.startsWith('# Web\n\nRun the tests before a commit.\n\n<!-- flowatlas:agents -->\n')).toBe(true);
    expect(existsSync(join(dir('gateway'), 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir('gateway'), 'CLAUDE.md'))).toBe(false);
    removeAgents({ config });
    expect(readFileSync(join(dir('web'), 'CLAUDE.md'), 'utf8')).toBe('# Web\n\nRun the tests before a commit.\n');
    expect(existsSync(join(dir('gateway'), 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(dir('web'), '.claude', 'skills', 'flowatlas', 'SKILL.md'))).toBe(false);
  });

  it('writes the short block into a CLAUDE.md whose repository registers the server, and says it is installed (P382)', () => {
    const { config, dir } = project('beside-instructions');
    writeFileSync(join(dir('web'), '.mcp.json'), JSON.stringify({ mcpServers: { flowatlas: { command: 'flowatlas', args: ['mcp'] } } }));
    installAgents({ config, instructions: true });
    const claude = readFileSync(join(dir('web'), 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('its instructions name the one call for each question');
    expect(claude).not.toContain('`complete: true`');
    expect(agentsStatus({ config, repo: 'web' }).changes.find((change) => change.file.endsWith('CLAUDE.md'))?.state).toBe('installed');
    expect(installAgents({ config, instructions: true, repo: 'web' }).changes.find((change) => change.file.endsWith('CLAUDE.md'))?.state).toBe('unchanged');
  });

  it('writes the ToolSearch call into the block where the configuration or .mcp.json leaves the core tools deferred (P380)', () => {
    const { config, dir } = project('deferred');
    installAgents({ config, instructions: true });
    expect(readFileSync(join(dir('web'), 'CLAUDE.md'), 'utf8')).toContain('core graph tools are loaded already');
    writeFileSync(join(dir('gateway'), '.mcp.json'), JSON.stringify({ mcpServers: { flowatlas: { command: 'flowatlas', args: ['mcp'], alwaysLoad: false } } }));
    installAgents({ config, instructions: true });
    expect(readFileSync(join(dir('gateway'), 'AGENTS.md'), 'utf8')).toContain(`load the tools in ONE ToolSearch call: \`${toolSearchQuery()}\``);
    expect(readFileSync(join(dir('web'), 'CLAUDE.md'), 'utf8')).toContain('core graph tools are loaded already');
    const written = JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;
    writeFileSync(config, JSON.stringify({ ...written, mcp: { alwaysLoad: false } }));
    installAgents({ config, instructions: true });
    expect(readFileSync(join(dir('web'), 'CLAUDE.md'), 'utf8')).toContain(`load the tools in ONE ToolSearch call: \`${toolSearchQuery()}\``);
  });

  it('keeps a guide edited by hand, refuses a file of that name that is not flowatlas’s, and says which', () => {
    const { config, dir } = project('edited');
    installAgents({ config, repo: 'web' });
    const skill = join(dir('web'), '.claude', 'skills', 'flowatlas', 'SKILL.md');
    writeFileSync(skill, readFileSync(skill, 'utf8').replace('One call per question', 'Read'));
    const rule = join(dir('web'), '.cursor', 'rules', 'flowatlas.mdc');
    writeFileSync(rule, '# our own rule\n');
    expect(installAgents({ config, repo: 'web' }).changes.map((change) => change.state)).toEqual(['edited by hand', 'not flowatlas']);
    expect(agentsStatus({ config, repo: 'web' }).changes.map((change) => change.state)).toEqual(['edited by hand', 'not flowatlas']);
    expect(removeAgents({ config, repo: 'web' }).changes.map((change) => change.state)).toEqual(['kept']);
    expect(readFileSync(rule, 'utf8')).toBe('# our own rule\n');
  });

  it('with --hook merges the search and edit hooks beside a hook already there, and remove takes out only them', () => {
    const { config, dir } = project('hook');
    const settings = join(dir('web'), '.claude', 'settings.local.json');
    mkdirSync(join(dir('web'), '.claude'), { recursive: true });
    const theirs = { permissions: { allow: ['Bash(pnpm test)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }] } };
    writeFileSync(settings, `${JSON.stringify(theirs, null, 2)}\n`);
    installAgents({ config, repo: 'web', hook: true });
    const written = JSON.parse(readFileSync(settings, 'utf8'));
    expect(written.permissions).toEqual(theirs.permissions);
    expect(written.hooks.PostToolUse).toHaveLength(3);
    expect(written.hooks.PostToolUse[1]).toMatchObject({ matcher: 'Grep|Bash', hooks: [{ type: 'command', timeout: 5 }] });
    expect(written.hooks.PostToolUse[1].hooks[0].command).toMatch(/search-hook\.js" --names ".*names\.json"$/);
    // The edit hook (P387), after every edit and whole file written.
    expect(written.hooks.PostToolUse[2]).toMatchObject({ matcher: 'Edit|MultiEdit|Write', hooks: [{ type: 'command', timeout: 5 }] });
    expect(written.hooks.PostToolUse[2].hooks[0].command).toMatch(/edit-hook\.js" --edits ".*edits\.json"$/);
    installAgents({ config, repo: 'web', hook: true, shared: true });
    const shared = JSON.parse(readFileSync(join(dir('web'), '.claude', 'settings.json'), 'utf8')).hooks.PostToolUse;
    expect(shared[0].hooks[0].command).toMatch(/^flowatlas agents search-hook --names "\.\.\/\.flowatlas\/names\.json"$/);
    expect(shared[1].hooks[0].command).toMatch(/^flowatlas agents edit-hook --edits "\.\.\/\.flowatlas\/edits\.json"$/);
    removeAgents({ config, repo: 'web' });
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual(theirs);
    expect(existsSync(join(dir('web'), '.claude', 'settings.json'))).toBe(false);
  });

  it('with --terminal writes the commands’ guide and hooks that name commands, and status reads it as installed (P392)', () => {
    const { config, dir } = project('terminal');
    installAgents({ config, instructions: true, hook: true, terminal: true });
    expect(readFileSync(join(dir('gateway'), 'AGENTS.md'), 'utf8')).toContain('- who calls this: `flowatlas impact <symbol>`');
    expect(readFileSync(join(dir('gateway'), '.claude', 'skills', 'flowatlas', 'SKILL.md'), 'utf8')).toContain('| Question | Terminal |');
    const hooks = JSON.parse(readFileSync(join(dir('web'), '.claude', 'settings.local.json'), 'utf8')).hooks.PostToolUse;
    expect(hooks[0].hooks[0].command).toMatch(/search-hook\.js" --names ".*names\.json" --terminal$/);
    expect(hooks[1].hooks[0].command).toMatch(/edit-hook\.js" --edits ".*edits\.json" --terminal$/);
    expect(agentsStatus({ config, terminal: true }).changes.every((change) => change.state === 'installed')).toBe(true);
    expect(agentsStatus({ config }).changes.some((change) => change.state === 'out of date')).toBe(true);
  });

  it('refuses to write into a project found from a git repository that is none of its own, and writes from its root or a repository of it (P366)', () => {
    const { config, dir } = project('scope');
    const root = join(dir('web'), '..');
    mkdirSync(join(dir('gateway'), '.git'), { recursive: true });
    mkdirSync(join(dir('web'), 'src'), { recursive: true });
    writeFileSync(join(dir('web'), '.git'), 'gitdir: elsewhere\n');
    // A new repository made in a folder under the project's root: none of its repositories.
    const unrelated = join(root, 'tools', 'scratch-repo');
    mkdirSync(join(unrelated, '.git'), { recursive: true });
    mkdirSync(join(unrelated, 'src'), { recursive: true });
    for (const cwd of [unrelated, join(unrelated, 'src')]) {
      expect(() => installAgents({ cwd, instructions: true, hook: true })).toThrow(/is not one of the repositories of the flowatlas project found above it/);
      expect(() => removeAgents({ cwd })).toThrow(/flowatlas\.config\.json\)?; nothing was written\. .*pass --config ".*flowatlas\.config\.json"/);
    }
    expect(existsSync(join(dir('gateway'), '.claude'))).toBe(false);
    expect(existsSync(join(dir('web'), 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(unrelated, '.claude'))).toBe(false);
    // Asked for by name, the project is written as before.
    expect(installAgents({ cwd: unrelated, config, repo: 'web' }).changes.map((change) => change.state)).toEqual(['installed', 'installed']);
    // From a repository of the project, and from its root, as before.
    expect(installAgents({ cwd: join(dir('web'), 'src') }).changes.map((change) => change.state)).toEqual(['installed', 'installed', 'unchanged', 'unchanged']);
    expect(agentsStatus({ cwd: dir('gateway') }).changes).toHaveLength(4);
    expect(removeAgents({ cwd: root }).changes.map((change) => change.state)).toEqual(['removed', 'removed', 'removed', 'removed']);
  });

  it('writes from a monorepo whose checkout holds the project’s root', () => {
    const { dir } = project('monorepo');
    const root = join(dir('web'), '..');
    mkdirSync(join(root, '.git'), { recursive: true });
    expect(installAgents({ cwd: dir('web') }).changes).toHaveLength(4);
  });

  it('merges and unmerges settings without losing a key', () => {
    const merged = withSearchHook({ model: 'x' }, 'node dist/search-hook.js --names x');
    expect(withoutSearchHook(merged)).toEqual({ model: 'x' });
  });
});

describe('the names a search hook can say something about', () => {
  const node = (id: string, over: Partial<GraphNode>): GraphNode => ({ id, type: 'method', label: id, ...over }) as GraphNode;
  const edge = (from: string, to: string, type: string): GraphEdge => ({ from, to, type, confidence: 'static' }) as GraphEdge;
  const nodes = [
    node('entry:orders:http:GET:/orders/:param', { type: 'entry', kind: 'http', label: 'GET /orders/:param', repo: 'orders', meta: { path: '/orders/:param' } }),
    node('orders#c.ts:OrdersController.findOne', { label: 'OrdersController.findOne', repo: 'orders' }),
    node('http_out:gateway#a.ts:1:1', { type: 'http_out', repo: 'gateway' }),
    node('entry:orders:http:GET:/health', { type: 'entry', kind: 'http', label: 'GET /health', repo: 'orders', meta: { path: '/health' } }),
    node('channel:order.created', { type: 'channel', label: 'order.created' }),
    node('producer:orders#s.ts:9:1', { type: 'producer', repo: 'orders' }),
    node('consumer:billing#c.ts:1', { type: 'consumer', repo: 'billing' }),
  ];
  const edges = [
    edge('http_out:gateway#a.ts:1:1', 'entry:orders:http:GET:/orders/:param', 'http_calls'),
    edge('entry:orders:http:GET:/orders/:param', 'orders#c.ts:OrdersController.findOne', 'handles'),
    edge('producer:orders#s.ts:9:1', 'channel:order.created', 'emits'),
    edge('channel:order.created', 'consumer:billing#c.ts:1', 'consumes'),
  ];
  const index = namesOf({ nodes, edges }, { gateway: '/p/gateway', orders: '/p/orders', billing: '/p/billing' });

  it('keeps a route another service calls, its handler and a channel two services share, and no route nothing outside calls', () => {
    expect(index.names.map((name) => `${name.kind} ${name.text}`)).toEqual(['route /orders/:param', 'handler OrdersController.findOne', 'channel order.created']);
    expect(index.names.find((name) => name.kind === 'route')?.across).toEqual({ gateway: 1 });
  });

  it('tells a search in the serving repository who calls it from elsewhere, and says nothing to the caller’s own', () => {
    const grep = (pattern: string, cwd: string) => contextFor({ tool_name: 'Grep', tool_input: { pattern }, cwd }, index);
    expect(grep('/orders/', '/p/orders/src')).toContain('`GET /orders/:param`, in orders: callers in gateway (1). who_calls({symbol: "entry:orders:http:GET:/orders/:param"}) lists them');
    expect(grep('OrdersController\\.findOne\\(', '/p/orders')).toContain('`OrdersController.findOne`, in orders');
    expect(grep('order.created', '/p/billing')).toContain('publishers and handlers in orders (1)');
    expect(grep('/orders/', '/p/gateway')).toBeUndefined();
    expect(grep('TODO', '/p/orders')).toBeUndefined();
    expect(grep('/orders/', '/elsewhere')).toBeUndefined();
    // In a terminal (P392), the command that prints the same answer.
    const terminal = contextFor({ tool_name: 'Grep', tool_input: { pattern: '/orders/' }, cwd: '/p/orders/src' }, index, 'linux', true);
    expect(terminal).toContain('`flowatlas impact "entry:orders:http:GET:/orders/:param" --format json` lists them');
    expect(terminal).not.toContain('who_calls');
    expect(contextFor({ tool_name: 'Grep', tool_input: { pattern: 'order.created' }, cwd: '/p/billing' }, index, 'linux', true)).toContain('`flowatlas channel "order.created" --format json` lists them');
  });

  it('finds the service on Windows terms: a drive, either slash, either case, the index as configured', () => {
    const grep = (cwd: string, services: Record<string, string>) =>
      contextFor({ tool_name: 'Grep', tool_input: { pattern: '/orders/' }, cwd }, { ...index, services }, 'win32');
    // The index's directories as written, the working directory as resolved: what failed on a Windows runner.
    expect(grep('/p/orders/src', index.services)).toContain('callers in gateway (1)');
    expect(grep('c:/p/Orders/src', { gateway: 'C:\\p\\gateway', orders: 'C:\\p\\orders' })).toContain('callers in gateway (1)');
    expect(grep('C:\\p\\orders-old', { gateway: 'C:\\p\\gateway', orders: 'C:\\p\\orders' })).toBeUndefined();
  });

  it('finds the service when the index and the shell name one directory two ways', async () => {
    // A link stands in for a second name of one directory: macOS's temporary directory, a Windows short name.
    const real = join(scratch, 'real');
    mkdirSync(join(real, 'orders'), { recursive: true });
    mkdirSync(join(real, 'gateway'), { recursive: true });
    const named = join(scratch, 'named');
    symlinkSync(real, named, 'junction');
    const path = join(scratch, 'names-linked.json');
    writeFileSync(path, JSON.stringify({ ...index, services: { gateway: join(named, 'gateway'), orders: join(named, 'orders') } }));
    const out: string[] = [];
    await runSearchHook(['--names', path], {
      stdin: async () => JSON.stringify({ tool_name: 'Grep', tool_input: { pattern: '/orders/' }, cwd: realpathSync.native(join(real, 'orders')) }),
      write: (text) => void out.push(text),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('callers in gateway (1)');
  });

  it('writes what Claude Code reads after a tool call', () => {
    expect(JSON.parse(hookOutput('x'))).toEqual({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'x' } });
  });

  it('is silent, and exits normally, on anything it cannot read', async () => {
    const out: string[] = [];
    await runSearchHook(['--names', join(scratch, 'none.json')], { stdin: async () => '{"tool_name":"Grep"}', write: (text) => void out.push(text) });
    await runSearchHook([], { stdin: async () => 'not json', write: (text) => void out.push(text) });
    expect(out).toEqual([]);
    const path = join(scratch, 'names.json');
    writeFileSync(path, JSON.stringify(index satisfies NamesIndex));
    await runSearchHook(['--names', path], {
      stdin: async () => JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rg -n "/orders/" src | head' }, cwd: '/p/orders' }),
      write: (text) => void out.push(text),
    });
    expect(out).toHaveLength(1);
    expect(index.namesFormatVersion).toBe(NAMES_FORMAT_VERSION);
  });
});

describe('reading a search’s pattern', () => {
  it('takes Grep’s pattern, and the first argument of grep, rg, ag or git grep past their flags', () => {
    expect(patternsOf({ tool_name: 'Grep', tool_input: { pattern: 'a.b' } })).toEqual(['a.b']);
    expect(patternsOf({ tool_name: 'Bash', tool_input: { command: "rg -n --glob '*.ts' 'order\\.created' src" } })).toEqual(['order\\.created']);
    expect(patternsOf({ tool_name: 'Bash', tool_input: { command: 'git grep -e cancelOrder -- .' } })).toEqual(['cancelOrder']);
    expect(patternsOf({ tool_name: 'Bash', tool_input: { command: 'cat x | grep -i "POST /orders"' } })).toEqual(['POST /orders']);
    expect(patternsOf({ tool_name: 'Bash', tool_input: { command: 'ls -la' } })).toEqual([]);
    expect(patternsOf({ tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } })).toEqual([]);
    expect(shellWords(`a 'b c' "d\\"e" f\\ g`)).toEqual(['a', 'b c', 'd"e', 'f g']);
  });

  it('reduces a regular expression to the longest run it matches literally', () => {
    expect(longestLiteral('OrdersService\\.create\\(')).toBe('OrdersService.create(');
    expect(longestLiteral('/orders/[0-9]+')).toBe('/orders/');
    expect(longestLiteral('(get|post)\\s+/invoices')).toBe('/invoices');
    // A dot in a name is searched for unescaped; `.*` is not a dot.
    expect(longestLiteral('order.created')).toBe('order.created');
    expect(longestLiteral('OrdersService.*cancel')).toBe('OrdersService');
  });
});
