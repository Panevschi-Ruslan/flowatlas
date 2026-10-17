import type {
  ClassDeclaration,
  GetAccessorDeclaration,
  MethodDeclaration,
  PropertyDeclaration,
} from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * A class's members by name, read from one walk of them (P124).
 *
 * `getMethod(name)`, `getProperty(name)` and `getGetAccessor(name)` each walk
 * every member of the class and wrap it, so a read that names a method once
 * per call costs calls x members, and on a class with many methods that walk
 * is most of the read. This answers the same questions from maps built once.
 *
 * The answers are ts-morph's own: each list is the class's members of that
 * kind in member order - which leaves out an overload signature outside a
 * declaration file and keeps an abstract method, as `getMembers` does - and a
 * name answers with the first member of the kind that has it. A static and an
 * instance member of one name are both on the list, so the first written wins,
 * as it does there; a computed name is its text, brackets and all.
 */
export interface ClassMembers {
  readonly methods: readonly MethodDeclaration[];
  readonly properties: readonly PropertyDeclaration[];
  method(name: string): MethodDeclaration | undefined;
  property(name: string): PropertyDeclaration | undefined;
  getAccessor(name: string): GetAccessorDeclaration | undefined;
}

/** The first of each name, in the order given. */
const firstByName = <T extends { getName(): string }>(members: readonly T[]): Map<string, T> => {
  const out = new Map<string, T>();
  for (const member of members) {
    const name = member.getName();
    if (!out.has(name)) out.set(name, member);
  }
  return out;
};

const build = (owner: ClassDeclaration): ClassMembers => {
  const methods: MethodDeclaration[] = [];
  const properties: PropertyDeclaration[] = [];
  const getters: GetAccessorDeclaration[] = [];
  for (const member of owner.getMembers()) {
    if (Node.isMethodDeclaration(member)) methods.push(member);
    else if (Node.isPropertyDeclaration(member)) properties.push(member);
    else if (Node.isGetAccessorDeclaration(member)) getters.push(member);
  }
  const methodNamed = firstByName(methods);
  const propertyNamed = firstByName(properties);
  const getterNamed = firstByName(getters);
  return {
    methods,
    properties,
    method: (name) => methodNamed.get(name),
    property: (name) => propertyNamed.get(name),
    getAccessor: (name) => getterNamed.get(name),
  };
};

/**
 * Keyed by the compiler's node for the class rather than by ts-morph's
 * wrapper, like the call index (P79): a watch that refreshes a file in place
 * keeps the wrapper and replaces every compiler node in it, so a wrapper key
 * would answer with the members of the old text. The old node becomes
 * unreachable, and its entry goes with it.
 */
const INDEXES = new WeakMap<object, ClassMembers>();

export const classMembersOf = (owner: ClassDeclaration): ClassMembers => {
  const key = owner.compilerNode;
  let members = INDEXES.get(key);
  if (members === undefined) {
    members = build(owner);
    INDEXES.set(key, members);
  }
  return members;
};
