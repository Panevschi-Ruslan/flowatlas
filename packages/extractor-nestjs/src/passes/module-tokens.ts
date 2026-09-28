import type { Expression, ObjectLiteralExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import { lineOf } from '@flowatlas/core';
import type { NestExtractContext } from '../context.js';
import type { ProviderRegistration } from '../modules-index.js';

/**
 * Where a framework module's configuring call names the tokens it provides.
 *
 * `entries`: the call takes a list of entries (or an object holding that list
 * under `listKey`), and each entry provides the token written under `key`.
 * `fixed`: the module provides one token of its own, whatever the arguments say.
 */
type TokenSource =
  | { readonly from: 'entries'; readonly key: string; readonly listKey?: string }
  | { readonly from: 'fixed'; readonly token: string };

/** Provider shape the module writes for each token, as Nest spells it. */
type WrittenAs = Extract<ProviderRegistration['kind'], 'useValue' | 'useFactory'>;

interface ModuleTokens {
  readonly module: string;
  readonly packages: readonly string[];
  /** Configuring method, and the provider shape the module writes under it. */
  readonly methods: Readonly<Record<string, WrittenAs>>;
  readonly tokens: TokenSource;
  /** The installed class every token it provides is an instance of. */
  readonly holds: { readonly typeName: string; readonly package: string };
}

/**
 * Framework modules that provide tokens a class then asks for with `@Inject`.
 *
 * Each row says what the module's own source does, so that a token it provides
 * is found where Nest finds it, rather than in `providers:` alone:
 *
 * - `ClientsModule.register([{ name, ... }])` writes `{ provide: name, useValue }`
 *   per entry, and `registerAsync` writes `{ provide: name, useFactory }`; both
 *   also take `{ clients: [...] }`.
 * - `CacheModule.register(...)` / `registerAsync(...)` write
 *   `{ provide: CACHE_MANAGER, useFactory }`, whatever the options.
 *
 * `holds` is the installed class each such token is an instance of. It is why a
 * call through one is a call into that package, as it would be had the class
 * been injected by its type, rather than a value nothing can see into.
 *
 * A module that provides a class (a `JwtService`, say) needs no row: the class
 * is resolved from the parameter's type. Nor does one whose token is asked for
 * with a decorator of its own (`@InjectQueue`, `@InjectRepository`), which is not
 * `@Inject` and is not read here.
 */
export const MODULE_TOKENS: readonly ModuleTokens[] = [
  {
    module: 'ClientsModule',
    packages: ['@nestjs/microservices'],
    methods: { register: 'useValue', registerAsync: 'useFactory' },
    tokens: { from: 'entries', key: 'name', listKey: 'clients' },
    holds: { typeName: 'ClientProxy', package: '@nestjs/microservices' },
  },
  {
    module: 'CacheModule',
    packages: ['@nestjs/cache-manager', '@nestjs/common'],
    methods: { register: 'useFactory', registerAsync: 'useFactory' },
    tokens: { from: 'fixed', token: 'CACHE_MANAGER' },
    holds: { typeName: 'Cache', package: 'cache-manager' },
  },
];

/** Token as written: a string literal keeps its value, anything else its text. */
export const tokenOf = (expr: Expression): string =>
  Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)
    ? expr.getLiteralValue()
    : expr.getText();

const initializerOf = (literal: ObjectLiteralExpression, key: string): Expression | undefined => {
  const property = literal.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property)
    ? property.getInitializer()
    : undefined;
};

/** The entries of `[...]`, or of `{ [listKey]: [...] }`. */
const entriesOf = (argument: Expression | undefined, listKey: string | undefined): Expression[] => {
  if (argument === undefined) return [];
  if (Node.isArrayLiteralExpression(argument)) return argument.getElements();
  if (listKey !== undefined && Node.isObjectLiteralExpression(argument)) {
    const list = initializerOf(argument, listKey);
    if (list !== undefined && Node.isArrayLiteralExpression(list)) return list.getElements();
  }
  return [];
};

/**
 * The tokens an entry of `imports:` provides into its module, read by the row
 * that describes the module it configures.
 *
 * `imported` is the module the entry names, as the import reader resolved it.
 * Anything not described — another package's module, a method the row does not
 * list, an entry whose token is not written in place — provides nothing here,
 * and an `@Inject` of that token is still reported unprovided.
 */
export const tokensProvidedBy = (
  expr: Expression,
  imported: { typeName: string; package: string },
  ctx: NestExtractContext,
): ProviderRegistration[] => {
  const call = Node.isParenthesizedExpression(expr) ? expr.getExpression() : expr;
  if (!Node.isCallExpression(call)) return [];
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return [];

  const row = MODULE_TOKENS.find(
    (candidate) =>
      candidate.module === imported.typeName && candidate.packages.includes(imported.package),
  );
  const method = callee.getName();
  if (row === undefined || !Object.hasOwn(row.methods, method)) return [];
  const kind = row.methods[method] as WrittenAs;

  const at = (node: Node) => ({ file: ctx.fileOf(node), line: lineOf(node) });
  const { tokens, holds } = row;
  if (tokens.from === 'fixed') return [{ token: tokens.token, kind, holds, ...at(call) }];

  const registrations: ProviderRegistration[] = [];
  const [argument] = call.getArguments();
  for (const entry of entriesOf(argument as Expression | undefined, tokens.listKey)) {
    if (!Node.isObjectLiteralExpression(entry)) continue;
    const token = initializerOf(entry, tokens.key);
    if (token !== undefined) registrations.push({ token: tokenOf(token), kind, holds, ...at(token) });
  }
  return registrations;
};
