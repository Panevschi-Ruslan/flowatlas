# missing-repo fixture

The repository nobody added to the configuration (P122). A bookshop of three
repositories, of which the configuration names two: `gateway` and `orders`.
The third, `payments-api`, sits beside them on disk and is not configured.
Three different things in the two configured repositories point at it:

- `gateway` sends two requests to `${PAYMENTS_URL}/charges` and
  `${PAYMENTS_URL}/refunds`. No service claims `PAYMENTS_URL` under
  `baseUrlEnv`, and nothing written down gives it a value, so both are
  `unknown-base-url-env` rows. The setting's name, less its `_URL`, is
  `payments`.
- `orders` imports `PaymentsClient` from `@acme/payments-client`, which is not
  installed. The configured services' manifests are named `@acme/gateway` and
  `@acme/orders`, so the package is under the project's own scope: the cause
  `module-not-installed:@acme/payments-client` on the call
  `this.payments.authorize(...)`. Without its scope and its `-client`, the
  package is `payments`.
- `orders` publishes `payment.requested`, which nothing configured consumes
  (`channels.noConsumers`). Its first segment is `payment`.

`payments`, `payments-client` and `payment` are one name once the separators,
the generic words and the plural are taken off, so `doctor` says one group:
"payments", three kinds of evidence (a setting, a package, a channel), four
places. Of the directories beside the configured repositories, `payments-api`
fits it three ways: its `package.json` is `@acme/payments-api`, its directory
name is `payments-api`, and `docker-compose.yml` beside the configuration
builds the container `payments` from it. Only its manifest and the setting
files at its top (`.env.example`) are read; none of its source.

So `doctor`, run in this directory, opens its unresolved section with the
following (run from elsewhere, as the snapshots are, the `flowatlas link` path
and `--config` are written for where it runs):

```
Probably missing: a repository for "payments" — 3 kinds of evidence, 4 places
  PAYMENTS_URL is used by gateway (2 requests) and no service claims it
  @acme/payments-client is imported by orders and is not installed
  channel payment.requested is published by orders and nobody here consumes it
  ./payments-api looks like it (package @acme/payments-api, its directory name, a compose service built from it): flowatlas link ./payments-api
```

`flowatlas link --suggested` adds `payments-api` to the configuration, as
`flowatlas link ./payments-api` would. `variants/linked/` is that
configuration: built, both requests join `POST /charges` and `POST /refunds`
(by the setting's name, a `base-url-from-name` note), `payment.requested`
joins its consumer, and no group is left. The package stays uninstalled, and
is no longer evidence: its name is now a configured service's.

Recorded: `expected.cli/doctor.txt` (the group at the head),
`doctor.missing.txt` and `.json` (every place), `doctor.github.txt` (a
`::notice` at the configuration), `link.suggested.txt` (`--dry-run`) and
`doctor.linked.txt` (the variant); `expected.mcp/` holds `start_here` and
`describe_for_prompt` on the gap id of the two requests, whose "How to close
it" names the repository.
