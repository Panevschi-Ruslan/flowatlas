# Channel: order.created

`channel:order.created` — channel in orders at `src/orders/orders.service.ts:49`

Read from the source by flowatlas, without running it. Steps are in call order; a best guess is a join it inferred, not one the code proves.

## Published by · 1

- **event order.created** `producer:orders#src/orders/orders.service.ts:49:5` — orders `src/orders/orders.service.ts:49`

## Consumed by · 1

- **InvoicesConsumer.onOrderCreated** `consumer:billing#src/invoices/invoices.consumer.ts:InvoicesConsumer.onOrderCreated` — billing `src/invoices/invoices.consumer.ts:17` — consumes (static)
  - **InvoicesConsumer.onOrderCreated** `billing#src/invoices/invoices.consumer.ts:InvoicesConsumer.onOrderCreated` — billing `src/invoices/invoices.consumer.ts:17` — handles (static) — takes `type:billing#OrderCreatedEvent`; returns `void`
    - **InvoicesService.create** `billing#src/invoices/invoices.service.ts:InvoicesService.create` — billing `src/invoices/invoices.service.ts:14` — calls (static) — takes `type:billing#CreateInvoiceDto`; returns `type:billing#InvoiceDto`

## Shapes

- in: `type:billing#OrderCreatedEvent`
- out: `void`

## Gaps

- none recorded on this chain

## Ask next

- `who_emits({channel: "channel:order.created"})`
- `who_consumes({channel: "channel:order.created"})`
- `describe_for_prompt({id: "channel:order.created"})`
- `who_calls({symbol: "consumer:billing#src/invoices/invoices.consumer.ts:InvoicesConsumer.onOrderCreated"})`
