import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { ConfigInvalidError, ConfigNotFoundError } from './errors.js';
import { ENTRY_KINDS } from './model/nodes.js';

export const CONFIG_FILENAME = 'flowatlas.config.json';
export const DEFAULT_OUTPUT = '.flowatlas';
export const DEFAULT_TYPE_MAX_DEPTH = 3;

/**
 * What a service whose source nobody here has is called.
 *
 * A word about where the facts came from rather than about what the service is
 * built on, because that is all anybody here knows about it: nothing was read,
 * so there is no framework to name. Module-local on purpose — it is a value
 * this schema fills in and reports print, never something to branch on. What a
 * reader downstream actually wants to know is whether `openapi` is set, which
 * is the fact rather than a word chosen to stand for it.
 */
const DECLARED_SERVICE_TYPE = 'declared';

/**
 * One end of the project: a repository, or a document standing in for one.
 *
 * `type` is an open string on purpose: the core must not know the names of the
 * frameworks it can be pointed at. The command line and the extractors own the
 * list of values they understand.
 *
 * `openapi` is the one exception to that, and it is a document format rather
 * than a framework. A service named this way has no source anybody here can
 * read — a payment provider, another team's repository, something written in
 * another language — and the document is the only statement of its routes and
 * its shapes there is.
 *
 * This project deleted `@flowatlas-hole`, an annotation whose purpose was to
 * accept a claim nothing could check, and the argument for deleting it was that
 * a checked way of saying the same thing already existed: the code the
 * annotation described sat in the same file, so the tool could go and read it
 * instead of being told. A document is not that. There is no source to read and
 * therefore no checked alternative, and the choice here is not between a claim
 * and a reading — it is between a claim and silence. Silence is what the tool
 * did before: the call was counted as third party and the question stopped
 * there, which was honest and answered nothing.
 *
 * What keeps this from being the annotation again is that nothing produced from
 * a document is ever presented as read. Every end of it is named as declared
 * wherever it is reported, in prose and in `--format json` alike, and `doctor`
 * says when the document last changed relative to the commits — because a stale
 * document is a wrong answer wearing a confident face, and that is the one
 * failure this way in can have.
 */
const serviceEntrySchema = z.strictObject({
  name: z.string().min(1),
  /**
   * Path to the repository, relative to the configuration file.
   *
   * Absent for a declared service, where the directory holding the document
   * stands in for it: everything downstream asks a service where it lives, and
   * a document that lives somewhere is a truer answer than none.
   */
  repo: z.string().min(1).optional(),
  /** Path to an OpenAPI document, relative to the configuration file. */
  openapi: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  /** Environment variables that hold this service's own base URL. */
  baseUrlEnv: z.array(z.string().min(1)).optional(),
  /** Settings keys a frontend reads its API base URL from. */
  apiBaseEnv: z.array(z.string().min(1)).optional(),
  /**
   * Which service answers each of those keys, by name.
   *
   * A frontend's settings key names one backend, and only the project knows
   * which: two services may serve the same route, and guessing between them
   * would draw an edge to a service the browser never reaches.
   */
  apiTarget: z.record(z.string().min(1), z.string().min(1)).optional(),
  /** Path to a tsconfig, when it is not the one at the repository root. */
  tsconfig: z.string().min(1).optional(),
  /** Entry file where global wrapping is installed, when there is one. */
  bootstrap: z.string().min(1).optional(),
});

/** The directory part of a configured path, in the spelling it was written in. */
const directoryOf = (path: string): string => {
  const cut = path.replace(/\\/g, '/').lastIndexOf('/');
  return cut <= 0 ? '.' : path.slice(0, cut);
};

/**
 * A service entry, with what a declared one leaves out filled in.
 *
 * Filled in here rather than left optional because every reader downstream asks
 * a service for its directory and its type, and making those two questions
 * answerable only sometimes would push the same branch into every one of them
 * for no gain. A declared service lives in the directory its document is in,
 * and is of the type that says nothing was read.
 */
