import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { normalizeFilePath, startLineOf, type EmbeddedFile, type GraphEdge } from '@flowatlas/core';
import { NUXT_BUILT_IN_COMPONENTS, type NuxtNames } from '@flowatlas/adapters-entry';
import type { CallExpression, ImportDeclaration, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { svelteMarkupTags, vueTemplateTags, type MarkupTag } from './events.js';
import { asyncComponentFile, installedPlugins, librarySettingsOf, libraryOf, type InstalledPlugins } from './registrations.js';

/**
 * The child components a component's markup renders (P255), and in Nuxt the
 * layout and the route middleware a page goes through.
 *
 * A tag is a call of the component it names: rendering `<CartBadge />` runs
 * that component's setup, and what its setup and its buttons reach is part
 * of the screen. So a tag that names a component of the repository is a
 * `calls` edge from the component that writes it to the one it names, at the
 * tag, `static`, as a call between two functions is - and a screen's flow
 * reaches the requests its children make.
 *
 * What a tag names is what the framework resolves it to, and nothing else: a
 * name the script imports (`<script setup>`, `components: { ... }`), one an
 * application registers for every template (`app.component('Name', X)`),
 * and in Nuxt one it registers by the file's path (`components/`, its
 * layers', a module's). Vue matches `<cart-badge>` to `CartBadge` as it
 * resolves one; Nuxt's `Lazy` prefix is the component it loads later. A tag
 * written in PascalCase that names none of these and none of the framework's
 * own is a row; a lower-case tag with a hyphen that names nothing is a
 * custom element, as HTML reads one.
 */

/** Components Vue and its router give every template. */
const VUE_BUILT_IN_COMPONENTS: ReadonlySet<string> = new Set([
  'Transition',
  'TransitionGroup',
  'KeepAlive',
  'Teleport',
  'Suspense',
  'Component',
  'Slot',
  'Template',
  'RouterView',
  'RouterLink',
]);

/** A component of this reading, with the script whose imports name what it renders. */
export interface MarkupComponent {
  readonly component: IndexedFunction;
  readonly made: EmbeddedFile;
  readonly script: SourceFile;
}

/** What Nuxt registers by name, and its pages by file, where the application is Nuxt's. */
export interface NuxtReading {
  readonly names: NuxtNames;
  /** The pages: repo-relative file -> its address. */
  readonly pages: ReadonlyMap<string, string>;
}

/** `cart-badge` as Vue looks it up: as written, camelised and capitalised. */
const vueSpellings = (tag: string): string[] => {
  const camel = tag.replace(/-(\w)/g, (_, char: string) => char.toUpperCase());
  const pascal = `${camel.slice(0, 1).toUpperCase()}${camel.slice(1)}`;
  return [...new Set([tag, camel, pascal])];
};

const pascalOf = (tag: string): string => vueSpellings(tag).at(-1) as string;

/** Whether a tag names a component rather than an element: a capital, a hyphen, or Vue's `<component>`. */
const isComponentTag = (name: string, svelte: boolean): boolean =>
  !name.includes(':') && !name.includes('.') && (/^[A-Z]/.test(name) || (!svelte && name.includes('-')));

/**
 * Every child component a file's script can name, by the name it holds it
 * under: a default import of a component file, or a named import whose
 * declaration is a component of this reading.
 */
const importedComponents = (ctx: ReactExtractContext, script: SourceFile, byFile: ReadonlyMap<string, IndexedFunction>): Map<string, IndexedFunction> => {
  const found = new Map<string, IndexedFunction>();
  // `const OrderChart = defineAsyncComponent(() => import('./OrderChart.vue'))` (P258).
  for (const declaration of script.getVariableDeclarations()) {
    const value = declaration.getInitializer();
    const loaded = value === undefined ? undefined : asyncComponentOf(ctx, value, byFile);
    if (loaded !== undefined) found.set(declaration.getName(), loaded);
  }
  for (const declaration of script.getImportDeclarations()) {
    const fileOf = componentFileOfImport(ctx, declaration);
    const whole = fileOf === undefined ? undefined : byFile.get(fileOf);
    const name = declaration.getDefaultImport()?.getText();
    if (name !== undefined && whole !== undefined) found.set(name, whole);
    for (const specifier of declaration.getNamedImports()) {
      const local = specifier.getAliasNode()?.getText() ?? specifier.getName();
      const symbol = specifier.getNameNode().getSymbol();
      for (const target of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
        const indexed = ctx.functions.get(target as never) ?? byFile.get(normalizeFilePath(target.getSourceFile().getFilePath(), ctx.repoDir));
        if (indexed !== undefined && indexed.role === 'component') {
          found.set(local, indexed);
          break;
        }
      }
    }
  }
  return found;
};

/** The component `defineAsyncComponent(...)` loads, where it is one of this reading (P258). */
const asyncComponentOf = (ctx: ReactExtractContext, value: TsNode, byFile: ReadonlyMap<string, IndexedFunction>): IndexedFunction | undefined => {
  const file = asyncComponentFile(value, ctx.repoDir, (candidate) => byFile.has(candidate));
  return file === undefined ? undefined : byFile.get(file);
};

/** The file an import names, repo-relative: the one the checker opens, else a component file by its relative path. */
const componentFileOfImport = (ctx: ReactExtractContext, declaration: ImportDeclaration): string | undefined => {
  const opened = declaration.getModuleSpecifierSourceFile();
  if (opened !== undefined) return normalizeFilePath(opened.getFilePath(), ctx.repoDir);
  const specifier = declaration.getModuleSpecifierValue();
  if (!specifier.startsWith('.')) return undefined;
  return normalizeFilePath(resolve(dirname(declaration.getSourceFile().getFilePath()), specifier), ctx.repoDir);
};

const propertyValue = (object: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const property = object.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

/** `components: { CartBadge, Total: OrderTotal }` of the Options API, by the name each is registered under. */
const optionComponents = (ctx: ReactExtractContext, script: SourceFile, imported: ReadonlyMap<string, IndexedFunction>, byFile: ReadonlyMap<string, IndexedFunction>): Map<string, IndexedFunction> => {
  const found = new Map<string, IndexedFunction>();
  const assignment = script.getExportAssignment((each) => !each.isExportEquals());
  let value: TsNode | undefined = assignment?.getExpression();
  if (value !== undefined && Node.isCallExpression(value)) value = value.getArguments()[0];
  if (value === undefined || !Node.isObjectLiteralExpression(value)) return found;
  const components = propertyValue(value, 'components');
  if (components === undefined || !Node.isObjectLiteralExpression(components)) return found;
  for (const property of components.getProperties()) {
    if (Node.isShorthandPropertyAssignment(property)) {
      const target = imported.get(property.getName());
      if (target !== undefined) found.set(property.getName(), target);
    } else if (Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      const target =
        initializer === undefined
          ? undefined
          : Node.isIdentifier(initializer)
            ? imported.get(initializer.getText())
            : asyncComponentOf(ctx, initializer, byFile);
      const key = property.getNameNode();
      const name = Node.isStringLiteral(key) ? key.getLiteralValue() : key.getText();
      if (target !== undefined) found.set(name, target);
    }
  }
  return found;
};

/** The components an application registers for every template, and the names it registers from a package's. */
interface GlobalComponents {
  readonly components: ReadonlyMap<string, IndexedFunction>;
  /** `app.component('Button', Button)` where `Button` is a package's (P258): a library's component, no row. */
  readonly packaged: ReadonlySet<string>;
}

/**
 * The components an application registers for every template:
 * `app.component('CartBadge', CartBadge)`, `Vue.component(...)`, a Nuxt
 * plugin's `nuxtApp.vueApp.component(...)`, a library plugin's own
 * `install(app)`, where the second is an import of a component file or
 * `defineAsyncComponent` of one (P258); one imported from a package is that
 * package's.
 */
const globalComponents = (ctx: ReactExtractContext, sources: readonly SourceFile[], byFile: ReadonlyMap<string, IndexedFunction>): GlobalComponents => {
  const found = new Map<string, IndexedFunction>();
  const packaged = new Set<string>();
  for (const sourceFile of sources) {
    if (!/\.component\s*\(/.test(sourceFile.getFullText())) continue;
    const imported = importedComponents(ctx, sourceFile, byFile);
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'component') return;
      const [name, value] = node.getArguments();
      if (name === undefined || value === undefined || !(Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name))) return;
      if (!Node.isIdentifier(value)) {
        const loaded = asyncComponentOf(ctx, value, byFile);
        if (loaded !== undefined) found.set(name.getLiteralValue(), loaded);
        return;
      }
      const target = imported.get(value.getText());
      if (target !== undefined) found.set(name.getLiteralValue(), target);
      else if (isFromPackage(sourceFile, value.getText())) packaged.add(name.getLiteralValue());
    });
  }
  return { components: found, packaged };
};

