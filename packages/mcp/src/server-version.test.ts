import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createFlowatlasServer } from './server.js';

/** What `initialize` answers as serverInfo.version (P86). */
const versionOf = async (options: Parameters<typeof createFlowatlasServer>[0]): Promise<string | undefined> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer(options);
  await server.connect(serverSide);
  const client = new Client({ name: 'version-test', version: '0' });
  await client.connect(clientSide);
  const version = client.getServerVersion()?.version;
  await client.close();
  return version;
};

describe('the version the server reports', () => {
  it('is the one it is given', async () => {
    // Every client saw 0.0.0 while `flowatlas mcp` passed none.
    expect(await versionOf({ dbPath: 'missing.db', version: '9.8.7' })).toBe('9.8.7');
  });

  it('is 0.0.0 only when nobody says', async () => {
    expect(await versionOf({ dbPath: 'missing.db' })).toBe('0.0.0');
  });

  it('is this package’s own manifest version from the standalone bin', async () => {
    const root = join(import.meta.dirname, '..');
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'bin', 'flowatlas-mcp.js'), '--db', join(root, 'missing.db')],
    });
    const client = new Client({ name: 'version-test', version: '0' });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.version).toBe(manifest.version);
    } finally {
      await client.close();
    }
  });
});