export const serviceConfigSchema = serviceEntrySchema
  .superRefine((service, ctx) => {
    const sources = [service.repo, service.openapi].filter((each) => each !== undefined);
    if (sources.length === 1) return;
    ctx.addIssue({
      code: 'custom',
      path: ['repo'],
      message:
        sources.length === 0
          ? 'a service needs either a repo to read or an openapi document to take the word of.'
          : 'a service has either a repo or an openapi document, not both: source that can be read is read.',
    });
  })
  .transform((service) => ({
    ...service,
    repo: service.repo ?? directoryOf(service.openapi as string),
    type: service.type ?? DECLARED_SERVICE_TYPE,
  }));

const adapterNamesSchema = z.array(z.string().min(1));

/**
 * A call shape that publishes to a channel, described in configuration.
 *
 * A project with its own message bus has no library for an adapter to detect,
 * so this is how it describes one: which type the call is made on, which method
 * publishes, and which arguments carry the channel and the payload. Data, not
 * code, so the core still knows nothing about the bus behind it.
 */
export const customProducerSchema = z.strictObject({
  /**
   * Type the call is made on. A list, because the same bus is often reached
   * through an interface at one call site and the class itself at another.
   */
  receiverType: z.union([z.string().min(1), z.array(z.string().min(1))]),
  method: z.string().min(1),
  channelArg: z.number().int().min(0).default(0),
  payloadArg: z.number().int().min(0).optional(),
  kind: z.string().min(1).default('event'),
});

/**
 * A call shape that starts receiving from a channel, described in configuration.
 *
 * The producer's counterpart, for a bus whose receiving side is a call rather
 * than a decorator. Without it a project's own bus is read as all publishers and
 * no handlers, which reads as though nothing anywhere listens.
 */
export const customSubscriberSchema = z.strictObject({
  /** Type the call is made on, as at the call site. A list, as for a producer. */
  receiverType: z.union([z.string().min(1), z.array(z.string().min(1))]),
  method: z.string().min(1),
  channelArg: z.number().int().min(0).default(0),
  /** Argument holding what runs when a message arrives, when the call takes one. */
  handlerArg: z.number().int().min(0).optional(),
  kind: z.string().min(1).default('event'),
});

export const customBrokerSchema = z.strictObject({
  name: z.string().min(1),
  channelKind: z.enum(['topic', 'queue', 'exchange', 'channel']).default('channel'),
  producers: z.array(customProducerSchema).default([]),
  /** Decorator names that mark a method as receiving from a channel. */
  consumers: z.array(z.string().min(1)).default([]),
  /** Calls that start receiving, for a bus that has no decorator to mark one. */
  subscribers: z.array(customSubscriberSchema).default([]),
});

/**
 * A table of handlers the project keeps itself.
 *
 * A bot that registers its buttons through its own `register('key', fn)` has no
 * library for an adapter to detect: the call is ordinary code in ordinary files.
 * This is how the project points at one — which object holds the table, which
 * method fills it, and which arguments carry the key and the function — so the
 * core still knows nothing about what is behind it.
 *
 * It names no packages, and that is a decision rather than an omission. Its
 * counterpart for HTTP frameworks says where it applies by naming a dependency,
 * which works there because a framework is something installed and a manifest
 * is where installed things are listed. A table of functions the project wrote
 * is installed from nowhere. What says where it lives is `receiver`: the name
 * the object is written under in this repository's own source, and a truer
 * statement of where the description applies than any dependency could be,
 * since it names the table itself rather than a library that happens to sit
 * beside it. It is also the one thing detection cannot read, because detection
 * answers from the manifest before a single source file has been opened.
 *
 * Adding a `packages` key anyway would buy the two descriptions the same
 * spelling and not the same meaning. Empty would have to mean everywhere, as it
 * does there — and empty is exactly what a project with a table of its own
 * writes, because it has no dependency to name, so describing one table in one
 * repository would put this reader's name on every repository of the project.
 * Non-empty would be no better: the dependency named would stand for the
 * repository rather than for the table, and every repository of the project
 * that happens to share that dependency would claim the description too.
 *
 * So this description does state where it applies, in `receiver`, and it is the
 * reading rather than detection that acts on the statement: a description whose
 * receiver is written nowhere in the repository matches nothing there, which is
 * the same outcome a dependency that is absent would have produced. What
 * decides whether the reader runs at all stays with the adapter's own
 * dependency list, and with `adapters.force.entry` for a repository that is on
 * neither — both statements about the repository, which is the question
 * detection is actually asking.
 */
