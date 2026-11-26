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

/** A service of the files given, beside a package manifest and a compiler configuration. */
const read = (files: Record<string, string>): Promise<RepoGraph> => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-nest-followed-')));
  roots.push(root);
  const all: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'worker', dependencies: { '@nestjs/common': '^11', '@nestjs/config': '^4' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { experimentalDecorators: true, strict: false }, include: ['src'] }),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return extractRepo({ rootDir: root, repo: 'worker', config: parseConfig({}) });
};

const rows = (graph: RepoGraph, reason: string): string[] =>
  graph.unresolved
    .filter((row) => row.reason === reason)
    .map((row) => row.symbol ?? '')
    .sort();

/** Where each parameter of `FulfilService`'s constructor is injected from. */
const injected = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'injects' && edge.from.includes('FulfilService'))
    .map((edge) => graph.nodes.find((node) => node.id === edge.to))
    .map((node) => `${node?.kind ?? '?'} ${node?.label ?? '?'} ${node?.file ?? ''}`)
    .sort();

describe('an alias the provider index finds is followed to what it names (P261)', () => {
  it('is the class or the provider the alias names, and says an alias of a token nothing provides', async () => {
    const graph = await read({
      'src/clients.module.ts': `
import { Injectable, Module } from '@nestjs/common';
export const LEDGER = 'LEDGER';
export const LEDGER_ALIAS = 'LEDGER_ALIAS';
export const ORDERS = 'ORDERS';
export const MISSING = 'MISSING';
@Injectable()
export class AuditClient {}
@Module({})
export class ClientsModule {
  static forRoot() {
    return {
      module: ClientsModule,
      providers: [
        AuditClient,
        { provide: LEDGER, useFactory: () => ({ url: 'http://ledger' }) },
        { provide: LEDGER_ALIAS, useExisting: LEDGER },
        { provide: ORDERS, useExisting: AuditClient },
        { provide: 'BROKEN', useExisting: MISSING },
      ],
    };
  }
}
`,
      'src/app.module.ts': `
import { Module } from '@nestjs/common';
import { ClientsModule } from './clients.module';
import { FulfilService } from './fulfil.service';
@Module({ imports: [ClientsModule.forRoot()], providers: [FulfilService] })
export class AppModule {}
`,
      'src/fulfil.service.ts': `
import { Inject, Injectable } from '@nestjs/common';
import { LEDGER_ALIAS, ORDERS } from './clients.module';
@Injectable()
export class FulfilService {
  constructor(@Inject(LEDGER_ALIAS) private readonly ledger: { url: string }, @Inject(ORDERS) private readonly orders: unknown, @Inject('BROKEN') private readonly broken: unknown) {}
}
`,
    });
    expect(injected(graph)).toEqual(['factory LEDGER src/clients.module.ts', 'injectable AuditClient src/clients.module.ts']);
    const broken = graph.unresolved.find((row) => row.reason === 'di-token-unknown');
    expect(broken?.symbol).toBe('FulfilService.constructor[2]');
    expect(broken?.hint).toContain('BROKEN is provided as MISSING (useExisting)');
  });
});

const SETTINGS = {
  'src/app.config.ts': "import { registerAs } from '@nestjs/config';\nexport default registerAs('app', () => ({ port: 3000 }));\n",
  'src/mail.config.ts': "import { registerAs } from '@nestjs/config';\nexport const mailConfig = registerAs('mail', () => ({ from: 'shop' }));\n",
  'src/unused.config.ts': "import { registerAs } from '@nestjs/config';\nexport const unusedConfig = registerAs('unused', () => ({}));\n",
  'src/fulfil.service.ts': `
import { Inject, Injectable } from '@nestjs/common';
import { getConfigToken } from '@nestjs/config';
import appConfig from './app.config';
import { mailConfig } from './mail.config';
import { unusedConfig } from './unused.config';
@Injectable()
export class FulfilService {
  constructor(
    @Inject(appConfig.KEY) private readonly app: unknown,
    @Inject(getConfigToken('mail')) private readonly mail: unknown,
    @Inject(unusedConfig.KEY) private readonly unused: unknown,
    @Inject(mailConfig.KEY) private readonly again: unknown,
  ) {}
}
`,
};

describe('a token a settings library builds (P261)', () => {
  it('is provided by the factory the application loads, by forRoot and by forFeature', async () => {
    const graph = await read({
      ...SETTINGS,
      'src/app.module.ts': `
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import { mailConfig } from './mail.config';
import { FulfilService } from './fulfil.service';
const loaded = [appConfig];
@Module({ imports: [ConfigModule.forRoot({ load: [...loaded] }), ConfigModule.forFeature(mailConfig)], providers: [FulfilService] })
export class AppModule {}
`,
    });
    expect(injected(graph)).toEqual([
      'factory appConfig.KEY src/app.config.ts',
      "factory getConfigToken('mail') src/mail.config.ts",
      'factory mailConfig.KEY src/mail.config.ts',
    ]);
    expect(rows(graph, 'di-token-unknown')).toEqual(['FulfilService.constructor[2]']);
  });

  it('is not provided where the application loads no factory', async () => {
    const graph = await read({
      ...SETTINGS,
      'src/app.module.ts': "import { Module } from '@nestjs/common';\nimport { FulfilService } from './fulfil.service';\n@Module({ providers: [FulfilService] })\nexport class AppModule {}\n",
    });
    expect(rows(graph, 'di-token-unknown')).toHaveLength(4);
  });
});

