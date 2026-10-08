import { callsHelper, evaluateExpression, namesHelper, type DbOp, type DbTableAccess } from '@flowatlas/core';
import { Node, SyntaxKind, type CallExpression, type TypeNode } from 'ts-morph';

/** A call to a function the configuration names, and the table it touches. */
export interface ConfiguredAccess {
  access: DbTableAccess;
  /** The table, or null where the argument that names it is not a string this can read. */
  table: string | null;
  op: DbOp | null;
}

/**
 * The table a call touches, when the call is to a function the project named
 * under `adapters.db.tables` (P37).
 *
 * A data access behind a package of the project's own that nobody installed
 * has no type to resolve and no descriptor to describe it, but the call site
 * says everything: which function it is, by the import in the calling file,
 * and which table, by the string written at the argument the configuration
 * names. The first description that matches wins.
 */
/** How far a client is followed back to the call that made it. */
const MOST_HOPS = 4;

/** The factory a row names, and the type its package names the client by. */
interface Factory {
  readonly name: string;
  readonly package?: string | undefined;
  readonly clientType?: string | undefined;
}

/** Type wrappers that stand for the type inside them: `Awaited<…>`, `Readonly<…>`. */
const WRAPPERS: ReadonlySet<string> = new Set(['Awaited', 'Readonly', 'NonNullable']);

/**
 * Whether a declared type is the factory's client, by how the type is written
 * (P44): `ReturnType<typeof createClient>`, the type the package names it by,
 * `typeof db` of a client the factory made, a type alias of any of them, or
 * any of them in a union or behind `Awaited<…>`.
 */
const CLIENT_TYPES: ReadonlyMap<SyntaxKind, (type: TypeNode, factory: Factory, hops: number) => boolean> = new Map<
  SyntaxKind,
  (type: TypeNode, factory: Factory, hops: number) => boolean
>([
  [
    SyntaxKind.TypeReference,
    (type, factory, hops) => {
      if (!Node.isTypeReference(type)) return false;
      const name = type.getTypeName();
      const [argument] = type.getTypeArguments();
      const named = Node.isIdentifier(name) ? name.getText() : undefined;
      if (named === 'ReturnType') {
        if (argument === undefined || !Node.isTypeQuery(argument)) return false;
        return namesHelper(argument.getExprName(), factory);
      }
      if (named !== undefined && WRAPPERS.has(named)) return argument !== undefined && isClientType(argument, factory, hops + 1);
      if (factory.clientType !== undefined && namesHelper(name, { name: factory.clientType, package: factory.package })) return true;
      // A name the repository gave one of these: `type Client = ReturnType<…>`.
      return (name.getSymbol()?.getDeclarations() ?? []).some((declaration) => {
        const aliased = Node.isTypeAliasDeclaration(declaration) ? declaration.getTypeNode() : undefined;
        return aliased !== undefined && isClientType(aliased, factory, hops + 1);
      });
    },
  ],
  [
    SyntaxKind.TypeQuery,
    (type, factory, hops) => Node.isTypeQuery(type) && madeBy(type.getExprName(), factory, hops + 1),
  ],
  [
    SyntaxKind.UnionType,
    (type, factory, hops) => Node.isUnionTypeNode(type) && type.getTypeNodes().some((member) => isClientType(member, factory, hops + 1)),
  ],
  [
    SyntaxKind.ParenthesizedType,
    (type, factory, hops) => Node.isParenthesizedTypeNode(type) && isClientType(type.getTypeNode(), factory, hops + 1),
  ],
]);

const isClientType = (type: TypeNode, factory: Factory, hops: number): boolean =>
  hops <= MOST_HOPS && (CLIENT_TYPES.get(type.getKind())?.(type, factory, hops) ?? false);

/**
 * Whether a value is what a call to the factory returned: the call itself,
 * awaited or not, or a name or a field bound to one -
 * `const db = createClient()`, `private db = createClient()` (P39) - or one
 * handed in typed as its client: a parameter, a constructor's injected field,
 * a field assigned elsewhere (P44).
 */
const madeBy = (value: Node, factory: Factory, hops: number): boolean => {
  if (hops > MOST_HOPS) return false;
  if (Node.isParenthesizedExpression(value) || Node.isAwaitExpression(value) || Node.isNonNullExpression(value) || Node.isAsExpression(value)) {
    return madeBy(value.getExpression(), factory, hops + 1);
  }
  if (Node.isCallExpression(value)) return callsHelper(value, factory);
  if (!Node.isIdentifier(value) && !Node.isPropertyAccessExpression(value)) return false;
  return (value.getSymbol()?.getDeclarations() ?? []).some((declaration) => {
    if (!Node.isVariableDeclaration(declaration) && !Node.isPropertyDeclaration(declaration) && !Node.isParameterDeclaration(declaration)) {
      return false;
    }
    const initializer = declaration.getInitializer();
    if (initializer !== undefined && madeBy(initializer, factory, hops + 1)) return true;
    const declared = declaration.getTypeNode();
    return declared !== undefined && isClientType(declared, factory, hops);
  });
};

/**
 * Whether a call is the one a row describes: the function itself, or a method
 * of a client its factory made.
 */
const MATCHES: Readonly<Record<'function' | 'client', (call: CallExpression, access: DbTableAccess) => boolean>> = {
  function: (call, access) => callsHelper(call, access),
  client: (call, access) => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== access.name) return false;
    return madeBy(callee.getExpression(), { name: access.factory ?? '', package: access.package, clientType: access.clientType }, 0);
  },
};

export const configuredAccessOf = (
  call: CallExpression,
  described: readonly DbTableAccess[],
): ConfiguredAccess | undefined => {
  const access = described.find((candidate) => MATCHES[candidate.factory === undefined ? 'function' : 'client'](call, candidate));
  if (access === undefined) return undefined;
  const op = access.op ?? null;
  if (typeof access.table === 'string') return { access, table: access.table, op };
  const argument = call.getArguments()[access.table];
  const value = argument === undefined ? undefined : evaluateExpression(argument);
  const table = value?.resolved === true && typeof value.value === 'string' && value.value !== '' ? value.value : null;
  return { access, table, op };
};
