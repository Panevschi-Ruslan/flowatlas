import { fieldSetNames, fieldSetSelections, type ComposedType, type Composition } from './federation.js';
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
  /** The field whose `@requires` asked for this one. */
  readonly requiredBy?: string;
  /** Planned under a field that was itself a choice. */
  readonly underChoice?: true;
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

export const planSelection = (composition: Composition, operation: 'query' | 'mutation' | 'subscription', fields: readonly MetaField[]): PlanStep[] => {
  const steps: PlanStep[] = [];
  const rootType = composition.roots[operation] ?? ({ query: 'Query', mutation: 'Mutation', subscription: 'Subscription' } as const)[operation];

  const walk = (
    type: string,
    selected: readonly MetaField[],
    current: string | undefined,
    provided: ReadonlyMap<string, readonly Selection[]> | undefined,
    context: { underChoice: boolean; requiredBy?: string },
    depth: number,
  ): void => {
    if (depth > MAX_DEPTH) return;
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
      const hop =
        current !== undefined && !stays
          ? { entity: owner, from: current, resolvable: chosen.every((subgraph) => (composedType?.keys?.[subgraph]?.length ?? 0) > 0) }
          : undefined;
      steps.push({
        type: owner,
        field: one.field,
        selected: one,
        subgraphs: chosen,
        ...(hop === undefined ? {} : { hop }),
        ...(context.requiredBy === undefined ? {} : { requiredBy: context.requiredBy }),
        ...(context.underChoice ? { underChoice: true as const } : {}),
      });
      const choice = context.underChoice || chosen.length > 1;
      for (const subgraph of chosen) {
        const declared = composed.owners.find((each) => each.subgraph === subgraph);
        // What the field requires is fetched by its owners, from the parent's subgraph.
        if (declared?.requires !== undefined && current !== undefined) {
          walk(owner, asSelections(fieldSetSelections(declared.requires), one.line, one.file), current, undefined, { underChoice: choice, requiredBy: `${owner}.${one.field}` }, depth + 1);
        }
        if (one.selections === undefined) continue;
        // A field the parent provides is resolved where the parent is, and so is what it provides below it.
        const below = stays && current === subgraph && provided?.has(one.field) === true ? providedFrom(provided.get(one.field)) : providedBy(declared?.provides);
        walk(namedTypeIn(composed.type), one.selections, subgraph, below, { underChoice: choice }, depth + 1);
      }
    }
  };

  walk(rootType, fields, undefined, undefined, { underChoice: false }, 0);
  return steps;
};

/** What a provided field provides below it, as a lookup of the same shape. */
const providedFrom = (selections: readonly Selection[] | undefined): ReadonlyMap<string, readonly Selection[]> | undefined => {
  if (selections === undefined || selections.length === 0) return undefined;
  const found = new Map<string, readonly Selection[]>();
  for (const selection of selections) if (selection.kind === 'field') found.set(selection.name, selection.selections);
  return found;
};
