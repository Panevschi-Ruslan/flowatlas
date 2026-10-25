import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CLI = join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js');
const CONFIG = join(ROOT, 'fixtures', 'multi-repo', 'flowatlas.config.json');

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** The tools `flowatlas mcp` lists with these arguments, by name. */
const listed = async (args: readonly string[]): Promise<string[]> => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp', ...args] });
  const client = new Client({ name: 'tools-test', version: '0' });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
};

describe('flowatlas mcp and the tools it lists (P201)', () => {
  it('lists those the project can answer, and every one with --all-tools', async () => {
    const auto = await listed(['--config', CONFIG]);
    // The multi-repo graph has no observed file, no rules and no diff; the command hands the pattern tester in.
    expect(auto).toContain('test_pattern');
    expect(auto).not.toContain('hot_paths');
    expect(auto).not.toContain('check_rules');
    expect(auto).toHaveLength(19);
    const all = await listed(['--config', CONFIG, '--all-tools']);
    expect(all).toHaveLength(26);
    expect(all).toEqual(expect.arrayContaining(['hot_paths', 'check_rules', 'what_changed']));
  }, 60000);

  it('refuses to start on a configuration naming a tool there is none of, and says which', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-tools-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'shop'));
    const config = join(dir, 'flowatlas.config.json');
    writeFileSync(config, JSON.stringify({ services: [{ name: 'shop', repo: './shop' }], mcp: { exclude: ['never_seem'] } }));
    const run = spawnSync(process.execPath, [CLI, 'mcp', '--config', config], { encoding: 'utf8', input: '' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('mcp.exclude.0: no tool is named "never_seem"; did you mean never_seen?');
    expect(run.stderr).toContain('The tools are: start_here, ');
  });
});
