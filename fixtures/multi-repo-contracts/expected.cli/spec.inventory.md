## Routes

15 routes, 1 procedure, read from the code; nothing here was run.

| service | verb | path | guarded | public | callers | tables written | channels published | fails | where |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `orders` | POST | `/deep` | no | — | gateway 1 | — | — | — | `src/deep/deep.controller.ts:8` |
| `orders` | POST | `/deep/categories` | no | — | gateway 1 | — | — | — | `src/deep/deep.controller.ts:13` |
| `orders` | POST | `/orders` | no | — | gateway 1, web 1 | — | `order.created` | — | `src/orders/orders.controller.ts:13` |
| `orders` | GET | `/orders/:param` | no | — | gateway 1 | — | — | — | `src/orders/orders.controller.ts:19` |
| `orders` | POST | `/orders/addresses` | no | — | gateway 1 | — | — | — | `src/orders/orders.controller.ts:37` |
| `orders` | POST | `/orders/drafts` | no | — | gateway 3 | — | — | — | `src/orders/orders.controller.ts:49` |
| `orders` | GET | `/orders/drafts/:param` | no | — | gateway 1 | — | — | — | `src/orders/orders.controller.ts:62` |
| `orders` | POST | `/orders/drafts/batch` | yes | — | gateway 1 | `drafts` | — | — | `src/orders/orders.controller.ts:109` |
| `orders` | POST | `/orders/drafts/preview` | yes | — | gateway 1 | — | — | 400 | `src/orders/orders.controller.ts:95` |
| `orders` | POST | `/orders/drafts/store` | yes | — | gateway 1 | `drafts` | — | 400 | `src/orders/orders.controller.ts:83` |
| `orders` | POST | `/orders/drafts/tag` | yes | — | gateway 1 | `drafts` | — | 400 | `src/orders/orders.controller.ts:89` |
| `orders` | POST | `/orders/legacy` | no | — | gateway 1 | — | `order.created` | — | `src/orders/orders.controller.ts:68` |
| `orders` | POST | `/orders/prices` | no | — | gateway 1 | — | — | — | `src/orders/orders.controller.ts:28` |
| `orders` | POST | `/wire` | no | — | gateway 1 | — | — | — | `src/wire/wire.controller.ts:9` |
| `orders` | POST | `/wire/broken` | no | — | gateway 1 | — | — | — | `src/wire/wire.controller.ts:15` |
| `orders` | procedure | `rpc orders.get` | no | — | — | — | — | — | `src/rpc/orders.rpc.controller.ts:15` |

