# nest-helper-keeps-request

A lending library's reminders sent through a chat courier. The request is
written once, in a helper, and the bot token in its address is handed in by
whoever sends the reminder:

```ts
fetch(`https://api.example.test/bot${token}/${method}`, { method: 'POST', … })
```

The helper is written twice, as a module-level function (`sendViaCourier`) and
as a method (`CourierClient.send`), because the rule is one for both.

Following a value out of a helper to its callers says who decided it, and must
never cost what the helper states. A caller is drawn on only where its argument
reads the address at least as surely as the helper's own reading; otherwise the
helper keeps its request, with its node and the caller's call into it
(`forwardNoWorse`, `packages/core/src/trace.ts`).

| Caller | Token | Drawn |
|---|---|---|
| `ReminderDispatcher.dispatchOne` → `sendViaCourier(token, job)` | `this.env.LIBRARY_BOT_TOKEN`, which cannot be read | in the helper: `POST /bot${…}/:param`, `static`; `dispatchOne calls sendViaCourier`, `static` |
| `ReminderDispatcher.dispatchOverdue` → `this.courier.send(token, job)` | the same | in the method: `POST /bot${…}/sendMessage`, `static`; `dispatchOverdue calls CourierClient.send`, `static` |
| `RemindersService.remindAtDesk` → `sendViaCourier('desk-bot', …)` | written | at the caller: `POST /botdesk-bot/:param`, `static`; the helper keeps its own request for `dispatchOne` |

Before, both unread callers were drawn on at `heuristic` with a
`dynamic-http-url` row each, the helper function was no node and the calls into
it were gone; the method kept its node and lost its request. A token filling
part of a segment read `/bot/desk-bot`, a path nothing requests.
