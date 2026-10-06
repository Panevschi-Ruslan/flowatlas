import type { FlowatlasConfig, ServiceConfig } from '../config.js';
import type { Unresolved } from '../model/graph.js';

/**
 * Ways in that are declared where a service is deployed rather than in its code.
 *
 * Every other reader finds a way in inside the source: a decorator, a call on an
 * application, a file in a routes directory. A service made of functions that a
 * platform invokes has none of those. Its handlers are plain exported functions,
 * and the facts that one of them is deployed under a name and that a route
 * lands on it are written in the files that describe the deployment, which no
 * type checker opens.
 *
 * This is the interface between a reader of such files and the entry adapter
 * that turns what it found into entries. It is stated here, and in these words,
 * so that a second reader of a second format can implement it and be handed to
 * the same adapter: nothing below names the format, the platform, or the tool
 * that writes the files. Only one reader exists today.
 *
 * Everything in it is what the files say, evaluated as far as the files alone
 * allow. A name the files do not settle is absent and a row says why; it is
 * never filled in with the parts that were settled (I3).
 */

/** The code a deployed function runs, as the deployment states it. */
export interface DeployedHandler {
  /** As written: `index.createLoan`, `handlers/loans.create`. */
  readonly written: string;
  /** The module part, relative to the source directory: `index`, `handlers/loans`. */
  readonly module: string;
  /** The name the module exports: `createLoan`. */
  readonly export: string;
  /**
   * The directory the deployment packages, repo-relative, when it could be read.
   *
   * Absent when the package is an archive built somewhere the files do not
   * describe; the adapter may then search for the module by name, and an edge
   * found that way says so.
   */
  readonly directory?: string;
  /** How the directory was found, for a reader who wants to check it. */
  readonly directoryFrom?: string;
}

/** One function the deployment creates. */
export interface DeployedFunction {
  /** Repo-relative path of the file declaring it. */
  readonly file: string;
  readonly line: number;
  /**
   * The name it is deployed under, when every part of it was read.
   *
   * This is what everything else joins to - a route integrating it, a workflow
   * invoking it, a rule targeting it - so it is absent rather than partial when
   * any part depends on something the files do not settle.
   */
  readonly name?: string;
  /** Where the declaration sits in its own format, for a person: unique per deployment. */
  readonly address: string;
  readonly handler?: DeployedHandler;
  /** The runtime, as written, when it was read. */
  readonly runtime?: string;
  /**
   * The values it is deployed with, by the name the code reads each under.
   *
   * Code very often names what it sends to by a variable rather than by a
   * literal - `process.env.RETURNS_QUEUE_URL` - and the value is set here and
   * nowhere else. Every variable the deployment sets is listed, read or not,
   * because a variable that is set to something unreadable and one that is not
   * set at all are two different things to tell the reader (P23).
   */
  readonly environment?: Readonly<Record<string, DeployedSetting>>;
  readonly meta?: Record<string, unknown>;
}

/**
 * The kinds of deployed thing a value, a source or a target can name, in words
 * that are the same on every platform.
 *
 * `bus` carries events selected by a pattern rather than addressed by a name;
 * `stream` is an ordered log a reader walks; a `table`'s changes can be read in
 * order as well.
 */
export type DeployedKind = 'function' | 'workflow' | 'queue' | 'topic' | 'bus' | 'table' | 'stream';

/** One value a function is deployed with. */
export interface DeployedSetting {
  /**
   * What the value is written as, for a reader: the reference
   * (`aws_sqs_queue.returns.url`) or the literal. Never parsed.
   */
  readonly written: string;
  /** The value, when it is text the files settle. */
  readonly text?: string;
  /**
   * What the value is an attribute of, when it is one of something deployed:
   * its URL, its ARN, its name. The name is the deployed name, which is what
   * everything joins on, so it is given even where the value itself - an ARN
   * the provider assigns - is not known until the thing is created.
   */
  readonly names?: { readonly kind: DeployedKind; readonly name: string };
  /** Why the value is not read, when it is not. */
  readonly unread?: {
    readonly text: string;
    /** The input variable it depends on, when that is the cause. */
    readonly variable?: string;
    /** Variable files and what each sets, when they disagree. */
    readonly files?: Readonly<Record<string, string>>;
  };
}

