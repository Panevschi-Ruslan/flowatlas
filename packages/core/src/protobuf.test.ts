import { describe, expect, it } from 'vitest';
import { grpcCallKind, grpcEntryKey, parseProto, sameMethodName } from './protobuf.js';

const SHOP = `
// The shop's contract.
syntax = "proto3";

package shop.v1;

import "google/protobuf/empty.proto";
import public "common.proto";

option go_package = "example/shop";

/* A cart
   per user. */
service CartService {
  option (shop.owner) = { team: "carts" };
  rpc AddItem (AddItemRequest) returns (google.protobuf.Empty) {}
  rpc GetCart(GetCartRequest) returns (Cart);
  rpc Watch (WatchRequest) returns (stream CartEvent) {
    option deprecated = true;
  }
  rpc Upload (stream Chunk) returns (UploadReply);
  rpc Chat (stream Line) returns (stream Line);
}

message Cart {
  message Item { string id = 1; }
  repeated Item items = 1;
  map<string, int32> counts = 2;
}

enum State { STATE_UNSPECIFIED = 0; }

service Empty {}
`;

describe('parseProto (P274)', () => {
  it('reads the package, the imports, each service and each method with its streams and line', () => {
    const file = parseProto(SHOP);
    expect(file.package).toBe('shop.v1');
    expect(file.imports).toEqual(['google/protobuf/empty.proto', 'common.proto']);
    expect(file.services.map((service) => service.fullName)).toEqual(['shop.v1.CartService', 'shop.v1.Empty']);
    const [cart] = file.services;
    expect(cart?.line).toBe(14);
    expect(cart?.methods.map((method) => [method.name, method.request, method.response, grpcCallKind(method), method.line])).toEqual([
      ['AddItem', 'AddItemRequest', 'google.protobuf.Empty', 'unary', 16],
      ['GetCart', 'GetCartRequest', 'Cart', 'unary', 17],
      ['Watch', 'WatchRequest', 'CartEvent', 'server-stream', 18],
      ['Upload', 'Chunk', 'UploadReply', 'client-stream', 21],
      ['Chat', 'Line', 'Line', 'bidi-stream', 22],
    ]);
  });

  it('names a service by its own name in a file with no package', () => {
    expect(parseProto('service Billing { rpc Charge (A) returns (B); }').services[0]?.fullName).toBe('Billing');
  });

  it('keeps what it read before a part it could not, and never throws', () => {
    const file = parseProto('package p; service A { rpc One (X) returns (Y); rpc ??? } service B { rpc Two (X) returns (Y); }');
    expect(file.services.map((service) => [service.fullName, service.methods.map((method) => method.name)])).toEqual([
      ['p.A', ['One']],
      ['p.B', ['Two']],
    ]);
    expect(parseProto('}}} service { "').services).toEqual([]);
    expect(parseProto('service S { rpc M (stream) returns (stream); }').services[0]?.methods.map((method) => grpcCallKind(method))).toEqual(['unary']);
  });

  it('reads a type named stream as a type, and a fully-qualified one as written', () => {
    const [service] = parseProto('service S { rpc M (.pkg.Req) returns (stream .pkg.Res); }').services;
    expect(service?.methods[0]).toMatchObject({ request: '.pkg.Req', response: '.pkg.Res', responseStream: true });
  });
});

describe('gRPC keys and names (P274)', () => {
  it('keys a way in by the path a client sends to', () => {
    expect(grpcEntryKey('shop.v1.CartService', 'GetCart')).toBe('grpc:shop.v1.CartService/GetCart');
  });

  it('matches a method however a generated client or a loader spells it', () => {
    expect(sameMethodName('getCart', 'GetCart')).toBe(true);
    expect(sameMethodName('get_cart', 'GetCart')).toBe(true);
    expect(sameMethodName('getCarts', 'GetCart')).toBe(false);
  });
});
