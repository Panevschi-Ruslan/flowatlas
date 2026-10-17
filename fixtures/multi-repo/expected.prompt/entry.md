# Way in: POST /orders/:param/invoice

`entry:gateway:http:POST:/orders/:param/invoice` — entry / http in gateway at `src/orders/orders.controller.ts:40`

Read from the source by flowatlas, without running it. Steps are in call order; a best guess is a join it inferred, not one the code proves.

## Steps

- **OrdersController.invoice** `gateway#src/orders/orders.controller.ts:OrdersController.invoice` — gateway `src/orders/orders.controller.ts:40` — handles (static) — takes `type:@fx/contracts#OrderDto`; returns `type:axios#AxiosResponse<type:gateway#InvoiceDto>`
  - **BillingClient.requestInvoice** `gateway#src/clients/billing.client.ts:BillingClient.requestInvoice` — gateway `src/clients/billing.client.ts:31` — calls (static) — takes `type:@fx/contracts#OrderDto`; returns `type:axios#AxiosResponse<type:gateway#InvoiceDto>`
    - **ServiceRegistry.invoicesUrl** `gateway#src/clients/service-registry.ts:ServiceRegistry.invoicesUrl` — gateway `src/clients/service-registry.ts:19` — calls (static) — returns `string`
      - **ServiceRegistry.baseUrlOf** `gateway#src/clients/service-registry.ts:ServiceRegistry.baseUrlOf` — gateway `src/clients/service-registry.ts:23` — calls (static) — takes `string`; returns `string`
    - **POST ?** `http_out:gateway#src/clients/billing.client.ts:33:12` — gateway `src/clients/billing.client.ts:33` — calls (heuristic) [best guess]
      - **POST /invoices** `entry:billing:http:POST:/invoices` — billing `src/invoices/invoices.controller.ts:15` — http_calls (marker) — takes `{orderId:string;amount:number}`; returns `type:gateway#InvoiceDto`
        - **InvoicesController.create** `billing#src/invoices/invoices.controller.ts:InvoicesController.create` — billing `src/invoices/invoices.controller.ts:15` — handles (static) — takes `type:billing#CreateInvoiceDto`; returns `type:billing#InvoiceDto`
          - **InvoicesService.create** `billing#src/invoices/invoices.service.ts:InvoicesService.create` — billing `src/invoices/invoices.service.ts:14` — calls (static) — takes `type:billing#CreateInvoiceDto`; returns `type:billing#InvoiceDto`

## Shapes

- in: `type:@fx/contracts#OrderDto`
- out: `type:axios#AxiosResponse<type:gateway#InvoiceDto>`

## Gaps

- none recorded on this chain

## Ask next

- `get_flow({entry: "entry:gateway:http:POST:/orders/:param/invoice"})`
- `describe_for_prompt({id: "entry:gateway:http:POST:/orders/:param/invoice"})`
- `impact({symbol: "entry:gateway:http:POST:/orders/:param/invoice"})`
- `who_calls({symbol: "gateway#src/orders/orders.controller.ts:OrdersController.invoice"})`
