# grpc-contract-messages

What a gRPC call sends compared with the message its contract declares, the
services a package hands a server, and a server that disagrees with its
contract (P287). `proto/store.proto` declares `store.InventoryService` and
`store.PricingService`, and the messages each method takes and answers:
nested messages and an enum, `repeated`, a `map`, an `int64`, a `oneof`, and a
well-known `Timestamp`.

## Three services

- `stock` is a gRPC server in plain JavaScript. It registers a health service
  from a package, `addService(health.service, new health.Implementation(...))`,
  drawn as `grpc.health.v1.Health/Check` and `/Watch` with the protocol's own
  messages; and a reflection service the package adds itself, `new
  ReflectionService(definition).addToServer(server)`, drawn as
  `ServerReflectionInfo` of `grpc.reflection.v1` and `v1alpha`. Its
  `InventoryService` implementation holds `reserve` and `release`, and:
  - no `countStock`, which the contract declares: a
    `grpc-method-unimplemented` finding (a client calling it is answered
    `UNIMPLEMENTED`);
  - a `restock` the contract does not declare: a `grpc-method-undeclared`
    finding, and no way in.
- `pricing` is written in another language and declared by the contract,
  `document: { kind: "protobuf", path: "./proto/store.proto", services:
  ["store.PricingService"] }`. Its way in carries `QuoteRequest` and
  `PriceQuote` as its input and output.
- `web` is an Express server whose routes call the other two.

## What the contract check says

Every way in carries its messages as types, `type:<service>#.store.ReserveRequest`,
fields named as JavaScript reads them (`warehouse_ids` as `warehouseIds`).

- `inventory.reserve({ sku, quantity: String(quantity) })` writes `quantity`
  as text where the message declares an `int32`: a type mismatch.
  `warehouseIds` is not written, and is not missing: a field left out arrives
  as its default (`proto-presence`).
- `inventory.release({ reservationId, reason })` writes `reason`, which
  `ReleaseRequest` does not declare.
- `inventory.countStock({ sku })` joins the declared method nobody
  implements.
- `pricing.quote(...)` is typed by the generated client, and agrees with
  `QuoteRequest`: one member of the `discount` choice is written. Its answer
  is read through the callback typed `PriceQuote`.
