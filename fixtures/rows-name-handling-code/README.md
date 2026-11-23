# rows-name-handling-code fixture

What a pilot on a real project got wrong after P368-P373 (P374): rows that
name the code handling their way in, a field read through a key held as a
default, a consumer anchored where it is written and never run when nothing
builds its class, and a subscriber to every channel drawing its type only
where it is published. Two repositories and one configuration, so
`flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/rows-name-handling-code/shop-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/rows-name-handling-code/shop-web/tsconfig.json --noEmit
```

`shop-api/node_modules` holds the hand-written `hono` stub; `shop-web/node_modules`
holds ones for `@angular/core`, `@angular/common`, `@angular/router` and `rxjs`.

## The back end - `shop-api` (Nest, with a worker in front)

- `OrdersService.cancel` is the method asked about. It publishes on
  `cart_canceled`, as `expire` does on `cart_expired`: frames with no `type`.
- `PATCH /api/orders/:id/cancel` (`OrdersController.cancel`) calls it behind
  `ClientGuard`, whose `suppliedId` reads the client's id out of the params,
  the query or the body, by a key it holds as a default:
  `options.actsAs ?? { in: 'body', name: 'userRef' }`, then
  `bag?.[source.name]`, `bag` assigned in three branches.
- `PATCH /api/orders/:id/note` runs `NoteGuard`, whose `noteOf` spreads the
  whole body into a copy: a use the reading cannot follow.
- `src/worker.ts` declares `POST /bot/staff/webhook` on a Hono application; its
  inline handler hands a pressed button to `StaffBot.handleCallbackQuery`,
  which calls the method.
- `DeskService.requestHelp` (`POST /api/desks/:id/help`) publishes
  `HELP_REQUESTED` on `desk_alerts`, which `StreamController` relays to the
  browser as server-sent events.
- `AlertRelay` subscribes to every channel of the bus (`bus.all()`) and pages
  the staff on `HELP_REQUESTED`.

## The front end - `shop-web` (Angular)

- `/orders/:orderId` (`OrderDetailComponent`) cancels through
  `OrdersClient.cancel`, which requests the cancel route.
- `LiveEvents` pushes each frame of the stream into a subject, `stream$`.
- `/desks` (`DeskBoardComponent`) subscribes to `stream$`, filtered to
  `HELP_REQUESTED`, and reloads: the subscription that runs.
- `OrderNotices` subscribes to `stream$` in `initialize` with a callback that
  only hands the event to `handle`, whose branch on `HELP_REQUESTED` shows a
  toast with one of its fields. Nothing injects `OrderNotices` and nothing
  calls `initialize`. `Toast.showInfo` is called by both screens too.

## What the answers say

- `impact` on `OrdersService.cancel`: the route, `by` its handler
  `OrdersController.cancel`; the webhook, `by`
  `StaffBot.handleCallbackQuery` (the class its worker hands the update to,
  not the worker file); the screen, `by` `OrderDetailComponent`.
- `check_contract` on the cancel route with `field: userRef`: read in
  `ClientGuard.suppliedId`, `layer: guard`, `sureness: default`, complete.
  Before P374, `reads: []` and `unsure: guard ClientGuard: stored in bag`.
- `check_contract` on the note route: `left` names `NoteGuard.noteOf`, the
  method the spread is in.
- `who_consumes` on `desk_alerts` with `HELP_REQUESTED`: `AlertRelay.pageStaff`,
  `DeskBoardComponent.reload`, and `OrderNotices.handle`, `reach: dead`, its
  class built by nothing. Before, the third was `Toast.showInfo`, alive from
  `screen /desks` through the toast's other callers.
- `search` for `HELP_REQUESTED`: one row, `desk_alerts`. Before, one per
  channel the bus carries, the cart channels holding only the every-channel
  subscriber's selection.
