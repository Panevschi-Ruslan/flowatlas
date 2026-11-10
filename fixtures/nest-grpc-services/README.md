# nest-grpc-services

A NestJS gateway calling a NestJS gRPC microservice (P274), the contract in
`proto/orders.proto` (`orders.OrdersService`).

## Two services

- `orders` is a microservice made with `transport: Transport.GRPC, options:
  { package: 'orders', protoPath }`. Its controller answers
  `@GrpcMethod('OrdersService', 'FindOrder')`, `@GrpcMethod('OrdersService')`
  on `listOrders` (the method's name, first letter raised: `ListOrders`) and
  `@GrpcStreamMethod('OrdersService', 'StreamUpdates')`. The contract says
  how each is called: unary, a server stream, a stream both ways. A fourth
  method's service is named by a setting, `@GrpcMethod(SERVICE, ...)`: a
  `grpc-service-unread` row, and no way in. It claims `ORDERS_GRPC_URL`.
- `gateway` registers a gRPC client, `ClientsModule.register([{ name:
  'ORDERS', transport: Transport.GRPC, options: { package: 'orders',
  protoPath, url: process.env.ORDERS_GRPC_URL } }])`. `OrdersClient` keeps
  `this.client.getService<OrdersService>('OrdersService')` in a property set
  in `onModuleInit`, and calls `findOrder` and `listOrders` on it.

## What joins

- `this.orders.findOrder(...)` joins orders' `FindOrder`, and
  `this.orders.listOrders(...)` its `ListOrders`, `static`, through the
  `url` the transport options give, `ORDERS_GRPC_URL`, which orders claims.
- `GET /orders/:id` reaches the gRPC call through `OrdersClient.find`.
