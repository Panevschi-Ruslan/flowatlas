import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { ConfigInvalidError, ConfigNotFoundError } from './errors.js';
import { ENTRY_KINDS } from './model/nodes.js';

export const CONFIG_FILENAME = 'flowatlas.config.json';
export const DEFAULT_OUTPUT = '.flowatlas';
export const DEFAULT_TYPE_MAX_DEPTH = 3;

/**
 * One repository of the project.
 *
 * `type` is an open string on purpose: the core must not know the names of the
 * frameworks it can be pointed at. The command line and the extractors own the
 * list of values they understand.
 */
export const serviceConfigSchema = z.strictObject({
  name: z.string().min(1),
  /** Path to the repository, relative to the configuration file. */
  repo: z.string().min(1),
  type: z.string().min(1),
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
          })
          .default({ registries: [], http: [] }),
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
      })
      .default({
        auto: true,
        force: {},
        entry: { registries: [], http: [] },
        broker: { custom: [] },
        db: { localBaseClasses: [] },
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
    const missing = config.services
      .filter((service) => !isDirectory(repoDirOf(service)))
      .map((service) => `services.${service.name}.repo: ${service.repo} is not a directory`);
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
