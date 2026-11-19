import { addressSidesOf, asksAbsolute, conditionsAround, declarationOf, joinedTests, prefixSidesOfRewrite, rewriteTestOf, underBase, UNREAD_SPAN, type AddressTest } from '@flowatlas/core';
import type { ArrowFunction, FunctionDeclaration, FunctionExpression, MethodDeclaration, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ClientFactory, RequestRewrites } from '../clients.js';
import type { ApiUrl } from './url.js';

/**
 * What a function a client runs before every request does to its address
 * (P244), read where the function is written.
 *
 * A request interceptor is how many front ends put the base in front of every
 * request: `api.interceptors.request.use((config) => { config.baseURL =
 * import.meta.env.VITE_API_URL; return config })`. Until this was read the
 * graph recorded the path each call writes, and the request joined by its
 * route alone - the defect P239 fixed for the base an instance is made with,
 * written one step later.
 *
 * Four things a function can do to the address, and each composes with the
 * base the instance or the call already gives in its own way:
 *
 * - `base`: it sets the base outright, `config.baseURL = X`. It runs after the
 *   call's options are merged in, so it wins over the call's own base too.
 * - `fallback`: it sets the base only where none is set, `config.baseURL ??=
 *   X` or behind `if (!config.baseURL)`. The call's or the instance's wins.
 * - `prefix`: it puts a base in front of the address, `config.url = X +
 *   config.url`; whatever base the client then applies goes in front of both,
 *   unless the result is absolute.
 * - `origin`: it replaces the whole request with one at a new address built
 *   from the old one's path, `new Request(`${X}${new URL(request.url).pathname}`,
 *   request)`; the path keeps the base's own path and loses its host. Two more
 *   spellings say the same (P250): the old address with its origin replaced,
 *   `request.url.replace(location.origin, X)`, and the old path resolved
 *   against the base, `new URL(new URL(request.url).pathname, X)`.
 *
 * Read only where it is certain, by the rule an interceptor of the framework's
 * client is read by (P239): the one condition that changes nothing is whether
 * the address is already absolute, and the one that is understood is "only
 * where no base is set". A condition about the address's own form,
 * `if (config.url.startsWith('/api'))`, is a test each request's written
 * address is put to (P280). Any other condition, a base chosen between two
 * values by a branch, or a rewrite whose base cannot be read, is a row, and
 * the requests through the client are then partly read.
 */
export interface Rewrite {
  readonly kind: 'base' | 'fallback' | 'prefix' | 'origin';
  readonly base: ApiUrl;
  /** Where the function writes it, for the row that says two disagree. */
  readonly at: TsNode;
  /**
   * Only for a request whose address is relative to the page (P250): a hook
   * that replaces the page's own origin changes nothing for one already sent
   * to a host or a setting.
   */
  readonly when?: 'relative';
  /** The test of the address each request writes that the rewrite is made under, where there is one (P280). */
  readonly test?: AddressTest;
  /**
   * Rewrites the request's address chooses among, each under its own test
   * (P285): the sides of a base chosen by a test of the address, or rewrites
   * written under tests in two places. `test` is then whether any applies,
   * and the rewrite's own kind and base are the first branch's.
   */
  readonly branches?: readonly Rewrite[];
}

export type RewriteReading =
  | { readonly kind: 'rewrite'; readonly rewrite: Rewrite }
  | { readonly kind: 'unread'; readonly at: TsNode; readonly why: string };

/** Reads a base written in the function as every other base is read; `unread` where it cannot be. */
export type BaseReader = (node: TsNode) => ApiUrl | 'unread';

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression();
  }
  return current;
};

type Fn = ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration;

/** Whether a node is a function a rewrite can be written in. */
const isFn = (node: TsNode): node is Fn =>
  Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node);

