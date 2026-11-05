# Does flowatlas help an assistant? Measured

No run has been recorded yet. The benchmark is built and checked (`run.mjs --dry` is in `pnpm check`); the figures appear here after the first full run, with the expectations they are compared against already committed.

## How it is measured

A generated project of eight TypeScript repositories - a NestJS gateway, three
NestJS services, an Express service, Lambda functions declared in Terraform, a
React storefront and an Angular back office, and a package of shared types -
is asked 30 fixed questions (`scripts/bench-agent/questions.yaml`). The
answers are marked against a key the generator writes from its own model of
what it generated, never from flowatlas's reading of it. The project has
traps: routes nothing calls, an event nobody handles, a call made through a
helper, an address read from a settings object, a field renamed across a
boundary.

| Arm | Workspace | flowatlas |
|---|---|---|
| A | every repository side by side | none |
| B | the repository the question is asked from | none |
| C | that repository | the graph of all of them over MCP, and the guide |
| D | every repository | the graph over MCP, and the guide |

A is search's best case and B its usual one; C is what one person in one
repository gets; D isolates what the graph adds when search sees everything
too. Every arm has the same model, the same prompt and the same tools for
reading and searching, in a fresh copy of its workspace; the person's own
settings, hooks and MCP servers are left out. Each question runs at least
three times an arm, and the tables give the median and the range. The kinds
where the graph should not help - one repository's own code, a constant, what
a method does - are asked and reported like the rest. What was expected was
written down before the first run (`scripts/bench-agent/expectations.md`) and
is compared below.

## Run it yourself

```sh
pnpm install && pnpm -r build
node scripts/bench-agent/run.mjs --pilot        # 32 sessions; prints what a full run would take
node scripts/bench-agent/run.mjs --full --yes   # after the pilot
node scripts/bench-agent/report.mjs scripts/bench-agent/results/<the run>
```

It drives Claude Code in print mode on the account you are signed in with,
so it spends that account's usage. A run stopped by a usage limit goes on
with `--resume <the run>`. `node scripts/bench-agent/run.mjs --dry` checks the
generator, the key and the scorers with no assistant at all, and is part of
`pnpm check`.
