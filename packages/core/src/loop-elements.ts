import { Node, VariableDeclarationKind, type Node as TsNode } from 'ts-morph';
import { evaluateExpression } from './static-value.js';

/**
 * The elements a loop hands its variables, where the code states them (P271).
 *
 * A service that starts one worker per queue writes the start once, inside a
 * loop over a record of handlers or a list of names -
 * `for (const name of Object.keys(handlers)) new Worker(name, ...)` - and the
 * queues are the keys of the record. The variable is one name in the source
 * and as many values as the record has keys; read as one value it is none.
 * So a loop is read here as the elements it walks, each with what every
 * variable it declares holds for that element, wherever the list or record is
 * written out: a record's keys, values or entries, an enum's members, a list
 * written out (spreads of lists written out included), and what a list
 * method that keeps elements answers.
 */

/** What one variable holds for one element. */
export interface TakenElement {
  /** The string the element reads as: a record's key, or a value that evaluates to one. */
  readonly name?: string;
  /** Where the element is written, where it is: an element of a list, a record's value. */
  readonly value?: TsNode;
}

/** Each element as every variable the loop declares holds it, keyed by the variable's declaration. */
export type LoopElement = ReadonlyMap<TsNode, TakenElement>;

export type LoopReading =
  | { readonly source: TsNode; readonly elements: readonly LoopElement[] }
  | { readonly source: TsNode; readonly why: string };

/** How many elements one loop is read as, at most. */
const MOST_ELEMENTS = 256;
/** How many bindings and spreads a list is followed through. */
const MOST_LINKS = 8;

/** The methods of a list that hand each element of it, as it is, to a callback. */
const ITERATING = new Set(['forEach', 'map', 'flatMap', 'filter', 'some', 'every', 'find', 'findLast']);
/** The methods of a list whose answer holds elements of it, as they are. */
const KEEPING = new Set(['filter', 'slice', 'reverse', 'sort', 'toSorted', 'toReversed', 'concat']);

const peeled = (node: TsNode): TsNode => {
  let current = node;
  for (let step = 0; step < MOST_LINKS; step += 1) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
  return current;
};

/** The declaration a name stands for, past an import. */
const declared = (node: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (declaration !== undefined && (Node.isImportSpecifier(declaration) || Node.isImportClause(declaration))) {
    return symbol?.getAliasedSymbol()?.getDeclarations()[0];
  }
  return declaration;
};

/** What a name of a `const` (or of an enum) is written as, past bindings and assertions. */
const written = (node: TsNode): TsNode => {
  let current = peeled(node);
  for (let step = 0; step < MOST_LINKS; step += 1) {
    const declaration = declared(current);
    if (declaration !== undefined && Node.isEnumDeclaration(declaration)) return declaration;
    if (
      declaration === undefined ||
      !Node.isVariableDeclaration(declaration) ||
      declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
    ) {
      return current;
    }
    const initial = declaration.getInitializer();
    if (initial === undefined) return current;
    current = peeled(initial);
  }
  return current;
};

/** A key as the source spells it: a word, a string, a number, a computed key that evaluates to one. */
const keyText = (name: TsNode): string | undefined => {
  if (Node.isIdentifier(name) || Node.isPrivateIdentifier(name)) return name.getText();
  if (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) return name.getLiteralValue();
  if (Node.isNumericLiteral(name)) return String(name.getLiteralValue());
  if (Node.isComputedPropertyName(name)) {
    const value = evaluateExpression(name.getExpression());
    return value.resolved && (typeof value.value === 'string' || typeof value.value === 'number') ? String(value.value) : undefined;
  }
  return undefined;
};

/** The string a value written out evaluates to, where it does. */
const nameOf = (value: TsNode): string | undefined => {
  const read = evaluateExpression(value);
  return read.resolved && typeof read.value === 'string' ? read.value : undefined;
};

export type RecordEntries = { readonly entries: readonly { key: string; value?: TsNode }[] } | { readonly why: string };

