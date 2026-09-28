# @flowatlas/cli

**A command-line tool that reads several TypeScript repositories without running
them, joins them into one graph, and answers questions about it.** It knows
NestJS and Angular, React and Next.js, Express, Fastify, Koa and Hono, Medusa,
tRPC and Telegraf; TypeORM, Prisma, Drizzle, Mongoose, Sequelize, Kysely, Knex,
MongoDB and node-postgres; Redis, Kafka, RabbitMQ, BullMQ and socket.io; and
OpenAPI and AsyncAPI documents for the services whose source you do not have. It
also serves the graph to a coding agent over the Model Context Protocol.

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

## What it reads

**Ways in**

- NestJS controllers, message handlers and schedules, with their guards and pipes
- Express, Fastify, Koa and Hono, where a route is registered by a call
- Next.js and Medusa, where a route is the path of a file
- tRPC procedures, and Telegraf bot commands, callbacks and events

**Browsers**

- Angular templates, services and router, lazy routes included
- React components and hooks
- `fetch`, `axios`, a wrapper or a client class of your own, each joined to the
  route that answers it

**Data**

- TypeORM, Prisma, Drizzle, Mongoose, Sequelize, Kysely, Knex, MongoDB and
  node-postgres
- read with nothing installed, even a Prisma client that was never generated
- a repository base of your own, with the table each class states
- Redis and cache-manager, and every settings key a request depends on

**Messages**

- Kafka, RabbitMQ, BullMQ, Redis pub/sub and socket.io, from both ends
- an in-house bus, described in the configuration
- the payload and the reply of a request, compared across the boundary

**Across repositories**

- a monorepo's services with the workspace packages they use, on a fresh clone
- a service you have no source for, from its OpenAPI or AsyncAPI document
- every contract compared where one repository meets another

**What it cannot read**

- a row saying why, and the one change that would read it
- an address or a table decided at run time is reported, never guessed
- test code left out, and every test directory named so you can see it

Every shape above is held by a fixture: a small repository written to prove it,
compared on every push. There are 106 of them, and
[the fixtures page](https://panevschi-ruslan.github.io/flowatlas/fixtures.html)
lists them all, generated from their READMEs.

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

`flowatlas --help` lists all twenty.

---

## What to expect on a first build

Not everything joins, and the tool says so rather than guessing. Five
repositories that ship as one product, three NestJS services and two Angular
frontends with a shared package of types between them, measured with 0.5.0:

| | first build | configured |
|---|---|---|
| HTTP routes found | 564 | 564 |
| Browser requests matched to a route | 494 of 503 | 494 of 503 |
| Calls between services matched | 1 of 43 | 41 of 43 |
| Routes something reaches | 483 | 508 |

The first column is what `init` writes and nothing more. The second adds the
settings `init` cannot know: `baseUrlEnv`, the settings key that addresses a
service; `apiBaseEnv` and `apiTarget`, the key a frontend's requests are rooted
at and where it points; and `sharedPackages`, the shared package of types. A
string in one repository and a route in another are joined by a fact only the
person who deployed them knows. `flowatlas doctor` names what is missing, with
the file and the line that wants it.

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
