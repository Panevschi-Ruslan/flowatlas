import type { Node as TsNode, Project } from 'ts-morph';

/**
 * Types a framework hands to a function the source left unannotated (R157).
 *
 * `procedure.use(async ({ ctx, next }) => { await ctx.db.order.findFirst() })`
 * annotates nothing. What `ctx` is was written once, a long way off, where the
 * framework's root was made - and it is the framework that carries it from there
 * to here, through its own generic types. With the framework installed the
 * checker follows that; with nothing installed it cannot, and the handler's
 * `ctx` is nothing at all.
 *
 * The reader that knows the framework knows both ends: which functions it hands
 * the context to, and where the context's type is written. The reader that
 * needs the type is another one - the one reading the data layer - and neither
 * may name the other. So the first records the fact here, as a written type
 * against the parameter it belongs to, and the second asks for it. Nothing in
 * this file knows what a context is.
 *
 * Kept per project and beside it rather than on any reader's context, because a
 * project is the one thing both readers are handed, and a type node is only
 * meaningful inside the project it was read from.
 */
export class SuppliedTypes {
  readonly #members = new Map<TsNode, Map<string, TsNode>>();

  /** Records that what `parameter` is handed carries `key`, of the type `written` states. */
  supply(parameter: TsNode, key: string, written: TsNode): void {
    const members = this.#members.get(parameter) ?? new Map<string, TsNode>();
    if (!members.has(key)) members.set(key, written);
    this.#members.set(parameter, members);
  }

  /** The type written for `key` of what `parameter` is handed, if a reader recorded one. */
  memberOf(parameter: TsNode, key: string): TsNode | undefined {
    return this.#members.get(parameter)?.get(key);
  }
}

const registries = new WeakMap<Project, SuppliedTypes>();

/** The types supplied in one project, made on first asking. */
export const suppliedTypes = (project: Project): SuppliedTypes => {
  let registry = registries.get(project);
  if (registry === undefined) {
    registry = new SuppliedTypes();
    registries.set(project, registry);
  }
  return registry;
};
