import type { CallExpression, Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * Tokens a settings library builds (P261): `registerAs('app', () => ({ ... }))`
 * of `@nestjs/config` is a factory whose `KEY` is the token its settings
 * object is injected by (`@Inject(appConfig.KEY)`), and `getConfigToken('app')`
 * the same token by its namespace. The factory is provided where the
 * application loads it - `ConfigModule.forFeature(appConfig)`, or
 * `ConfigModule.forRoot({ load: [appConfig] })` - and by nothing else.
 *
 * Read from the files' own spelling (the package's name in the import, the
 * namespace written in the call), so a repository whose packages are not
 * installed reads the same as one whose are.
 */

const SETTINGS_PACKAGE = '@nestjs/config';

/** The expression a cast or a pair of brackets is wrapped round. */
const unwrap = (node: TsNode): TsNode => {
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isSatisfiesExpression(at) || Node.isNonNullExpression(at)) at = at.getExpression();
  return at;
};

/** Whether a name is imported from the settings package under its own name: `registerAs`, `ConfigModule`. */
const importedAs = (identifier: TsNode, name: string): boolean => {
  if (!Node.isIdentifier(identifier)) return false;
  const declaration = identifier.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isImportSpecifier(declaration)) return false;
  // `getName` is the name the package exports, whatever it is imported as.
  return declaration.getName() === name && declaration.getImportDeclaration().getModuleSpecifierValue() === SETTINGS_PACKAGE;
};

/** A call of the settings package's `name`: `registerAs(...)`, `ConfigModule.forRoot(...)`. */
const callOf = (node: TsNode, name: string, method?: string): CallExpression | undefined => {
  const call = unwrap(node);
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  if (method === undefined) return importedAs(callee, name) ? call : undefined;
  return Node.isPropertyAccessExpression(callee) && callee.getName() === method && importedAs(callee.getExpression(), name) ? call : undefined;
};

/** The `registerAs` call a name holds, through the imports and the `const` it is bound by. */
const factoryOf = (node: TsNode, depth = 0): CallExpression | undefined => {
  if (depth > 6) return undefined;
  const at = unwrap(node);
  const direct = callOf(at, 'registerAs');
  if (direct !== undefined) return direct;
  if (!Node.isIdentifier(at)) return undefined;
  const symbol = at.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      const found = initializer === undefined ? undefined : factoryOf(initializer, depth + 1);
      if (found !== undefined) return found;
    }
    if (Node.isExportAssignment(declaration)) {
      const found = factoryOf(declaration.getExpression(), depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

/** The namespace a `registerAs` call registers its settings object under. */
const namespaceOf = (factory: CallExpression): string | undefined => {
  const [first] = factory.getArguments();
  return first !== undefined && (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)) ? first.getLiteralValue() : undefined;
};

/** The namespace a token is, where it is a settings object's: `appConfig.KEY`, `getConfigToken('app')`. */
const askedOf = (token: TsNode): { readonly factory?: CallExpression; readonly namespace?: string } | undefined => {
  const at = unwrap(token);
  if (Node.isPropertyAccessExpression(at) && at.getName() === 'KEY') {
    const factory = factoryOf(at.getExpression());
    return factory === undefined ? undefined : { factory, ...(namespaceOf(factory) === undefined ? {} : { namespace: namespaceOf(factory) }) };
  }
  const call = callOf(at, 'getConfigToken');
  const [first] = call?.getArguments() ?? [];
  return first !== undefined && (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)) ? { namespace: first.getLiteralValue() } : undefined;
};

/** The factories a list of them names: written out, spread in, or held by a `const`. */
const listed = (node: TsNode, depth = 0): TsNode[] => {
  if (depth > 4) return [];
  const at = unwrap(node);
  if (Node.isArrayLiteralExpression(at)) return at.getElements().flatMap((element) => (Node.isSpreadElement(element) ? listed(element.getExpression(), depth + 1) : [element]));
  if (Node.isIdentifier(at)) {
    const declaration = at.getSymbol()?.getDeclarations()[0];
    const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    return initializer === undefined ? [] : listed(initializer, depth + 1);
  }
  return [];
};

/** What a call of `ConfigModule` loads: `forFeature`'s factory, `forRoot`'s `load` list. */
const loadsOf = (call: CallExpression): TsNode[] => {
  const [first] = call.getArguments();
  if (first === undefined) return [];
  if (callOf(call, 'ConfigModule', 'forFeature') !== undefined) return [first];
  if (callOf(call, 'ConfigModule', 'forRoot') === undefined || !Node.isObjectLiteralExpression(first)) return [];
  const load = first.getProperty('load');
  const list = load !== undefined && Node.isPropertyAssignment(load) ? load.getInitializer() : undefined;
  return list === undefined ? [] : listed(list);
};

/** Every settings factory the application loads, by the `registerAs` call it is. */
const loadedFactories = (sources: readonly SourceFile[]): CallExpression[] => {
  const found: CallExpression[] = [];
  for (const source of sources) {
    if (!source.getText().includes('ConfigModule')) continue;
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      for (const loaded of loadsOf(call)) {
        const factory = factoryOf(loaded);
        if (factory !== undefined) found.push(factory);
      }
    }
  }
  return found;
};

/**
 * The `registerAs` call that provides a token, where the token is a settings
 * object's and the application loads its factory; `undefined` otherwise.
 */
export const settingsProviderOf = (token: TsNode, sources: () => readonly SourceFile[]): CallExpression | undefined => {
  const asked = askedOf(token);
  if (asked === undefined) return undefined;
  return loadedFactories(sources()).find((factory) => (asked.factory !== undefined ? factory === asked.factory : asked.namespace !== undefined && namespaceOf(factory) === asked.namespace));
};