/** The functions a value written for a rewrite stands for: written in place, listed, or named. */
export const functionsOf = (value: TsNode, depth = 0): TsNode[] => {
  if (depth > 4) return [];
  const target = unwrap(value);
  if (Node.isArrayLiteralExpression(target)) return target.getElements().flatMap((element) => functionsOf(element, depth + 1));
  if (isFn(target)) return [target];
  if (Node.isIdentifier(target) || Node.isPropertyAccessExpression(target)) {
    const declaration = declarationOf(target);
    if (declaration === undefined) return [];
    if (Node.isFunctionDeclaration(declaration)) return [declaration];
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      return initializer === undefined ? [] : functionsOf(initializer, depth + 1);
    }
  }
  return [];
};

/** The binding a parameter, or one key destructured from it, declares. */
const bindingOf = (parameter: TsNode | undefined, key?: string): TsNode | undefined => {
  if (parameter === undefined || !Node.isParameterDeclaration(parameter)) return undefined;
  const name = parameter.getNameNode();
  if (key === undefined) return Node.isIdentifier(name) ? parameter : undefined;
  if (!Node.isObjectBindingPattern(name)) return undefined;
  return name.getElements().find((element) => (element.getPropertyNameNode()?.getText() ?? element.getName()) === key);
};

/** Whether a name refers to a declaration. */
const refersTo = (node: TsNode, declaration: TsNode | undefined): boolean => {
  if (declaration === undefined) return false;
  const target = unwrap(node);
  return Node.isIdentifier(target) && target.getSymbol()?.getDeclarations()[0] === declaration;
};

/**
 * What the function is handed, by how the client hands it: which expressions
 * are the request's options, and which is the address it already has.
 */
interface Handed {
  readonly isOptions: (node: TsNode) => boolean;
  readonly isAddress: (node: TsNode) => boolean;
}

/** One reading per way a client hands the request over, a Strategy by name. */
const HANDED: Readonly<Record<RequestRewrites['handed'], (fn: Fn, rewrites: RequestRewrites) => Handed>> = {
  // axios: the config itself, `(config) => …`, the address under `url`.
  options: (fn, rewrites) => {
    const own = bindingOf(fn.getParameters()[0]);
    const isOptions = (node: TsNode): boolean => refersTo(node, own);
    return {
      isOptions,
      isAddress: (node) => {
        const target = unwrap(node);
        return Node.isPropertyAccessExpression(target) && target.getName() === rewrites.addressKey && isOptions(target.getExpression());
      },
    };
  },
  // ofetch: a context, `(ctx) => ctx.options…` or `({ options }) => options…`,
  // the address under `request`.
  context: (fn, rewrites) => {
    const parameter = fn.getParameters()[0];
    const context = bindingOf(parameter);
    const options = bindingOf(parameter, 'options');
    const keyOfContext = (node: TsNode, key: string): boolean => {
      const target = unwrap(node);
      return Node.isPropertyAccessExpression(target) && target.getName() === key && refersTo(target.getExpression(), context);
    };
    return {
      isOptions: (node) => refersTo(node, options) || keyOfContext(node, 'options'),
      isAddress: (node) => keyOfContext(node, rewrites.addressKey),
    };
  },
  // ky: the request itself, which can only be replaced by a new one; its
  // address is anything read off `request.url`.
  request: (fn, rewrites) => {
    const request = bindingOf(fn.getParameters()[0]);
    // A name the hook gives what it read off the request reads it too:
    // `const url = new URL(request.url)` (P250).
    const reads = (node: TsNode, depth: number): boolean =>
      depth < 4 &&
      [unwrap(node), ...node.getDescendants()].some((each) => {
        if (Node.isPropertyAccessExpression(each) && each.getName() === rewrites.addressKey && refersTo(each.getExpression(), request)) return true;
        if (!Node.isIdentifier(each)) return false;
        const declaration = each.getSymbol()?.getDeclarations()[0];
        if (declaration === undefined || !Node.isVariableDeclaration(declaration) || ownerOf(declaration) !== fn) return false;
        const value = declaration.getInitializer();
        return value !== undefined && reads(value, depth + 1);
      });
    return {
      isOptions: () => false,
      isAddress: (node) => reads(node, 0),
    };
  },
};

