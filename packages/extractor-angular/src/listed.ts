import { declarationOf, evaluateExpression } from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { LoopSource, TemplateAddress, TemplateRead } from './template.js';

/**
 * The addresses a link spells from what its template reads (P363).
 *
 * A sidebar is written once and shows a link per entry of a catalog -
 * `@for (item of items(); track item.route) { <a [routerLink]="item.route"> }`
 * over a member derived from a constant list of objects - so the link is one
 * binding in the template and as many addresses as the catalog has entries.
 * Read as one value it is none, and every screen only the sidebar opens was
 * reached by nothing. So the read is followed: from the loop variable to the
 * list it walks, from a member of the component to what it is made of - a
 * field's value, a getter's or a method's answer, a `computed(() => …)` or a
 * `signal(…)`'s value - to the list written out, through what a list method
 * keeps (`filter`, `slice`, `sort`, …), makes (`map` to objects written in
 * place, spreading the element or naming its members) or flattens
 * (`flatMap`, a nested loop over an element's member), a constant's
 * initializer and an import; and each element's member is read where its
 * object writes it. Whatever is not followed is said, once per reason.
 */

/** A parameter of a callback bound to the element it is handed. */
type Bindings = ReadonlyMap<TsNode, Value>;

/** An expression, with what the parameters it reads stand for. */
interface Value {
  readonly node: TsNode;
  readonly bound: Bindings;
}

export interface ListedReading {
  readonly paths: readonly string[];
  /** Why some of it was not read, each said once. */
  readonly unread: readonly string[];
  /** The lists it went through, as written, for a row to name. */
  readonly lists: readonly string[];
}

/** How many addresses one link is read as, at most. */
const MOST = 256;
/** How many steps any one reading follows. */
const DEEPEST = 12;

const NONE: Bindings = new Map();

/** The methods of a list whose answer holds elements of it, as they are. */
const KEEPING = new Set(['filter', 'slice', 'sort', 'toSorted', 'reverse', 'toReversed', 'concat']);

const peeled = (node: TsNode): TsNode => {
  let current = node;
  for (let step = 0; step < DEEPEST; step += 1) {
    if (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isSatisfiesExpression(current) || Node.isNonNullExpression(current) || Node.isTypeAssertion(current)) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
  return current;
};

const said = (node: TsNode): string => node.getText().replace(/\s+/g, ' ').slice(0, 60);

/** What a function hands back: its expression body, or every `return` of its block. */
const returnsOf = (fn: TsNode): TsNode[] => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn) && !Node.isMethodDeclaration(fn) && !Node.isGetAccessorDeclaration(fn)) return [];
  const body = fn.getBody();
  if (body === undefined) return [];
  if (!Node.isBlock(body)) return [body];
  const out: TsNode[] = [];
  body.forEachDescendant((node, traversal) => {
    if (Node.isFunctionLikeDeclaration(node) || Node.isClassDeclaration(node)) {
      traversal.skip();
      return;
    }
    if (Node.isReturnStatement(node)) {
      const expression = node.getExpression();
      if (expression !== undefined) out.push(expression);
    }
  });
  return out;
};

/** The member of a class, or of a class it extends, by name. */
const memberOf = (owner: ClassDeclaration, name: string): TsNode | undefined => {
  let current: ClassDeclaration | undefined = owner;
  for (let depth = 0; current !== undefined && depth < 6; depth += 1) {
    const found = current.getProperty(name) ?? current.getGetAccessor(name) ?? current.getMethod(name);
    if (found !== undefined) return found;
    current = current.getBaseClass();
  }
  return undefined;
};

/** The class a node is written in. */
const classOf = (node: TsNode): ClassDeclaration | undefined => node.getFirstAncestor((ancestor): ancestor is ClassDeclaration => Node.isClassDeclaration(ancestor));

export interface Reader {
  /** The list a template's loop variable walks, by name, and what the component is. */
  readonly loops: ReadonlyMap<string, LoopSource>;
  readonly owner: ClassDeclaration;
}

/**
 * Reads an address a template spells, over every element of every loop it
 * reads through.
 */
