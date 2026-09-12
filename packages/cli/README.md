# @flowatlas/cli

**A command-line tool that reads several TypeScript repositories without running
them, joins them into one graph, and answers questions about it.** It knows
NestJS and Angular, Telegraf and Hono, TypeORM, Prisma, Mongo, Redis, Kafka,
RabbitMQ and BullMQ. It also serves the graph to a coding agent over the Model
Context Protocol.

A compiler reads one repository. This reads five and matches a request made in
one service to the route that answers it in another, a message published in one
to whatever handles it, and a button in a browser to the endpoint it calls.

```sh
npm install -g @flowatlas/cli
```

---

## From nothing to an answer

```sh
flowatlas init --dir .   # find the repositories under here and write the config
flowatlas build          # read them all and join them
flowatlas doctor         # what it could not read, and the one thing to change
```

![one click in a browser, followed into a third repository](https://raw.githubusercontent.com/Panevschi-Ruslan/flowatlas/main/docs/media/04-flow.gif)

That is one `(click)` in an Angular template, followed through a gateway, into
an orders service, down to the row it reads. Three repositories, and
`unresolved on this path: 0` says nothing along the way was guessed.

**[The walkthrough](https://panevschi-ruslan.github.io/flowatlas/)** does all ten
steps with a recording of each.

---

## What it answers

| Command | Answers |
|---|---|
| `flowatlas flow <entry>` | follow one way in through every service it reaches |
| `flowatlas impact <symbol>` | every entry point that reaches a symbol, and whose |
| `flowatlas channel <name>` | who publishes to a channel and who handles it |
| `flowatlas contracts` | what each service sends against what the other declares |
| `flowatlas doctor` | what could not be read, and what has drifted |
| `flowatlas diff <base>` | what a branch changes and who would notice |
| `flowatlas visualise` | the whole graph as one page you can open |
| `flowatlas mcp` | serve it to an agent over stdio |

`flowatlas --help` lists all twenty-one.

---

## What to expect on a first build

Not everything joins, and the tool says so rather than guessing. A first build of
a five-repository project, with no configuration beyond what `init` writes:

| | first build | after two settings |
|---|---|---|
| HTTP routes found | 615 | 615 |
| Browser requests matched to a route | 333 of 356 | 333 of 356 |
| Calls between services matched | 0 of 55 | 43 of 55 |
| Routes something reaches | 322 | 353 |

The two settings are `baseUrlEnv`, which tells the tool which settings key
addresses a service, and `apiTarget`, which says where a frontend's key points.
`flowatlas doctor` names both, with the file and the line that needs them.

Precision over recall throughout: an edge marked `static` is one the code says is
there, an edge it inferred is marked `heuristic`, and anything it could not read
is reported with a file, a line and a reason rather than guessed at.

---

## Annotations

Where an address really is assembled at run time, annotate it and the graph
believes you, recording the edge as `marker` so it is clear which edges were
told rather than found. That is the separate
[`@flowatlas/markers`](https://www.npmjs.com/package/@flowatlas/markers) package,
and it is optional.

---

Node 20 or newer. MIT.
[Source, docs and issues](https://github.com/Panevschi-Ruslan/flowatlas).
