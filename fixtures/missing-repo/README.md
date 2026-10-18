# missing-repo fixture

The repository nobody added to the configuration (P122). A bookshop of four
repositories, of which the configuration names three: `gateway`, `orders` and
`jobs` (Terraform and two functions, P204). The fourth, `payments-api`, sits
beside them on disk and is not configured. Five different things in the
configured repositories point at it:

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
- `jobs` reads the Kinesis stream `payments` into its `ledger` function, and
  nothing configured writes to it: a `stream-no-writer` finding, and evidence
  of the kind `subscription` (P204), by the stream's name, `payments`. It is
  said only as a subscription, not again as a channel with one end.
- `jobs` sends events whose `source` begins `acme.payments` to its `receipts`
  function, and nothing configured publishes one: a
  `subscription-matches-nothing` finding, the same kind of evidence, by the
  source's last dotted word, `payments`.

`payments`, `payments-client` and `payment` are one name once the separators,
the generic words and the plural are taken off, so `doctor` says one group:
"payments", four kinds of evidence (a setting, a package, a channel, a
subscription), six places. Of the directories beside the configured repositories, `payments-api`
fits it three ways: its `package.json` is `@acme/payments-api`, its directory
name is `payments-api`, and `docker-compose.yml` beside the configuration
builds the container `payments` from it. Only its manifest and the setting
files at its top (`.env.example`) are read; none of its source.

So `doctor`, run in this directory, opens its unresolved section with the
following (run from elsewhere, as the snapshots are, the `flowatlas link` path
and `--config` are written for where it runs):

```
Probably missing: a repository for "payments" — 4 kinds of evidence, 6 places
  PAYMENTS_URL is used by gateway (2 requests) and no service claims it
  @acme/payments-client is imported by orders and is not installed
  channel payment.requested is published by orders and nobody here consumes it
  events from acme.payments* are taken by jobs (1 rule) and nothing here publishes one
  stream kinesis/payments is read by jobs and nothing here writes to it
  ./payments-api looks like it (package @acme/payments-api, its directory name, a compose service built from it): flowatlas link ./payments-api
```

`flowatlas link --suggested` adds `payments-api` to the configuration, as
`flowatlas link ./payments-api` would. `variants/linked/` is that
configuration: built, both requests join `POST /charges` and `POST /refunds`
(by the setting's name, a `base-url-from-name` note), `payment.requested`
joins its consumer, and no group is left. The package, the stream and the
rule stay as they are, and are no longer evidence: their name is now a
configured service's.

`traces/payments.otlp.json` is the same project at run time (P144): four
checkouts through the gateway (three `pay`, one `refund`), each answered by a
service whose spans say `service.name` `payments`, which the configuration does
not list. `observe` matches its two routes and its two `ChargesController`
methods to nothing, so they are blind spots (`seen-not-in-code`) of a service
no configured service is: a fifth kind of evidence, `traffic`, for the same
group ("5 kinds of evidence, 8 places"), each place with what it reached and
the hour it was seen in. Their check, `gap:payments||seen-not-in-code`, names
the repository to link, on the page and from `describe_for_prompt` alike. The
gateway's own calls match its call sites, so they are no blind spot.

`traces/peer.otlp.json` is the calls side (P146): the gateway's pay and refund
requests say `peer.service` `payments-api`, an orders call says `payments`, one
names a configured service (`orders-api`, not counted), one an address
(dropped) and one an instance (masked as `:value`). `observe` counts the first
two as `peer` blind spots of their callers, and `doctor --missing` reads each as
traffic to the same group: `gateway: called payments-api, 6 spans in 1h
(peer.service)`. Beside `payments.otlp.json`, the orders call and the spans
`payments` wrote itself are one signal, said in one line.

Recorded: `expected.cli/doctor.txt` (the group at the head),
`doctor.missing.txt` and `.json` (every place), `doctor.github.txt` (a
`::notice` at the configuration), `link.suggested.txt` (`--dry-run`) and
`doctor.linked.txt` (the variant); `expected.mcp/` holds `start_here` and
`describe_for_prompt` on the gap id of the two requests, whose "How to close
it" names the repository. With the traces: `expected.cli/observe.traffic.json`
(the observed file), `doctor.traffic.txt`, `doctor.missing.traffic.txt` and
`.json`, and `expected.mcp.traffic/` (`describe_for_prompt` on the blind spots'
gap id, `start_here`); with the peer traces, `observe.peer.txt` and `.json`,
`doctor.missing.peer.txt` and `.json`, and `doctor.missing.traffic-peer.txt`
(both trace files).