describe('a module import chosen in this repository is followed (P261)', () => {
  it('follows a literal condition, a const, a function of the repository and a spread, and says what is read at run time', async () => {
    const graph = await read({
      'src/modules.ts': `
import { Module } from '@nestjs/common';
@Module({})
export class MemoryModule {}
@Module({})
export class DatabaseModule {
  static forRoot(url: string) {
    return { module: DatabaseModule, providers: [] };
  }
}
@Module({})
export class MetricsModule {}
@Module({})
export class TracingModule {}
@Module({})
export class MailModule {}
export const IN_MEMORY = false;
export const STAGE = 'prod';
export const database = () => DatabaseModule.forRoot('postgres://shop');
`,
      'src/app.module.ts': `
import { Module } from '@nestjs/common';
import { database, DatabaseModule, IN_MEMORY, MailModule, MemoryModule, MetricsModule, STAGE, TracingModule } from './modules';
const storage = IN_MEMORY ? MemoryModule : database();
const observed = STAGE === 'prod' ? [MetricsModule, TracingModule] : [];
@Module({ imports: [storage, ...observed, ...(STAGE !== 'prod' ? [MemoryModule] : []), process.env.MAIL ? MailModule : MemoryModule] })
export class AppModule {}
`,
    });
    const imported = graph.edges
      .filter((edge) => edge.type === 'imports')
      .map((edge) => `${graph.nodes.find((node) => node.id === edge.to)?.label ?? '?'}${edge.meta?.['moduleKind'] === 'dynamic' ? ' (configured)' : ''}`)
      .sort();
    expect(imported).toEqual(['DatabaseModule (configured)', 'MetricsModule', 'TracingModule']);
    expect(rows(graph, 'module-import-dynamic')).toEqual(['AppModule imports process.env.MAIL ? MailModule : MemoryModule']);
  });
});

describe('a module of a package that is not installed (P264)', () => {
  it('is the class its import names, of the package it names, said as not installed rather than computed', async () => {
    const graph = await read({
      'src/app.module.ts': `
import { Module } from '@nestjs/common';
import * as queues from '@nestjs/bullmq';
import { ClientsModule as Clients, Transport } from '@nestjs/microservices';
import { ShopModule } from '@shop/kit';
import { ReportsModule } from './reports.module';
@Module({ imports: [Clients.register([{ name: 'EVENTS', transport: Transport.TCP }]), queues.BullModule.forRoot({}), queues.BullModule.registerQueue({ name: 'mail' }), ShopModule, ReportsModule.forReports('daily'), process.env.MAIL ? ShopModule : Clients] })
export class AppModule {}
`,
      'src/reports.module.ts': `
import { Module } from '@nestjs/common';
@Module({})
export class ReportsModule {
  static forReports(kind: string) {
    return { module: ReportsModule, providers: [{ provide: 'REPORT_KIND', useValue: kind }] };
  }
}
`,
    });
    const imported = graph.edges
      .filter((edge) => edge.type === 'imports')
      .map((edge) => graph.nodes.find((node) => node.id === edge.to))
      .map((node) => `${node?.label ?? '?'} ${String(node?.meta?.['package'] ?? '')}`.trim())
      .sort();
    // A configuring method of any name configures its module, here and in a package.
    expect(imported).toEqual(['BullModule @nestjs/bullmq', 'ClientsModule @nestjs/microservices', 'ReportsModule', 'ShopModule @shop/kit']);
    const reports = graph.edges.find((edge) => edge.type === 'imports' && graph.nodes.find((node) => node.id === edge.to)?.label === 'ReportsModule');
    expect(reports?.meta?.['moduleKind']).toBe('dynamic');
    // Known by the import alone, which no compiler checked.
    const confidence = (label: string) => graph.edges.find((edge) => edge.type === 'imports' && graph.nodes.find((node) => node.id === edge.to)?.label === label)?.confidence;
    expect([confidence('BullModule'), confidence('ShopModule'), confidence('ClientsModule')]).toEqual(['heuristic', 'heuristic', 'static']);
    const notInstalled = graph.unresolved.filter((row) => row.reason === 'module-import-not-installed');
    // The microservices package is read from its built-in shape (P78), so only the two with none are said.
    expect(notInstalled.map((row) => [row.symbol, row.meta?.['package']])).toEqual([
      ['AppModule imports queues.BullModule', '@nestjs/bullmq'],
      ["AppModule imports queues.BullModule.registerQueue({ name: 'mail' })", '@nestjs/bullmq'],
      ['AppModule imports ShopModule', '@shop/kit'],
    ]);
    expect(rows(graph, 'module-import-dynamic')).toEqual(['AppModule imports process.env.MAIL ? ShopModule : Clients']);
  });
});
