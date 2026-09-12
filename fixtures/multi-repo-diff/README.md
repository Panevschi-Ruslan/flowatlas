# multi-repo-diff

Two revisions of one project, for `flowatlas diff`.

`base/` is the whole project as it stands. `head/` holds only the files that
differ, laid over a copy of `base/`. A test makes each repository a git
repository, commits `base`, lays `head/` over it, commits again, and asks for
the difference between the two.

Four edits, each there to make one thing about a diff true or false.

| Where | What changes | What the diff has to say |
|---|---|---|
| `orders/src/dto/create-order.dto.ts` | one required field added | the gateway does not send it, and this breaks |
| `orders/src/orders/orders.controller.ts` | an import split over five lines | nothing — every line below it moved and no route did |
| `orders/src/orders/orders.service.ts` | a method removed | a node that is gone, with what reached it read off the base graph |
| `billing/src/invoices/invoices.consumer.ts` | the drift annotated | one fewer contract error, and not because anything was fixed |

`gateway/src/clients/dto.ts` is deliberately identical on both sides. Nobody
edited the gateway, which is exactly the situation no compiler can see: the
break is between two repositories that each still compile.