export const entryRegistrySchema = z.strictObject({
  /** How this registry is named in reports and on the entries it produces. */
  name: z.string().min(1),
  /**
   * The object the call is made on, spelled the way it is written.
   *
   * A name rather than a type, because a table of functions usually has no type
   * of its own to point at. The object still has to be declared in the
   * repository being read, so an import from a package that happens to share the
   * name is not matched.
   */
  receiver: z.union([z.string().min(1), z.array(z.string().min(1))]),
  method: z.string().min(1).default('register'),
  /** Which argument carries the key a person types or presses. */
  keyArg: z.number().int().min(0).default(0),
  /** Which argument carries the function that answers it. */
  handlerArg: z.number().int().min(0).default(1),
  /** The kind of way in each registration opens. */
  kind: z.enum(ENTRY_KINDS).default('bot_callback'),
});

/**
 * Types whose values declare routes, as a cross product.
 *
 * A framework usually declares one application type, and usually re-exports it
 * from more than one package: the implementation, the types package beside it,
 * and whatever the repository happens to import it from. Writing every pair by
 * hand is the same list three times, so a group is a set of packages and a set
 * of type names, and every combination of them counts.
 */
export const entryHttpAppTypesSchema = z.strictObject({
  packages: z.array(z.string().min(1)).min(1),
  typeNames: z.array(z.string().min(1)).min(1),
});

/**
 * How one application is hung inside another.
 *
 * The path the mount adds is either an argument or a key of an options object,
 * and the application being mounted is either the argument itself or the first
 * parameter of a function the framework will call with an instance of its own.
 */
export const entryHttpMountSchema = z.strictObject({
  method: z.string().min(1),
  /** Which argument is the application; negative counts from the end. */
  appArg: z.number().int().default(-1),
  /** Which argument spells the path, when one does. */
  pathArg: z.number().int().optional(),
  /** The options argument and the key on it that spells the prefix. */
  prefixKey: z
    .strictObject({ arg: z.number().int().min(0), key: z.string().min(1) })
    .optional(),
  /** The application is the first parameter of the function handed over. */
  asPlugin: z.boolean().default(false),
  /** Methods that turn an application into the middleware it is mounted as. */
  through: z.array(z.string().min(1)).default([]),
});

/**
 * How middleware is installed on a whole application rather than on one route.
 *
 * This is the guard equivalent, and the reason it is worth describing: one such
 * call written above thirty mounts is what stands between a request and every
 * route under all of them.
 */
export const entryHttpMiddlewareSchema = z.strictObject({
  method: z.string().min(1),
  /** The first argument may be a path the middleware is scoped to. */
  scoped: z.boolean().default(false),
  /** The first argument names a lifecycle hook and is not middleware itself. */
  named: z.boolean().default(false),
  /** Keys of an options object that hold middleware for one route. */
  optionKeys: z.array(z.string().min(1)).default([]),
});

/** A route declared by one object argument rather than by position. */
export const entryHttpRouteObjectSchema = z.strictObject({
  method: z.string().min(1),
  verbKey: z.string().min(1),
  pathKey: z.string().min(1),
  handlerKey: z.string().min(1),
});

/**
 * A framework that registers an HTTP route by calling an application.
 *
 * The third and last of the descriptions this tool accepts instead of code, and
 * the one with the most variation behind it: every such framework wants the
 * same three things from the source — a verb, a path and a handler — and
 * differs only in what the methods are called and where the arguments sit. A
 * service built on something nobody here has heard of is read from this alone.
 *
 * Every field says where something is. None of them says how to compute
 * anything: the moment a description would need a condition it has stopped
 * being a description, and what it wants is an adapter.
 */
