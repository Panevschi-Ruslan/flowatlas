import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { Node, Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { readGrpcCalls } from './grpc-calls.js';
import { contractsOf } from './grpc-contracts.js';
import { grpcServerAdapter } from './grpc-services.js';

const SHOP = `
syntax = "proto3";
package shop;
service CartService {
  rpc GetCart (GetCartRequest) returns (Cart);
  rpc AddItem (AddItemRequest) returns (Empty);
}
service CatalogService {
  rpc ListProducts (Empty) returns (Products);
  rpc WatchPrices (Empty) returns (stream Price);
}
`;

interface Read {
  project: Project;
  ctx: ExtractContext;
}

/** A repository at `/svc`, the contract at `/proto/shop.proto`, nothing installed. */
const repository = (files: Record<string, string>, pkg: Record<string, string> = { '@grpc/grpc-js': '^1.0.0' }, contracts: Record<string, string> = { '/proto/shop.proto': SHOP }): Read => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, allowJs: true } });
  const fs = project.getFileSystem();
  fs.writeFileSync('/flowatlas.config.json', '{}');
  for (const [path, text] of Object.entries(contracts)) fs.writeFileSync(path, text);
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const ctx: ExtractContext = {
    repo: 'svc',
    repoDir: '/svc',
    service: { name: 'svc', repo: '/svc', type: 'grpc' },
    config: parseConfig({}),
    pkg: { dependencies: pkg },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'svc' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  return { project, ctx };
};

const servedBy = (files: Record<string, string>, pkg?: Record<string, string>): { entries: EntryNode[]; rows: Unresolved[] } => {
  const { ctx } = repository(files, pkg);
  return { entries: grpcServerAdapter.extractEntries(ctx), rows: ctx.builder.build().unresolved };
};

/** Every call in every function of the repository, read as the server pass reads them. */
const calledBy = (files: Record<string, string>, pkg?: Record<string, string>): { calls: GraphNode[]; rows: Unresolved[] } => {
  const { project, ctx } = repository(files, pkg);
  const rows: Unresolved[] = [];
  const holders = project
    .getSourceFiles()
    .flatMap((source) => [...source.getFunctions(), ...source.getClasses().flatMap((klass) => klass.getMethods())])
    .map((fn) => ({
      body: fn.getBody(),
      id: `fn:${Node.isMethodDeclaration(fn) ? fn.getName() : (fn.getName() ?? '?')}`,
      file: fn.getSourceFile().getFilePath().slice(1),
      ensure: () => undefined,
    }));
  readGrpcCalls(holders, {
    repo: 'svc',
    repoDir: '/svc',
    pkg: ctx.pkg,
    builder: ctx.builder,
    project,
    fileOf: (node) => node.getSourceFile().getFilePath().slice(1),
    addressOf: (url) => {
      const text = url.getText();
      const env = /process\.env\.([A-Z_]+)/.exec(text)?.[1];
      return { path: null, baseUrlEnv: env ?? null, host: null };
    },
    report: (row) => rows.push(row),
  });
  return { calls: ctx.builder.build().nodes.filter((node) => node.type === 'http_out'), rows };
};

describe('gRPC contracts (P274)', () => {
  it('finds every .proto file up to the top of the project, and a file a loader names by the end of its path', () => {
    const { project } = repository({});
    const contracts = contractsOf(project.getFileSystem(), '/svc');
    expect(contracts.all.map((contract) => contract.path)).toEqual(['/proto/shop.proto']);
    expect(contracts.file('shop.proto', '/svc/src')?.path).toBe('/proto/shop.proto');
    expect(contracts.file('../proto/shop.proto', '/svc')?.path).toBe('/proto/shop.proto');
    expect(contracts.pathOf(contracts.all[0]!)).toBe('../proto/shop.proto');
    expect(contracts.byShortName('CartService').map((each) => each.service.fullName)).toEqual(['shop.CartService']);
  });
});

