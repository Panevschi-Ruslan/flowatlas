import type { CallExpression, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * The providers a repository writes for injection tokens, as both containers
 * that inject by token write them (P247, P256): `{ provide: TOKEN, useFactory
 * }`, `useValue`, `useClass`, `useExisting`, wherever the object is written -
 * a module's own list, or a configuring method's answer, in this service or a
 * package of the workspace it reads.
 *
 * A provider written inside a function is made only where the repository
 * calls that function: a `forRootAsync` beside the `forRoot` the application
 * calls provides nothing. That is the one rule both readers of a token keep -
 * the injection reader, which says whether a token is provided at all
 * (P259), and the procedure reader, which follows what a provider's factory
 * builds (P256) - so it is written once, here.
 */

/** One provider as written, and the shape it is written in. */
export interface WrittenProvider {
  readonly token: TsNode;
  /** The object literal it is written as. */
  readonly object: ObjectLiteralExpression;
  /** The factory (`useFactory`), as written: a function, a method, or a name. */
  readonly factory?: TsNode;
  /** The value (`useValue`). */
  readonly given?: TsNode;
  /** The class (`useClass`). */
  readonly useClass?: TsNode;
  /** The token it hands on (`useExisting`). */
  readonly existing?: TsNode;
}

/** The providers of a repository, read once, and the calls its functions are made by. */
export interface ProviderIndex {
  /** Every provider the repository makes for a token. */
  of(token: TsNode): readonly WrittenProvider[];
  /** Every call the repository makes of a function it declares: the one way a parameter of it is handed a value. */
  callsOf(fn: TsNode): readonly CallExpression[];
}

/** The expression a cast, a bang or a pair of brackets is wrapped round. */
const unwrap = (node: TsNode): TsNode => {
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isNonNullExpression(at) || Node.isSatisfiesExpression(at) || Node.isAwaitExpression(at)) {
    at = at.getExpression();
  }
  return at;
};

/** The name a call is made by: `f()` is `f`, and `a.b.f()` is `f` too. */
const calleeName = (call: CallExpression): string | undefined => {
  const callee = unwrap(call.getExpression());
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};

/** What an object's property is given, written out or by a name of the same spelling. */
const propertyValue = (property: TsNode): TsNode | undefined =>
  Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;

/** Whether two tokens are the same: one symbol, or one string written twice (P247). */
export const sameToken = (a: TsNode, b: TsNode): boolean => {
  const left = unwrap(a);
  const right = unwrap(b);
  const text = (node: TsNode): string | undefined => (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralText() : undefined);
  if (text(left) !== undefined || text(right) !== undefined) return text(left) === text(right);
  const symbolOf = (node: TsNode) => {
    const symbol = node.getSymbol();
    return symbol?.getAliasedSymbol() ?? symbol;
  };
  const one = symbolOf(left);
  return one !== undefined ? one === symbolOf(right) : left.getText() === right.getText();
};

/** A function the repository declares, by the declaration its calls resolve to and the name they are written with. */
const declaredFunction = (fn: TsNode): { readonly declaration: TsNode; readonly name: string } | undefined => {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    const name = fn.getName();
    return name === undefined ? undefined : { declaration: fn, name };
  }
  const holder = fn.getParent();
  if ((Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && holder !== undefined && Node.isVariableDeclaration(holder)) {
    return { declaration: holder, name: holder.getName() };
  }
  return undefined;
};

/** The shapes a provider is written in, by the property naming each. */
const SHAPES = [
  ['useFactory', 'factory'],
  ['useValue', 'given'],
  ['useClass', 'useClass'],
  ['useExisting', 'existing'],
] as const;

/** The providers written in a repository's sources, read once, when first asked. */
export const providerIndex = (sources: () => readonly SourceFile[]): ProviderIndex => {
  let providers: WrittenProvider[] | undefined;
  /** Every call in the sources, by the name it is written with, read once. */
  let calls: Map<string, CallExpression[]> | undefined;
  const callsOf = (fn: TsNode): CallExpression[] => {
    const declared = declaredFunction(fn);
    if (declared === undefined) return [];
    if (calls === undefined) {
      const index = new Map<string, CallExpression[]>();
      for (const source of sources()) {
        for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const name = calleeName(call);
          if (name !== undefined) index.set(name, [...(index.get(name) ?? []), call]);
        }
      }
      calls = index;
    }
    return (calls.get(declared.name) ?? []).filter((call) => {
      const callee = unwrap(call.getExpression());
      const named = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
      const symbol = named.getSymbol();
      return ((symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []).includes(declared.declaration);
    });
  };
  /** Whether a provider is one the repository makes: written outside any named function, or in one it calls. */
  const made = (provider: TsNode): boolean => {
    const within = provider.getFirstAncestor((node) => Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node));
    return within === undefined || declaredFunction(within) === undefined || callsOf(within).length > 0;
  };
  const all = (): readonly WrittenProvider[] => {
    if (providers !== undefined) return providers;
    const found: WrittenProvider[] = [];
    for (const source of sources()) {
      source.forEachDescendant((node) => {
        if (!Node.isObjectLiteralExpression(node)) return;
        const provide = node.getProperty('provide');
        const token = provide === undefined ? undefined : propertyValue(provide);
        if (token === undefined) return;
        const shapes: Record<string, TsNode> = {};
        for (const [property, as] of SHAPES) {
          const written = node.getProperty(property);
          const value = written === undefined ? undefined : Node.isMethodDeclaration(written) ? written : propertyValue(written);
          if (value !== undefined) shapes[as] = value;
        }
        if (Object.keys(shapes).length === 0 || !made(node)) return;
        found.push({ token, object: node, ...shapes });
      });
    }
    providers = found;
    return found;
  };
  return {
    of: (token) => all().filter((provider) => sameToken(provider.token, token)),
    callsOf,
  };
};