/** What one write in the function sets, before its conditions are asked. */
interface Write {
  readonly key: 'base' | 'address' | 'origin';
  readonly value: TsNode;
  readonly at: TsNode;
  /** Written with `??=` or `||=`: only where no base is set. */
  readonly fallback?: true;
}

/** The function a node is written directly in, so a callback inside the rewrite is not read as the rewrite. */
const ownerOf = (node: TsNode): TsNode | undefined => node.getFirstAncestor((each) => isFn(each) || Node.isFunctionLikeDeclaration(each));

/** Whether an object is what the function answers with. */
const isAnswered = (node: TsNode, fn: TsNode): boolean => {
  const parent = node.getParent();
  if (parent === undefined) return false;
  if (Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isSatisfiesExpression(parent)) return isAnswered(parent, fn);
  if (Node.isReturnStatement(parent)) return ownerOf(parent) === fn;
  return parent === fn;
};

/** The writes of the base and of the address in one object, by the keys the client reads. */
const writesIn = (object: TsNode, baseKey: string, addressKey: string, at: TsNode): Write[] => {
  if (!Node.isObjectLiteralExpression(object)) return [];
  return object.getProperties().flatMap((property): Write[] => {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) return [];
    const name = property.getName().replace(/^['"]|['"]$/g, '');
    const value = Node.isPropertyAssignment(property) ? property.getInitializer() : property.getNameNode();
    if (value === undefined) return [];
    if (name === baseKey) return [{ key: 'base', value, at }];
    if (name === addressKey) return [{ key: 'address', value, at }];
    return [];
  });
};

const FALLBACK_OPERATORS = new Set([SyntaxKind.QuestionQuestionEqualsToken, SyntaxKind.BarBarEqualsToken]);

/** Every place a function writes the base or the address it was handed. */
const writesOf = (fn: Fn, handed: Handed, factory: ClientFactory, rewrites: RequestRewrites): Write[] => {
  const { baseKey } = factory;
  const { addressKey } = rewrites;
  const writes: Write[] = [];
  for (const node of fn.getDescendants()) {
    if (ownerOf(node) !== fn) continue;
    // `config.baseURL = X`, `config.url = X + config.url`, `ctx.request = …`.
    if (Node.isBinaryExpression(node)) {
      const operator = node.getOperatorToken().getKind();
      if (operator !== SyntaxKind.EqualsToken && !FALLBACK_OPERATORS.has(operator)) continue;
      const left = unwrap(node.getLeft());
      const fallback = FALLBACK_OPERATORS.has(operator) ? { fallback: true as const } : {};
      if (Node.isPropertyAccessExpression(left) && left.getName() === baseKey && handed.isOptions(left.getExpression())) {
        writes.push({ key: 'base', value: node.getRight(), at: node, ...fallback });
      } else if (handed.isAddress(left) && Node.isPropertyAccessExpression(left)) {
        writes.push({ key: 'address', value: node.getRight(), at: node });
      }
      continue;
    }
    // `Object.assign(config, { baseURL })`.
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      const [target, ...sources] = node.getArguments();
      if (Node.isPropertyAccessExpression(callee) && callee.getText() === 'Object.assign' && target !== undefined && handed.isOptions(target)) {
        for (const source of sources) writes.push(...writesIn(unwrap(source), baseKey, addressKey, node));
      }
      continue;
    }
    // `return { ...config, baseURL }`: the options answered with in place of
    // the ones handed in.
    if (Node.isObjectLiteralExpression(node) && isAnswered(node, fn)) {
      const spreads = node.getProperties().some((property) => Node.isSpreadAssignment(property) && handed.isOptions(property.getExpression()));
      if (spreads) writes.push(...writesIn(node, baseKey, addressKey, node));
      continue;
    }
    // `return new Request(`${X}${new URL(request.url).pathname}`, request)`.
    if (rewrites.handed === 'request' && Node.isNewExpression(node) && node.getExpression().getText() === 'Request' && isAnswered(node, fn)) {
      const [address] = node.getArguments();
      if (address !== undefined) writes.push({ key: 'origin', value: address, at: node });
    }
  }
  return writes;
};

