/**
 * The libraries that build a server action out of a function, described rather
 * than implemented.
 *
 * A server action written by hand is an exported function, and the directive
 * above it is the whole of the declaration. The commoner spelling by an order
 * of magnitude is a builder: a client object is asked for a schema, and the
 * call that ends the chain is handed the function that does the work. Nothing
 * about the export is a function declaration, so a reader looking for one finds
 * nothing at all.
 *
 * What separates the two is one fact: which argument of which method is the
 * action. That is a fact about a library, so it is a row here rather than a
 * branch in the reader — the same shape `route-dialects.ts` uses, and for the
 * same reason. A second library is a row; a second reader would be a second
 * copy of the rules about directives, exports and handlers.
 *
 * Only a method call is described, because that is what a builder is: the chain
 * that carries the schema has to end somewhere, and it ends in a call on what
 * the previous step returned. A library whose action is built by a bare
 * function call rather than by a chain is not read, and the aggregate row that
 * already names unbuilt exports says so.
 */

/** A library that turns a function into a server action. */
export interface ActionBuilder {
  /** How the description is named on the entries it reads. */
  readonly name: string;
  /** Dependencies any one of which means this library is in use. */
  readonly packages: readonly string[];
  /**
   * The methods that receive the action, and which argument it is.
   *
   * A record rather than a list because that is how it is asked: the reader has
   * a method name in its hand and wants the argument position, which is a
   * lookup and not a search.
   */
  readonly methods: Readonly<Record<string, number>>;
}

/**
 * next-safe-action, which is what the measured repository is written with.
 *
 * `client.schema(input).action(async ({ input }) => …)` is the whole of it, and
 * `stateAction` is the same thing for a form bound to the framework's own state
 * hook. Both take the action as their only argument.
 *
 * Its older spelling, `action(schema, fn)` called as a bare function rather
 * than on a client, is deliberately not here: it is not a method call, so the
 * shape this file describes cannot say it, and claiming otherwise would be a
 * row that reads nothing.
 */
export const NEXT_SAFE_ACTION: ActionBuilder = {
  name: 'next-safe-action',
  packages: ['next-safe-action'],
  methods: { action: 0, stateAction: 0 },
};

/**
 * zsa, the second library, and the reason this is a table.
 *
 * It spells the same chain with different names — `createServerAction()
 * .input(schema).handler(async ({ input }) => …)` — and needed nothing of the
 * description that the first one did not already ask for. That is what a
 * description is for: the second library was a row.
 */
export const ZSA: ActionBuilder = {
  name: 'zsa',
  packages: ['zsa', '@zsa/zsa'],
  methods: { handler: 0 },
};

/** Every library that builds a server action from a function. */
export const ACTION_BUILDERS: readonly ActionBuilder[] = [NEXT_SAFE_ACTION, ZSA];