/** Whether a name a file holds is imported from a package rather than a file of the repository. */
const isFromPackage = (sourceFile: SourceFile, name: string): boolean =>
  sourceFile.getImportDeclarations().some((declaration) => {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier.startsWith('.') || /^[@~#]\//.test(specifier)) return false;
    return declaration.getDefaultImport()?.getText() === name || declaration.getNamedImports().some((each) => (each.getAliasNode()?.getText() ?? each.getName()) === name);
  });

/** One tag's answer: the components it renders, or why it renders none of the repository's. */
type Resolved = { readonly targets: readonly IndexedFunction[]; readonly lazy?: boolean } | { readonly why: 'framework' | 'library' | 'element' | 'missing' | 'ambiguous'; readonly files?: readonly string[] };

const EDGE_KEY = (edge: Pick<GraphEdge, 'from' | 'to'>): string => `${edge.from}\u0000${edge.to}`;

/** Where SvelteKit's routes are, repo-relative, where the application is SvelteKit's (P258). */
export interface SveltekitReading {
  readonly root: string;
}

/**
 * Draws the child components of every component of this reading, in Nuxt
 * each page's route middleware and layout (P255), and in SvelteKit each
 * page's layouts and loads (P258). Returns nothing; the edges and rows are
 * the builder's.
 */
export const drawChildren = (
  ctx: ReactExtractContext,
  components: readonly MarkupComponent[],
  sources: readonly SourceFile[],
  nuxt: NuxtReading | undefined,
  sveltekit?: SveltekitReading,
): void => {
  const byFile = new Map(components.map(({ component }) => [component.file, component] as const));
  const { components: global, packaged } = globalComponents(ctx, sources, byFile);
  const plugins: InstalledPlugins = components.some(({ made }) => made.format.extension !== '.svelte')
    ? installedPlugins(ctx.pkg, sources, ctx.repoDir, librarySettingsOf(ctx.repoDir, ctx.pkg, nuxt !== undefined))
    : { libraries: [], unknown: [] };
  const drawn = new Set<string>();
  const rendering = nuxt === undefined ? undefined : layoutRenderingOf(nuxt, components);
  // What plugins add when the application starts (P258), then what the root component's setup adds (P262).
  const startup = nuxt === undefined ? undefined : startupMiddlewareOf(ctx, nuxt, components, sources);
  const runtime = nuxt === undefined ? [] : [...runtimeMiddlewareOf(ctx, nuxt), ...(startup?.added ?? [])];
  const scoped = startup?.scoped ?? new Set<string>();
  const edge = (from: IndexedFunction, to: IndexedFunction, file: string, line: number, meta: Record<string, unknown>): void => {
    if (from.id === to.id) return;
    const key = EDGE_KEY({ from: from.id, to: to.id });
    if (drawn.has(key) && meta['order'] === undefined) return;
    drawn.add(key);
    ctx.ensureFunctionNode(from.fn);
    ctx.ensureFunctionNode(to.fn);
    ctx.builder.addEdge({ from: from.id, to: to.id, type: 'calls', confidence: 'static', file, line, meta });
  };

  for (const { component, made, script } of components) {
    const svelte = made.format.extension === '.svelte';
    const imported = importedComponents(ctx, script, byFile);
    const local = new Map([...imported, ...optionComponents(ctx, script, imported, byFile)]);
    const resolveTag = (written: string): Resolved => {
      const spellings = svelte ? [written] : vueSpellings(written);
      const named = spellings.map((name) => local.get(name)).find((found) => found !== undefined) ?? (svelte ? undefined : spellings.map((name) => global.get(name)).find((found) => found !== undefined));
      if (named !== undefined) return { targets: [named] };
      const pascal = svelte ? written : pascalOf(written);
      if (nuxt !== undefined && !svelte) {
        const lazy = /^Lazy[A-Z]/.test(pascal) && !nuxt.names.components.has(pascal);
        const name = lazy ? pascal.slice(4) : pascal;
        const registered = nuxt.names.components.get(name);
        if (registered !== undefined) {
          const targets = registered.flatMap((each) => {
            const found = byFile.get(each.file);
            return found === undefined ? [] : [found];
          });
          // A name of a file Nuxt registers that is no component of this reading (a render function in `.ts`): joined to nothing, and said by nothing.
          return { targets, ...(lazy ? { lazy: true } : {}) };
        }
        const twice = nuxt.names.ambiguous.get(name);
        if (twice !== undefined) return { why: 'ambiguous', files: twice };
        if (NUXT_BUILT_IN_COMPONENTS.has(name) || nuxt.names.packaged.has(name)) return { why: 'framework' };
      }
      if (!svelte && VUE_BUILT_IN_COMPONENTS.has(pascal)) return { why: 'framework' };
      // A component a library registers by name (P258): the library's, with no row.
      if (!svelte && (packaged.has(written) || packaged.has(pascal) || libraryOf(pascal, plugins.libraries) !== undefined)) return { why: 'library' };
      return /^[A-Z]/.test(written) ? { why: 'missing' } : { why: 'element' };
    };

    for (const tag of svelte ? svelteMarkupTags(made.text) : vueTemplateTags(made.text)) {
      // `<component :is="CartBadge">`, `<svelte:component this={CartBadge}>`: the component the binding names.
      const bound = isTag(tag, 'component') ? isBinding(tag, svelte) : tag.name === 'svelte:component' ? thisBinding(tag) : undefined;
      if (bound !== undefined) {
        const target = bound.literal ? undefined : local.get(bound.name);
        const resolved = bound.literal ? resolveTag(bound.name) : target === undefined ? undefined : { targets: [target] };
        if (resolved !== undefined && 'targets' in resolved) for (const child of resolved.targets) edge(component, child, made.file, tag.line, { renders: bound.name });
        continue;
      }
      if (nuxt !== undefined && !svelte && isTag(tag, 'NuxtLayout')) {
        layoutTag(ctx, nuxt, byFile, component, made, tag, edge);
        continue;
      }
      if (!isComponentTag(tag.name, svelte)) continue;
      const resolved = resolveTag(tag.name);
      if ('targets' in resolved) {
        for (const child of resolved.targets) edge(component, child, made.file, tag.line, { renders: tag.name, ...(resolved.lazy === true ? { lazy: true } : {}) });
        continue;
      }
      if (resolved.why !== 'missing' && resolved.why !== 'ambiguous') continue;
      // A plugin the table of libraries does not know may register it: said, so the row is not taken for a typo (P258).
      const mayRegister = svelte || resolved.why !== 'missing' ? [] : plugins.unknown;
      const byPlugin = mayRegister.length === 0 ? '' : `; ${mayRegister.map((plugin) => `${plugin.written} in ${plugin.file}`).join(', ')} may register it`;
      ctx.report({
        file: made.file,
        line: tag.line,
        reason: 'component-unresolved',
        level: 'info',
        symbol: `${component.name} <${tag.name}>`,
        message:
          resolved.why === 'ambiguous'
            ? `<${tag.name}> in ${made.file} is a name ${(resolved.files ?? []).join(' and ')} each give, so which one it renders is not said, and neither is joined`
            : `<${tag.name}> in ${made.file} names no component the file imports or registers, and none the framework registers by name, so what it renders is not joined${byPlugin}`,
        hint:
          resolved.why === 'ambiguous'
            ? 'Rename one of the two files, so one name is one component.'
            : mayRegister.length === 0
              ? 'Import the component in the script, register it, or put it where the framework registers components by name.'
              : 'Import the component in the script, or register it with `app.component` in the repository; a library the plugin installs is not read.',
        meta: { cause: 'component-unresolved', why: resolved.why, tag: tag.name, ...(mayRegister.length === 0 ? {} : { plugins: mayRegister.map((plugin) => `${plugin.file}:${plugin.line}`) }) },
      });
    }

    if (nuxt !== undefined && rendering !== undefined && nuxt.pages.has(made.file)) pageFlow(ctx, nuxt, rendering, runtime, scoped, byFile, component, made, script, edge);
    if (sveltekit !== undefined && svelte) sveltekitPageFlow(ctx, sveltekit, byFile, component, made, edge);
  }
};

const isTag = (tag: MarkupTag, pascal: string): boolean => pascalOf(tag.name) === pascal;

/** What `<component :is>` names: a binding to a name the script holds, or a literal tag name. */
const isBinding = (tag: MarkupTag, svelte: boolean): { name: string; literal: boolean } | undefined => {
  if (svelte) return undefined;
  const bound = tag.attributes.get(':is') ?? tag.attributes.get('v-bind:is');
  if (typeof bound === 'string' && /^[A-Za-z_$][\w$]*$/.test(bound.trim())) return { name: bound.trim(), literal: false };
  const literal = tag.attributes.get('is');
  return typeof literal === 'string' && literal !== '' ? { name: literal, literal: true } : undefined;
};

const thisBinding = (tag: MarkupTag): { name: string; literal: boolean } | undefined => {
  const bound = tag.attributes.get('this');
  const name = typeof bound === 'string' ? /^\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(bound.trim())?.[1] : undefined;
  return name === undefined ? undefined : { name, literal: false };
};

type DrawEdge = (from: IndexedFunction, to: IndexedFunction, file: string, line: number, meta: Record<string, unknown>) => void;

/** `<NuxtLayout name="admin">` outside the root component: the layout it renders, as a child (P255). */
const layoutTag = (
  ctx: ReactExtractContext,
  nuxt: NuxtReading,
  byFile: ReadonlyMap<string, IndexedFunction>,
  component: IndexedFunction,
  made: EmbeddedFile,
  tag: MarkupTag,
  edge: DrawEdge,
): void => {
  if (made.file === nuxt.names.root) return;
  const named = tag.attributes.get('name');
  const bound = tag.attributes.get(':name') ?? tag.attributes.get('v-bind:name');
  if (bound !== undefined) {
    layoutRow(ctx, made.file, tag.line, component.name, String(bound), 'dynamic');
    return;
  }
  if (typeof named !== 'string') return;
  const file = nuxt.names.layouts.get(named);
  const target = file === undefined ? undefined : byFile.get(file);
  if (target !== undefined) edge(component, target, made.file, tag.line, { renders: tag.name, layout: named });
  else layoutRow(ctx, made.file, tag.line, component.name, named, 'missing');
};

/** The layout and the route middleware a page names (`definePageMeta`), read off its script. */
interface PageMeta {
  readonly line: number;
  /** A name, `false` for none, or the code it is written as. */
  readonly layout?: { name: string } | false | { code: string };
  readonly middleware: ReadonlyArray<{ name: string } | { code: string }>;
}

const pageMetaOf = (script: SourceFile): PageMeta | undefined => {
  let found: PageMeta | undefined;
  script.forEachDescendant((node, traversal) => {
    if (!Node.isCallExpression(node) || node.getExpression().getText() !== 'definePageMeta') return;
    traversal.stop();
    const [first] = node.getArguments();
    const line = startLineOf(node);
    if (first === undefined || !Node.isObjectLiteralExpression(first)) {
      found = { line, middleware: [] };
      return;
    }
    const literal = (value: TsNode): { name: string } | { code: string } =>
      Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) ? { name: value.getLiteralValue() } : { code: value.getText() };
    const layoutNode = propertyValue(first, 'layout');
    const layout = layoutNode === undefined ? undefined : Node.isFalseLiteral(layoutNode) ? false : literal(layoutNode);
    const middlewareNode = propertyValue(first, 'middleware');
    const listed = middlewareNode === undefined ? [] : Node.isArrayLiteralExpression(middlewareNode) ? middlewareNode.getElements() : [middlewareNode];
    // A middleware written in place is part of the page's own script, read with it.
    const middleware = listed.filter((item) => !(Node.isArrowFunction(item) || Node.isFunctionExpression(item))).map(literal);
    found = { line, ...(layout === undefined ? {} : { layout }), middleware };
  });
  return found;
};

