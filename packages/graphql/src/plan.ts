import { contextName, fieldSetNames, fieldSetSelections, type ComposedType, type Composition } from './federation.js';
import type { MetaField } from './meta.js';
import type { Selection } from './parse.js';
import { namedTypeIn } from './schema.js';

/**
 * An operation planned across a federated graph (P241), statically: for each
 * field it selects, the subgraph that resolves it, as the router decides.
 *
 * Walking down from the root type, a field stays in the subgraph that fetches
 * its parent when that subgraph resolves it, provides it (`@provides` on the
 * parent field) or holds it as a key of the entity (it arrives in the
 * representation). Otherwise the router makes an entity call to the field's
 * owner - a hop, which runs the owner's reference resolver (D5). A field with
 * `@requires` is planned after the fields it requires, which are planned as
 * if selected beside it (D7).
 *
 * Where more than one subgraph could answer and none is the parent's - a
 * shareable root field, a progressive override - every one is named and the
 * step is a choice (D6); the router decides by cost at run time, and nothing
 * here guesses which.
 *
 * Entity interfaces (P245). A subgraph that knows an interface only as an
 * `@interfaceObject` resolves the fields it adds to every implementation as
 * the interface's (`as`), and an entity call into it is for the interface.
 * Where such a subgraph fetched the parent, it cannot say which of the
 * interface's types a value is, so a fragment on one of them, or
 * `__typename`, is an entity call for the interface to the subgraph that owns
 * it, whose reference resolver answers with the type.
 *
 * Contexts (P245). An argument the router fills with `@fromContext` is
 * planned as a dependency of its field: the fields it selects, fetched from
 * the nearest type above it in the selection that sets the context, by the
 * subgraph that fetched that type. Where nothing above it does, the step
 * says so (`unset`) rather than guess one.
 */
export interface PlanStep {
  readonly type: string;
  readonly field: string;
  /** The selection it plans, for its line and alias. */
  readonly selected: MetaField;
  /** The subgraphs that resolve it here: more than one is a choice. */
  readonly subgraphs: readonly string[];
  /** An entity call: the entity fetched from `subgraphs`, with the subgraph that fetched its parent. */
  readonly hop?: { readonly entity: string; readonly from: string; readonly resolvable: boolean };
  /** The field whose `@requires` asked for this one, or whose argument it fills from a context. */
  readonly requiredBy?: string;
  /** Planned under a field that was itself a choice. */
  readonly underChoice?: true;
  /** The type a subgraph resolves the field under where it is not `type`: an interface object's interface (P245). */
  readonly as?: Readonly<Record<string, string>>;
  /** The context this step fetches a field of, for an argument of `requiredBy` (P245). */
  readonly fromContext?: string;
  /** Arguments the field takes from a context no type above it in this selection sets, so not planned (P245). */
  readonly unset?: ReadonlyArray<{ readonly argument: string; readonly context: string }>;
}

/** The deepest a selection is followed, as the linker follows one. */
const MAX_DEPTH = 32;

/** Whether a subgraph holds a field as part of a key it names the entity by. */
const holdsAsKey = (type: ComposedType | undefined, subgraph: string, field: string): boolean =>
  [...(type?.keys?.[subgraph] ?? []), ...(type?.stubs?.[subgraph] ?? [])].some((fields) => fieldSetNames(fields).includes(field));

/** A field set written in a directive, as selections a plan can walk, at the line of the field that wrote it. */
const asSelections = (selections: readonly Selection[], line: number, file: string | undefined): MetaField[] =>
  selections.flatMap((selection): MetaField[] =>
    selection.kind === 'field'
      ? [{ field: selection.name, line, ...(file === undefined ? {} : { file }), ...(selection.selections.length === 0 ? {} : { selections: asSelections(selection.selections, line, file) }) }]
      : selection.kind === 'inline'
        ? asSelections(selection.selections, line, file).map((inner) => ({ ...inner, ...(selection.on === undefined ? {} : { on: selection.on }) }))
        : [],
  );

/** The fields a parent field provides, by name, with what each provides below it. */
const providedBy = (provides: string | undefined): ReadonlyMap<string, readonly Selection[]> | undefined => {
  if (provides === undefined) return undefined;
  const found = new Map<string, readonly Selection[]>();
  for (const selection of fieldSetSelections(provides)) if (selection.kind === 'field') found.set(selection.name, selection.selections);
  return found;
};

/** The subgraphs that own an interface, as opposed to knowing it as an interface object: those that key it as itself. */
const interfaceOwners = (type: ComposedType | undefined): string[] =>
  Object.keys(type?.keys ?? {})
    .filter((subgraph) => !(type?.interfaceObjects ?? []).includes(subgraph))
    .sort();

/** A level of the selection above a field: the type a subgraph fetched there. */
interface Level {
  readonly type: string;
  readonly subgraph: string | undefined;
}

/** What a walk carries down: whether it is under a choice, and the field it plans a dependency of. */
interface Carried {
  readonly underChoice: boolean;
  readonly requiredBy?: string;
  readonly fromContext?: string;
}