/** Whether a condition asks only whether no base is set yet: `!config.baseURL`, `config.baseURL == null`. */
const asksUnset = (condition: TsNode, handed: Handed, baseKey: string): boolean => {
  const target = unwrap(condition);
  const isBase = (node: TsNode): boolean => {
    const each = unwrap(node);
    return Node.isPropertyAccessExpression(each) && each.getName() === baseKey && handed.isOptions(each.getExpression());
  };
  if (Node.isPrefixUnaryExpression(target) && target.getOperatorToken() === SyntaxKind.ExclamationToken) return isBase(target.getOperand());
  if (!Node.isBinaryExpression(target)) return false;
  const operator = target.getOperatorToken().getKind();
  if (![SyntaxKind.EqualsEqualsToken, SyntaxKind.EqualsEqualsEqualsToken].includes(operator)) return false;
  const other = isBase(target.getLeft()) ? target.getRight() : isBase(target.getRight()) ? target.getLeft() : undefined;
  if (other === undefined) return false;
  const text = unwrap(other).getText();
  return text === 'null' || text === 'undefined' || text === "''" || text === '""';
};

/** `config.baseURL ?? X`, `config.baseURL || X`: the base where none is set. */
const fallbackIn = (value: TsNode, handed: Handed, baseKey: string): TsNode | undefined => {
  const target = unwrap(value);
  if (!Node.isBinaryExpression(target)) return undefined;
  const operator = target.getOperatorToken().getKind();
  if (operator !== SyntaxKind.QuestionQuestionToken && operator !== SyntaxKind.BarBarToken) return undefined;
  const left = unwrap(target.getLeft());
  return Node.isPropertyAccessExpression(left) && left.getName() === baseKey && handed.isOptions(left.getExpression()) ? target.getRight() : undefined;
};

/** `location.origin` and its spellings: the origin of the page a request relative to it is sent from. */
const PAGE_ORIGIN = /^(?:(?:window|globalThis|self|document)\.)?location\.origin$/;

/** An expression through `.toString()` and `.href`, which spell the same address. */
const asText = (node: TsNode): TsNode => {
  const target = unwrap(node);
  if (Node.isCallExpression(target) && target.getArguments().length === 0) {
    const callee = target.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'toString') return asText(callee.getExpression());
  }
  if (Node.isPropertyAccessExpression(target) && target.getName() === 'href') return asText(target.getExpression());
  return target;
};

/** Whether an expression is the path the request has, read off its own address: `url.pathname`, with `search` after it. */
const isOwnPath = (node: TsNode, handed: Handed): boolean => {
  const target = unwrap(node);
  const part = (each: TsNode, name: string): boolean => {
    const at = unwrap(each);
    return Node.isPropertyAccessExpression(at) && at.getName() === name && handed.isAddress(at.getExpression());
  };
  if (part(target, 'pathname')) return true;
  if (Node.isBinaryExpression(target) && target.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    return part(target.getLeft(), 'pathname') && part(target.getRight(), 'search');
  }
  if (Node.isTemplateExpression(target) && target.getHead().getLiteralText() === '') {
    const spans = target.getTemplateSpans();
    return spans.every((span) => span.getLiteral().getLiteralText() === '') && part(spans[0]?.getExpression() as TsNode, 'pathname') && spans.slice(1).every((span) => part(span.getExpression(), 'search'));
  }
  return false;
};

/** A base cut to its origin, as `new URL(path, base)` cuts it: a literal's own path is dropped. */
const originOnly = (base: ApiUrl): ApiUrl => {
  if (base.host === null || base.url === null) return base;
  try {
    const url = new URL(base.url);
    return { ...base, url: url.origin, path: '' };
  } catch {
    return base;
  }
};

