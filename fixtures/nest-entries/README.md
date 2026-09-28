# nest-entries

Every kind of way into a NestJS service that is not a plain HTTP route.

| Declared by | Entry |
|---|---|
| `@Cron('*/5 * * * *')`, `@Cron(CronExpression.EVERY_HOUR)` | a schedule |
| `@Interval(5000)`, `@Timeout(1000)` | a timer |
| `@Get(['a', 'b'])` | one route per path in the list |
| `@EventPattern('order.created')` | a message consumer, and its channel |
| `@MessagePattern({ cmd: 'sum' })` | a request-reply consumer, and its channel |

All ten ways in are read, with no unresolved row.
