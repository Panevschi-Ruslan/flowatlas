import { hasDependency, makeLeafId, makeSymbolId, startLineOf, type EmbeddedFile, type NamedFunction } from '@flowatlas/core';
import { NUXT_PAGES, SVELTEKIT_PAGES, nuxtLayoutOf, type FsRouter } from '@flowatlas/adapters-entry';
import type { Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { definePass } from '../passes/types.js';
import { positionAt, topLevelBlocks } from './blocks.js';
import { svelteMarkupEvents, vueTemplateEvents, type TemplateEvent, type TemplateHandler } from './events.js';
import { COMPONENT_TAIL_NAME, componentNameOf, scriptSourceOf } from './formats.js';
import { routedComponents } from './routes.js';
import { adoptAs, functionsOf, indexStores, repoFiles, storeCallsIn, storeHookOf, type StoreIndex } from './stores.js';

/**
 * Vue and Svelte components (P233), read from the files the core made up for
 * the checker (`addEmbeddedScripts`).
 *
 * A component is a `ui_component` whose body is its whole script, so what its
 * setup does when it is shown - a `useFetch`, a store it reads, a composable
 * it calls - is the component's, as a React component's body is; a function
 * its script declares is a function of its own as well, which is what a
 * click names. Every binding of its markup that a person presses is a
 * `ui_action` with a `handles` edge to the code it runs: a function of the
 * script, a method of the Options API, an action of a store. A handler that
 * names nothing the component has is a row, never a guess.
 *
 * Its routes are written on its node the first time the node is written,
 * which is why this pass runs before any other writes a component.
 */

/** Where the component's own text starts, for its node: the template, else the first script. */
const componentLine = (made: EmbeddedFile): number => {
  const blocks = topLevelBlocks(made.text);
  const first = blocks.find((block) => block.name === 'template') ?? blocks.find((block) => block.name === 'script');
  return first === undefined ? 1 : positionAt(made.text, first.start).line;
};

/** The object a component's `export default` is: `{...}` or `defineComponent({...})`. */
const optionsObject = (sourceFile: SourceFile): ObjectLiteralExpression | undefined => {
  const assignment = sourceFile.getExportAssignment((each) => !each.isExportEquals());
  let value: TsNode | undefined = assignment?.getExpression();
  if (value !== undefined && Node.isCallExpression(value)) value = value.getArguments()[0];
  return value !== undefined && Node.isObjectLiteralExpression(value) ? value : undefined;
};

/** The functions a component's `setup()` of the Options API declares, by name. */
const setupFunctions = (options: ObjectLiteralExpression): Map<string, { declaration: NamedFunction['declaration']; body: TsNode }> => {
  const found = new Map<string, { declaration: NamedFunction['declaration']; body: TsNode }>();
  const setup = options.getProperty('setup');
  const body = setup !== undefined && Node.isMethodDeclaration(setup) ? setup.getBody() : undefined;
  if (body === undefined || !Node.isBlock(body)) return found;
  for (const statement of body.getStatements()) {
    if (Node.isFunctionDeclaration(statement) && statement.getName() !== undefined && statement.getBody() !== undefined) {
      found.set(statement.getName() as string, { declaration: statement, body: statement.getBody() as TsNode });
    }
    if (!Node.isVariableStatement(statement)) continue;
    for (const declaration of statement.getDeclarations()) {
      const value = declaration.getInitializer();
      if (value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value))) found.set(declaration.getName(), { declaration, body: value.getBody() });
    }
  }
  return found;
};

/** What a component's script names that a handler can run. */
interface ComponentScope {
  readonly component: IndexedFunction;
  /** By the name a template writes. */
  readonly named: Map<string, IndexedFunction>;
  /** Names the script declares that are not functions: a handler naming one runs nothing. */
  readonly values: Set<string>;
  readonly script: SourceFile;
}

/** The function of this repository a name in a script resolves to, through an import. */
const importedFunction = (ctx: ReactExtractContext, script: SourceFile, name: string): IndexedFunction | undefined => {
  for (const declaration of script.getImportDeclarations()) {
    const named = declaration.getNamedImports().find((specifier) => (specifier.getAliasNode()?.getText() ?? specifier.getName()) === name);
    if (named === undefined) continue;
    for (const found of (named.getNameNode().getSymbol()?.getAliasedSymbol() ?? named.getNameNode().getSymbol())?.getDeclarations() ?? []) {
      const indexed = ctx.functions.get(found as never);
      if (indexed !== undefined) return indexed;
    }
  }
  return undefined;
};