/**
 * The base a new request's address puts in front of the old one's path,
 * where it is written as the old address with its origin replaced or as the
 * old path resolved against the base (P250): `request.url.replace(location.origin,
 * X)`, `request.url.replace(new URL(request.url).origin, X)`,
 * `new URL(new URL(request.url).pathname, X)`. Nothing where it is neither.
 */
const originOf = (written: TsNode, handed: Handed, read: BaseReader): { base: ApiUrl | 'unread'; when?: 'relative' } | undefined => {
  const value = asText(written);
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    const [from, to] = value.getArguments();
    if (!Node.isPropertyAccessExpression(callee) || !['replace', 'replaceAll'].includes(callee.getName()) || from === undefined || to === undefined) return undefined;
    if (!handed.isAddress(callee.getExpression())) return undefined;
    const origin = unwrap(from);
    if (PAGE_ORIGIN.test(origin.getText())) return { base: read(to), when: 'relative' };
    const own = Node.isPropertyAccessExpression(origin) && origin.getName() === 'origin' && handed.isAddress(origin.getExpression());
    return own ? { base: read(to) } : undefined;
  }
  if (Node.isNewExpression(value) && value.getExpression().getText() === 'URL') {
    const [path, base] = value.getArguments();
    if (path === undefined || base === undefined || !isOwnPath(path, handed)) return undefined;
    const found = read(base);
    return { base: found === 'unread' ? found : originOnly(found) };
  }
  return undefined;
};

/** How much of a written expression a row quotes. */
const quoted = (node: TsNode): string => node.getText().replace(/\s+/g, ' ').slice(0, 60);

/**
 * What one function a client runs before every request does to the address,
 * as one reading per write: nothing where it writes neither the base nor the
 * address.
 */
export const rewritesOf = (fnNode: TsNode, factory: ClientFactory, read: BaseReader, who?: string): RewriteReading[] => {
  const rewrites = factory.rewrites;
  if (rewrites === undefined || !isFn(fnNode)) return [];
  const fn = fnNode;
  const handed = HANDED[rewrites.handed](fn, rewrites);
  // Who the row says runs it: the client before every request, or one call before its own (P250).
  const runs = who ?? `a function ${factory.client.name} runs before every request`;
  return writesOf(fn, handed, factory, rewrites).flatMap((write): RewriteReading[] => {
    const conditions = conditionsAround(write.at, fnNode);
    const unset = conditions.some((condition) => asksUnset(condition, handed, factory.baseKey));
    const open = conditions.filter((condition) => !asksAbsolute(condition, handed.isAddress) && !asksUnset(condition, handed, factory.baseKey));
    // A condition about the address's own form is a test each request is put to (P280).
    const test = open.length === 0 ? null : rewriteTestOf(write.at, fnNode, handed.isAddress, (condition) => asksUnset(condition, handed, factory.baseKey));
    if (test === undefined) {
      return [{ kind: 'unread', at: write.at, why: `${runs} rewrites the address only when ${quoted(open[0] as TsNode)}, so which requests go out under it is not known` }];
    }
    const reading = readWritten(write, write.value, test, { handed, factory, read, runs, unset });
    return reading === null ? [] : [reading];
  });
};

/** What reading one write needs of the function it is written in. */
interface WriteContext {
  readonly handed: Handed;
  readonly factory: ClientFactory;
  readonly read: BaseReader;
  readonly runs: string;
  /** Whether the write sits behind a condition that asks only whether no base is set. */
  readonly unset: boolean;
}

/** Whether a branch writes back what the request already had: `config.url`, or the base it was handed. */
const keepsAsIs = (write: Write, value: TsNode, context: WriteContext): boolean => {
  if (write.key === 'address') return context.handed.isAddress(value);
  if (write.key !== 'base') return false;
  return Node.isPropertyAccessExpression(value) && value.getName() === context.factory.baseKey && context.handed.isOptions(value.getExpression());
};

/** The key two rewrites that do the same thing share. */
export const rewriteKey = (rewrite: Rewrite): string =>
  rewrite.branches === undefined ? `${rewrite.kind}\0${rewrite.base.url ?? ''}` : rewrite.branches.map(rewriteKey).join('\0\0');

