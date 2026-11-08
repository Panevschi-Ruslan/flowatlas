import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type RepoGraph } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { extractRepo } from '../extract-repo.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A service whose module imports a configured module of its own, written as `module` says. */
const read = (module: string): Promise<RepoGraph> => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-nest-configured-')));
  roots.push(root);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'worker', dependencies: { '@nestjs/common': '^11' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { experimentalDecorators: true, strict: false }, include: ['src'] }),
    'src/clients.module.ts': `
import { Module } from '@nestjs/common';
export const ORDERS = 'ORDERS';
export const AUDIT = 'AUDIT';
@Module({})
export class ClientsModule {
  static forRoot(url: string) {
    return { module: ClientsModule, providers: [{ provide: ORDERS, useFactory: () => ({ url }) }], exports: [ORDERS] };
  }
  static forRootAsync(options: { useFactory: () => string }) {
    return { module: ClientsModule, providers: [{ provide: AUDIT, useFactory: options.useFactory }], exports: [AUDIT] };
  }
}
`,
    'src/app.module.ts': `
import { Module } from '@nestjs/common';
import { ClientsModule } from './clients.module';
import { FulfilService } from './fulfil.service';
${module}
`,
    'src/fulfil.service.ts': `
import { Inject, Injectable } from '@nestjs/common';
import { AUDIT, ORDERS } from './clients.module';
@Injectable()
export class FulfilService {
  constructor(@Inject(ORDERS) private readonly orders: { url: string }, @Inject(AUDIT) private readonly audit: string) {}
}
`,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return extractRepo({ rootDir: root, repo: 'worker', config: parseConfig({}) });
};

const unknownTokens = (graph: RepoGraph): string[] =>
  graph.unresolved
    .filter((row) => row.reason === 'di-token-unknown')
    .map((row) => row.symbol ?? '')
    .sort();

describe('a token a configuring method provides (P259)', () => {
  it('is provided where the application calls the method, and a provider node where it is written', async () => {
    const graph = await read("@Module({ imports: [ClientsModule.forRoot('http://orders')], providers: [FulfilService] })\nexport class AppModule {}");
    expect(unknownTokens(graph)).toEqual(['FulfilService.constructor[1]']);
    const provider = graph.nodes.find((node) => node.type === 'provider' && node.label === 'ORDERS');
    expect(provider).toEqual(expect.objectContaining({ file: 'src/clients.module.ts', kind: 'factory' }));
    expect(graph.edges.some((edge) => edge.type === 'injects' && edge.to === provider?.id)).toBe(true);
  });

  it('is provided by each method the application calls, wherever the call is written', async () => {
    const graph = await read(
      "const audit = ClientsModule.forRootAsync({ useFactory: () => 'audit' });\n@Module({ imports: [ClientsModule.forRoot('http://orders'), audit], providers: [FulfilService] })\nexport class AppModule {}",
    );
    expect(unknownTokens(graph)).toEqual([]);
  });
});