/** The code a handler runs, when the component's script says. */
const targetOf = (ctx: ReactExtractContext, scope: ComponentScope, handler: TemplateHandler, stores: StoreIndex): IndexedFunction | undefined => {
  if (handler.kind === 'name') return scope.named.get(handler.name) ?? importedFunction(ctx, scope.script, handler.name);
  // `store.add`: a Pinia store the script holds.
  const holder = scope.script.getVariableDeclaration(handler.object);
  const value = holder?.getInitializer();
  const hook = value === undefined ? undefined : storeHookOf(value);
  const action = hook === undefined ? undefined : stores.pinia.get(hook)?.get(handler.name);
  if (action !== undefined) return action;
  // `api.send`: a function of a module imported whole.
  for (const declaration of scope.script.getImportDeclarations()) {
    if (declaration.getNamespaceImport()?.getText() !== handler.object) continue;
    const module = declaration.getModuleSpecifierSourceFile();
    const fn = module?.getFunction(handler.name) ?? module?.getVariableDeclaration(handler.name);
    const indexed = fn === undefined ? undefined : ctx.functions.get(fn as never);
    if (indexed !== undefined) return indexed;
  }
  return undefined;
};

/** Nuxt's pages, in the directory its application keeps its code in. */
const nuxtPages = (srcDir: string): FsRouter => (srcDir === '' ? NUXT_PAGES : { ...NUXT_PAGES, root: `${srcDir}/${NUXT_PAGES.root}` });

export const sfcPass = definePass('components', (ctx: ReactExtractContext) => {
  if (ctx.embedded.length === 0) return;
  const sources = repoFiles(ctx);
  const stores = indexStores(ctx, sources);
  const extensions = [...new Set(ctx.embedded.map((made) => made.format.extension))];
  const routed = routedComponents(sources, ctx.embedded.map((made) => made.file), {
    repoDir: ctx.repoDir,
    extensions,
    pages: [
      // Under `app/` from Nuxt 4, under `srcDir` where the configuration names one (P240).
      ...(hasDependency(ctx.pkg, 'nuxt') ? [nuxtPages(nuxtLayoutOf(ctx.repoDir, ctx.pkg).srcDir)] : []),
      ...(hasDependency(ctx.pkg, '@sveltejs/kit') ? [SVELTEKIT_PAGES] : []),
    ],
  });

  const scopes: ComponentScope[] = [];
  for (const made of ctx.embedded) {
    const tail = made.sourceFile.getVariableDeclaration(COMPONENT_TAIL_NAME);
    if (tail === undefined) continue;
    const name = componentNameOf(made.file);
    const line = componentLine(made);
    const fn: NamedFunction = { name, declaration: tail, body: made.sourceFile, line };
    const component: IndexedFunction = { id: makeSymbolId(ctx.repo, made.file, name), name, role: 'component', file: made.file, line, fn };
    ctx.functions.add(component);
    ctx.stats.components += 1;
    const paths = routed.get(made.file);
    ctx.ensureFunctionNode(fn, paths === undefined ? undefined : { route: [...paths].sort().join(' ') });

    // What a handler can name: the script's own functions, the Options API's methods and setup.
    const named = new Map<string, IndexedFunction>();
    const values = new Set<string>();
    const script = scriptOf(ctx, made);
    for (const indexed of ctx.functions.all()) {
      if (indexed.file === made.file && indexed !== component) named.set(indexed.name, indexed);
    }
    for (const statement of script.getVariableStatements()) {
      for (const declaration of statement.getDeclarations()) if (!named.has(declaration.getName())) values.add(declaration.getName());
    }
    const options = optionsObject(script);
    if (options !== undefined) {
      const methods = options.getProperty('methods');
      const object = methods !== undefined && Node.isPropertyAssignment(methods) ? methods.getInitializer() : undefined;
      if (object !== undefined && Node.isObjectLiteralExpression(object)) {
        for (const method of functionsOf(object)) named.set(method.name, adoptAs(ctx, `${name}.${method.name}`, method));
      }
      for (const [fnName, found] of setupFunctions(options)) named.set(fnName, adoptAs(ctx, `${name}.${fnName}`, found));
      const data = options.getProperty('data');
      if (data !== undefined) values.add('data');
    }
    const scope: ComponentScope = { component, named, values, script };
    scopes.push(scope);

    const events = made.format.extension === '.svelte' ? svelteMarkupEvents(made.text) : vueTemplateEvents(made.text);
    for (const event of events) action(ctx, scope, event, made.file, stores);
  }

  // Calls into a store, from a component, a composable or another store: the
  // checker cannot see through a store whose library is not installed. And a
  // call to what a composable handed back - `const { load } = useOrders()`,
  // then `load()` - is a call into the composable, whose code it runs.
  for (const indexed of [...ctx.functions.all()]) {
    if (indexed.file.startsWith('../')) continue;
    const calls = [...storeCallsIn(indexed.fn.body, stores), ...composableCallsIn(ctx, indexed.fn.body)];
    for (const { call, target } of calls) {
      if (target.id === indexed.id) continue;
      ctx.ensureFunctionNode(indexed.fn);
      ctx.ensureFunctionNode(target.fn);
      ctx.builder.addEdge({ from: indexed.id, to: target.id, type: 'calls', confidence: 'static', file: indexed.file, line: startLineOf(call) });
    }
  }
});