/**
 * Where a message is sent, by what the deployment names.
 *
 * An event put on a bus is named by the bus and by fields of the event itself
 * (`fields`, as the deployment's own pattern language spells them), because a
 * bus routes on what an event says rather than on where it was sent.
 */
export type MessageTarget =
  | { readonly kind: 'queue'; readonly name: string }
  | { readonly kind: 'topic'; readonly name: string }
  | { readonly kind: 'bus'; readonly name: string; readonly fields?: Readonly<Record<string, string>> };

/** What a delivery hands its messages to. */
export type DeliveryTarget =
  /** A function this deployment creates, by its position in `functions`. */
  | { readonly kind: 'function'; readonly function: number }
  /** A function deployed somewhere else, by its deployed name. */
  | { readonly kind: 'function'; readonly name: string }
  /** A workflow, by its deployed name: whoever declares it, here or elsewhere. */
  | { readonly kind: 'workflow'; readonly name: string }
  | MessageTarget;

/**
 * One filter on one value, as a deployment writes it.
 *
 * Alternatives in a list are any-of. `unread` is a filter this reading does not
 * evaluate - a numeric range, an address block - kept as written, which matches
 * nothing rather than everything.
 */
export type ValueFilter =
  | { readonly equals: string }
  | { readonly prefix: string }
  | { readonly suffix: string }
  | { readonly equalsIgnoreCase: string }
  | { readonly wildcard: string }
  | { readonly anythingBut: readonly ValueFilter[] }
  | { readonly exists: boolean }
  | { readonly unread: string };

/** The messages on a bus a pattern selects. */
export interface MessagePattern {
  /** Each field filtered, with its alternatives. A field not named is not filtered. */
  readonly fields: Readonly<Record<string, readonly ValueFilter[]>>;
  /** Filters on fields that are not matched on, as written. */
  readonly unmatched?: Readonly<Record<string, unknown>>;
}

/** Where a delivery takes its messages from. */
export type DeliverySource =
  | { readonly kind: 'queue'; readonly name: string }
  | { readonly kind: 'topic'; readonly name: string }
  | { readonly kind: 'bus'; readonly name: string; readonly pattern: MessagePattern }
  /** A clock: `expression` as the deployment writes it, when read. */
  | { readonly kind: 'schedule'; readonly expression?: string }
  /** The changes to a table, or the records of a stream, read in order. */
  | { readonly kind: 'changes'; readonly of: 'table' | 'stream'; readonly name: string };

/** What declares a delivery. */
export type DeliveryKind = 'rule' | 'subscription' | 'mapping' | 'schedule' | 'pipe' | 'redrive';

/**
 * One way messages reach something: a rule's target, a subscription, a mapping
 * from a queue or a stream to a function, a schedule, a pipe, a queue's
 * redrive to the queue its failures go to.
 *
 * These are the subscribers code never states: the publishing half of a
 * channel is a call in a handler, and this half is in the deployment.
 */
export interface DeployedDelivery {
  readonly file: string;
  readonly line: number;
  /** Where it is declared, in the deployment's own terms: unique per deployment. */
  readonly address: string;
  readonly by: DeliveryKind;
  /** The name the deployment gives the rule, schedule or pipe, when read. */
  readonly name?: string;
  readonly from: DeliverySource;
  /**
   * Absent when the target was not read; a row says why. The source is still
   * drawn as having a reader, because something does read it.
   */
  readonly to?: DeliveryTarget;
  readonly meta?: Record<string, unknown>;
}

/** What answers a route. */
export type RouteTarget =
  /** A function this deployment creates, by its position in `functions`. */
  | { readonly function: number }
  /** A function created somewhere else, by the name it is deployed under. */
  | { readonly name: string }
  /**
   * A queue, a topic or a bus the route sends the request to itself, with no
   * function in between: the route is the way in and a publisher (P23).
   */
  | { readonly sends: MessageTarget };