export const entryHttpSchema = z.strictObject({
  /** How this framework is named in reports and on the entries it produces. */
  name: z.string().min(1),
  /**
   * Dependencies any one of which means this framework is in use.
   *
   * One configuration covers every repository of a project, and most of them
   * are built on something else. An empty list means the description is tried
   * everywhere.
   */
  packages: z.array(z.string().min(1)).default([]),
  appTypes: z.array(entryHttpAppTypesSchema).min(1),
  /**
   * Method name to the verb it answers.
   *
   * Absent means the eight a method is usually named after, which is what every
   * framework measured so far spells.
   */
  verbs: z.record(z.string().min(1), z.string().min(1)).optional(),
  /** A method taking the verb as its first argument. */
  verbArgument: z.string().min(1).optional(),
  /** A method returning the same application with a prefix in front of it. */
  prefixMethod: z.string().min(1).optional(),
  /**
   * The prefix method changes the application it is called on rather than
   * returning a new one, so a bare statement of it moves every route on it.
   */
  prefixMutates: z.boolean().default(false),
  /** A key of the constructor's options object that prefixes the whole router. */
  prefixOption: z.string().min(1).optional(),
  /** A method returning a route object already bound to a path. */
  pathMethod: z.string().min(1).optional(),
  /** Which argument of a verb call spells the path. */
  pathArg: z.number().int().min(0).default(0),
  /** Which argument answers the request; negative counts from the end. */
  handlerArg: z.number().int().default(-1),
  /**
   * Arguments between the path and the handler are middleware for that route.
   *
   * True for every framework measured so far, and a field rather than a rule
   * because a framework that spells its route middleware somewhere else would
   * otherwise have every one of those arguments named as a guard it is not.
   */
  middlewareBetween: z.boolean().default(true),
  mount: entryHttpMountSchema.optional(),
  middleware: entryHttpMiddlewareSchema.optional(),
  routeObject: entryHttpRouteObjectSchema.optional(),
});

/**
 * Where a tree of named ways in is hung so that requests reach it.
 *
 * The tree itself is a value in one file and is served from another, and the
 * serving file is usually three lines long: a call to something that turns the
 * tree into a handler. That call is worth describing for one reason — it is the
 * only place a reader can stand and say *this file serves a tree I could not
 * read*, which is the sentence a repository whose ways in are all of this shape
 * needs most.
 *
 * The tree is either the argument itself or a key of an options object written
 * there. Both are allowed on one row rather than two, because it is one call
 * with two accepted spellings and the reader tries the object first.
 */
export const entryProcedureMountSchema = z.strictObject({
  /** The function that turns a tree into something requests arrive at. */
  call: z.string().min(1),
  /** Which argument carries the tree, when it is the argument itself. */
  treeArg: z.number().int().min(0).default(0),
  /** The key of an options argument that carries the tree, when it is one. */
  treeKey: z.string().min(1).optional(),
});

/**
 * A tree of named ways in, assembled from object literals.
 *
 * The second family of call-registered boundary this tool reads, and it differs
 * from the first in exactly one structural fact, which is why it is a
 * description of its own rather than a field on the other one: the name of a way
 * in is a *key* of an object literal rather than a string argument at a
 * position, and its full address is every key above it. `entryHttpSchema` and
 * `entryRegistrySchema` both say where a name sits among a call's arguments —
 * `pathArg`, `keyArg` — and neither can say "the key this value is written
 * under", nor "and every key of every literal that encloses it". Nothing but a
 * walk of the tree produces the address, so the walk is code and this says what
 * the code should look for.
 *
 * `terminators` is the other half, and the half that makes the reading safe: a
 * value is a way in when it is a chain of calls whose last link is one of these
 * and whose argument is a function. That is a shape a repository does not write
 * by accident, and it is why this description needs no types to be sure of
 * itself — which matters, because a repository nobody has installed resolves
 * almost nothing and is the state most readers are pointed at.
 *
 * Every field says where something is or what something is called. None of them
 * says how to walk the tree.
 */