/** How the root component renders a page's layout: by the page's name for it, by one name for every page, by code, or not at all. */
type LayoutRendering = { kind: 'page' } | { kind: 'named'; name: string } | { kind: 'dynamic'; code: string } | { kind: 'none' };

const layoutRenderingOf = (nuxt: NuxtReading, components: readonly MarkupComponent[]): LayoutRendering => {
  // Without a root component of its own, Nuxt's renders the page in its layout.
  if (nuxt.names.root === undefined) return { kind: 'page' };
  const root = components.find(({ made }) => made.file === nuxt.names.root);
  if (root === undefined) return { kind: 'page' };
  const tag = vueTemplateTags(root.made.text).find((each) => isTag(each, 'NuxtLayout'));
  if (tag === undefined) return { kind: 'none' };
  const bound = tag.attributes.get(':name') ?? tag.attributes.get('v-bind:name');
  if (bound !== undefined) return { kind: 'dynamic', code: String(bound) };
  const named = tag.attributes.get('name');
  return typeof named === 'string' ? { kind: 'named', name: named } : { kind: 'page' };
};

/** The function a route middleware file's default export runs: what `defineNuxtRouteMiddleware` is handed. */
const middlewareFunction = (ctx: ReactExtractContext, name: string, file: string): IndexedFunction | undefined => {
  const sourceFile = ctx.project.getSourceFile(join(ctx.repoDir, file));
  let value: TsNode | undefined = sourceFile?.getExportAssignment((each) => !each.isExportEquals())?.getExpression();
  if (value !== undefined && Node.isCallExpression(value) && /(?:^|\.)defineNuxtRouteMiddleware$/.test(value.getExpression().getText())) value = value.getArguments()[0];
  if (value === undefined) return undefined;
  if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) {
    return ctx.functions.adopt({ name, declaration: value, body: value.getBody(), line: startLineOf(value) });
  }
  if (!Node.isIdentifier(value)) return undefined;
  for (const declaration of value.getSymbol()?.getDeclarations() ?? []) {
    const indexed = ctx.functions.get(declaration as never);
    if (indexed !== undefined) return indexed;
  }
  return undefined;
};