/**
 * Rewrites each made under its own test of the address, put together as one
 * the request's address chooses among (P285): the branches of `url.includes('admin')
 * ? '/admin' : '/shop'`, or rewrites written under tests in two places.
 */
export const branchedRewrite = (rewrites: readonly Rewrite[]): Rewrite | undefined => {
  const branches = [...new Map(rewrites.flatMap((rewrite) => rewrite.branches ?? [rewrite]).map((branch) => [rewriteKey(branch), branch])).values()];
  const [first] = branches;
  if (first === undefined) return undefined;
  if (branches.some((branch) => branch.test === undefined)) return undefined;
  if (branches.length === 1) return first;
  return { ...first, test: joinedTests(branches.map((branch) => branch.test as AddressTest), false), branches };
};

/**
 * What one value a write puts reads as, under the test of the address it is
 * written under (`null` where it is under none): a rewrite, a row, or nothing
 * where the value writes back what the request had. A branch whose condition
 * is a test of the address is each side under that test (P285); any other
 * branch is a row.
 */
const readWritten = (write: Write, written: TsNode, test: AddressTest | null, context: WriteContext): RewriteReading | null => {
  const sides = addressSidesOf(written, context.handed.isAddress, test);
  if ('unread' in sides) {
    return { kind: 'unread', at: write.at, why: `${context.runs} writes one of two bases by a branch (${quoted(sides.unread)}), and which one a request goes out under is not read` };
  }
  const [only] = sides;
  if (sides.length === 1 && only !== undefined) return readSide(write, only.value, only.test, context);
  return joinedReadings(sides.map((side) => readSide(write, side.value, side.test, context)));
};

/** Readings of the sides of one write put together: the first row, or the rewrites as branches the address chooses among. */
const joinedReadings = (readings: ReadonlyArray<RewriteReading | null>): RewriteReading | null => {
  const unread = readings.find((reading) => reading?.kind === 'unread');
  if (unread !== undefined) return unread;
  const rewrite = branchedRewrite(readings.flatMap((reading) => (reading?.kind === 'rewrite' ? [reading.rewrite] : [])));
  return rewrite === undefined ? null : { kind: 'rewrite', rewrite };
};

/** What one side of a write reads as, under its test of the address. */
const readSide = (write: Write, written: TsNode, test: AddressTest | null, context: WriteContext): RewriteReading | null => {
  const { handed, factory, read, runs, unset } = context;
  const tested = test === null ? {} : { test };
  const value = unwrap(written);
  if (keepsAsIs(write, value, context)) return null;
  if (write.key === 'base') {
    const behind = fallbackIn(value, handed, factory.baseKey);
    const base = read(behind ?? value);
    if (base === 'unread') return { kind: 'unread', at: write.at, why: `${runs} writes ${factory.baseKey} and it could not be read` };
    const kind = write.fallback === true || unset || behind !== undefined ? 'fallback' : 'base';
    return { kind: 'rewrite', rewrite: { kind, base, at: write.at, ...tested } };
  }
  if (write.key === 'origin') {
    const replaced = originOf(value, handed, read);
    if (replaced?.base === 'unread') return { kind: 'unread', at: write.at, why: `${runs} replaces the request's origin, and the base it puts there could not be read` };
    if (replaced !== undefined) return { kind: 'rewrite', rewrite: { kind: 'origin', base: replaced.base, at: write.at, ...(replaced.when === undefined ? {} : { when: replaced.when }), ...tested } };
  }
  // The base put in front may itself be chosen by a test of the address (P293).
  const prefixes = prefixSidesOfRewrite(value, handed.isAddress, (node) => {
    const base = read(node);
    return base === 'unread' ? { url: null, path: null, baseUrlEnv: null, host: null, via: null, guessed: false } : base;
  });
  if ('unread' in prefixes) {
    return { kind: 'unread', at: write.at, why: `${runs} puts one of two bases in front of the address by a branch (${quoted(prefixes.unread)}), and which one a request goes out under is not read` };
  }
  const kind = write.key === 'origin' ? 'origin' : 'prefix';
  const readings = prefixes.map(({ base, test: chosen }): RewriteReading | null => {
    if (base === null) return null;
    if (base === undefined) return { kind: 'unread', at: write.at, why: `${runs} rewrites the address, and the base it puts in front could not be read` };
    const under = chosen === null ? test : test === null ? chosen : joinedTests([test, chosen], true);
    return { kind: 'rewrite', rewrite: { kind, base, at: write.at, ...(under === null ? {} : { test: under }) } };
  });
  const [only] = readings;
  return readings.length === 1 && only !== undefined ? only : joinedReadings(readings);
};

