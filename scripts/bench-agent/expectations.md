# What we expect, written before the first run (P238)

Committed before any recorded run, and not edited after one: the report
compares the results with this file as it stands, and a claim changed after
the fact would be a claim fitted to the results. A new expectation is a new
line with the date it was added, and the report says which run came after it.

## In words

- **Questions across repositories** (callers, what a change breaks, who
  handles an event, what nothing calls). With one repository open and no
  graph (B), most of these cannot be answered at all: the answer is in code
  that is not there. With the graph (C), they can. We expect C well above B.
  With every repository open (A), search can find most answers given enough
  calls; we expect the graph (D) to be at least as right and to get there
  with fewer tool calls and fewer tokens.
- **What nothing calls.** Proving that nothing calls a route means reading
  everything; we expect the graph to do better here than anywhere else. But
  the traps hide some real callers from the graph (a call made through a
  helper, an address read from a settings object), so the graph's answer
  will list a few routes that are in fact called. We expect D above A, and
  not fully right.
- **The traps themselves** (which service a client reaches, when the address
  comes from a settings object or the call goes through a helper). The graph
  has no edge for these. We expect the arms with the graph to do no better
  than A there, and possibly worse, if the assistant trusts the graph's
  silence over the code.
- **A field renamed across a boundary.** The graph compares what is sent
  with what is read. We expect D at least as right as A.
- **Questions about one repository's own code** (which methods write, what a
  constant is, whether a method retries). The graph should not help, and its
  tools cost tokens to list. We expect the same correctness with and without
  it, and somewhat more tokens with it.

## As claims the report checks

A claim compares two arms' median over every session of a kind: the score
unless a measure is named (`calls` for tool calls, `tokens`, `time`). `>` and
`<` mean by more than 0.1 for a score and by more than 10% for a measure; `=`
means within those; `>=` and `<=` mean not worse by more than them.

```expectations
cross-repo-callers: C > B
cross-repo-callers: D >= A
calls cross-repo-callers: D < A
blast-radius: C > B
blast-radius: D >= A
tokens blast-radius: D < A
event-handlers: C > B
event-handlers: D >= A
dead: C > B
dead: D > A
contract: D >= A
settings: D <= A
single-repo: C = B
single-repo: D = A
code-text: C = B
code-text: D = A
explain: C = B
explain: D = A
tokens single-repo: C > B
```

Added 2026-11-05, before any run.
