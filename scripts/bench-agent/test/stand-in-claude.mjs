#!/usr/bin/env node
/**
 * A stand-in for `claude -p`, for the runner's test: no assistant, no account.
 *
 * It takes the arguments the adapter passes, starts the MCP server the
 * `--mcp-config` names exactly as Claude Code would - so a graph arm whose
 * server does not start is caught here - asks it `start_here`, and prints the
 * stream of events Claude Code prints. Its answer comes from
 * `STAND_IN_ANSWERS` (a JSON file of prompt -> answer); after
 * `STAND_IN_LIMIT_AFTER` sessions (counted in `STAND_IN_COUNT`) it answers
 * with a usage limit instead.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  process.stdout.write('0.0.0 (stand-in)\n');
  process.exit(0);
}
const flag = (name) => argv[argv.indexOf(name) + 1];
const prompt = flag('-p');
const config = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8'));
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

/** One MCP server, started from its configuration, asked to initialise and then one tool. */
const askServer = (server, tool) =>
  new Promise((done) => {
    const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      done({ status: 'failed' });
    }, 20000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end === -1) break;
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: {} } })}\n`);
        } else if (message.id === 2) {
          clearTimeout(timer);
          child.kill();
          done({ status: message.error === undefined ? 'connected' : 'failed' });
        }
      }
    });
    child.on('error', () => done({ status: 'failed' }));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stand-in', version: '0' } } })}\n`);
  });

const count = process.env['STAND_IN_COUNT'];
let seen = 0;
if (count !== undefined) {
  seen = existsSync(count) ? Number(readFileSync(count, 'utf8')) : 0;
  writeFileSync(count, String(seen + 1));
}
const limitAfter = process.env['STAND_IN_LIMIT_AFTER'];

const servers = [];
const tools = [];
for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
  const answer = await askServer(server, 'start_here');
  servers.push({ name, status: answer.status });
  tools.push({ type: 'tool_use', name: `mcp__${name}__start_here`, input: {} });
}
say({ type: 'system', subtype: 'init', model: 'stand-in-model', mcp_servers: servers });
say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Grep', input: {} }, ...tools], usage: { input_tokens: 10, output_tokens: 5 } } });
if (limitAfter !== undefined && seen >= Number(limitAfter)) {
  say({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude usage limit reached. Your limit will reset at 5pm.', num_turns: 1, duration_ms: 5, usage: { input_tokens: 10, output_tokens: 0 } });
  process.exit(1);
}
const answers = JSON.parse(readFileSync(process.env['STAND_IN_ANSWERS'], 'utf8'));
say({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: answers[prompt] ?? 'I could not tell.',
  num_turns: 2,
  duration_ms: 40,
  total_cost_usd: 0.01,
  usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
});
