# gateway-served-at-deploy-choices

A shop's APIs whose stage, region or address is chosen when they are deployed,
and the plain page that calls each by the address it is served at (P298):

- `orders`, Terraform: a REST API made by a module handed the stage as an
  input written over a root variable (`staging` by default) and the aliased
  provider in `eu-west-2` through its call's `providers` map, mapped onto
  `api.shop.example` at the base path `orders`; and an HTTP API whose stage a
  local sets from the workspace;
- `shipping`, the Serverless Framework, deployed to `${opt:region, 'eu-central-1'}`;
- `catalog`, a CDK app whose stage is `tryGetContext('stage') ?? 'beta'`,
  handed to its stack as a prop, and whose region is the context's;
- `reviews`, a SAM template nesting the API's template as an application and
  handing it its own `Stage` parameter (`qa` by default);
- `web`, plain HTML and the classic scripts it loads (`browser`).

| Call | Read as |
|---|---|
| ``fetch(`${ORDERS_DOMAIN}/submit`)``, `https://api.shop.example/orders` | `POST /orders/submit` of `orders`, served at the domain with the base path in front of its routes |
| ``fetch(`${ORDERS_API}/submit`)``, the API's own address in `eu-west-2` at `staging` | the same route: the API's own address serves it without the base path (`under: /orders`), at any stage `-var` names, `staging` where none is |
| ``fetch(`${PAYMENTS_API}/payments`)`` | `POST /payments` of `orders`, at whatever stage the workspace names |
| ``fetch(`${SHIPPING_API}/rates`)`` | `GET /rates` of `shipping`, in any region `--region` names, `eu-central-1` where none is |
| ``fetch(`${CATALOG_API}/products`)`` | `GET /products` of `catalog`, at any stage and in any region `-c` names, `beta` and `eu-west-1` where none is |
| ``fetch(`${REVIEWS_API}/reviews`)`` | `GET /reviews` of `reviews`, at any stage the parent's deployment is handed, `qa` where none is |

Each is joined `heuristic` (`via: served-at`) with a `base-url-from-files`
note that says what was taken as chosen at deploy time.