/**
 * A page's way through Nuxt's router (P255): every middleware in front of
 * every page, in the order Nuxt runs them, then the ones the page names in
 * its order, then its layout - each a `calls` edge from the page with its
 * place in that order, so a flow from the page goes through them as the
 * router does. A name that matches no file is a row.
 */
const pageFlow = (
  ctx: ReactExtractContext,
  nuxt: NuxtReading,
  rendering: LayoutRendering,
  runtime: readonly RuntimeMiddleware[],
  scoped: ReadonlySet<string>,
  byFile: ReadonlyMap<string, IndexedFunction>,
  page: IndexedFunction,
  made: EmbeddedFile,
  script: SourceFile,
  edge: DrawEdge,
): void => {
  const meta = pageMetaOf(script);
  const line = meta?.line ?? page.line;
  let order = 0;
  const through = (name: string, file: string): void => {
    const fn = middlewareFunction(ctx, name, file);
    if (fn !== undefined) edge(page, fn, made.file, line, { middleware: name, order: order++ });
  };
  // What a plugin adds when the application starts (P258), or the root
  // component's setup (P262): a global one after the ones the build adds, a
  // named one in place of a file's.
  const added = (middleware: RuntimeMiddleware): void => {
    edge(page, middleware.fn, made.file, line, { middleware: middleware.name ?? middleware.fn.name, order: order++, ...middleware.from });
  };
  for (const middleware of nuxt.names.middleware) if (middleware.global) through(middleware.name, middleware.file);
  for (const middleware of runtime) if (middleware.global) added(middleware);
  for (const written of meta?.middleware ?? []) {
    if ('code' in written) {
      middlewareRow(ctx, made.file, line, page.name, written.code, 'dynamic');
      continue;
    }
    const atRuntime = runtime.findLast((each) => !each.global && each.name === written.name);
    const known = nuxt.names.middleware.find((each) => each.name === written.name);
    if (atRuntime !== undefined) added(atRuntime);
    // One only a component's setup adds is there once that component has been shown (P262).
    else if (known === undefined) middlewareRow(ctx, made.file, line, page.name, written.name, scoped.has(written.name) ? 'scoped' : 'missing');
    else through(known.name, known.file);
  }

  const asked = meta?.layout;
  if (rendering.kind === 'dynamic') {
    if (asked !== false) layoutRow(ctx, made.file, line, page.name, rendering.code, 'dynamic');
    return;
  }
  if (rendering.kind === 'none') {
    if (asked !== undefined && asked !== false) layoutRow(ctx, made.file, line, page.name, 'name' in asked ? asked.name : asked.code, 'unrendered');
    return;
  }
  if (asked === false) return;
  if (rendering.kind === 'page' && asked !== undefined && 'code' in asked) {
    layoutRow(ctx, made.file, line, page.name, asked.code, 'dynamic');
    return;
  }
  const name = rendering.kind === 'named' ? rendering.name : asked === undefined ? 'default' : (asked as { name: string }).name;
  const file = nuxt.names.layouts.get(name);
  const layout = file === undefined ? undefined : byFile.get(file);
  if (layout !== undefined) edge(page, layout, made.file, line, { layout: name, order: order++ });
  // No `default` layout is no layout, as Nuxt renders the page alone.
  else if (!(name === 'default' && asked === undefined) && !nuxt.names.layouts.has(name)) layoutRow(ctx, made.file, line, page.name, name, 'missing');
};