/**
 * The opening of an address a function rewrites in a way not read (P280): a
 * hole, in front of the path of whatever base the call or the instance gives,
 * since the rewrite may change what stands before that path and nothing says
 * it removes it.
 */
export const unreadOpening = (base: ApiUrl | undefined): ApiUrl => {
  const path = base?.path === null || base?.path === undefined || base.path === '/' ? '' : base.path.replace(/\/+$/, '');
  return { url: `${UNREAD_SPAN}${path}`, path: `/${UNREAD_SPAN}${path}`, baseUrlEnv: null, host: null, via: null, guessed: false };
};

/**
 * The rewrite a request goes out under, by the address it writes (P280): the
 * one its client runs where it applies, none where a test of the address
 * says it does not, and `unread` where the rewrite is not read or the test
 * cannot tell from what is read of the address.
 */
export const rewriteFor = (
  runs: { readonly rewrite?: Rewrite; readonly rewriteUnread?: unknown } | undefined,
  written: ApiUrl,
): Rewrite | 'unread' | undefined => {
  if (runs === undefined) return undefined;
  if (runs.rewriteUnread !== undefined) return 'unread';
  return appliedTo(runs.rewrite, written.url ?? written.path ?? '');
};

/**
 * The rewrite an address goes out under, of one that may carry a test or
 * branches (P285): the one branch whose test holds, none where none does, and
 * `unread` where a test cannot tell or two branches that differ both hold.
 */
export const appliedTo = (rewrite: Rewrite | undefined, written: string): Rewrite | 'unread' | undefined => {
  if (rewrite?.test === undefined) return rewrite;
  if (rewrite.branches !== undefined) {
    const answers = rewrite.branches.map((branch) => ({ branch, holds: branch.test === undefined ? true : branch.test(written) }));
    if (answers.some(({ holds }) => holds === undefined)) return 'unread';
    const taken = answers.filter(({ holds }) => holds).map(({ branch }) => branch);
    if (new Set(taken.map(rewriteKey)).size > 1) return 'unread';
    return taken[0];
  }
  const holds = rewrite.test(written);
  return holds === undefined ? 'unread' : holds ? rewrite : undefined;
};

/** A base without its host or setting: the path a request built from another's keeps. */
const pathOnly = (base: ApiUrl): ApiUrl => ({ ...base, url: base.path, host: null, baseUrlEnv: null, via: 'literal' });

/**
 * The base a request goes out under once the function the client runs before
 * it has rewritten it: `base` is the one the call or the instance gives, and
 * undefined where neither does.
 */
export const basedBy = (rewrite: Rewrite | undefined, base: ApiUrl | undefined): ApiUrl | undefined => {
  if (rewrite === undefined) return base;
  switch (rewrite.kind) {
    case 'base':
      return rewrite.base;
    case 'fallback':
      return base ?? rewrite.base;
    case 'prefix':
      return base === undefined ? rewrite.base : underBase(base, rewrite.base);
    case 'origin':
      // The page's origin is in front only of a request relative to the page (P250).
      if (rewrite.when === 'relative' && base !== undefined && (base.host !== null || base.baseUrlEnv !== null)) return base;
      return base === undefined || base.path === null ? rewrite.base : underBase(rewrite.base, pathOnly(base));
  }
};
