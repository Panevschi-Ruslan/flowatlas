import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { extractRepo } from '../extract-repo.js';

// In the system temporary directory on purpose, unlike the tests beside the
// fixtures: nothing is installed above it, which is the case the shapes are for.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-nest-shapes-')));

afterAll(() => rmSync(root, { recursive: true, force: true }));

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'shop',
    dependencies: { '@nestjs/common': '^11', '@nestjs/microservices': '^11', rxjs: '^7' },
  }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: { experimentalDecorators: true, strict: false },
    include: ['src'],
  }),
  'src/app.module.ts': `
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ShopService } from './shop.service';

@Module({
  imports: [ClientsModule.register([{ name: 'EVENTS_CLIENT', transport: Transport.TCP }])],
  providers: [ShopService],
})
export class AppModule {}
`,
  'src/shop.service.ts': `
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { Observable } from 'rxjs';

export interface Basket { id: string; total: number }

@Injectable()
export class ShopService {
  constructor(@Inject('EVENTS_CLIENT') private readonly events: ClientProxy) {}

  placed(basket: Basket): Observable<Basket> {
    return this.events.emit<Basket>('basket.placed', basket);
  }
}
`,
};

for (const [path, text] of Object.entries(FILES)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const read = (builtInShapes?: boolean) =>
  extractRepo({
    rootDir: root,
    repo: 'shop',
    config: parseConfig(builtInShapes === undefined ? {} : { builtInShapes }),
  });

const reasons = async (builtInShapes?: boolean) =>
  (await read(builtInShapes)).unresolved.map((row) => row.reason).sort();

describe('built-in shapes for a Nest service with nothing installed', () => {
  it('reports the client module and its token as unread without them', async () => {
    expect(await reasons(false)).toEqual(
      expect.arrayContaining(['di-token-unknown', 'module-import-dynamic']),
    );
  });

  it('resolves the registered client token and the stream it answers with', async () => {
    const rows = await reasons();
    expect(rows).not.toContain('module-import-dynamic');
    expect(rows).not.toContain('di-token-unknown');
    expect(rows).not.toContain('type-unresolved');
  });

  it('injects the token as the client class of its package', async () => {
    const graph = await read();
    const client = graph.nodes.find((node) => node.label === 'ClientProxy');
    expect(client?.meta?.['package']).toBe('@nestjs/microservices');
    const service = graph.nodes.find((node) => node.label === 'ShopService');
    expect(
      graph.edges.some((edge) => edge.from === service?.id && edge.to === client?.id && edge.type === 'injects'),
    ).toBe(true);
  });

  it('writes no shape file into the repository, and counts none as a source', async () => {
    const graph = await read();
    expect(graph.nodes.some((node) => node.file?.includes('node_modules/rxjs'))).toBe(false);
    const repoNode = graph.nodes.find((node) => node.type === 'repo');
    expect((repoNode?.meta?.['stats'] as { files?: number } | undefined)?.files).toBe(2);
  });
});
