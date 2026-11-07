import { conventionExtentOf, isWithinDir, normalizeFilePath, startLineOf, type NamedFunction } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';

/**
 * The stores of a Vue application, and their actions as functions (P233).
 *
 * Pinia: `export const useOrders = defineStore('orders', { actions: {...} })`,
 * or with a setup function whose returned functions are the actions. Vuex:
 * `createStore({ actions, modules })`, its actions named by the string a
 * `dispatch` writes. Neither library needs to be installed: what a store is,
 * is how the call is written, and its actions are methods and functions like
 * any other once they are in the index.
 */
export interface StoreIndex {
  /** Pinia: the hook's name -> its actions by name. */
  readonly pinia: ReadonlyMap<string, ReadonlyMap<string, IndexedFunction>>;
  /** Vuex: `module/action` and `action` -> the action. */
  readonly vuex: ReadonlyMap<string, IndexedFunction>;
}

const calledName = (call: CallExpression): string | undefined => {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};

const propertyValue = (object: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const property = object.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

/** The functions an object literal holds, as methods or as properties: `{ add() {}, remove: async () => {} }`. */
type FoundFunction = { name: string; declaration: NamedFunction['declaration']; body: TsNode };

export const functionsOf = (object: ObjectLiteralExpression): FoundFunction[] =>
  object.getProperties().flatMap((property): FoundFunction[] => {
    if (Node.isMethodDeclaration(property)) {
      const body = property.getBody();
      return body === undefined ? [] : [{ name: property.getName(), declaration: property, body }];
    }
    if (!Node.isPropertyAssignment(property)) return [];
    const value = property.getInitializer();
    if (value === undefined || !(Node.isArrowFunction(value) || Node.isFunctionExpression(value))) return [];
    return [{ name: property.getName(), declaration: property, body: value.getBody() }];
  });

/** A function under a name of the reading's own, put in the index so every pass reads it. */
export const adoptAs = (ctx: ReactExtractContext, name: string, found: { declaration: NamedFunction['declaration']; body: TsNode }): IndexedFunction =>
  ctx.functions.adopt({ name, declaration: found.declaration, body: found.body, line: startLineOf(found.declaration) });

/** The functions a setup store returns: declared in its body, named in its returned object. */
const setupActions = (setup: TsNode): Array<{ name: string; declaration: NamedFunction['declaration']; body: TsNode }> => {
  if (!(Node.isArrowFunction(setup) || Node.isFunctionExpression(setup))) return [];
  const body = setup.getBody();
  if (!Node.isBlock(body)) return [];
  const returned = body.getStatements().find((statement) => Node.isReturnStatement(statement));
  const object = returned !== undefined && Node.isReturnStatement(returned) ? returned.getExpression() : undefined;
  if (object === undefined || !Node.isObjectLiteralExpression(object)) return [];
  const names = new Set(object.getProperties().map((property) => (Node.isShorthandPropertyAssignment(property) || Node.isPropertyAssignment(property) ? property.getName() : '')));
  const found: Array<{ name: string; declaration: NamedFunction['declaration']; body: TsNode }> = [];
  for (const statement of body.getStatements()) {
    if (Node.isFunctionDeclaration(statement) && statement.getName() !== undefined && names.has(statement.getName() as string)) {
      const fnBody = statement.getBody();
      if (fnBody !== undefined) found.push({ name: statement.getName() as string, declaration: statement, body: fnBody });
    }
    if (Node.isVariableStatement(statement)) {
      for (const declaration of statement.getDeclarations()) {
        const value = declaration.getInitializer();
        if (!names.has(declaration.getName()) || value === undefined) continue;
        if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) found.push({ name: declaration.getName(), declaration, body: value.getBody() });
      }
    }
  }
  return found;
};

/** A Vuex options object's actions, and its modules', by `module/action` where namespaced. */
const vuexActions = (ctx: ReactExtractContext, object: ObjectLiteralExpression, prefix: string, into: Map<string, IndexedFunction>, label: string): void => {
  const actions = propertyValue(object, 'actions');
  if (actions !== undefined && Node.isObjectLiteralExpression(actions)) {
    for (const action of functionsOf(actions)) {
      const indexed = adoptAs(ctx, `${label}.${prefix}${action.name}`, action);
      into.set(`${prefix}${action.name}`, indexed);
      if (!into.has(action.name)) into.set(action.name, indexed);
    }
  }
  const modules = propertyValue(object, 'modules');
  if (modules === undefined || !Node.isObjectLiteralExpression(modules)) return;
  for (const property of modules.getProperties()) {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) continue;
    const key = property.getName();
    const value = Node.isPropertyAssignment(property) ? property.getInitializer() : property.getNameNode();
    const module = value === undefined ? undefined : objectBehind(value);
    if (module === undefined) continue;
    const namespaced = propertyValue(module, 'namespaced')?.getText() === 'true';
    vuexActions(ctx, module, namespaced ? `${prefix}${key}/` : prefix, into, label);
  }
};