/**
 * A route middleware added when the application starts:
 * `addRouteMiddleware('name', fn, { global })` in a plugin (P258), or at the
 * top of the root component's setup (P262).
 */
interface RuntimeMiddleware {
  /** None for `addRouteMiddleware(fn)`, which is global. */
  readonly name?: string;
  readonly global: boolean;
  readonly fn: IndexedFunction;
  /**
   * Where it is added, as the page's edge says it: `{ plugin }` the
   * repo-relative plugin file; `{ setup, addedIn, firstNavigation: false }`
   * the root component and the file of the call - a middleware the root
   * component adds runs from the navigation after the first, which the
   * router makes before the root component is set up.
   */
  readonly from: Readonly<Record<string, unknown>>;
}

/** The function a route middleware is: written in place, `defineNuxtRouteMiddleware` of one, or a name of one. */
const middlewareValue = (ctx: ReactExtractContext, name: string, value: TsNode): IndexedFunction | undefined => {
  let at: TsNode = value;
  if (Node.isCallExpression(at) && /(?:^|\.)defineNuxtRouteMiddleware$/.test(at.getExpression().getText())) at = at.getArguments()[0] ?? at;
  if (Node.isArrowFunction(at) || Node.isFunctionExpression(at)) return ctx.functions.adopt({ name, declaration: at, body: at.getBody(), line: startLineOf(at) });
  if (!Node.isIdentifier(at)) return undefined;
  for (const declaration of (at.getSymbol()?.getAliasedSymbol() ?? at.getSymbol())?.getDeclarations() ?? []) {
    const indexed = ctx.functions.get(declaration as never);
    if (indexed !== undefined) return indexed;
    if (Node.isVariableDeclaration(declaration)) {
      const held = declaration.getInitializer();
      if (held !== undefined && held !== value) return middlewareValue(ctx, name, held);
    }
  }
  return undefined;
};

