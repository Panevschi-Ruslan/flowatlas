import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { DocumentError } from '../document/declared.js';
import { documentReader } from '../document/readers.js';
import { resolveProcedureCall, unservedContracts } from '../procedure-link.js';
import { readProtobufDocument } from './read.js';

const SHOP = `
package shop;
service CartService {
  rpc GetCart (GetCartRequest) returns (Cart);
  rpc Watch (WatchRequest) returns (stream CartEvent);
}
service ShippingService { rpc GetQuote (QuoteRequest) returns (Quote); }
`;

describe('a service declared by a .proto file (P274)', () => {
  it('is a kind of document', () => {
    expect(documentReader('protobuf')).toBe(readProtobufDocument);
  });

  it('declares each method of the services named as an rpc way in, keyed as a server is', () => {
    const { graph, declared } = readProtobufDocument(SHOP, { service: 'cart', documentPath: 'proto/shop.proto', services: ['shop.CartService'], generatedAt: 'now' });
    expect(declared).toBe(2);
    const entries = graph.nodes.filter((node) => node.type === 'entry');
    expect(entries.map((entry) => [entry.id, entry.meta?.['call'], entry.meta?.['declaredBy'], entry.line])).toEqual([
      ['entry:cart:rpc:grpc:shop.CartService/GetCart', 'unary', 'proto/shop.proto', 4],
      ['entry:cart:rpc:grpc:shop.CartService/Watch', 'server-stream', 'proto/shop.proto', 5],
    ]);
    expect(graph.edges.every((edge) => edge.type === 'handles' && edge.confidence === 'declared')).toBe(true);
  });

  it('declares every service of the file where none is named, and refuses one the file does not declare', () => {
    expect(readProtobufDocument(SHOP, { service: 'all', documentPath: 'shop.proto' }).declared).toBe(3);
    expect(() => readProtobufDocument(SHOP, { service: 'x', documentPath: 'shop.proto', services: ['shop.Billing'] })).toThrow(DocumentError);
    expect(() => readProtobufDocument('message Only {}', { service: 'x', documentPath: 'm.proto' })).toThrow(DocumentError);
  });
});

describe('the messages of a service declared by a .proto file (P287)', () => {
  it('carries each method\'s messages as its input and output, read through the files the contract imports', () => {
    const contract = `
      syntax = "proto3";
      package shop;
      import "common/money.proto";
      service PaymentService { rpc Charge (ChargeRequest) returns (ChargeReply); }
      message ChargeRequest { shop.common.Money amount = 1; string card_number = 2; }
      message ChargeReply { string transaction_id = 1; }
    `;
    const beside: Record<string, string> = { 'common/money.proto': 'syntax = "proto3"; package shop.common; message Money { string currency_code = 1; int64 units = 2; }' };
    const { graph } = readProtobufDocument(contract, { service: 'payment', documentPath: 'pb/shop.proto', readBeside: (path) => beside[path], generatedAt: 'now' });
    const [entry] = graph.nodes.filter((node) => node.type === 'entry');
    expect(entry?.meta?.['signature']).toEqual({ params: [{ name: 'request', type: 'type:payment#.shop.ChargeRequest' }], returns: 'type:payment#.shop.ChargeReply' });
    expect(graph.types['type:payment#.shop.ChargeRequest']?.fields?.map((field) => [field.name, field.type, field.optional])).toEqual([
      ['amount', 'type:payment#.shop.common.Money', true],
      ['cardNumber', 'string', false],
    ]);
    expect(graph.types['type:payment#.shop.common.Money']).toMatchObject({ declaredIn: 'payment#common/money.proto' });
  });
});

describe('a gRPC call sent where nothing here can read (P274)', () => {
  const entry = (repo: string): GraphNode => ({ id: `entry:${repo}`, type: 'entry', label: 'x', repo, kind: 'rpc', meta: { key: 'grpc:shop.CartService/GetCart', call: 'unary' } });
  const call: GraphNode = { id: 'c', type: 'http_out', label: 'c', repo: 'web', kind: 'rpc', meta: { procedure: 'grpc:shop.CartService/GetCart', call: 'unary' } };
  const index = (declaring: Record<string, GraphNode>) => ({
    proceduresOf: (service: string) => new Map(declaring[service] === undefined ? [] : [['grpc:shop.CartService/GetCart', declaring[service] as GraphNode]]),
    targetsOf: () => [],
    services: () => Object.keys(declaring),
  });

  it('reaches the one configured service implementing its full name, as sure as a guess', () => {
    expect(resolveProcedureCall(call, index({ cart: entry('cart') }))).toMatchObject({ kind: 'linked', via: 'grpc-contract', targetService: 'cart', confidence: 'heuristic' });
  });

  it('is ambiguous between two, and a procedure of another family is never joined so', () => {
    expect(resolveProcedureCall(call, index({ cart: entry('cart'), legacy: entry('legacy') }))).toMatchObject({ kind: 'ambiguous', candidates: ['cart', 'legacy'] });
    const trpc: GraphNode = { ...call, meta: { procedure: 'orders.list' } };
    const other = { ...index({}), proceduresOf: (service: string) => new Map(service === 'orders' ? [['orders.list', entry('orders')]] : []), services: () => ['orders'] };
    expect(resolveProcedureCall(trpc, other).kind).toBe('noProcedure');
  });
});

describe('gRPC methods nothing configured implements (P274)', () => {
  const call = (id: string, method: string, service = 'shop.ShippingService'): GraphNode => ({
    id,
    type: 'http_out',
    label: id,
    repo: 'storefront',
    file: 'src/clients.ts',
    line: 3,
    kind: 'rpc',
    meta: { procedure: `grpc:${service}/${method}`, service, method, contract: '../proto/shop.proto' },
  });

  it('is one row per caller and service, naming the methods and the file', () => {
    const served = new Map([['cart', new Map([['grpc:shop.CartService/GetCart', {} as GraphNode]])]]);
    const rows = unservedContracts(
      [call('a', 'GetQuote'), call('b', 'Track'), call('c', 'GetQuote'), call('d', 'GetCart', 'shop.CartService')],
      { services: () => ['cart'], proceduresOf: (service) => served.get(service) ?? new Map() },
    );
    expect(rows).toMatchObject([
      {
        reason: 'grpc-method-unserved',
        service: 'storefront',
        sites: 3,
        message: 'storefront calls shop.ShippingService (GetQuote, Track), which ../proto/shop.proto declares and no configured service implements',
      },
    ]);
  });
});
