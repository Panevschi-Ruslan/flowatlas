import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../version.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CLI = join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js');

describe('flowatlas mcp', () => {
  it('answers initialize with the version of the command a user installed', async () => {
    // The server is compiled from a private package versioned on its own; what a
    // client should see is the command's version (P86 D3), never 0.0.0.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'mcp', '--config', join(ROOT, 'fixtures', 'multi-repo', 'flowatlas.config.json')],
    });
    const client = new Client({ name: 'version-test', version: '0' });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()).toMatchObject({ name: 'flowatlas', version: VERSION });
      expect(VERSION).not.toBe('0.0.0');
    } finally {
      await client.close();
    }
  });
});
