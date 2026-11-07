# multi-repo-exports

A small shop of three repositories, each deployed with a different tool, that
share their APIs, a queue and a topic through CloudFormation outputs (P249):
one exports a value under a name, another imports it by that name. Nothing is
deployed; the linker joins each import to the export of the same name.

Type-checked, never executed or deployed.

| Service | Written with | Publishes | Reads |
|---|---|---|---|
| `gateway` | the Serverless Framework (`serverless.yml`, stack `shop-gateway-prod`) | the REST API `shop`'s id and root (`shop-rest-api-id`, `shop-rest-api-root`), its URL (`shop-api-url`), the HTTP API `shop-http`'s id (`shop-http-api-id`), and the framework's own `ServiceEndpoint`, `HttpApiId`, `HttpApiUrl` | `orders`' queue by `${cf:shop-orders.PlacedQueueArn}`; an audit queue of a billing service nobody configured, by `${cf:billing-prod.AuditQueueUrl}` |
| `orders` | the AWS CDK (`lib/orders-stack.ts`, stack `shop-orders`) | its queue `orders-placed` (`orders-placed-queue-arn`, and `PlacedQueueArn` of its stack) | the REST API through `RestApi.fromRestApiAttributes` - `POST /orders`, `GET /orders/{id}`; the HTTP API through `HttpApi.fromHttpApiAttributes` - `GET /orders`; `catalog`'s topic through `Topic.fromTopicArn` |
| `catalog` | AWS SAM (`template.yaml`, stack `catalog-prod` from `samconfig.toml`) | its topic `catalog-restock` (`catalog-restock-topic-arn`) | the REST API's root - `GET /products` as `AWS::ApiGateway::Resource` and `Method`; the HTTP API - `GET /products/{id}` as `AWS::ApiGatewayV2::Route`; `orders`' queue by `!ImportValue`; the REST API's URL as `SHOP_API_URL` |

What the graph says:

- Every route `orders` and `catalog` hang from the gateway's APIs has its full
  path (`POST /orders`, `GET /orders/:param`, `GET /products`,
  `GET /products/:param`) and is a route of `gateway` too.
- `catalog`'s `reorder` handler calls `${process.env.SHOP_API_URL}/orders`;
  the value imports the REST API's URL, so the request is the gateway's, and
  it lands on `orders`' `POST /orders` (`expected.cli/flow.reorder.tree.txt`).
- `sqs/orders-placed` is one channel: `orders` publishes to it, and both
  `gateway`'s `audit` mapping and `catalog`'s `Reorder` mapping read it.
  `sns/catalog-restock` is one channel `catalog` publishes to and `orders`'
  subscription reads.

What it says it could not do:

| Row | Where | Why |
|---|---|---|
| `export-not-found` | `gateway/serverless.yml:14` | `${cf:billing-prod.AuditQueueUrl}`: no configured service is the stack `billing-prod` |
| `environment-value-unread` | `gateway/src/audit.ts:9` | the publish through that value |
| `route-path-unread` | `catalog/template.yaml:91` | an `Api` event whose `RestApiId` is imported, which the transform refuses |
