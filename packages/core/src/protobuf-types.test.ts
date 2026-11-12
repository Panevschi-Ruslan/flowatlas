import { describe, expect, it } from 'vitest';
import { parseProto } from './protobuf.js';
import { GRPC_PACKAGE_CONTRACTS, protoJsonName, protoTypes } from './protobuf-types.js';

const ORDERS = `
syntax = "proto3";
package shop.orders;
import "google/protobuf/timestamp.proto";
import "google/protobuf/empty.proto";

message PlaceOrder {
  message Line { string product_id = 1; uint32 quantity = 2; }
  enum Speed { STANDARD = 0; OVERNIGHT = 1 [deprecated = true]; }
  string customer_id = 1;
  repeated Line lines = 2;
  map<string, string> labels = 3;
  Speed speed = 4;
  int64 total_cents = 5;
  bytes note = 6;
  optional string coupon = 7;
  google.protobuf.Timestamp placed_at = 8;
  oneof payment {
    string card_token = 9;
    Voucher voucher = 10;
  }
  reserved 11 to 15;
  option deprecated = false;
}
message Voucher { string code = 1; Voucher replaces = 2; }
service Orders {
  rpc Place (PlaceOrder) returns (google.protobuf.Empty);
}
`;

describe('parseProto messages (P287)', () => {
  it('reads each message, nested ones by their full name, with fields, maps, labels and oneofs', () => {
    const file = parseProto(ORDERS);
    expect(file.syntax).toBe('proto3');
    expect(file.messages.map((message) => message.fullName)).toEqual(['shop.orders.PlaceOrder.Line', 'shop.orders.PlaceOrder', 'shop.orders.Voucher']);
    expect(file.enums).toEqual([{ name: 'Speed', fullName: 'shop.orders.PlaceOrder.Speed', values: ['STANDARD', 'OVERNIGHT'], line: 9 }]);
    const order = file.messages[1];
    expect(order?.fields.map((field) => [field.name, field.type, field.repeated, field.mapKey ?? null, field.label ?? null, field.oneof ?? null])).toEqual([
      ['customer_id', 'string', false, null, null, null],
      ['lines', 'Line', true, null, null, null],
      ['labels', 'string', true, 'string', null, null],
      ['speed', 'Speed', false, null, null, null],
      ['total_cents', 'int64', false, null, null, null],
      ['note', 'bytes', false, null, null, null],
      ['coupon', 'string', false, null, 'optional', null],
      ['placed_at', 'google.protobuf.Timestamp', false, null, null, null],
      ['card_token', 'string', false, null, null, 'payment'],
      ['voucher', 'Voucher', false, null, null, 'payment'],
    ]);
    // The service after the messages is still read.
    expect(file.services[0]?.methods[0]?.name).toBe('Place');
  });

  it('says proto2 and editions, and steps over a group and an extension', () => {
    const two = parseProto('syntax = "proto2"; message A { required string id = 1; optional group G = 2 { optional int32 x = 3; } extend B { optional int32 y = 4; } }');
    expect(two.syntax).toBe('proto2');
    expect(two.messages.map((message) => [message.fullName, message.fields.map((field) => field.name)])).toEqual([['A', ['id']]]);
    expect(parseProto('edition = "2023"; message A {}').syntax).toBe('editions');
  });
});

describe('protoTypes (P287)', () => {
  const types = () => protoTypes([{ path: 'proto/orders.proto', file: parseProto(ORDERS) }], 'orders');

  it('names fields as JavaScript reads them', () => {
    expect(protoJsonName('customer_id')).toBe('customerId');
    expect(protoJsonName('a_b_c')).toBe('aBC');
    expect(protoJsonName('already')).toBe('already');
  });

  it('registers a message, the messages and enums it holds, and a choice as one shape per member', () => {
    const read = types();
    expect(read.refOf('PlaceOrder', 'shop.orders')).toBe('type:orders#.shop.orders.PlaceOrder');
    expect(read.refOf('.shop.orders.Voucher', 'elsewhere')).toBe('type:orders#.shop.orders.Voucher');
    expect(read.refOf('google.protobuf.Empty', 'shop.orders')).toBe('type:orders#.google.protobuf.Empty');
    expect(read.refOf('Missing', 'shop.orders')).toBe('unknown');
    const registry = read.registry();
    const order = registry['type:orders#.shop.orders.PlaceOrder'];
    expect(order?.kind).toBe('union');
    expect(order?.members).toEqual(['type:orders#.shop.orders.PlaceOrder/cardToken', 'type:orders#.shop.orders.PlaceOrder/voucher']);
    const arm = registry['type:orders#.shop.orders.PlaceOrder/voucher'];
    expect(arm?.fields?.map((field) => [field.name, field.type, field.optional, field.meta?.['protoPresence'] ?? null])).toEqual([
      ['customerId', 'string', false, 'implicit'],
      ['lines', 'type:orders#.shop.orders.PlaceOrder.Line[]', false, 'implicit'],
      ['labels', 'object', false, 'implicit'],
      ['speed', 'type:orders#.shop.orders.PlaceOrder.Speed', false, 'implicit'],
      ['totalCents', 'number | string', false, 'implicit'],
      ['note', 'Buffer | string', false, 'implicit'],
      ['coupon', 'string', true, 'explicit'],
      ['placedAt', 'unknown', true, 'explicit'],
      ['voucher', 'type:orders#.shop.orders.Voucher', true, 'explicit'],
    ]);
    expect(registry['type:orders#.shop.orders.PlaceOrder.Speed']).toMatchObject({ kind: 'union', members: ["'STANDARD'", "'OVERNIGHT'", 'number'] });
    // A message that holds itself is registered once.
    expect(registry['type:orders#.shop.orders.Voucher']?.fields?.[1]?.type).toBe('type:orders#.shop.orders.Voucher');
    for (const entry of Object.values(registry)) expect(entry.structuralHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('keeps a proto2 required field required, and every other proto2 field optional', () => {
    const read = protoTypes([{ path: 'a.proto', file: parseProto('syntax = "proto2"; message A { required string id = 1; optional int32 n = 2; int32 m = 3; }') }], 'a');
    read.refOf('A', undefined);
    expect(read.registry()['type:a#.A']?.fields?.map((field) => [field.name, field.optional, field.meta?.['protoPresence'] ?? null])).toEqual([
      ['id', false, null],
      ['n', true, 'explicit'],
      ['m', true, 'explicit'],
    ]);
  });

  it('knows the health and reflection contracts the packages implement', () => {
    const health = parseProto(GRPC_PACKAGE_CONTRACTS[0]?.text ?? '');
    expect(health.services.map((service) => [service.fullName, service.methods.map((method) => method.name)])).toEqual([['grpc.health.v1.Health', ['Check', 'Watch']]]);
    expect(GRPC_PACKAGE_CONTRACTS.map((contract) => contract.word)).toEqual(['health', 'reflection', 'reflection']);
  });
});