/** Calls to a name destructured from a call of this repository's function: the function they came from. */
const composableCallsIn = (ctx: ReactExtractContext, body: TsNode): Array<{ call: TsNode; target: IndexedFunction }> => {
  const found: Array<{ call: TsNode; target: IndexedFunction }> = [];
  body.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee)) return;
    const [declaration] = callee.getSymbol()?.getDeclarations() ?? [];
    if (declaration === undefined || !Node.isBindingElement(declaration)) return;
    const holder = declaration.getFirstAncestor((ancestor) => Node.isVariableDeclaration(ancestor));
    const value = holder !== undefined && Node.isVariableDeclaration(holder) ? holder.getInitializer() : undefined;
    const made = value !== undefined && Node.isAwaitExpression(value) ? value.getExpression() : value;
    if (made === undefined || !Node.isCallExpression(made) || !Node.isIdentifier(made.getExpression())) return;
    const symbol = made.getExpression().getSymbol();
    for (const source of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
      const target = ctx.functions.get(source as never);
      if (target !== undefined) {
        found.push({ call: node, target });
        return;
      }
    }
  });
  return found;
};

/** The script a component's code is in: its own, or the file its `<script src>` names. */
const scriptOf = (ctx: ReactExtractContext, made: EmbeddedFile): SourceFile => {
  const source = scriptSourceOf(made.text, made.format.extension);
  if (source === undefined) return made.sourceFile;
  const dir = made.sourceFile.getDirectoryPath();
  return ctx.project.getSourceFile(`${dir}/${source.replace(/^\.\//, '')}`) ?? made.sourceFile;
};

/** One binding of the markup: its `ui_action`, and an edge to the code it runs. */
const action = (ctx: ReactExtractContext, scope: ComponentScope, event: TemplateEvent, file: string, stores: StoreIndex): void => {
  const id = makeLeafId('ui_action', ctx.repo, file, event.line, event.column);
  const targets = event.handlers.flatMap((handler) => {
    const target = targetOf(ctx, scope, handler, stores);
    return target === undefined ? [] : [target];
  });
  ctx.builder.addNode({
    id,
    type: 'ui_action',
    label: `${event.attribute}="${event.source.replaceAll(/\s+/g, ' ').slice(0, 80)}"`,
    repo: ctx.repo,
    file,
    line: event.line,
    kind: 'event',
    meta: {
      event: event.event,
      handler: event.source,
      component: scope.component.id,
      template: file,
      handlerVia: targets.length === 0 ? 'enclosing' : 'named',
    },
  });
  // A bare name the component does not have is said, not guessed: a method
  // renamed in the script and not in the markup.
  for (const handler of event.handlers) {
    if (handler.kind !== 'name' || targetOf(ctx, scope, handler, stores) !== undefined || scope.values.has(handler.name)) continue;
    if (event.handlers.length !== 1 || event.source.trim() !== handler.name) continue;
    ctx.report({
      file,
      line: event.line,
      reason: 'template-handler-not-found',
      level: 'action',
      message: `${event.attribute}="${event.source}" names ${handler.name}, which ${scope.component.name} does not declare or import`,
      hint: 'Declare the function in the component, import it, or correct the name in the markup.',
      symbol: `${scope.component.name} ${event.attribute}`,
    });
  }
  ctx.ensureFunctionNode(scope.component.fn);
  for (const target of targets.length === 0 ? [scope.component] : targets) {
    ctx.ensureFunctionNode(target.fn);
    ctx.builder.addEdge({ from: id, to: target.id, type: 'handles', confidence: 'static', file, line: event.line });
  }
};