describe('gRPC servers (P274)', () => {
  it('is turned on by the libraries, and not by a NestJS microservice over another transport', () => {
    expect(grpcServerAdapter.detect({ dependencies: { '@grpc/grpc-js': '1' } })).toBe(true);
    expect(grpcServerAdapter.detect({ dependencies: { grpc: '1' } })).toBe(true);
    expect(grpcServerAdapter.detect({ dependencies: { '@nestjs/microservices': '1' } })).toBe(false);
    expect(grpcServerAdapter.detect({ dependencies: { express: '4' } })).toBe(false);
  });

  it('reads a service of a loaded contract, each implemented method a way in with its handler and how it is called', () => {
    const { entries, rows } = servedBy({
      '/svc/index.js': `
        const grpc = require('@grpc/grpc-js');
        const loader = require('@grpc/proto-loader');
        const health = require('grpc-health-check');
        async function getCart(call, callback) { callback(null, {}); }
        const pkg = grpc.loadPackageDefinition(loader.loadSync('shop.proto'));
        const server = new grpc.Server();
        server.addService(health.service, new health.Implementation({}));
        server.addService(pkg.shop.CartService.service, { getCart, addItem: (call, cb) => cb(null, {}) });
      `,
    });
    expect(rows).toEqual([]);
    expect(entries.map((entry) => [entry.key, entry.meta?.['call'], entry.meta?.['handlerVia'], entry.meta?.['contract']])).toEqual([
      ['grpc:shop.CartService/GetCart', 'unary', 'function', '../proto/shop.proto'],
      ['grpc:shop.CartService/AddItem', 'unary', 'inline', '../proto/shop.proto'],
    ]);
    expect(entries[0]).toMatchObject({ kind: 'rpc', label: 'grpc shop.CartService/GetCart', handler: { functionName: 'getCart' } });
  });

  it('names a generated definition nobody committed by the contract, and reads an instance of a class', () => {
    const { entries } = servedBy({
      '/svc/src/server.ts': `
        import { Server } from '@grpc/grpc-js';
        import { CatalogServiceService } from './gen/shop_grpc_pb';
        class Catalog {
          listProducts(call, cb) { cb(null, {}); }
          watchPrices(call) { call.end(); }
          private helper() {}
        }
        new Server().addService(CatalogServiceService, new Catalog());
      `,
    });
    expect(entries.map((entry) => [entry.key, entry.meta?.['call'], entry.handler])).toEqual([
      ['grpc:shop.CatalogService/ListProducts', 'unary', expect.objectContaining({ className: 'Catalog', methodName: 'listProducts' })],
      ['grpc:shop.CatalogService/WatchPrices', 'server-stream', expect.objectContaining({ methodName: 'watchPrices' })],
    ]);
  });

  it('says a service it cannot name, one named by no contract, and an implementation it cannot read', () => {
    const { entries, rows } = servedBy({
      '/svc/src/server.ts': `
        import { Server, loadPackageDefinition } from '@grpc/grpc-js';
        import { loadSync } from '@grpc/proto-loader';
        import { LedgerServiceService } from './gen/ledger_grpc_pb';
        import { makeImpl } from './impl';
        const server = new Server();
        const loaded = loadPackageDefinition(loadSync('billing.proto')) as any;
        server.addService(LedgerServiceService, {});
        server.addService(loaded.billing.InvoiceService.service, { issueInvoice: () => undefined });
        server.addService(loaded.shop.CartService.service, makeImpl());
      `,
    });
    expect(rows.map((row) => [row.reason, row.meta?.['why'] ?? null])).toEqual([
      ['grpc-service-unread', 'service'],
      ['grpc-contract-unread', null],
      ['grpc-service-unread', 'implementation'],
    ]);
    expect(entries.map((entry) => [entry.key, entry.meta?.['handlerVia']])).toEqual([
      ['grpc:billing.InvoiceService/IssueInvoice', 'inline'],
      ['grpc:shop.CartService/GetCart', 'none'],
      ['grpc:shop.CartService/AddItem', 'none'],
    ]);
  });

  it('reads a NestJS controller by its decorators and the package its transport options name', () => {
    const { entries, rows } = servedBy(
      {
        '/svc/src/main.ts': `
          import { Transport } from '@nestjs/microservices';
          export const options = { transport: Transport.GRPC, options: { package: 'shop', protoPath: 'proto/shop.proto' } };
        `,
        '/svc/src/cart.controller.ts': `
          import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
          export class CartController {
            @GrpcMethod('CartService', 'GetCart') one(request) { return {}; }
            @GrpcMethod('CartService') addItem() { return {}; }
            @GrpcStreamMethod('CatalogService', 'WatchPrices') prices(stream) { return stream; }
            @GrpcMethod(process.env.NAME) dynamic() { return {}; }
          }
        `,
      },
      { '@nestjs/microservices': '^12.0.0', '@grpc/grpc-js': '^1.0.0' },
    );
    expect(entries.map((entry) => [entry.key, entry.meta?.['call'], (entry.handler as { methodName?: string }).methodName])).toEqual([
      ['grpc:shop.CartService/GetCart', 'unary', 'one'],
      ['grpc:shop.CartService/AddItem', 'unary', 'addItem'],
      ['grpc:shop.CatalogService/WatchPrices', 'server-stream', 'prices'],
    ]);
    expect(rows.map((row) => row.reason)).toEqual(['grpc-service-unread']);
  });
});

