import type { Node as TsNode, TemplateExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import { holeIn, UNREAD_SPAN } from './ids.js';
import { packageNameOf } from './origin.js';
import { declarationOf, evaluateExpression } from './static-value.js';
import { choosesASegment, isQueryTail } from './trace.js';

/** How a string was arrived at, which is what tells a reader how far to trust it. */
export type StaticStringVia = 'literal' | 'template' | 'const' | 'enum' | 'shared-package';

export interface StaticString {
  value: string;
  via: StaticStringVia;
  /**
   * Settings keys the string is rooted at, as written after the settings object.
   * The caller decides what a key means; here it is only recorded.
   */
  envRefs: string[];
  /** Whether a branch nobody settled was taken to arrive at the value. */
  guessed?: boolean;
  /** What the code falls back to where the setting it opens with is not set, when it writes one (P292). */
  fallback?: string;
}

/**
 * A settings key found behind a hole, and whatever literal text came with it.
 *
 * A helper that assembles an address answers with both: the settings it is
 * rooted at, and the part of the path it has already written.
 */
export interface SettingBehind {
  key: string;
  /** Literal text between the settings and whatever follows the hole. */
  prefix?: string;
  /** Whether a branch nobody settled was taken to arrive at that text. */
  guessed?: boolean;
  /** What the code falls back to where the setting is not set, when it writes one (P292). */
  otherwise?: string;
}

export interface StaticStringOptions {
  /** Packages shared between repositories, so a constant read from one is known. */
  sharedPackages?: readonly string[];
  /** Identifiers that stand for a settings object, e.g. the one a build swaps out. */
  envRoots?: readonly string[];
  /**
   * What every hole becomes when its value is only known at run time.
   *
   * Left unset, a hole is judged by where it sits: one that fills a segment
   * outright becomes `:param`, and one that could run over a separator becomes
   * `UNREAD_SPAN`, which nothing matches. Set it only where the caller knows the
   * string is not an address and the distinction does not apply.
   */
  placeholder?: string;
  /**
   * Follows the opening hole back to a settings key when it is not one outright.
   *
   * A settings value is usually kept in a property before it is used, and the
   * property is not the setting. Supplied by a caller that knows how far it is
   * willing to follow.
   */
  settingBehind?: (node: TsNode) => SettingBehind | string | null;
  /**
   * Reads a hole the evaluator cannot, when a caller knows how.
   *
   * Tried only after the ordinary evaluation fails, so it can add answers and
   * never change one.
   */
  resolveSpan?: (node: TsNode) => string | null;
  /**
   * Whether text joined with `+` to a value read at run time is read as the
   * template it spells, `'/orders/' + id` as `` `/orders/${id}` `` (P280).
   * Asked for by a reader of addresses, where a hole is a segment; a name
   * put together that way is not a name read.
   */
  concatenation?: boolean;
}

/** Which shared package a declaration came from, when it came from one. */
const sharedPackageOf = (
  declaration: TsNode | undefined,
  sharedPackages: readonly string[],
): string | undefined => {
  if (declaration === undefined) return undefined;
  const path = declaration.getSourceFile().getFilePath();
  // The manifest is the reliable answer, because a workspace reaches its own
  // packages through a link. The path is the fallback for anything installed
  // the ordinary way, where no manifest is reachable.
  const owner = packageNameOf(path);
  return (
    sharedPackages.find((pkg) => pkg === owner) ??
    sharedPackages.find((pkg) => path.includes(`/node_modules/${pkg}/`))
  );
};

/** A name taken out of an object where it is declared, and what it was taken out of. */
export interface TakenMember {
  /** What the pattern destructures: `process.env` in `const { ORDERS_URL = '' } = process.env`. */
  readonly from: TsNode;
  /** The member the name is: its own spelling, or the property it renames. */
  readonly key: string;
  /** The default it holds where the object has no such member, when it writes one. */
  readonly fallback?: TsNode;
}

/**
 * The member a name stands for, when it was taken out of an object where it is
 * declared: `const { SHIPPING_URL = '' } = process.env` declares `SHIPPING_URL`
 * as the member of `process.env` it reads, which is a settings read spelled in
 * the declaration rather than at each use (P269). Only a name written directly in
 * a `const`'s own pattern: one nested deeper is a member of a member.
 */
export const takenMember = (name: TsNode): TakenMember | undefined => {
  if (!Node.isIdentifier(name)) return undefined;
  const element = name.getSymbol()?.getDeclarations()[0];
  if (element === undefined || !Node.isBindingElement(element) || element.getDotDotDotToken() !== undefined) return undefined;
  const pattern = element.getParent();
  const declaration = pattern?.getParent();
  if (!Node.isObjectBindingPattern(pattern) || declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  const from = declaration.getInitializer();
  if (from === undefined) return undefined;
  const fallback = element.getInitializer();
  return {
    from,
    key: element.getPropertyNameNode()?.getText() ?? element.getName(),
    ...(fallback === undefined ? {} : { fallback }),
  };
};

/**
 * The settings key an expression reads, when it reads one.
 *
 * `environment.api.baseUrl` answers `api.baseUrl`: the whole path after the
 * root, because that is how the key is written in the configuration too.
 */
export const settingKeyIn = (expr: TsNode, roots: readonly string[]): string | null => {
  if (roots.length === 0) return null;
  // `const { apiUrl } = environment`: the member of a root, taken out where it is declared (P269).
  const taken = takenMember(expr);
  if (taken !== undefined) {
    const holder = Node.isPropertyAccessExpression(taken.from) ? settingKeyIn(taken.from, roots) : null;
    if (holder !== null) return `${holder}.${taken.key}`;
    return rootSpellings(taken.from).some((spelling) => roots.includes(spelling)) ? taken.key : null;
  }
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const parts: string[] = [];
  let current: TsNode = expr;
  while (Node.isPropertyAccessExpression(current)) {
    parts.unshift(current.getName());
    current = current.getExpression();
  }
  const spellings = rootSpellings(current);
  // The longest root that is listed wins, so a root with a path of its own
  // (`useRuntimeConfig().public`, P233) is not read as the shorter one.
  for (let at = parts.length - 1; at >= 0; at -= 1) {
    const under = parts.slice(0, at).map((part) => `.${part}`).join('');
    if (spellings.some((spelling) => roots.includes(`${spelling}${under}`))) return parts.slice(at).join('.');
  }
  return null;
};

/**
 * How the start of a settings path may be listed: its name, or - a call with
 * no arguments, written in place or held by a `const` - the call
 * (`useRuntimeConfig()`), whatever the name it is held by.
 */
const rootSpellings = (node: TsNode): string[] => {
  const called = (call: TsNode | undefined): string | undefined =>
    call !== undefined && Node.isCallExpression(call) && call.getArguments().length === 0 && Node.isIdentifier(call.getExpression())
      ? `${call.getExpression().getText()}()`
      : undefined;
  if (Node.isCallExpression(node)) return [called(node)].filter((spelling): spelling is string => spelling !== undefined);
  if (!Node.isIdentifier(node)) return [];
  const [declaration] = node.getSymbol()?.getDeclarations() ?? [];
  const bound = declaration !== undefined && Node.isVariableDeclaration(declaration) ? called(declaration.getInitializer()) : undefined;
  return bound === undefined ? [node.getText()] : [node.getText(), bound];
};

/** One hole of a string put together from text and holes, and the text after it. */
interface Span {
  readonly expression: TsNode;
  readonly tail: string;
}

const fromTemplate = (template: TemplateExpression, options: StaticStringOptions): StaticString =>
  fromSpans(
    template.getHead().getLiteralText(),
    template.getTemplateSpans().map((span) => ({ expression: span.getExpression(), tail: span.getLiteral().getLiteralText() })),
    options,
  );

/** The pieces of `a + b + c`, left to right. */
const piecesOf = (node: TsNode): TsNode[] => {
  let value = node;
  while (Node.isParenthesizedExpression(value)) value = value.getExpression();
  return Node.isBinaryExpression(value) && value.getOperatorToken().getText() === '+'
    ? [...piecesOf(value.getLeft()), ...piecesOf(value.getRight())]
    : [value];
};

/** What one piece of a join is: text that is read, or a value that is not. */
type Piece = { readonly text: string } | { readonly expression: TsNode };

/** A piece of a join as text and holes, a template among them taken apart into its own. */
const partsOf = (piece: TsNode): Piece[] => {
  if (Node.isTemplateExpression(piece)) {
    return [
      { text: piece.getHead().getLiteralText() },
      ...piece.getTemplateSpans().flatMap((span): Piece[] => [{ expression: span.getExpression() }, { text: span.getLiteral().getLiteralText() }]),
    ];
  }
  const evaluated = evaluateExpression(piece);
  return evaluated.resolved && (typeof evaluated.value === 'string' || typeof evaluated.value === 'number')
    ? [{ text: String(evaluated.value) }]
    : [{ expression: piece }];
};

/** Whether a piece of a join is text, as written, as a template or as a constant holds it. */
const isText = (piece: TsNode): boolean => {
  if (Node.isStringLiteral(piece) || Node.isNoSubstitutionTemplateLiteral(piece) || Node.isTemplateExpression(piece)) return true;
  const evaluated = evaluateExpression(piece);
  return evaluated.resolved && typeof evaluated.value === 'string';
};

/**
 * `'/sellers/' + name + '/follow'`: text joined with `+` to values read at
 * run time, read as the same string written as a template is (P280), holes
 * and a setting it opens with alike. Only a join that holds text: a sum of
 * values none of which is a string is not a string put together.
 */
const fromConcatenation = (expr: TsNode, options: StaticStringOptions): StaticString | null => {
  const pieces = piecesOf(expr);
  if (pieces.length < 2 || !pieces.some(isText)) return null;
  const parts = pieces.flatMap(partsOf);
  let head = '';
  let at = 0;
  for (let part = parts[at]; part !== undefined && 'text' in part; part = parts[++at]) head += part.text;
  const spans: Span[] = [];
  while (at < parts.length) {
    const hole = parts[at] as { expression: TsNode };
    let tail = '';
    for (let part = parts[++at]; part !== undefined && 'text' in part; part = parts[++at]) tail += part.text;
    spans.push({ expression: hole.expression, tail });
  }
  return spans.length === 0 ? null : fromSpans(head, spans, options);
};

const fromSpans = (head: string, all: readonly Span[], options: StaticStringOptions): StaticString => {
  const roots = options.envRoots ?? [];

  let value = head;
  const envRefs: string[] = [];
  let guessed = false;
  let fallback: string | undefined;

  let end = all.length;
  // Trailing holes that are only ever a query string or nothing add nothing to
  // the route, and a hole before them still ends the address.
  while (end > 0) {
    const span = all[end - 1];
    if (span === undefined || span.tail !== '') break;
    if (evaluateExpression(span.expression).resolved) break;
    if (!isQueryTail(span.expression)) break;
    end -= 1;
  }
  const spans = all.slice(0, end);
  for (const [index, span] of spans.entries()) {
    const tail = span.tail;
    // Only a hole the string starts with can be its root. Dropping one from the
    // middle would leave a path that reads as complete and is not.
    const opening = value === '' && envRefs.length === 0;
    const direct = opening ? settingKeyIn(span.expression, roots) : null;
    const behind =
      opening && direct === null ? options.settingBehind?.(span.expression) : null;
    const found = behind === null || behind === undefined ? null : behind;
    const key = direct ?? (typeof found === 'string' ? found : (found?.key ?? null));
    if (key !== null) {
      const root = typeof found === 'object' && found !== null ? found : undefined;
      envRefs.push(key);
      // The half behind the hole may have been arrived at through a branch
      // nobody settled, and the text this returns says nothing about how it was
      // read. Carrying it is what lets the edge downstream say `heuristic`.
      if (root?.guessed === true) guessed = true;
      fallback = root?.otherwise;
      value = (root?.prefix ?? '') + tail;
      continue;
    }
    const evaluated = evaluateExpression(span.expression);
    const read =
      evaluated.resolved && typeof evaluated.value === 'string'
        ? evaluated.value
        : options.resolveSpan?.(span.expression);
    const hole =
      options.placeholder ??
      (choosesASegment(span.expression)
        ? UNREAD_SPAN
        : holeIn(value, tail, index === spans.length - 1));
    value += (read ?? hole) + tail;
  }

  return { value, via: 'template', envRefs, ...(guessed ? { guessed: true } : {}), ...(fallback === undefined ? {} : { fallback }) };
};

/** The two branches of a condition, written in place or held in a `const`. */
const branchesOf = (expr: TsNode): [TsNode, TsNode] | undefined => {
  let value: TsNode | undefined = expr;
  while (value !== undefined && Node.isParenthesizedExpression(value)) value = value.getExpression();
  if (value !== undefined && Node.isIdentifier(value)) {
    const declaration = value.getSymbol()?.getDeclarations()[0];
    const constant = declaration !== undefined && Node.isVariableDeclaration(declaration) && declaration.getVariableStatement()?.getDeclarationKind() === 'const';
    value = constant ? declaration.getInitializer() : undefined;
    while (value !== undefined && Node.isParenthesizedExpression(value)) value = value.getExpression();
  }
  return value !== undefined && Node.isConditionalExpression(value) ? [value.getWhenTrue(), value.getWhenFalse()] : undefined;
};

/** What an address asks for apart from its query and fragment. */
const beforeQuery = (value: string): string => value.split(/[?#]/)[0] ?? '';

/**
 * A condition whose two branches are one address but for the query (P279):
 * `params ? \`/api/signup?${params}\` : '/api/signup'` asks for `/api/signup`
 * whichever is taken, so it is read as the branch that carries a query - the
 * address with its query unread - and not as a string known only at run time.
 * Branches that differ anywhere before the query are left unread.
 */
const sameRouteEitherWay = (expr: TsNode, options: StaticStringOptions): StaticString | undefined => {
  const branches = branchesOf(expr);
  if (branches === undefined) return undefined;
  const [yes, no] = branches.map((branch) => resolveStaticString(branch, options));
  if (yes === null || yes === undefined || no === null || no === undefined) return undefined;
  if (beforeQuery(yes.value) !== beforeQuery(no.value) || yes.envRefs.join('\0') !== no.envRefs.join('\0')) return undefined;
  return yes.value.length >= no.value.length ? yes : no;
};

/**
 * Reads a string out of the source without running it.
 *
 * The one place that follows a name to the text behind it: a literal, a template
 * whose holes can be filled or named, a constant, an enum member, or the same
 * read through a package the services share. Returns null when the string is
 * only known at run time, which is a fact worth recording rather than guessing
 * around: a route path or a channel name invented here becomes a confident edge
 * that is simply wrong.
 */
export const resolveStaticString = (
  expr: TsNode,
  options: StaticStringOptions = {},
): StaticString | null => {
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
    return { value: expr.getLiteralValue(), via: 'literal', envRefs: [] };
  }

  if (Node.isTemplateExpression(expr)) return fromTemplate(expr, options);

  const branched = sameRouteEitherWay(expr, options);
  if (branched !== undefined) return branched;

  const evaluated = evaluateExpression(expr);
  if (!evaluated.resolved || typeof evaluated.value !== 'string') {
    return options.concatenation === true && !evaluated.resolved ? fromConcatenation(expr, options) : null;
  }

  const declaration = declarationOf(expr);
  const shared = sharedPackageOf(declaration, options.sharedPackages ?? []);
  const via: StaticStringVia =
    shared !== undefined
      ? 'shared-package'
      : declaration !== undefined && Node.isEnumMember(declaration)
        ? 'enum'
        : 'const';
  return { value: evaluated.value, via, envRefs: [] };
};
