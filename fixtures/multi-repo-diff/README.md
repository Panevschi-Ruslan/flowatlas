# multi-repo-diff

Two revisions of one project, for `flowatlas diff`.

`base/` is the whole project as it stands. `head/` holds only the files that
differ, laid over a copy of `base/`. A test makes each repository a git
repository, commits `base`, lays `head/` over it, commits again, and asks for
the difference between the two.

Six edits, each there to make one thing about a diff true or false.

| Where | What changes | What the diff has to say |
|---|---|---|
| `orders/src/dto/create-order.dto.ts` | one required field added | the gateway does not send it, and this breaks |
| `orders/src/orders/orders.controller.ts` | an import split over five lines | nothing — every line below it moved and no route did |
| `orders/src/orders/orders.service.ts` | a method removed | a node that is gone, with what reached it read off the base graph |
| `billing/src/invoices/invoices.consumer.ts` | the drift annotated | one fewer contract error, and not because anything was fixed |
| `orders/src/shipments/shipments.controller.ts`, `shipments.service.ts` | `GET /shipments/:id` renamed to `GET /shipments/:id/status`, and `track` now picks a carrier by name | the gateway's request for the old path lost its target (`joins.lost`), and a new `call-dynamic-receiver` gap sits in a changed method (`unresolved.added`) |
| `orders/src/orders/orders.service.ts`, `billing/src/invoices/gift-wrap.consumer.ts` | `create` publishes `order.gift-wrapped` as well, and a new billing handler takes it | the flow of `POST /orders`, from the gateway and from `orders`, gains two steps across two repositories (`flows`, P116), beside the body the gateway's request no longer satisfies |

`gateway/src/clients/dto.ts` is deliberately identical on both sides, and so is
the gateway's `GET /orders/:id/shipment`, which asks `orders` for the route the
head revision renames. Nobody edited the gateway, which is exactly the
situation no compiler can see: the break is between two repositories that each
still compile.

`expected.cli/` holds the document `flowatlas diff HEAD~1` writes (P116):
`diff.md` with its changed flows drawn, `diff.class.md` with a participant per
class, one diagram and no context, and `diff.json`. `scripts/cli-snapshots.mjs`
records them, with the timings and the path of the copy written as
placeholders.

`expected.mcp/` holds what the MCP server answers about this branch (P96):
`what_changed` with and without its verdict, the prompts and the resources.
`scripts/mcp-snapshots.mjs` makes the history, builds the head, runs
`flowatlas diff HEAD~1` (`scripts/diff-fixture.mjs`) and asks.