/**
 * Every route middleware the application's plugins add when it starts (P258),
 * in the order Nuxt runs the plugins: `addRouteMiddleware('auth', fn)` is a
 * named one, `{ global: true }` or a function alone one in front of every
 * page. A name or a function written as code is a row at the call.
 */
const runtimeMiddlewareOf = (ctx: ReactExtractContext, nuxt: NuxtReading): RuntimeMiddleware[] => {
  const found: RuntimeMiddleware[] = [];
  for (const plugin of nuxt.names.plugins) {
    const sourceFile = ctx.project.getSourceFile(join(ctx.repoDir, plugin.file));
    if (sourceFile === undefined || !sourceFile.getFullText().includes('addRouteMiddleware')) continue;
    sourceFile.forEachDescendant((node) => {
      if (!isAddRouteMiddleware(node)) return;
      const read = additionOf(ctx, node as CallExpression, plugin.file);
      if (read !== undefined) found.push({ ...read, from: { plugin: plugin.file } });
    });
  }
  return found;
};

const isAddRouteMiddleware = (node: TsNode): boolean =>
  Node.isCallExpression(node) && /(?:^|\.)addRouteMiddleware$/.test(node.getExpression().getText());

/**
 * One `addRouteMiddleware(...)`: its name (none for a function alone), whether
 * it runs in front of every page, and the function it runs. A name or a
 * function written as code is a row at the call, and nothing is answered.
 */
const additionOf = (ctx: ReactExtractContext, node: CallExpression, file: string): Omit<RuntimeMiddleware, 'from'> | undefined => {
  const [first, second, third] = node.getArguments();
  if (first === undefined) return undefined;
  const named = Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first) ? first.getLiteralValue() : undefined;
  const anonymous = Node.isArrowFunction(first) || Node.isFunctionExpression(first) || (Node.isCallExpression(first) && /defineNuxtRouteMiddleware$/.test(first.getExpression().getText()));
  const value = anonymous ? first : second;
  const options = anonymous ? second : third;
  const global = anonymous || (options !== undefined && Node.isObjectLiteralExpression(options) && propertyValue(options, 'global')?.getText() === 'true');
  const label = named ?? `${file.split('/').pop()?.replace(/\.(?:[cm]?[jt]s|vue)$/, '') ?? file} middleware`;
  const fn = value === undefined || (!anonymous && named === undefined) ? undefined : middlewareValue(ctx, label, value);
  if (fn === undefined) {
    middlewareRow(ctx, file, startLineOf(node), file, (named === undefined && !anonymous ? first : (value ?? first)).getText().slice(0, 60), 'dynamic', 'plugin');
    return undefined;
  }
  return { ...(named === undefined ? {} : { name: named }), global, fn };
};

/** How many functions deep a call from the root component's setup is followed to an `addRouteMiddleware`. */
const STARTUP_DEPTH = 4;

/**
 * The route middleware added outside a plugin (P262). Nuxt runs its plugins,
 * makes its first navigation, and then sets up the root component; an
 * `addRouteMiddleware` at the top of that setup - `app.vue`'s `<script
 * setup>` or its `setup()` - or at the top of a function of the repository
 * the setup calls there (a composable, and the ones it calls in turn) runs
 * once, and what it adds stays for every navigation after. Anywhere else - a
 * page's or a child's setup, a handler, a callback, a composable nothing at
 * startup calls - it runs when that code runs, so which navigations it stands
 * in front of is not something the files say: a row at the call, and the
 * names it adds kept for the page that names one.
 */