describe('gRPC calls (P274)', () => {
  it('reads calls through a generated client, a promisified method and a loaded contract, with where each is sent', () => {
    const { calls, rows } = calledBy({
      '/svc/src/gen/cart.ts': `
        import { makeGenericClientConstructor } from '@grpc/grpc-js';
        export const CartServiceService = { getCart: { path: '/shop.CartService/GetCart' }, addItem: { path: '/shop.CartService/AddItem' } };
        export interface CartServiceClient { getCart(r, cb): void; addItem(r, cb): void }
        export const CartServiceClient = makeGenericClientConstructor(CartServiceService, 'shop.CartService') as unknown as { new (a: string, c: unknown): CartServiceClient };
      `,
      '/svc/src/clients.ts': `
        import { promisify } from 'node:util';
        import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
        import { loadSync } from '@grpc/proto-loader';
        import { CartServiceClient } from './gen/cart';
        import { CatalogServiceClient } from './gen/shop_grpc_pb';
        const cart = new CartServiceClient(process.env.CART_ADDR, credentials.createInsecure());
        const addAsync = promisify(cart.addItem).bind(cart);
        const shop = loadPackageDefinition(loadSync('../proto/shop.proto')) as any;
        const catalog = new shop.shop.CatalogService('catalog:50051', credentials.createInsecure());
        const generated = new CatalogServiceClient(process.env.CATALOG_ADDR, credentials.createInsecure());
        export function getCart(userId) { cart.getCart({ userId }, () => undefined); cart.close(); }
        export async function add(userId) { await addAsync({ userId }); }
        export function prices() { return catalog.watchPrices({}); }
        export function list() { generated.listProducts({}, () => undefined); generated.notAMethod(); }
      `,
    });
    expect(rows).toEqual([]);
    expect(calls.map((call) => [call.meta?.['procedure'], call.meta?.['call'] ?? null, call.meta?.['link']])).toEqual([
      ['grpc:shop.CartService/GetCart', 'unary', { protocol: 'grpc', baseUrlEnv: 'CART_ADDR' }],
      ['grpc:shop.CartService/AddItem', 'unary', { protocol: 'grpc', baseUrlEnv: 'CART_ADDR' }],
      ['grpc:shop.CatalogService/WatchPrices', 'server-stream', { protocol: 'grpc', host: 'catalog:50051' }],
      ['grpc:shop.CatalogService/ListProducts', 'unary', { protocol: 'grpc', baseUrlEnv: 'CATALOG_ADDR' }],
    ]);
    expect(calls[0]).toMatchObject({ kind: 'rpc', label: 'grpc shop.CartService/GetCart', meta: { contract: '../proto/shop.proto', operation: 'getCart' } });
  });

  it('reads a NestJS client kept from getService, its address from the transport options', () => {
    const { calls } = calledBy(
      {
        '/svc/src/app.module.ts': `
          import { Transport } from '@nestjs/microservices';
          export const clients = [{ name: 'SHOP', transport: Transport.GRPC, options: { package: 'shop', url: process.env.SHOP_GRPC_URL } }];
        `,
        '/svc/src/cart.client.ts': `
          export class CartClient {
            private cart: any;
            constructor(private readonly client: any) {}
            onModuleInit() { this.cart = this.client.getService('CartService'); }
            find(userId) { return this.cart.getCart({ userId }); }
          }
        `,
      },
      { '@nestjs/microservices': '^12.0.0', '@grpc/grpc-js': '^1.0.0' },
    );
    expect(calls.map((call) => [call.meta?.['procedure'], call.meta?.['link']])).toEqual([['grpc:shop.CartService/GetCart', { protocol: 'grpc', baseUrlEnv: 'SHOP_GRPC_URL' }]]);
  });

  it('reads a client a package injects by the generated interface it is typed with, with no address', () => {
    const { calls } = calledBy({
      '/svc/src/gen/cart.ts': 'export interface CartServiceClient { getCart(request: object): unknown; }',
      '/svc/src/rpc.ts': `
        import type { CartServiceClient } from './gen/cart';
        declare function Service(name: string): PropertyDecorator;
        export class CartRpc {
          @Service('CartService') public svc: CartServiceClient;
        }
      `,
      '/svc/src/handler.ts': `
        import { CartRpc } from './rpc';
        export class Handler {
          constructor(private readonly cart: CartRpc) {}
          run() { return this.cart.svc.getCart({}); }
        }
      `,
    });
    expect(calls.map((call) => [call.meta?.['procedure'], call.meta?.['link'] ?? null])).toEqual([['grpc:shop.CartService/GetCart', null]]);
  });

  it('says a generated client of a service no contract declares, and draws nothing through it', () => {
    const { calls, rows } = calledBy({
      '/svc/src/ledger.ts': `
        import { LedgerServiceClient } from './gen/ledger_grpc_pb';
        const ledger = new LedgerServiceClient(process.env.LEDGER_ADDR, undefined);
        export function record() { ledger.append({}, () => undefined); }
      `,
    });
    expect(calls).toEqual([]);
    expect(rows.map((row) => [row.reason, row.message])).toEqual([
      ['grpc-service-unread', expect.stringContaining('no .proto file of the repository declares a service LedgerService')],
    ]);
  });
});
