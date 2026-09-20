# nest-telegraf

A bot whose handlers are declared with decorators. Every one of them is an
ordinary `entry` node with a bot kind: nothing downstream is told a bot was
involved.

`telegraf` is in the manifest beside `nestjs-telegraf` on purpose. Only the
second one is a signal; the first is the imperative API, which registers
handlers in calls no decorator adapter can see.

| Declaration | Expected |
|---|---|
| `@Start()` / `@Help()` | `bot_command:start` / `bot_command:help`, `meta.decorator` tells them from `@Command('start')` |
| `@Command('depots')` | `bot_command:menu` |
| `@Command(['orders', 'o'])` | two entries, both handled by the same method, `meta.trigger` keeps the array |
| `@Hears('Depots')` | `bot_command:Depots` — a reply-keyboard button is a typed command |
| `@Hears(/^hi/i)` | `bot_command:/^hi/i` |
| `@Action('order_confirm')` | `bot_callback:order_confirm`, `meta.callbackData` the same string |
| `@Action(/^order_(\d+)$/)` | `bot_callback:/^order_(\d+)$/`, `meta.callbackData` the source and flags |
| `@Btn(CB.CANCEL)` in a second `@Update` class | `bot_callback:order_cancel` — an alias is the same decorator, a const still resolves |
| `@Action(dynamicKey())` with `@FlowEntry('checkout')` | `bot_callback:checkout`, `meta.confidence` `marker`, `meta.trigger` the expression |
| `@Action(dynamicKey())` without a marker | no node; unresolved `dynamic-bot-trigger` |
| `@On('callback_query')` | `bot_event:callback_query` |
| `@On(['message', 'edited_message'])` | two `bot_event` entries |
| `@Scene('checkout')` with `@SceneEnter` / `@SceneLeave` | `scene_step:checkout#enter` / `#leave` |
| `@On('text')` inside that scene | `bot_event:checkout/text` — the scene prefix is what keeps two scenes apart |
| `@Wizard('register')` with steps 1, 2, 4 | three `scene_step` entries and `triggers` edges 1→2 and 2→4, `meta.order` the step left |
| `@SceneEnter` in a plain `@Injectable` | no node; unresolved `orphan-scene-decorator` |
| `@Action` from `./cqrs-like.js` | ignored: same name, different declaration |
| `@UseGuards(AdminGuard)` on a handler | `guarded_by` on the entry, from the generic pass and not from this adapter |
| `confirm()` calling the injected `OrdersService` | the ordinary `injects` and `calls` chain below the entry |