const startupMiddlewareOf = (
  ctx: ReactExtractContext,
  nuxt: NuxtReading,
  components: readonly MarkupComponent[],
  sources: readonly SourceFile[],
): { added: RuntimeMiddleware[]; scoped: Set<string> } => {
  const added: RuntimeMiddleware[] = [];
  const scoped = new Set<string>();
  const plugins = new Set(nuxt.names.plugins.map((plugin) => plugin.file));
  // A module's `addRouteMiddleware` is the build's, from its kit (P255), and read with the module.
  const calls = sources.filter((sourceFile) => {
    const text = sourceFile.getFullText();
    return text.includes('addRouteMiddleware') && !/\bdefineNuxtModule\b|['"](?:@nuxt|nuxt)\/kit['"]/.test(text) && !plugins.has(ctx.fileOf(sourceFile));
  });
  if (calls.length === 0) return { added, scoped };

  // The calls the root component's setup makes, each with the file it is written in.
  const atStartup = new Map<TsNode, string>();
  const root = components.find(({ made }) => made.file === nuxt.names.root);
  const walked = new Set<TsNode>();
  const walk = (body: TsNode, depth: number): void => {
    if (walked.has(body) || depth > STARTUP_DEPTH) return;
    walked.add(body);
    body.forEachDescendant((node, traversal) => {
      // A function written here runs when something calls it, not now.
      if (node !== body && Node.isFunctionLikeDeclaration(node)) {
        traversal.skip();
        return;
      }
      if (!Node.isCallExpression(node)) return;
      if (isAddRouteMiddleware(node)) {
        atStartup.set(node, ctx.fileOf(node));
        return;
      }
      const callee = node.getExpression();
      if (!Node.isIdentifier(callee)) return;
      const symbol = callee.getSymbol();
      for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
        if (declaration.getSourceFile().getFilePath().includes('/node_modules/')) continue;
        const fn = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
        if (fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn))) {
          const fnBody = fn.getBody();
          if (fnBody !== undefined) walk(fnBody, depth + 1);
        }
      }
    });
  };
  if (root !== undefined) {
    walk(root.script, 0);
    // The Options API's `setup()`.
    const assignment = root.script.getExportAssignment((each) => !each.isExportEquals());
    let options: TsNode | undefined = assignment?.getExpression();
    if (options !== undefined && Node.isCallExpression(options)) options = options.getArguments()[0];
    const setup = options !== undefined && Node.isObjectLiteralExpression(options) ? options.getProperty('setup') : undefined;
    const body = setup !== undefined && Node.isMethodDeclaration(setup) ? setup.getBody() : undefined;
    if (body !== undefined) walk(body, 0);
  }

  for (const sourceFile of calls) {
    sourceFile.forEachDescendant((node) => {
      if (!isAddRouteMiddleware(node)) return;
      const file = ctx.fileOf(node);
      const addedIn = atStartup.get(node);
      if (addedIn !== undefined && nuxt.names.root !== undefined) {
        const read = additionOf(ctx, node as CallExpression, file);
        if (read !== undefined) added.push({ ...read, from: { setup: nuxt.names.root, addedIn, firstNavigation: false } });
        return;
      }
      const [first] = (node as CallExpression).getArguments();
      const named = first !== undefined && (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)) ? first.getLiteralValue() : undefined;
      if (named !== undefined) scoped.add(named);
      middlewareRow(ctx, file, startLineOf(node), file, named ?? (first?.getText().slice(0, 60) ?? ''), 'scoped', 'call');
    });
  }
  return { added, scoped };
};

/** A SvelteKit page or layout file's name: `+page`, `+layout`, and what it resets to after `@` (P258). */
const SVELTEKIT_PAGE = /^\+page(?:@([^.]*))?\.svelte$/;
const SVELTEKIT_LAYOUT = /^\+layout(?:@([^.]*))?\.svelte$/;
const SVELTEKIT_LOADS: ReadonlyArray<{ readonly kind: 'server' | 'universal'; readonly file: RegExp }> = [
  { kind: 'server', file: /^\+layout\.server\.[cm]?[jt]s$/ },
  { kind: 'universal', file: /^\+layout\.[cm]?[jt]s$/ },
];

/** One level of a SvelteKit page's layouts: a directory with a layout file of any kind. */
interface SveltekitLevel {
  /** Repo-relative directory. */
  readonly dir: string;
  /** Its `+layout.svelte`, and what it resets to, where it has one. */
  readonly component?: { readonly file: string; readonly reset?: string };
}

/** The directories from the routes' root down to `dir`, the root first. */
const directoriesDown = (root: string, dir: string): string[] => {
  const below = dir === root ? [] : dir.slice(root.length + 1).split('/');
  return [root, ...below.map((_, index) => `${root}/${below.slice(0, index + 1).join('/')}`)];
};

/** The route id a directory of SvelteKit's routes is: `/`, `/(app)/orders`. */
const routeIdOf = (root: string, dir: string): string => (dir === root ? '/' : `/${dir.slice(root.length + 1)}`);

/**
 * A SvelteKit page's way through its layouts (P258): every layout up the
 * route tree wraps it, the root's outermost, unless a `@` resets the chain -
 * `+page@(app).svelte` is wrapped by the layout of the `(app)` directory and
 * those above it only, `+page@.svelte` by the root's, and a layout's own `@`
 * does the same for the layouts above it. Each layout's loads run before
 * anything is shown - every server `load` first, then every universal one -
 * and its component then wraps the page. Each is a `calls` edge from the page
 * in that order (`meta.order`), so a flow from the page reaches what its
 * layouts load and what they request. A reset naming no directory above it
 * is a row.
 */
