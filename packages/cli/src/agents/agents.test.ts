import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_QUESTIONS, agentQuestionsLine, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { INSTRUCTIONS } from '@flowatlas/mcp';
import { afterAll, describe, expect, it } from 'vitest';
import { agentsStatus, installAgents, removeAgents, withSearchHook, withoutSearchHook } from '../commands/agents.js';
import { namesOf, NAMES_FORMAT_VERSION, type NamesIndex } from './names.js';
import { contextFor, hookOutput, longestLiteral, patternsOf, runSearchHook, shellWords } from './search-hook.js';
import { GUIDE_MAX_LINES, guideBody, ownedFile, ownedState, sharedBlock, withGuideBlock, withoutGuideBlock } from './template.js';

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

  it('writes a skill and a Cursor rule an assistant loads by description, with a mark that tells a hand edit apart', () => {
    const skill = ownedFile('claude-skill', GUIDE);
    expect(skill).toMatch(/^---\nname: flowatlas\ndescription: "Use for questions that cross this project's repositories/);
    expect(ownedFile('cursor-rule', GUIDE)).toMatch(/\nalwaysApply: false\n---\n/);
    expect(ownedState(skill)).toBe('ours');
    expect(ownedState(skill.replace('Narrow, then read', 'Read'))).toBe('edited');
    expect(ownedState('# my own skill\n')).toBe('foreign');
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

  it('keeps a guide edited by hand, refuses a file of that name that is not flowatlas’s, and says which', () => {
    const { config, dir } = project('edited');
    installAgents({ config, repo: 'web' });
    const skill = join(dir('web'), '.claude', 'skills', 'flowatlas', 'SKILL.md');
    writeFileSync(skill, readFileSync(skill, 'utf8').replace('Narrow, then read', 'Read'));
    const rule = join(dir('web'), '.cursor', 'rules', 'flowatlas.mdc');
    writeFileSync(rule, '# our own rule\n');
    expect(installAgents({ config, repo: 'web' }).changes.map((change) => change.state)).toEqual(['edited by hand', 'not flowatlas']);
    expect(agentsStatus({ config, repo: 'web' }).changes.map((change) => change.state)).toEqual(['edited by hand', 'not flowatlas']);
    expect(removeAgents({ config, repo: 'web' }).changes.map((change) => change.state)).toEqual(['kept']);
    expect(readFileSync(rule, 'utf8')).toBe('# our own rule\n');
  });

  it('with --hook merges the search hook beside a hook already there, and remove takes out only it', () => {
    const { config, dir } = project('hook');
    const settings = join(dir('web'), '.claude', 'settings.local.json');
    mkdirSync(join(dir('web'), '.claude'), { recursive: true });
    const theirs = { permissions: { allow: ['Bash(pnpm test)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }] } };
    writeFileSync(settings, `${JSON.stringify(theirs, null, 2)}\n`);
    installAgents({ config, repo: 'web', hook: true });
    const written = JSON.parse(readFileSync(settings, 'utf8'));
    expect(written.permissions).toEqual(theirs.permissions);
    expect(written.hooks.PostToolUse).toHaveLength(2);
    expect(written.hooks.PostToolUse[1]).toMatchObject({ matcher: 'Grep|Bash', hooks: [{ type: 'command', timeout: 5 }] });
    expect(written.hooks.PostToolUse[1].hooks[0].command).toMatch(/search-hook\.js" --names ".*names\.json"$/);
    installAgents({ config, repo: 'web', hook: true, shared: true });
    expect(JSON.parse(readFileSync(join(dir('web'), '.claude', 'settings.json'), 'utf8')).hooks.PostToolUse[0].hooks[0].command).toMatch(
      /^flowatlas agents search-hook --names "\.\.\/\.flowatlas\/names\.json"$/,
    );
    removeAgents({ config, repo: 'web' });
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual(theirs);
    expect(existsSync(join(dir('web'), '.claude', 'settings.json'))).toBe(false);
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
