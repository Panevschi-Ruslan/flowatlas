# nest-followed-tokens

Tokens and module imports a NestJS application settles in its own files, and
that the injection reader follows (P261): an alias a configuring method
provides, a settings object's token, and modules chosen by a literal
condition or built by a function of the repository.

| What | Written as | Read as |
|---|---|---|
| an alias of a factory | `{ provide: LEDGER_CLIENT, useExisting: LEDGER }` in `ClientsModule.forRoot()` | `OrdersService` is injected the `LEDGER` factory's provider |
| an alias of a class | `{ provide: AUDIT_CLIENT, useExisting: AuditClient }` | `OrdersService` is injected `AuditClient` |
| a settings object's token | `@Inject(appConfig.KEY)`, `appConfig` a `registerAs('app', ...)` that `ConfigModule.forRoot({ load: [appConfig] })` loads | a provider where `registerAs` is written |
| a token by namespace | `@Inject(getConfigToken('mail'))`, `ConfigModule.forFeature(mailConfig)` | a provider where `registerAs('mail', ...)` is written |
| a module a literal condition chooses | `const storage = IN_MEMORY ? MemoryStorageModule : database()`, `IN_MEMORY = false` | `DatabaseModule`, configured, through `database()`'s answer |
| modules spread in by a literal condition | `...(STAGE === 'prod' ? [MetricsModule] : [])` | `MetricsModule` |

What it says it could not do:

| Row | Where | Why |
|---|---|---|
| `module-import-dynamic` | `src/app.module.ts:22` | `process.env.MAIL === 'smtp' ? SmtpModule : NullMailModule` is decided when the shop starts |
| `di-token-unknown` | `src/orders.service.ts:14` | `reportsConfig` is a `registerAs` nothing loads |

`@nestjs/config` is described by a stub of its types; nothing else is installed.