const sveltekitPageFlow = (
  ctx: ReactExtractContext,
  sveltekit: SveltekitReading,
  byFile: ReadonlyMap<string, IndexedFunction>,
  page: IndexedFunction,
  made: EmbeddedFile,
  edge: DrawEdge,
): void => {
  const { root } = sveltekit;
  const fileName = made.file.split('/').pop() ?? '';
  const pageName = SVELTEKIT_PAGE.exec(fileName);
  if (pageName === null || !made.file.startsWith(`${root}/`)) return;
  const pageDir = made.file.slice(0, made.file.lastIndexOf('/'));
  const levelAt = (dir: string): SveltekitLevel | undefined => {
    let entries: string[];
    try {
      entries = readdirSync(join(ctx.repoDir, dir));
    } catch {
      return undefined;
    }
    const component = entries.map((entry) => ({ entry, match: SVELTEKIT_LAYOUT.exec(entry) })).find(({ match }) => match !== null);
    const hasLoad = entries.some((entry) => SVELTEKIT_LOADS.some(({ file }) => file.test(entry)));
    if (component === undefined && !hasLoad) return undefined;
    const reset = component?.match?.[1];
    return { dir, ...(component === undefined ? {} : { component: { file: `${dir}/${component.entry}`, ...(reset === undefined ? {} : { reset }) } }) };
  };

  // From the page up: the nearest layout at or above where the page (or the layout below) says to start.
  const chain: SveltekitLevel[] = [];
  let candidates = directoriesDown(root, pageDir).reverse();
  let reset = pageName[1];
  let from = made.file;
  for (;;) {
    if (reset !== undefined) {
      const named = reset === '' ? candidates.length - 1 : candidates.findIndex((dir) => (dir === root ? '' : dir.split('/').pop()) === reset);
      if (named === -1) {
        layoutRow(ctx, from, 1, page.name, `@${reset}`, 'missing', 'sveltekit');
        return;
      }
      candidates = candidates.slice(named);
    }
    const index = candidates.findIndex((dir) => levelAt(dir) !== undefined);
    if (index === -1) break;
    const level = levelAt(candidates[index] as string) as SveltekitLevel;
    chain.unshift(level);
    candidates = candidates.slice(index + 1);
    reset = level.component?.reset;
    from = level.component?.file ?? level.dir;
  }

  let order = 0;
  const step = (target: IndexedFunction | undefined, meta: Record<string, unknown>): void => {
    if (target !== undefined) edge(page, target, made.file, page.line, { ...meta, order: order++ });
  };
  // The `load` a file of the directory exports.
  const loadOf = (dir: string, ownFile: RegExp): IndexedFunction | undefined => {
    for (const indexed of ctx.functions.all()) {
      if (indexed.name === 'load' && indexed.file.startsWith(`${dir}/`) && ownFile.test(indexed.file.slice(dir.length + 1))) return indexed;
    }
    return undefined;
  };
  const own = [
    { kind: 'server' as const, file: /^\+page\.server\.[cm]?[jt]s$/ },
    { kind: 'universal' as const, file: /^\+page\.[cm]?[jt]s$/ },
  ];
  for (const { kind, file } of SVELTEKIT_LOADS) {
    for (const level of chain) step(loadOf(level.dir, file), { load: kind, layout: routeIdOf(root, level.dir) });
    const pageLoad = own.find((each) => each.kind === kind);
    if (pageLoad !== undefined) step(loadOf(pageDir, pageLoad.file), { load: kind, page: routeIdOf(root, pageDir) });
  }
  for (const level of chain) {
    if (level.component !== undefined) step(byFile.get(level.component.file), { layout: routeIdOf(root, level.dir) });
  }
};

/** Why a layout or a middleware a page names is not joined; `scoped`: added only where some component's code runs (P262). */
type UnmatchedName = 'missing' | 'dynamic' | 'unrendered' | 'scoped';

const layoutRow = (ctx: ReactExtractContext, file: string, line: number, page: string, name: string, why: UnmatchedName, framework: 'nuxt' | 'sveltekit' = 'nuxt'): void => {
  const kit = framework === 'sveltekit';
  ctx.report({
    file,
    line,
    reason: 'layout-unresolved',
    level: why === 'missing' ? 'action' : 'info',
    symbol: `${page} layout ${name}`,
    message:
      why === 'missing' && kit
        ? `${file} resets its layouts to ${name}, and no directory above it is named ${name.slice(1)}, so which layouts wrap it is not said`
        : why === 'missing'
        ? `${file} is shown in the layout ${name}, and no file of a layouts directory of the application is named so`
        : why === 'dynamic'
          ? `the layout ${file} is shown in is written as code (${name}), so which one is not read`
          : `${file} names the layout ${name}, and the root component renders no <NuxtLayout>, so no layout is shown`,
    hint:
      why === 'missing' && kit
        ? 'Name a directory above the file after `@` - `+page@(app).svelte` - or `@` alone for the root layout.'
        : why === 'missing'
        ? 'Correct the name, or add the layout to `layouts/`.'
        : why === 'dynamic'
          ? 'Write the layout as a literal name in `definePageMeta` or on `<NuxtLayout name>`.'
          : 'Render `<NuxtLayout>` around `<NuxtPage>` in `app.vue`, or remove the name.',
    meta: { cause: 'layout-unresolved', why, layout: name },
  });
};

const middlewareRow = (
  ctx: ReactExtractContext,
  file: string,
  line: number,
  page: string,
  name: string,
  why: Exclude<UnmatchedName, 'unrendered'>,
  by: 'page' | 'plugin' | 'call' = 'page',
): void => {
  ctx.report({
    file,
    line,
    reason: 'route-middleware-unresolved',
    level: why === 'missing' ? 'action' : 'info',
    symbol: `${page} middleware ${name}`,
    message:
      why === 'missing'
        ? `${file} names the route middleware ${name}, and no file of a middleware directory of the application, no module and no plugin gives one of that name`
        : why === 'scoped' && by === 'call'
          ? `${file} adds the route middleware ${name} outside a plugin and not at the top of the root component's setup, so it is added only when this code runs, and which navigations it runs in front of is not read`
          : why === 'scoped'
            ? `${file} names the route middleware ${name}, which only a component's code adds when it runs, so whether it is there when this page is shown is not read`
            : by === 'plugin'
              ? `${file} adds a route middleware whose name or function is written as code (${name}), so which pages it runs in front of, and what it runs, is not read`
              : `a route middleware ${file} names is written as code (${name}), so which one is not read`,
    hint:
      why === 'missing'
        ? 'Correct the name, or add the middleware to `middleware/`.'
        : why === 'scoped'
          ? 'Add it in a plugin, or at the top of `app.vue`\'s setup, or put it in `middleware/`.'
          : by === 'plugin'
            ? "Write `addRouteMiddleware('name', (to) => ..., { global })` with a literal name and the function in place or imported."
            : 'Write the middleware as a literal name in `definePageMeta`.',
    meta: { cause: 'route-middleware-unresolved', why, middleware: name },
  });
};