/** A record's entries, in order, past spreads of records written out; an enum's members. */
const entriesOf = (record: TsNode, depth = 0): RecordEntries => {
  const value = written(record);
  if (Node.isEnumDeclaration(value)) {
    return {
      entries: value.getMembers().map((member) => {
        const initial = member.getInitializer();
        return { key: member.getName(), ...(initial === undefined ? {} : { value: initial }) };
      }),
    };
  }
  if (!Node.isObjectLiteralExpression(value)) return { why: `${record.getText().slice(0, 60)} is not a record written out.` };
  const entries: { key: string; value?: TsNode }[] = [];
  for (const property of value.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      if (depth >= MOST_LINKS) return { why: `${property.getText().slice(0, 60)} spreads too deep to read.` };
      const inner = entriesOf(property.getExpression(), depth + 1);
      if ('why' in inner) return inner;
      for (const each of inner.entries) {
        const at = entries.findIndex((entry) => entry.key === each.key);
        if (at >= 0) entries.splice(at, 1);
        entries.push(each);
      }
      continue;
    }
    const key = keyText(property.getNameNode());
    if (key === undefined) return { why: `${property.getNameNode().getText().slice(0, 60)} is a key worked out when the code runs.` };
    const held = Node.isPropertyAssignment(property)
      ? property.getInitializer()
      : Node.isShorthandPropertyAssignment(property)
        ? property.getNameNode()
        : property;
    const at = entries.findIndex((entry) => entry.key === key);
    if (at >= 0) entries.splice(at, 1);
    entries.push({ key, ...(held === undefined ? {} : { value: held }) });
  }
  return { entries };
};

/**
 * What a record written out holds under each key, in order, past spreads of
 * records written out; an enum's members. Or why it cannot be read.
 */
export const recordEntriesOf = (record: TsNode): RecordEntries => entriesOf(record);

/** One element of a list as the loop's single variable takes it: the pair of an entry, or one value. */
type Element = { readonly name?: string; readonly value?: TsNode; readonly pair?: readonly [TakenElement, TakenElement] };

type Elements = { readonly elements: readonly Element[] } | { readonly why: string };

const tooMany = (source: TsNode): Elements => ({ why: `${source.getText().slice(0, 60)} holds more elements than are read.` });

/** The elements a list written out holds, in order. */
const elementsOf = (list: TsNode, depth = 0): Elements => {
  if (depth > MOST_LINKS) return { why: `${list.getText().slice(0, 60)} is built too deep to read.` };
  const value = written(list);
  if (Node.isArrayLiteralExpression(value)) {
    const out: Element[] = [];
    for (const element of value.getElements()) {
      if (Node.isSpreadElement(element)) {
        const inner = elementsOf(element.getExpression(), depth + 1);
        if ('why' in inner) return inner;
        out.push(...inner.elements);
        continue;
      }
      const name = nameOf(element);
      out.push({ value: element, ...(name === undefined ? {} : { name }) });
    }
    return out.length > MOST_ELEMENTS ? tooMany(list) : { elements: out };
  }
  if (Node.isNewExpression(value) && value.getExpression().getText() === 'Set') {
    const [source] = value.getArguments();
    return source === undefined ? { elements: [] } : elementsOf(source, depth + 1);
  }
  if (Node.isCallExpression(value)) {
    const callee = peeled(value.getExpression());
    const [first] = value.getArguments();
    if (Node.isPropertyAccessExpression(callee)) {
      const method = callee.getName();
      const receiver = callee.getExpression();
      if (receiver.getText() === 'Object' && first !== undefined && (method === 'keys' || method === 'values' || method === 'entries')) {
        const record = entriesOf(first);
        if ('why' in record) return record;
        if (record.entries.length > MOST_ELEMENTS) return tooMany(first);
        return {
          elements: record.entries.map(({ key, value: held }): Element => {
            if (method === 'keys') return { name: key };
            const name = held === undefined ? undefined : nameOf(held);
            const asValue: TakenElement = { ...(held === undefined ? {} : { value: held }), ...(name === undefined ? {} : { name }) };
            if (method === 'values') return asValue;
            return { pair: [{ name: key }, asValue] };
          }),
        };
      }
      if (receiver.getText() === 'Array' && method === 'from' && first !== undefined) return elementsOf(first, depth + 1);
      if (KEEPING.has(method)) {
        const kept = elementsOf(receiver, depth + 1);
        if ('why' in kept || method !== 'concat') return kept;
        const out = [...kept.elements];
        for (const more of value.getArguments()) {
          const inner = elementsOf(more, depth + 1);
          if ('why' in inner) return inner;
          out.push(...inner.elements);
        }
        return { elements: out };
      }
    }
  }
  const read = evaluateExpression(value);
  if (read.resolved && Array.isArray(read.value) && read.value.every((each) => typeof each === 'string')) {
    return read.value.length > MOST_ELEMENTS ? tooMany(list) : { elements: (read.value as string[]).map((name) => ({ name })) };
  }
  return { why: `${list.getText().slice(0, 60)} is not a list written out.` };
};