export const entryProcedureSchema = z.strictObject({
  /** How this is named in reports and on the entries it produces. */
  name: z.string().min(1),
  /**
   * Dependencies any one of which means this is in use.
   *
   * One configuration covers every repository of a project. An empty list means
   * the description is tried everywhere.
   */
  packages: z.array(z.string().min(1)).default([]),
  /**
   * Functions that assemble a tree out of one object literal.
   *
   * Names rather than types, and that is the one place this description is
   * looser than its HTTP counterpart. The builder is nearly always re-exported
   * through a file of the project's own — the value the library hands back is
   * taken apart and its pieces published under the project's own names — so the
   * type on the receiver is the project's, not the library's, and a row naming
   * the library's types would match nothing. What makes the looseness safe is
   * that a name alone is never enough: a call is only a tree once one of the
   * literal's values turns out to be a way in by the rule above.
   */
  assembledBy: z.array(z.string().min(1)).min(1),
  /**
   * The last link of a chain, and the kind of way in it opens.
   *
   * A lookup rather than a list, because the reader asks exactly one question of
   * it — what does this method mean — and the answer differs per spelling: one
   * of them reads and one of them writes, and a third may be a stream that is
   * not a request at all.
   */
  terminators: z.record(z.string().min(1), z.enum(ENTRY_KINDS)),
  /** How the keys down the tree are joined into one address. */
  separator: z.string().min(1).default('.'),
  /** The chain link carrying the shape of what a caller sends. */
  inputMethod: z.string().min(1).optional(),
  /**
   * The chain link that installs something in front of a way in.
   *
   * It is read on the chain and on whatever the chain starts from, because the
   * ordinary way to write this is to name the guarded starting point once and
   * then use it everywhere — which means the guard is nowhere near the way in it
   * protects.
   */
  guardMethod: z.string().min(1).optional(),
  /** Where a tree is hung so that requests reach it. */
  mounts: z.array(entryProcedureMountSchema).default([]),
});

export const adapterForceSchema = z.strictObject({
  entry: adapterNamesSchema.optional(),
  db: adapterNamesSchema.optional(),
  broker: adapterNamesSchema.optional(),
  frontend: adapterNamesSchema.optional(),
});

