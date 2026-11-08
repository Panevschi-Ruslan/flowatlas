import { dirname, join, resolve } from 'node:path';
import { normalizeFilePath, startLineOf, type EmbeddedFile, type GraphEdge } from '@flowatlas/core';
import { NUXT_BUILT_IN_COMPONENTS, type NuxtNames } from '@flowatlas/adapters-entry';
import type { ImportDeclaration, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { svelteMarkupTags, vueTemplateTags, type MarkupTag } from './events.js';

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
const optionComponents = (script: SourceFile, imported: ReadonlyMap<string, IndexedFunction>): Map<string, IndexedFunction> => {
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
      const target = initializer !== undefined && Node.isIdentifier(initializer) ? imported.get(initializer.getText()) : undefined;
      const key = property.getNameNode();
      const name = Node.isStringLiteral(key) ? key.getLiteralValue() : key.getText();
      if (target !== undefined) found.set(name, target);
    }
  }
  return found;
};

/**
 * The components an application registers for every template:
 * `app.component('CartBadge', CartBadge)`, `Vue.component(...)`, a Nuxt
 * plugin's `nuxtApp.vueApp.component(...)`, where the second is an import of
 * a component file.
 */
const globalComponents = (ctx: ReactExtractContext, sources: readonly SourceFile[], byFile: ReadonlyMap<string, IndexedFunction>): Map<string, IndexedFunction> => {
  const found = new Map<string, IndexedFunction>();
  for (const sourceFile of sources) {
    if (!/\.component\s*\(/.test(sourceFile.getFullText())) continue;
    const imported = importedComponents(ctx, sourceFile, byFile);
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'component') return;
      const [name, value] = node.getArguments();
      if (name === undefined || value === undefined || !(Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) || !Node.isIdentifier(value)) return;
      const target = imported.get(value.getText());
      if (target !== undefined) found.set(name.getLiteralValue(), target);
    });
  }
  return found;
};

/** One tag's answer: the components it renders, or why it renders none of the repository's. */
type Resolved = { readonly targets: readonly IndexedFunction[]; readonly lazy?: boolean } | { readonly why: 'framework' | 'element' | 'missing' | 'ambiguous'; readonly files?: readonly string[] };

const EDGE_KEY = (edge: Pick<GraphEdge, 'from' | 'to'>): string => `${edge.from}\u0000${edge.to}`;

/**
 * Draws the child components of every component of this reading, and in
 * Nuxt each page's route middleware and layout (P255). Returns nothing; the
 * edges and rows are the builder's.
 */
export const drawChildren = (
  ctx: ReactExtractContext,
  components: readonly MarkupComponent[],
  sources: readonly SourceFile[],
  nuxt: NuxtReading | undefined,
): void => {
  const byFile = new Map(components.map(({ component }) => [component.file, component] as const));
  const global = globalComponents(ctx, sources, byFile);
  const drawn = new Set<string>();
  const rendering = nuxt === undefined ? undefined : layoutRenderingOf(nuxt, components);
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
    const local = new Map([...imported, ...optionComponents(script, imported)]);
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
      ctx.report({
        file: made.file,
        line: tag.line,
        reason: 'component-unresolved',
        level: 'info',
        symbol: `${component.name} <${tag.name}>`,
        message:
          resolved.why === 'ambiguous'
            ? `<${tag.name}> in ${made.file} is a name ${(resolved.files ?? []).join(' and ')} each give, so which one it renders is not said, and neither is joined`
            : `<${tag.name}> in ${made.file} names no component the file imports or registers, and none the framework registers by name, so what it renders is not joined`,
        hint:
          resolved.why === 'ambiguous'
            ? 'Rename one of the two files, so one name is one component.'
            : 'Import the component in the script, register it, or put it where the framework registers components by name.',
        meta: { cause: 'component-unresolved', why: resolved.why, tag: tag.name },
      });
    }

    if (nuxt !== undefined && rendering !== undefined && nuxt.pages.has(made.file)) pageFlow(ctx, nuxt, rendering, byFile, component, made, script, edge);
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
  for (const middleware of nuxt.names.middleware) if (middleware.global) through(middleware.name, middleware.file);
  for (const written of meta?.middleware ?? []) {
    if ('code' in written) {
      middlewareRow(ctx, made.file, line, page.name, written.code, 'dynamic');
      continue;
    }
    const known = nuxt.names.middleware.find((each) => each.name === written.name);
    if (known === undefined) middlewareRow(ctx, made.file, line, page.name, written.name, 'missing');
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

/** Why a layout or a middleware a page names is not joined. */
type UnmatchedName = 'missing' | 'dynamic' | 'unrendered';

const layoutRow = (ctx: ReactExtractContext, file: string, line: number, page: string, name: string, why: UnmatchedName): void => {
  ctx.report({
    file,
    line,
    reason: 'layout-unresolved',
    level: why === 'missing' ? 'action' : 'info',
    symbol: `${page} layout ${name}`,
    message:
      why === 'missing'
        ? `${file} is shown in the layout ${name}, and no file of a layouts directory of the application is named so`
        : why === 'dynamic'
          ? `the layout ${file} is shown in is written as code (${name}), so which one is not read`
          : `${file} names the layout ${name}, and the root component renders no <NuxtLayout>, so no layout is shown`,
    hint:
      why === 'missing'
        ? 'Correct the name, or add the layout to `layouts/`.'
        : why === 'dynamic'
          ? 'Write the layout as a literal name in `definePageMeta` or on `<NuxtLayout name>`.'
          : 'Render `<NuxtLayout>` around `<NuxtPage>` in `app.vue`, or remove the name.',
    meta: { cause: 'layout-unresolved', why, layout: name },
  });
};

const middlewareRow = (ctx: ReactExtractContext, file: string, line: number, page: string, name: string, why: Exclude<UnmatchedName, 'unrendered'>): void => {
  ctx.report({
    file,
    line,
    reason: 'route-middleware-unresolved',
    level: why === 'missing' ? 'action' : 'info',
    symbol: `${page} middleware ${name}`,
    message:
      why === 'missing'
        ? `${file} names the route middleware ${name}, and no file of a middleware directory of the application, and no module, gives one of that name`
        : `a route middleware ${file} names is written as code (${name}), so which one is not read`,
    hint: why === 'missing' ? 'Correct the name, or add the middleware to `middleware/`.' : 'Write the middleware as a literal name in `definePageMeta`.',
    meta: { cause: 'route-middleware-unresolved', why, middleware: name },
  });
};
