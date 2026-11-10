# grpc-shared-contract

gRPC services and their callers, one contract shared by all of them (P274):
`proto/shop.proto` at the top of the project declares `shop.CartService`,
`shop.PaymentService`, `shop.CatalogService` and `shop.ShippingService`.

## Four services

- `payments` is a gRPC server written in plain JavaScript (CommonJS, no
  TypeScript anywhere), so its scripts are what is read. It loads the contract
  by its bare name, `loadSync('shop.proto')`, which its build copies in, and
  registers `loadPackageDefinition(...).shop.PaymentService.service` with
  `{ charge: chargeHandler }`. It claims `PAYMENTS_ADDR` as its address. The
  health service it registers from a package is drawn by the protocol's own
  contract, `grpc.health.v1.Health/Check` and `/Watch`, with no code of its
  own behind them (P287).
- `catalog` registers `CatalogServiceService`, imported from generated code
  nobody committed (`./gen/shop_grpc_pb`), with an instance of `CatalogImpl`.
  The contract says which service that is and how each method is called:
  `WatchPrices` is a server stream. A private method is not a way in. It is
  reached at the host `catalog` (`services[].hosts`).
- `cart` is written in another language: nothing here can read it, so it is
  declared by the contract, `document: { kind: "protobuf", path:
  "./proto/shop.proto", services: ["shop.CartService"] }`, and claims
  `CART_ADDR`.
- `storefront` is an Express server whose routes call the others through
  gRPC clients made four ways.

## What joins

- `cart.getCart`, `cart.emptyCart` and `addItemAsync` (a
  `promisify(cart.addItem).bind(cart)`) join cart's declared methods: the
  client is generated code committed beside the routes, its paths name each
  method. The edges are as sure as the document.
- `payments.charge` joins payments' `Charge`, `static`: the client is made
  from the loaded contract, `new shop.shop.PaymentService(process.env.PAYMENTS_ADDR, ...)`.
- `catalog.listProducts` joins catalog's `ListProducts`: the client is
  generated code nobody committed, named by the contract, and sent to
  `catalog:50051`.
- `shipping.getQuote` joins nothing: no configured service implements
  `shop.ShippingService`. A `grpc-method-unserved` row names it and the file
  that declares it, beside the `unknown-base-url-env` row for `SHIPPING_ADDR`.
- `ledger.append` is drawn nowhere: `LedgerServiceClient` is generated from a
  contract this repository does not hold, a `grpc-service-unread` row.
- `cart.close()` is a method of every client, not a call of the service.
