# cant-follow fixture

What the reader could not follow, grouped by cause (P75). Neither service has
its dependencies installed; only the framework's own packages resolve, through
the built-in shapes, so every other package import resolves to nothing.

`storefront`:

- `NotifyService.mail` is `new MailClient()` from `@shopkit/mailer`, not
  installed: the calls on it are `module-not-installed:@shopkit/mailer`, and
  every `Receipt` a route returns is a `type-unresolved` row with the same cause.
- `NotifyService.audit` comes from `@storefront/audit`, a tsconfig path alias
  that points at no file, and `NotifyService.templates` from
  `../legacy/templates`, a relative path with no file: `import-unresolved`.
- `PricingService.tax` is a `TaxTable` imported from `./index`, which resolves
  and exports no such name: `re-export-missing`.
- `PricingService.rules` is typed by an interface: `interface-type`.
- `OrdersService.steps[sku]()` picks its method by key: `dynamic-member`.
- `ReminderJob` injects `Queue` from `@shopkit/queue` by type
  (`di-type-unresolved`, `module-not-installed:@shopkit/queue`), calls into a
  callback's untyped `job` (`callback-param`), a field declared `any`
  (`any-typed`), and a parameter with no type (`untyped-parameter`).

`payments`:

- `ChargesService.ledger` is a `LedgerClient` from `@shopkit/ledger`, not
  installed: `module-not-installed:@shopkit/ledger`, and the route's
  `LedgerEntry` is a `type-unresolved` row with the same cause.

`flowatlas doctor --unresolved` prints these by cause and by package, the page
shows them under Not joined, and the MCP `cant_follow` tool answers the same.

`expected.mcp` holds what the graph server answers where it used to answer
nothing (P94): `who_calls` on `ReminderJob.start`, which nothing calls, marks it
`topOfChain` with the gaps of its file and points at them; `impact` on it says
`entriesNone`; and a cause misspelled is an error naming the causes there are.
