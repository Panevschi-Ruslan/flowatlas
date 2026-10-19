# Run time in five minutes

`flowatlas build` says what the code can do. `flowatlas observe` adds what it
did: which of the front end's calls ran, which joins into which routes, how
long each took and how it answered. You do not need a tracing backend for
it. Your end-to-end tests already make the calls; let Playwright write them
down.

## 1. Record a HAR in each test

In the Playwright project, a fixture that records every test's network into
its own output directory:

```ts
// e2e/fixtures.ts
import { test as base } from '@playwright/test';

export const test = base.extend({
  contextOptions: async ({ contextOptions }, use, testInfo) => {
    await use({
      ...contextOptions,
      recordHar: {
        path: testInfo.outputPath('network.har'),
        content: 'omit', // 'embed' or 'attach' only if you want --shapes (below)
        mode: 'minimal',
        urlFilter: '**/api/**', // optional: only your API's calls
      },
    });
  },
});
export { expect } from '@playwright/test';
```

and import `test` from `./fixtures` in the specs. (Outside the test runner,
`browser.newContext({ recordHar: { path: 'network.har' } })` does the same;
the HAR is written when the context closes.)

## 2. Run the tests

```
npx playwright test
```

Each test leaves `test-results/<test>/network.har`.

## 3. Lay the run over the map

```
flowatlas build                       # once, if the map is not built yet
flowatlas observe test-results        # add --service web if the map has more than one front end
```

`observe` reads every HAR under the directory (and the `.zip` Playwright
writes for a `recordHar` path ending in `.zip`) and leaves the rest alone -
videos, screenshots, traces, `.last-run.json` - saying how many files it
left. A quoted glob works too: `flowatlas observe 'test-results/**/*.har'`.
Run it again after the next test run: runs add up hour by hour, and a file
already read is skipped.

```
7 spans read from 3 file(s)
not read: 1 entry of type image, 1 entry made by a service worker, 1 entry of type document, 1 entry of type script, 1 entry made by the test through its request API, not by the page, 1 entry answered by the test (route.fulfill), not by a server
left alone in test-results: 6 files that are not HAR (a directory is read for its HAR files; name other trace files on their own)
2 joins seen, 0 entries hit, 1 seen at run time but not found in code, 2 that could be more than one place
  client    web  POST /orders/:value/cancel  (1)
...
```

What is not the page's own call to your server is counted and left out: a
request the test made through Playwright's `request` API, one a service
worker made, one the test answered with `route.fulfill` or stopped with
`route.abort`, and every page, script, style, image and font. A call that got
no answer is *it failed*.

## 4. Look

- **`flowatlas visualise`**: the joins from the front end's call sites into
  the routes they reached are marked seen, with their count, p50, p95, max and
  errors, on Steps and the Map (`#map/x=p95` colours links by time); what the
  tests called and the code does not show is under *seen at run time*.
- **The graph server** (`flowatlas mcp`), for an agent:
  - `slow_steps` - the joins and call sites the tests were slowest on, each
    measured at the caller (the browser's time, network included);
  - `never_seen` - the routes of the services the front end calls that no
    test reached: what the suite does not cover, as evidence, never a verdict;
  - `get_flow` and `who_calls` show `observed: n` with `p95` beside each row
    traffic went through.

  A HAR is the front end's side only: `hot_paths`, `trace_for` and
  `undeclared_failures` answer from the services' own spans (below).

## The other two routes

**A HAR saved by hand.** In Chrome or Edge DevTools, the Network tab's
*Save all as HAR* (or *Export HAR (sanitized)*) after clicking through, then
`flowatlas observe ~/Downloads/shop.example.test.har --service web`.

**OpenTelemetry, on staging or on your machine.** Point the services'
exporters at a receiver on this machine and click through:

```
flowatlas observe --listen                         # 127.0.0.1:4318 until Ctrl-C

OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318  # in each service
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OBSERVE_ENDPOINT=http://127.0.0.1:4318             # a NestJS service with @nestjs/observe
```

Server spans give what a HAR cannot: each route hit (`hot_paths`), the
statuses it answered that its code does not declare (`undeclared_failures`),
and one slow and one failing request step by step (`trace_for`). Files
exported from a collector, Zipkin, Jaeger or X-Ray read the same way:
`flowatlas observe traces/*.json`. See
[`observe --listen`](CLI.md#observe---listen-a-receiver-on-this-machine).

## What is kept, and what is never stored

Of each call: the service, the method, the path with every value-like segment
masked (`/orders/:value`), the status, the duration, the start time, whether
it failed, and the service the call's origin names (a third party's host
only). Never: headers, cookies, tokens, query strings, bodies, hosts of your
own services, a failure's text, or anything else in the HAR. The HAR itself
is not copied or cached; delete it when you are done.

With `--shapes`, and only then, the JSON bodies a HAR holds (`content:
'embed'`, or `'attach'`, whose body files beside the HAR or in its `.zip` are
read) are walked for their shape - key names and JSON types, never a value -
and compared with the types the code declares (P113):
`flowatlas observe test-results --shapes`. Record with `content: 'omit'` and
there is nothing to read; the summary says so.

The whole reference is [`flowatlas observe`](CLI.md#flowatlas-observe-file).