export const readAddress = (address: TemplateAddress, reader: Reader): ListedReading => {
  const unread = new Set<string>();
  const lists = new Set<string>();
  const paths = new Set<string>();
  let steps = 0;
  const miss = (why: string): [] => {
    unread.add(why);
    return [];
  };

  /** What a class member stands for: a field's value, a getter's answer, a method as a function. */
  const member = (owner: ClassDeclaration, name: string): Value[] => {
    const found = memberOf(owner, name);
    if (found === undefined) return miss(`${owner.getName() ?? 'the component'} has no member ${name} this reading finds`);
    if (Node.isPropertyDeclaration(found)) {
      const initializer = found.getInitializer();
      return initializer === undefined ? miss(`${name} is given no value where it is declared`) : [{ node: initializer, bound: NONE }];
    }
    if (Node.isGetAccessorDeclaration(found)) return returnsOf(found).map((node) => ({ node, bound: NONE }));
    return [{ node: found, bound: NONE }];
  };

  /** What calling a value with nothing hands back: a signal's value, a computed's, a function's answer. */
  const called = (value: Value): Value[] => {
    const node = peeled(value.node);
    if (Node.isCallExpression(node)) {
      const callee = peeled(node.getExpression());
      const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : '';
      const [first] = node.getArguments();
      if ((name === 'computed' || name === 'linkedSignal') && first !== undefined) {
        const fn = peeled(first);
        return returnsOf(fn).map((returned) => ({ node: returned, bound: value.bound }));
      }
      if (name === 'signal' && first !== undefined) return [{ node: first, bound: value.bound }];
    }
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isMethodDeclaration(node) || Node.isFunctionDeclaration(node)) {
      return returnsOf(node).map((returned) => ({ node: returned, bound: value.bound }));
    }
    const held = heldBy(value);
    if (held !== undefined) return held.flatMap(called);
    return miss(`${said(node)} is called, and what it hands back is not read`);
  };

  /** What a name or a member read stands for, one link further: a bound parameter, a constant, a member of the component. */
  const heldBy = (value: Value): Value[] | undefined => {
    const node = peeled(value.node);
    if (Node.isIdentifier(node)) {
      // `{ route }` names the parameter or constant `route`, not the property it writes.
      const parent = node.getParent();
      const shorthand = parent !== undefined && Node.isShorthandPropertyAssignment(parent) ? node.getProject().getTypeChecker().compilerObject.getShorthandAssignmentValueSymbol(parent.compilerNode) : undefined;
      const declaration = shorthand === undefined ? node.getSymbol()?.getDeclarations()[0] : [...value.bound.keys()].find((key) => key.compilerNode === shorthand.declarations?.[0]);
      if (shorthand !== undefined && declaration === undefined) {
        const held = shorthand.declarations?.[0];
        const found = held === undefined ? undefined : node.getSourceFile().getDescendantAtPos(held.getStart())?.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        const initializer = found?.getInitializer();
        return initializer === undefined ? undefined : [{ node: initializer, bound: NONE }];
      }
      if (declaration !== undefined && value.bound.has(declaration)) return [value.bound.get(declaration) as Value];
      const target = declarationOf(node);
      if (target === undefined) return undefined;
      if (Node.isVariableDeclaration(target)) {
        const initializer = target.getInitializer();
        return initializer === undefined ? undefined : [{ node: initializer, bound: NONE }];
      }
      if (Node.isFunctionDeclaration(target)) return [{ node: target, bound: NONE }];
      return undefined;
    }
    if (Node.isPropertyAccessExpression(node)) {
      const receiver = peeled(node.getExpression());
      if (Node.isThisExpression(receiver)) {
        const owner = classOf(node);
        return owner === undefined ? undefined : member(owner, node.getName());
      }
      return valuesOf({ node: receiver, bound: value.bound }).flatMap((object) => memberValue(object, node.getName()));
    }
    return undefined;
  };

  /** The objects a value is written as, past names: an object literal in place, a constant holding one, a bound element. */
  const valuesOf = (value: Value, depth = 0): Value[] => {
    if (depth > DEEPEST) return [];
    const node = peeled(value.node);
    if (Node.isObjectLiteralExpression(node)) return [{ node, bound: value.bound }];
    if (Node.isConditionalExpression(node)) return [...valuesOf({ node: node.getWhenTrue(), bound: value.bound }, depth + 1), ...valuesOf({ node: node.getWhenFalse(), bound: value.bound }, depth + 1)];
    const held = heldBy(value);
    return held === undefined ? [] : held.flatMap((each) => valuesOf(each, depth + 1));
  };

  /** What an object writes under a key: its own property, or one of an object it spreads, the last that writes it. */
  const memberValue = (object: Value, key: string, depth = 0): Value[] => {
    if (depth > 6) return [];
    const node = peeled(object.node);
    if (!Node.isObjectLiteralExpression(node)) return [];
    const properties = node.getProperties();
    for (let at = properties.length - 1; at >= 0; at -= 1) {
      const property = properties[at] as TsNode;
      if (Node.isPropertyAssignment(property) && property.getName().replace(/^['"]|['"]$/g, '') === key) {
        const initializer = property.getInitializer();
        return initializer === undefined ? [] : [{ node: initializer, bound: object.bound }];
      }
      if (Node.isShorthandPropertyAssignment(property) && property.getName() === key) return [{ node: property.getNameNode(), bound: object.bound }];
      if (!Node.isSpreadAssignment(property)) continue;
      const found = valuesOf({ node: property.getExpression(), bound: object.bound }).flatMap((inner) => memberValue(inner, key, depth + 1));
      if (found.length > 0) return found;
    }
    return [];
  };

  /** The elements of a list a value is written as. */
  const elementsOf = (value: Value, depth = 0): Value[] => {
    if (depth > DEEPEST || (steps += 1) > 4 * MOST) return [];
    const node = peeled(value.node);
    if (Node.isArrayLiteralExpression(node)) {
      return node.getElements().flatMap((element) =>
        Node.isSpreadElement(element) ? elementsOf({ node: element.getExpression(), bound: value.bound }, depth + 1) : [{ node: element, bound: value.bound }],
      );
    }
    if (Node.isConditionalExpression(node)) {
      return [...elementsOf({ node: node.getWhenTrue(), bound: value.bound }, depth + 1), ...elementsOf({ node: node.getWhenFalse(), bound: value.bound }, depth + 1)];
    }
    if (Node.isBinaryExpression(node) && ['??', '||'].includes(node.getOperatorToken().getText())) {
      return [...elementsOf({ node: node.getLeft(), bound: value.bound }, depth + 1), ...elementsOf({ node: node.getRight(), bound: value.bound }, depth + 1)];
    }
    if (Node.isCallExpression(node)) {
      const callee = peeled(node.getExpression());
      if (Node.isPropertyAccessExpression(callee)) {
        const method = callee.getName();
        const receiver: Value = { node: callee.getExpression(), bound: value.bound };
        const args = node.getArguments();
        if (method === 'concat') return [receiver, ...args.map((arg) => ({ node: arg, bound: value.bound }))].flatMap((each) => elementsOf(each, depth + 1));
        if (KEEPING.has(method)) return elementsOf(receiver, depth + 1);
        if (method === 'map' || method === 'flatMap') {
          const fn = args[0] === undefined ? undefined : peeled(args[0]);
          const parameter = fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) ? fn.getParameters()[0] : undefined;
          if (fn === undefined || parameter === undefined || !Node.isIdentifier(parameter.getNameNode())) {
            return miss(`${said(node)} hands each element to something other than a function of one named parameter written in place`);
          }
          return elementsOf(receiver, depth + 1).flatMap((element) => {
            const bound = new Map(value.bound).set(parameter, element);
            return returnsOf(fn).flatMap((returned) => (method === 'map' ? [{ node: returned, bound }] : elementsOf({ node: returned, bound }, depth + 1)));
          });
        }
        if (callee.getExpression().getText() === 'Object' && method === 'values' && args[0] !== undefined) {
          return valuesOf({ node: args[0], bound: value.bound }).flatMap((object) => {
            const literal = peeled(object.node);
            if (!Node.isObjectLiteralExpression(literal)) return [];
            return literal.getProperties().flatMap((property) => {
              if (Node.isPropertyAssignment(property)) {
                const initializer = property.getInitializer();
                return initializer === undefined ? [] : [{ node: initializer, bound: object.bound }];
              }
              return [];
            });
          });
        }
      }
      return called({ node: callee, bound: value.bound }).flatMap((each) => elementsOf(each, depth + 1));
    }
    const held = heldBy(value);
    if (held !== undefined) {
      if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) lists.add(node.getText());
      return held.flatMap((each) => elementsOf(each, depth + 1));
    }
    return miss(`${said(node)} is not a list written here, nor a constant, a member or a call that hands one back`);
  };

  /** The strings a value reads as: a literal, a constant, a member of an element, a concatenation of them. */
  const stringsOf = (value: Value, depth = 0): string[] => {
    if (depth > DEEPEST) return [];
    const node = peeled(value.node);
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return [node.getLiteralValue()];
    if (Node.isConditionalExpression(node)) return [...stringsOf({ node: node.getWhenTrue(), bound: value.bound }, depth + 1), ...stringsOf({ node: node.getWhenFalse(), bound: value.bound }, depth + 1)];
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '+') {
      const left = stringsOf({ node: node.getLeft(), bound: value.bound }, depth + 1);
      const right = stringsOf({ node: node.getRight(), bound: value.bound }, depth + 1);
      return left.flatMap((a) => right.map((b) => a + b));
    }
    if (Node.isTemplateExpression(node)) {
      let out = [node.getHead().getLiteralText()];
      for (const span of node.getTemplateSpans()) {
        const inner = stringsOf({ node: span.getExpression(), bound: value.bound }, depth + 1);
        if (inner.length === 0) return [];
        out = out.flatMap((head) => inner.map((each) => head + each + span.getLiteral().getLiteralText()));
      }
      return out;
    }
    const held = heldBy(value);
    if (held !== undefined) return held.flatMap((each) => stringsOf(each, depth + 1));
    const evaluated = evaluateExpression(node);
    if (evaluated.resolved && typeof evaluated.value === 'string') return [evaluated.value];
    unread.add(`${said(node)} is not a string written here`);
    return [];
  };

  /** What a read of the template stands for, with each loop it reads through bound to each of its elements. */
  const readValues = (read: TemplateRead, env: ReadonlyMap<string, Value>, depth: number): Array<{ value: Value; env: ReadonlyMap<string, Value> }> => {
    if (depth > DEEPEST) return [];
    const loop = read.own === true ? undefined : reader.loops.get(read.root);
    let starts: Array<{ value: Value; env: ReadonlyMap<string, Value> }>;
    if (loop !== undefined) {
      const held = env.get(read.root);
      if (held !== undefined) starts = [{ value: held, env }];
      else if ('unread' in loop) return miss(loop.unread);
      else {
        starts = readValues(loop, env, depth + 1).flatMap(({ value, env: outer }) =>
          elementsOf(value).map((element) => ({ value: element, env: new Map(outer).set(read.root, element) })),
        );
      }
    } else {
      starts = member(reader.owner, read.root).map((value) => ({ value, env }));
    }
    let current = starts;
    for (const step of read.steps) {
      current = current.flatMap(({ value, env: at }) =>
        'call' in step ? called(value).map((each) => ({ value: each, env: at })) : valuesOf(value).flatMap((object) => memberValue(object, step.member)).map((each) => ({ value: each, env: at })),
      );
      if (current.length === 0) {
        unread.add(`${read.text} reads ${'call' in step ? 'a call' : step.member} of something not written here`);
        return [];
      }
      if (current.length > MOST) current = current.slice(0, MOST);
    }
    return current;
  };

  const spell = (at: number, env: ReadonlyMap<string, Value>, written: readonly string[]): void => {
    if (paths.size >= MOST) return;
    const part = address.parts[at];
    if (part === undefined) {
      const path = address.segments ? written.join('/').replace(/\/{2,}/g, '/') : written.join('');
      paths.add(path);
      return;
    }
    if ('text' in part) {
      spell(at + 1, env, [...written, part.text]);
      return;
    }
    for (const { value, env: next } of readValues(part.read, env, 0)) {
      for (const text of stringsOf(value)) spell(at + 1, next, [...written, text]);
    }
  };
  spell(0, new Map(), []);
  return { paths: [...paths].sort(), unread: [...unread].sort(), lists: [...lists] };
};
