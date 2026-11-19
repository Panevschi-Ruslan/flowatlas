# serverless-event-factories

A shop deployed with the Serverless Framework whose functions put events on
one bus through one helper, `emit(name, data)`, which builds each entry with
the factory of that name from a record of them (`src/common/events.ts`) and
sends it. The rules that run the other functions are in `serverless.yml`. A
clone nobody installed: every client is read from what the source states, so
every edge it draws is `heuristic` (P268).

| Call | Read as |
|---|---|
| `emit('OrderPlaced', ...)` in `src/orders/place.ts` | a producer there, onto `eventbridge/shop-events/shop.orders/OrderPlaced`: the member `OrderPlaced` of `events` is the factory the helper calls, and its answer is the entry |
| `emit('OrderShipped', ...)`, `emit('StockReserved', ...)` | the same, at each caller; `StockReserved` is a method of the record whose body returns its entry after a statement |
| `putEntry(events.OrderPlaced(...))` in `src/orders/ship.ts` | a producer at the caller: the helper sends the entry it is handed whole |
| `refundIssued(orderId, amount)` in `src/payments/refund.ts` | the entry a function called by its name answers, its parameters bound to the call's arguments |
| `emit(event.name, event.data)` in `src/orders/replay.ts` | nothing at the caller: the name is the function's input. The helper keeps its own producer, and its `channel-const-unresolved` row names the parameter and what `replay.ts` hands |
| `fetch(LEDGER, ...)` in `src/stock/reserve.ts` | `POST /ledger` of this service, `heuristic`: `LEDGER_URL` is an API Gateway address in the service's region and at its stage, whose id is written out (`base-url-from-files`) |

Every rule names the bus by its ARN, which reads as the bus the factories
name, so each channel has both ends.