export const planSelection = (composition: Composition, operation: 'query' | 'mutation' | 'subscription', fields: readonly MetaField[]): PlanStep[] => {
  const steps: PlanStep[] = [];
  const rootType = composition.roots[operation] ?? ({ query: 'Query', mutation: 'Mutation', subscription: 'Subscription' } as const)[operation];

  /** The nearest level that sets a context: the type it is set on there, and the subgraph that fetched it. */
  const setterOf = (context: string, levels: readonly Level[]): Level | undefined => {
    for (const level of levels) {
      const candidates = [level.type, ...(composition.types[level.type]?.possible ?? [])];
      const setter = candidates.find((name) => composition.types[name]?.contexts?.includes(context) === true);
      if (setter !== undefined) return { type: setter, subgraph: level.subgraph };
    }
    return undefined;
  };

  const marks = (context: Carried): Partial<Pick<PlanStep, 'requiredBy' | 'underChoice' | 'fromContext'>> => ({
    ...(context.requiredBy === undefined ? {} : { requiredBy: context.requiredBy }),
    ...(context.fromContext === undefined ? {} : { fromContext: context.fromContext }),
    ...(context.underChoice ? { underChoice: true as const } : {}),
  });

  const walk = (
    type: string,
    selected: readonly MetaField[],
    current: string | undefined,
    provided: ReadonlyMap<string, readonly Selection[]> | undefined,
    context: Carried,
    ancestors: readonly Level[],
    depth: number,
  ): void => {
    if (depth > MAX_DEPTH) return;
    const parentType = composition.types[type];
    const asObject = current !== undefined && parentType?.interfaceObjects?.includes(current) === true;
    // Which of the interface's types a value is, asked of the interface's owner (P245).
    const asked = asObject ? selected.find((one) => (one.on !== undefined && one.on !== type) || one.field === '__typename') : undefined;
    const owning = interfaceOwners(parentType);
    if (asked !== undefined && current !== undefined && owning.length > 0) {
      steps.push({ type, field: '__typename', selected: asked, subgraphs: owning, hop: { entity: type, from: current, resolvable: true }, ...marks(context) });
    }
    for (const one of selected) {
      if (one.field === '__typename') continue;
      const owner = one.on ?? type;
      const composedType = composition.types[owner];
      const composed = composedType?.fields[one.field];
      if (composed === undefined || composed.owners.length === 0) continue;
      const owners = composed.owners.map((each) => each.subgraph);
      const progressive = composed.owners.some((each) => each.label !== undefined);
      const stays = current !== undefined && (owners.includes(current) || provided?.has(one.field) === true || holdsAsKey(composedType, current, one.field));
      const chosen = stays && !(progressive && owners.includes(current as string)) ? [current as string] : owners;
      const as = Object.fromEntries(composed.owners.flatMap((each) => (each.as !== undefined && chosen.includes(each.subgraph) ? [[each.subgraph, each.as]] : [])));
      // The entity an entity call is for: the interface where the field is an interface object's,
      // or where the parent came from a subgraph that knows only the interface.
      const entity = (Object.values(as)[0] as string | undefined) ?? (asObject && owner !== type ? type : owner);
      const hop =
        current !== undefined && !stays
          ? { entity, from: current, resolvable: chosen.every((subgraph) => (composition.types[entity]?.keys?.[subgraph]?.length ?? 0) > 0) }
          : undefined;
      const levels: Level[] = [{ type: owner, subgraph: current }, ...(owner === type ? [] : [{ type, subgraph: current }]), ...[...ancestors].reverse()];
      const filled = chosen.flatMap((subgraph) => composed.owners.find((each) => each.subgraph === subgraph)?.context ?? []);
      const unset = filled.filter((argument) => setterOf(argument.context, levels) === undefined).map((argument) => ({ argument: argument.argument, context: contextName(argument.context) }));
      steps.push({
        type: owner,
        field: one.field,
        selected: one,
        subgraphs: chosen,
        ...(hop === undefined ? {} : { hop }),
        ...marks(context),
        ...(Object.keys(as).length === 0 ? {} : { as }),
        ...(unset.length === 0 ? {} : { unset }),
      });
      const choice = context.underChoice || chosen.length > 1;
      for (const subgraph of chosen) {
        const declared = composed.owners.find((each) => each.subgraph === subgraph);
        // What the field requires is fetched by its owners, from the parent's subgraph.
        if (declared?.requires !== undefined && current !== undefined) {
          walk(owner, asSelections(fieldSetSelections(declared.requires), one.line, one.file), current, undefined, { underChoice: choice, requiredBy: `${owner}.${one.field}` }, ancestors, depth + 1);
        }
        // What an argument takes from a context is fetched where the context is set, before the field (P245).
        for (const argument of declared?.context ?? []) {
          const setter = setterOf(argument.context, levels);
          if (setter === undefined) continue;
          walk(
            setter.type,
            asSelections(fieldSetSelections(argument.selection), one.line, one.file),
            setter.subgraph,
            undefined,
            { underChoice: choice, requiredBy: `${owner}.${one.field}`, fromContext: contextName(argument.context) },
            [],
            depth + 1,
          );
        }
        if (one.selections === undefined) continue;
        // A field the parent provides is resolved where the parent is, and so is what it provides below it.
        const below = stays && current === subgraph && provided?.has(one.field) === true ? providedFrom(provided.get(one.field)) : providedBy(declared?.provides);
        walk(namedTypeIn(composed.type), one.selections, subgraph, below, { underChoice: choice }, [...ancestors, { type: owner, subgraph: current }], depth + 1);
      }
    }
  };

  walk(rootType, fields, undefined, undefined, { underChoice: false }, [], 0);
  return steps;
};

/** What a provided field provides below it, as a lookup of the same shape. */
const providedFrom = (selections: readonly Selection[] | undefined): ReadonlyMap<string, readonly Selection[]> | undefined => {
  if (selections === undefined || selections.length === 0) return undefined;
  const found = new Map<string, readonly Selection[]>();
  for (const selection of selections) if (selection.kind === 'field') found.set(selection.name, selection.selections);
  return found;
};