/** The object literal a value is, or the one a `const` it names was given. */
const objectBehind = (value: TsNode): ObjectLiteralExpression | undefined => {
  if (Node.isObjectLiteralExpression(value)) return value;
  if (!Node.isIdentifier(value)) return undefined;
  for (const declaration of (value.getSymbol()?.getAliasedSymbol() ?? value.getSymbol())?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined && Node.isObjectLiteralExpression(initializer)) return initializer;
    }
  }
  return undefined;
};

export const indexStores = (ctx: ReactExtractContext, sources: readonly SourceFile[]): StoreIndex => {
  const pinia = new Map<string, Map<string, IndexedFunction>>();
  const vuex = new Map<string, IndexedFunction>();
  for (const sourceFile of sources) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const name = calledName(node);
      if (name === 'defineStore') {
        const holder = node.getParent();
        if (holder === undefined || !Node.isVariableDeclaration(holder)) return;
        const hook = holder.getName();
        const [first, second] = node.getArguments();
        const definition = second ?? first;
        const actions = new Map<string, IndexedFunction>();
        const options = definition !== undefined && Node.isObjectLiteralExpression(definition) ? propertyValue(definition, 'actions') : undefined;
        const found =
          options !== undefined && Node.isObjectLiteralExpression(options) ? functionsOf(options) : definition === undefined ? [] : setupActions(definition);
        for (const action of found) actions.set(action.name, adoptAs(ctx, `${hook}.${action.name}`, action));
        pinia.set(hook, actions);
        return;
      }
      if (name !== 'createStore') return;
      const [options] = node.getArguments();
      const object = options === undefined ? undefined : objectBehind(options);
      if (object !== undefined) vuexActions(ctx, object, '', vuex, 'store');
    });
    // `new Vuex.Store({...})` is a new expression, not a call.
    sourceFile.forEachDescendant((node) => {
      if (!Node.isNewExpression(node)) return;
      const callee = node.getExpression();
      const named = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
      if (named !== 'Store') return;
      const [options] = node.getArguments();
      const object = options === undefined ? undefined : objectBehind(options);
      if (object !== undefined) vuexActions(ctx, object, '', vuex, 'store');
    });
  }
  return { pinia, vuex };
};

/** The Pinia hook a name was given the store of: `const orders = useOrders()`. */
export const storeHookOf = (name: TsNode): string | undefined => {
  if (Node.isCallExpression(name)) return calledName(name);
  if (!Node.isIdentifier(name)) return undefined;
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const value = declaration.getInitializer();
    if (value !== undefined && Node.isCallExpression(value)) return calledName(value);
  }
  return undefined;
};

/**
 * Every call into a store a function makes: `orders.add()` on a Pinia store,
 * `store.dispatch('orders/add')` on Vuex. Drawn here because the checker
 * cannot see through a store whose library is not installed.
 */
export const storeCallsIn = (body: TsNode, stores: StoreIndex): Array<{ call: CallExpression; target: IndexedFunction }> => {
  const found: Array<{ call: CallExpression; target: IndexedFunction }> = [];
  const visit = (node: TsNode): void => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const method = callee.getName();
    if (method === 'dispatch') {
      const [action] = node.getArguments();
      if (action !== undefined && (Node.isStringLiteral(action) || Node.isNoSubstitutionTemplateLiteral(action))) {
        const target = stores.vuex.get(action.getLiteralValue());
        if (target !== undefined) found.push({ call: node, target });
      }
      return;
    }
    const hook = storeHookOf(callee.getExpression());
    const target = hook === undefined ? undefined : stores.pinia.get(hook)?.get(method);
    if (target !== undefined) found.push({ call: node, target });
  };
  if (Node.isCallExpression(body)) visit(body);
  body.forEachDescendant(visit);
  return found;
};

/**
 * Whether a file is outside what this reading reads as the application's own:
 * outside the repository, and outside every directory its framework builds
 * into it (a Nuxt layer beside it, P243).
 */
export const isOutsideReading = (ctx: ReactExtractContext, filePath: string): boolean =>
  normalizeFilePath(filePath, ctx.repoDir).startsWith('../') && !conventionExtentOf(ctx.project).some((dir) => isWithinDir(filePath, dir));

/** The repository's own files a store may be declared in: not a package's. */
export const repoFiles = (ctx: ReactExtractContext): SourceFile[] =>
  ctx.project.getSourceFiles().filter((sourceFile) => !sourceFile.getFilePath().includes('/node_modules/') && !isOutsideReading(ctx, sourceFile.getFilePath()));