/** Where a loop's variables are declared, and the list it walks. */
interface Loop {
  /** The declaration of the whole element: a variable, or the callback's first parameter. */
  readonly holder: TsNode;
  readonly source: TsNode;
  /** `for (const key in record)`: the record's keys. */
  readonly keysOf?: boolean;
}

/** The loop a declaration is a variable of, where it is one. */
const loopAround = (declaration: TsNode): Loop | undefined => {
  let holder = declaration;
  // `[key, value]` destructured from the element: the element is the pattern's owner.
  if (Node.isBindingElement(holder)) {
    const pattern = holder.getParent();
    if (!Node.isArrayBindingPattern(pattern)) return undefined;
    const owner = pattern.getParent();
    if (owner === undefined) return undefined;
    holder = owner;
  }
  if (Node.isVariableDeclaration(holder)) {
    const list = holder.getParent();
    const statement = list?.getParent();
    if (list === undefined || !Node.isVariableDeclarationList(list) || list.getDeclarationKind() === VariableDeclarationKind.Var) return undefined;
    if (Node.isForOfStatement(statement)) return { holder, source: statement.getExpression() };
    if (Node.isForInStatement(statement)) return { holder, source: statement.getExpression(), keysOf: true };
    return undefined;
  }
  if (!Node.isParameterDeclaration(holder)) return undefined;
  const fn = holder.getParent();
  if (!(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) || fn.getParameters()[0] !== holder) return undefined;
  const call = fn.getParent();
  if (call === undefined || !Node.isCallExpression(call) || call.getArguments()[0] !== fn) return undefined;
  const callee = peeled(call.getExpression());
  if (!Node.isPropertyAccessExpression(callee) || !ITERATING.has(callee.getName())) return undefined;
  return { holder, source: callee.getExpression() };
};

/** What each variable of a loop holds for one element. */
const bindingsOf = (holder: TsNode, element: Element): Map<TsNode, TakenElement> => {
  const out = new Map<TsNode, TakenElement>();
  const name = Node.isVariableDeclaration(holder) || Node.isParameterDeclaration(holder) ? holder.getNameNode() : undefined;
  if (name !== undefined && Node.isArrayBindingPattern(name)) {
    const [first, second] = name.getElements();
    const pair = element.pair;
    if (pair !== undefined) {
      if (first !== undefined && Node.isBindingElement(first)) out.set(first, pair[0]);
      if (second !== undefined && Node.isBindingElement(second)) out.set(second, pair[1]);
    }
    return out;
  }
  if (element.pair === undefined) {
    out.set(holder, { ...(element.name === undefined ? {} : { name: element.name }), ...(element.value === undefined ? {} : { value: element.value }) });
  }
  return out;
};

/**
 * Every element a loop hands the variable `declaration` is part of, with what
 * each variable of the loop holds for it; or why the list cannot be read.
 * Undefined where the declaration is not a loop's variable.
 */
export const loopOver = (declaration: TsNode): LoopReading | undefined => {
  const loop = loopAround(declaration);
  if (loop === undefined) return undefined;
  const elements: Elements = loop.keysOf === true
    ? (() => {
        const record = entriesOf(loop.source);
        return 'why' in record ? record : { elements: record.entries.map(({ key }) => ({ name: key })) };
      })()
    : elementsOf(loop.source);
  if ('why' in elements) return { source: loop.source, why: elements.why };
  return { source: loop.source, elements: elements.elements.map((element) => bindingsOf(loop.holder, element)) };
};

/** The declaration of a name used as a loop's variable, where it is one, past a shorthand. */
export const loopVariableOf = (name: TsNode): TsNode | undefined => {
  const node = peeled(name);
  if (!Node.isIdentifier(node)) return undefined;
  const parent = node.getParent();
  const symbol =
    parent !== undefined && Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node
      ? parent.getValueSymbol()
      : node.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  return declaration !== undefined && loopAround(declaration) !== undefined ? declaration : undefined;
};
