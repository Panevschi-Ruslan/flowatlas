# bot-registry

A bot whose buttons are functions in a table it keeps itself, and whose commands
are registered inside module-level functions. Neither is a class, and before R12
neither existed in the graph — with nothing saying so.

`callbackRegistry` is named in `flowatlas.config.json` under
`adapters.entry.registries`; `textRegistry` deliberately is not, so the fixture
also covers what a repository says when it finds a table nobody configured.

| Declaration | Expected |
|---|---|
| `callbackRegistry.register('confirm_cancel', confirmCancelHandler)` | `bot_callback:confirm_cancel`, `handles` a `function` node, `calls` `OrdersService.cancel` |
| `callbackRegistry.register('view_order', viewOrderHandler)` | the handler reaches `OrdersService.find` through `summarise`, so a `function` calls a `function` |
| `callbackRegistry.register('keep_order', (data, deps) => …)` | `bot_callback:keep_order` handled by the function written in place, a `function` node `callbacks:keep_order@19`, `meta.handlerVia` `inline` |
| ``callbackRegistry.register(`rate_${…}`, …)`` | no node; unresolved `registry-key-dynamic` |
| `textRegistry.on('help', helpText)` | no nodes; one unresolved `entry-registry-unconfigured` naming `textRegistry.on` and both registrations |
| `bot.command('menu', () => showMenu(orders))` in `registerMenuHandlers` | `bot_command:menu` handled by the `showMenu` function — a registration outside any class |
| `bot.action('back_to_main', …)` in the same function | `bot_callback:back_to_main` handled by the function written in the registration, `action back_to_main@14`, which calls `OrdersService.find`; `meta.handlerVia` `inline` |
| `this.bot.start(() => this.greet())` | `bot_command:start` handled by `Bot.greet`, exactly as before |
| `summarise`, called only from a handler | a `function` node; every other module-level function in the repo is not one |