export const flowatlasConfigSchema = z
  .strictObject({
    services: z.array(serviceConfigSchema).default([]),
    /** Packages shared between repositories, followed when resolving constants. */
    sharedPackages: z.array(z.string().min(1)).default([]),
    adapters: z
      .strictObject({
        auto: z.boolean().default(true),
        force: adapterForceSchema.default({}),
        entry: z
          .strictObject({
            registries: z.array(entryRegistrySchema).default([]),
            /** Frameworks that register an HTTP route by calling an application. */
            http: z.array(entryHttpSchema).default([]),
            /** Frameworks whose ways in are the keys of a tree of object literals. */
            procedures: z.array(entryProcedureSchema).default([]),
          })
          .default({ registries: [], http: [], procedures: [] }),
        broker: z
          .strictObject({
            custom: z.array(customBrokerSchema).default([]),
          })
          .default({ custom: [] }),
        db: z
          .strictObject({
            /**
             * Classes declared in a repository that stand for its data layer.
             *
             * A project with its own repository base has no database package to
             * point at, so this is how it names one without the core learning
             * anything about the store behind it.
             */
            localBaseClasses: z.array(z.string().min(1)).default([]),
          })
          .default({ localBaseClasses: [] }),
        frontend: z
          .strictObject({
            /**
             * Classes declared in a repository that stand for its HTTP client.
             *
             * The browser's half of what `db.localBaseClasses` does for the data
             * half, and it is needed for the same reason: a class wrapping
             * `fetch` behind `get` and `post` is the normal way to write a front
             * end, and there is no package to point at. The reader recognises
             * such a class on its own wherever it can follow the class's own
             * verbs to the network; this is how a project says so where it
             * cannot — a base the verbs are inherited from, a transport reached
             * through a helper module, a repository whose dependencies are not
             * installed. Naming the class or any class it extends is enough.
             */
            localClientClasses: z.array(z.string().min(1)).default([]),
          })
          .default({ localClientClasses: [] }),
      })
      .default({
        auto: true,
        force: {},
        entry: { registries: [], http: [], procedures: [] },
        broker: { custom: [] },
        db: { localBaseClasses: [] },
        frontend: { localClientClasses: [] },
      }),
    /** Directory for generated artefacts, relative to the configuration file. */
    output: z.string().min(1).default(DEFAULT_OUTPUT),
    /**
     * How the two ends of a boundary are compared.
     *
     * `rules.disable` switches off one of the named rules about what happens to
     * a shape on the way through JSON, for a project whose wire does not work
     * that way. `ignoreEdges` is the annotation for code nobody can annotate: a
     * third party's consumer, or a repository that is not yours to edit.
     */
    contracts: z
      .strictObject({
        /** How far into nested shapes to compare before settling for a hash. */
        depth: z.number().int().min(1).default(DEFAULT_TYPE_MAX_DEPTH),
        rules: z
          .strictObject({ disable: z.array(z.string().min(1)).default([]) })
          .default({ disable: [] }),
        /** Boundaries whose drift is deliberate, as `from|type|to`. */
        ignoreEdges: z.array(z.string().min(1)).default([]),
      })
      .default({ depth: DEFAULT_TYPE_MAX_DEPTH, rules: { disable: [] }, ignoreEdges: [] }),
    /**
     * What a health check treats as already agreed to.
     *
     * `ignoreReasons` is for noise a project has decided to live with — a data
     * layer nothing describes yet, a bot whose triggers are all computed. Rows
     * of those reasons are still printed; they are only taken out of the number
     * `doctor --strict` compares with the baseline, so the setting quietens the
     * gate without hiding anything from the person reading the report.
     */
    doctor: z
      .strictObject({
        /** Where the accepted numbers live. Defaults to `<output>/baseline.json`. */
        baseline: z.string().min(1).optional(),
        /** Reasons left out of the growth check, still reported. */
        ignoreReasons: z.array(z.string().min(1)).default([]),
        /**
         * Decorators that mark a handler as public on purpose, so a route with no
         * guard in front of it is not reported as unguarded.
         */
        publicDecorators: z
          .array(z.string().min(1))
          .default(['Public', 'IsPublic', 'AllowAnonymous', 'SkipAuth']),
        /** Routes public by decision, as `METHOD /path`, with `*` for any run of characters. */
        publicRoutes: z.array(z.string().min(1)).default([]),
        /**
         * Guards that never refuse a request for who is asking — a rate limiter —
         * so a route with nothing else in front of it is still unguarded.
         */
        nonGateWrappers: z.array(z.string().min(1)).default(['ThrottlerGuard']),
        /**
         * Decorators that switch a guard off for one handler (a flag the guard
         * reads through the reflector), each with the guard classes it switches
         * off; an empty list means every guard. A route carrying one is audited
         * as if those guards were not there.
         */
        skipGuardDecorators: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
        markers: z
          .strictObject({
            /** Fail a strict run on a redundant annotation, not only a false one. */
            warnAsError: z.boolean().default(false),
          })
          .default({ warnAsError: false }),
      })
      .default({
        ignoreReasons: [],
        publicDecorators: ['Public', 'IsPublic', 'AllowAnonymous', 'SkipAuth'],
        publicRoutes: [],
        nonGateWrappers: ['ThrottlerGuard'],
        skipGuardDecorators: {},
        markers: { warnAsError: false },
      }),
    types: z
      .strictObject({
        /** How deep nested type structures are expanded before falling back to a reference. */
        maxDepth: z.number().int().min(1).default(DEFAULT_TYPE_MAX_DEPTH),
      })
      .default({ maxDepth: DEFAULT_TYPE_MAX_DEPTH }),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.services.forEach((service, index) => {
      if (seen.has(service.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['services', index, 'name'],
          message: `Duplicate service name ${JSON.stringify(service.name)}.`,
        });
      }
      seen.add(service.name);
    });

    // A target naming a service that does not exist is a typo that would
    // otherwise show up much later as a call that reaches nothing.
    const names = new Set(config.services.map((service) => service.name));
    config.services.forEach((service, index) => {
      for (const [key, target] of Object.entries(service.apiTarget ?? {})) {
        if (names.has(target)) continue;
        ctx.addIssue({
          code: 'custom',
          path: ['services', index, 'apiTarget', key],
          message: `${JSON.stringify(target)} is not a configured service.`,
        });
      }
    });
  });

export type CustomBrokerConfig = z.infer<typeof customBrokerSchema>;
export type EntryHttpConfig = z.infer<typeof entryHttpSchema>;
/**
 * A description as it is written, before the schema fills in what it leaves out.
 *
 * Exported so that the descriptions shipped with the tool can be written in the
 * same shape a person writes in configuration, and go through the same schema
 * on the way in. A shape nothing but configuration ever uses is a shape only
 * configuration has ever tested.
 */