/** One HTTP route the deployment exposes. */
export interface DeployedRoute {
  readonly file: string;
  readonly line: number;
  readonly method: string;
  /**
   * The path, normalised, with `UNREAD_SPAN` at the front when the route hangs
   * from a point another repository publishes (`root`).
   */
  readonly path: string;
  /** The path as the deployment writes it. */
  readonly rawPath: string;
  /** The API it belongs to, by name, when that was read. */
  readonly api?: string;
  readonly target?: RouteTarget;
  /**
   * The route hangs from a point of the API published somewhere else.
   *
   * `key` is that point's address in a namespace both sides can spell - a
   * parameter's name, another deployment's output - and `below` is the part of
   * the path this deployment adds. The linker joins the two (P21).
   */
  readonly root?: { readonly key: string; readonly below: string };
  /** What stands in front of the route: an authoriser, by what the deployment calls it. */
  readonly guards?: readonly { readonly label: string; readonly file: string; readonly line: number }[];
  readonly meta?: Record<string, unknown>;
}

/** A point of an API this deployment publishes for other deployments to hang routes from. */
export interface PublishedRoot {
  readonly key: string;
  /** The path of that point, normalised. */
  readonly path: string;
  readonly api?: string;
  readonly file: string;
  readonly line: number;
}

/** Where something inside a document is written, 1-based, as an editor counts. */
export interface DefinitionPosition {
  readonly line: number;
  readonly column: number;
}

/**
 * A workflow's definition, as the deployment hands it over.
 *
 * Either text in a format of its own - a definition file loaded by path, a
 * template rendered with its variables, a document written in place - or a
 * value the deployment's own language builds, which has no text and is placed
 * by where each member of it is written. Both say which file a reader should
 * open to see it.
 */
export type DeployedDefinition =
  | {
      readonly kind: 'text';
      /** Repo-relative file the text is in: a definition, a template, or the deployment file itself. */
      readonly file: string;
      readonly text: string;
      readonly format: 'json' | 'yaml';
      /** The line of `file` the text's first line is on: 1 for a file of its own. */
      readonly firstLine: number;
    }
  | {
      readonly kind: 'value';
      readonly file: string;
      readonly value: unknown;
      /** Where the member at `path` is written in `file`, or where the value is built. */
      at(path: readonly (string | number)[]): DefinitionPosition | undefined;
    };

/** One workflow the deployment creates. */
export interface DeployedWorkflow {
  /** Repo-relative path of the file declaring it. */
  readonly file: string;
  readonly line: number;
  /**
   * The name it is deployed under, when every part of it was read: what a step
   * of another workflow, a rule or a handler starts it by. Absent rather than
   * partial, as a function's is.
   */
  readonly name?: string;
  /** Where the declaration sits in its own format, for a person: unique per deployment. */
  readonly address: string;
  /** Absent when the definition could not be read; a row says why. */
  readonly definition?: DeployedDefinition;
  /**
   * What a `${...}` placeholder left in the definition stands for, once the
   * deployment fills it in, and `undefined` where the files do not say.
   *
   * A deployment fills some placeholders with names it knows only as references
   * to what it creates - a function, another workflow - and this is the value
   * the definition holds once they are filled, spelled the way the definition
   * would spell it, so the reader of the definition needs no second way to read
   * a name.
   */
  fill(placeholder: string): string | undefined;
  readonly meta?: Record<string, unknown>;
}

/** Everything one reader found in one repository. */
export interface Deployment {
  readonly functions: readonly DeployedFunction[];
  readonly routes: readonly DeployedRoute[];
  readonly roots: readonly PublishedRoot[];
  readonly workflows: readonly DeployedWorkflow[];
  /** The subscribers it declares (P23). */
  readonly deliveries: readonly DeployedDelivery[];
  /** What could not be read, with repo-relative files. */
  readonly rows: readonly Unresolved[];
}

export interface DeploymentReadOptions {
  /** Absolute path of the repository. */
  readonly repoDir: string;
  readonly service?: ServiceConfig;
  readonly config: FlowatlasConfig;
}

/** A reader of one format of deployment description. */
export interface DeploymentReader {
  /** Names the format in reports. */
  readonly name: string;
  /**
   * Whether the repository describes a deployment this reader reads anything
   * from. Cheap: asked during detection, before any source is parsed. The
   * configuration is offered because a description it holds can be what makes
   * a declaration readable.
   */
  declares(repoDir: string, config?: FlowatlasConfig): boolean;
  read(options: DeploymentReadOptions): Deployment;
  /**
   * Every file whose change can change what `read` returns, repo-relative, so a
   * build that caches what it read knows when to read it again. Offered what
   * `read` is offered, because which files a reading loads can depend on it.
   */
  files(repoDir: string, options?: Omit<DeploymentReadOptions, 'repoDir'>): readonly string[];
}