export type EntryHttpDescription = z.input<typeof entryHttpSchema>;
export type EntryRegistryConfig = z.infer<typeof entryRegistrySchema>;
export type EntryProcedureConfig = z.infer<typeof entryProcedureSchema>;
/**
 * A description as it is written, before the schema fills in what it leaves out.
 *
 * Exported for the same reason its HTTP counterpart is: what ships with the tool
 * is written in the shape a person writes in configuration and goes in through
 * the same schema, so a field only configuration had ever tested cannot exist.
 */
export type EntryProcedureDescription = z.input<typeof entryProcedureSchema>;
export type CustomProducerConfig = z.infer<typeof customProducerSchema>;
export type CustomSubscriberConfig = z.infer<typeof customSubscriberSchema>;
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;
export type FlowatlasConfig = z.infer<typeof flowatlasConfigSchema>;

export interface LoadedConfig {
  config: FlowatlasConfig;
  /** Absolute path of the configuration file. */
  configPath: string;
  /** Directory holding the configuration file; every relative path is resolved against it. */
  rootDir: string;
  /** Absolute path of the output directory. */
  outputDir: string;
  /** Absolute path of a service's repository. */
  repoDir(service: ServiceConfig | string): string;
}

export interface LoadConfigOptions {
  /** Fail when a service repository directory is missing. Defaults to true. */
  checkRepos?: boolean;
}

const formatIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });

/** Validates an already-parsed object. `source` only labels error messages. */
export const parseConfig = (data: unknown, source = CONFIG_FILENAME): FlowatlasConfig => {
  const result = flowatlasConfigSchema.safeParse(data);
  if (!result.success) throw new ConfigInvalidError(source, formatIssues(result.error));
  return result.data;
};

/** Walks up from `startDir` looking for a configuration file. */
export const findConfig = (startDir: string = process.cwd()): string | undefined => {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Finds, reads and validates the configuration.
 *
 * `from` may be the configuration file itself or any directory below it.
 */
export const loadConfig = (
  from: string = process.cwd(),
  options: LoadConfigOptions = {},
): LoadedConfig => {
  const start = resolve(from);
  const configPath = isFile(start) ? start : findConfig(start);
  if (configPath === undefined) throw new ConfigNotFoundError(start);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (cause) {
    throw new ConfigInvalidError(
      configPath,
      [`not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`],
      'Check the file for a trailing comma or an unquoted key.',
    );
  }

  const config = parseConfig(raw, configPath);
  const rootDir = dirname(configPath);
  const repoDirOf = (service: ServiceConfig | string): string => {
    const found =
      typeof service === 'string'
        ? config.services.find((candidate) => candidate.name === service)
        : service;
    if (found === undefined) {
      throw new ConfigInvalidError(configPath, [
        `no service named ${JSON.stringify(String(service))}`,
      ]);
    }
    return isAbsolute(found.repo) ? found.repo : resolve(rootDir, found.repo);
  };

  if (options.checkRepos !== false) {
    // A declared service is checked on the one path it actually has. Its `repo`
    // is the document's directory, filled in by the schema, so checking that
    // instead would pass whenever the folder existed and the document did not —
    // and the failure would arrive much later, as a service with no routes.
    const missing = config.services.flatMap((service) => {
      if (service.openapi !== undefined) {
        const path = isAbsolute(service.openapi)
          ? service.openapi
          : resolve(rootDir, service.openapi);
        return isFile(path) ? [] : [`services.${service.name}.openapi: ${service.openapi} is not a file`];
      }
      return isDirectory(repoDirOf(service))
        ? []
        : [`services.${service.name}.repo: ${service.repo} is not a directory`];
    });
    if (missing.length > 0) {
      // Not "re-run init": when init was the thing that wrote them, running it
      // again writes the same paths and the reader is in a loop. Say what they
      // are relative to and let them look.
      throw new ConfigInvalidError(
        configPath,
        missing,
        `Each one is relative to ${dirname(configPath)}, the directory this file is in. Correct them there, or point services[].repo at an absolute path.`,
      );
    }
  }

  return {
    config,
    configPath,
    rootDir,
    outputDir: isAbsolute(config.output) ? config.output : resolve(rootDir, config.output),
    repoDir: repoDirOf,
  };
};
