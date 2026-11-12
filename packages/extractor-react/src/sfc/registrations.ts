import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { configValueAt, hasDependency, normalizeFilePath, packageOfSpecifier, parseSyntax, startLineOf, type PackageJson } from '@flowatlas/core';
import { nuxtApplicationOf, VITE_CONFIGS } from '@flowatlas/adapters-entry';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind, ts } from 'ts-morph';

/**
 * What a Vue application registers for every template besides its own files
 * (P258): the components of a library a plugin installs, and the plugins it
 * installs whose registrations are not read.
 *
 * `app.use(Vuetify)` registers `<VBtn>`, `<VCard>` and every other component
 * of the library by name, in its package, out of the repository's reach. A
 * small table of common libraries says which names are theirs - a fixed
 * prefix, or a list where the library has none - so a tag one of them gives
 * is the library's: no child of the repository's, and no row. A plugin the
 * table does not know may register anything, so a tag that names nothing
 * stays a row, and the row says which plugin may register it.
 */

/** A library of components installed by a plugin, and the names it registers. */
export interface ComponentLibrary {
  readonly name: string;
  /** Its package, and the packages of the Nuxt modules that install it. */
  readonly packages: readonly string[];
  /**
   * Every name it registers begins with this: `V` for `VBtn`, then a capital;
   * where it has {@link names} too, each of them follows it (`PrimeButton`).
   */
  readonly prefix?: string;
  /** The names it registers, where they share no prefix of their own. */
  readonly names?: ReadonlySet<string>;
  /**
   * Where the application sets a prefix of its own for it (P262): a dotted
   * key of the framework's configuration, and the function of the bundler's
   * configuration - a component resolver, a plugin - that takes one as
   * `prefix` or `components.prefix`, by its name or by the module it is
   * imported from.
   */
  readonly prefixSetting?: { readonly config: string; readonly call?: string; readonly from?: string };
}

/** PrimeVue's components, which it registers under their own names with no prefix. */
const PRIMEVUE_COMPONENTS: ReadonlySet<string> = new Set([
  'Accordion', 'AccordionContent', 'AccordionHeader', 'AccordionPanel', 'AccordionTab', 'AutoComplete', 'Avatar', 'AvatarGroup',
  'Badge', 'BlockUI', 'Breadcrumb', 'Button', 'ButtonGroup', 'Calendar', 'Card', 'Carousel', 'CascadeSelect', 'Checkbox',
  'CheckboxGroup', 'Chip', 'Chips', 'ColorPicker', 'Column', 'ColumnGroup', 'ConfirmDialog', 'ConfirmPopup', 'ContextMenu',
  'DataTable', 'DataView', 'DatePicker', 'DeferredContent', 'Dialog', 'Divider', 'Dock', 'Drawer', 'Dropdown', 'DynamicDialog',
  'Editor', 'Fieldset', 'FileUpload', 'FloatLabel', 'Fluid', 'Galleria', 'IconField', 'IftaLabel', 'Image', 'ImageCompare',
  'Inplace', 'InputChips', 'InputGroup', 'InputGroupAddon', 'InputIcon', 'InputMask', 'InputNumber', 'InputOtp', 'InputSwitch',
  'InputText', 'Knob', 'Listbox', 'MegaMenu', 'Menu', 'Menubar', 'Message', 'MeterGroup', 'MultiSelect', 'OrderList',
  'OrganizationChart', 'OverlayBadge', 'OverlayPanel', 'Paginator', 'Panel', 'PanelMenu', 'Password', 'PickList', 'Popover',
  'ProgressBar', 'ProgressSpinner', 'RadioButton', 'RadioButtonGroup', 'Rating', 'Row', 'ScrollPanel', 'ScrollTop', 'Select',
  'SelectButton', 'Sidebar', 'Skeleton', 'Slider', 'SpeedDial', 'SplitButton', 'Splitter', 'SplitterPanel', 'Step', 'StepItem',
  'StepList', 'StepPanel', 'StepPanels', 'Stepper', 'Steps', 'Tab', 'TabList', 'TabMenu', 'TabPanel', 'TabPanels', 'TabView',
  'Tabs', 'Tag', 'Terminal', 'Textarea', 'TieredMenu', 'Timeline', 'Toast', 'ToggleButton', 'ToggleSwitch', 'Toolbar', 'Tree',
  'TreeSelect', 'TreeTable', 'VirtualScroller',
]);

/**
 * Common libraries of components, each by the names it registers. Kept
 * small on purpose: a library is here only where its names are fixed by its
 * package (a prefix, or a list), so a tag is silenced only for a fact of the
 * package and never for a guess at one. PrimeVue and Nuxt UI take a prefix
 * of the application's (P262), read where it is written.
 */
export const COMPONENT_LIBRARIES: readonly ComponentLibrary[] = [
  { name: 'Vuetify', packages: ['vuetify', 'vuetify-nuxt-module'], prefix: 'V' },
  {
    name: 'PrimeVue',
    packages: ['primevue', '@primevue/nuxt-module'],
    names: PRIMEVUE_COMPONENTS,
    prefixSetting: { config: 'primevue.components.prefix', call: 'PrimeVueResolver' },
  },
  { name: 'Element Plus', packages: ['element-plus', '@element-plus/nuxt'], prefix: 'El' },
  { name: 'Naive UI', packages: ['naive-ui', '@bg-dev/nuxt-naiveui'], prefix: 'N' },
  { name: 'Quasar', packages: ['quasar', 'nuxt-quasar-ui'], prefix: 'Q' },
  { name: 'Ant Design Vue', packages: ['ant-design-vue', '@ant-design-vue/nuxt'], prefix: 'A' },
  { name: 'Nuxt UI', packages: ['@nuxt/ui', '@nuxt/ui-pro'], prefix: 'U', prefixSetting: { config: 'ui.prefix', from: '@nuxt/ui/vite' } },
];

/** Plugins of packages that register no component a template names: a router, a store, translations, queries. */
const PLUGINS_WITHOUT_COMPONENTS: ReadonlySet<string> = new Set([
  'vue-router',
  'pinia',
  'vuex',
  'vue-i18n',
  '@tanstack/vue-query',
  '@vue/apollo-option',
  '@unhead/vue',
  '@vueuse/head',
]);

/** Whether a tag, in PascalCase, is a name a library registers. */
export const libraryOf = (pascal: string, libraries: readonly ComponentLibrary[]): ComponentLibrary | undefined =>
  libraries.find((library) => {
    const prefix = library.prefix ?? '';
    if (!pascal.startsWith(prefix)) return false;
    const rest = pascal.slice(prefix.length);
    return library.names !== undefined ? library.names.has(rest) : prefix !== '' && /^[A-Z]/.test(rest);
  });

/**
 * What the application says about the libraries it installs beyond its
 * manifest (P262): the modules its parts install (a library's Nuxt module a
 * layer names), each configuration that may set a library's prefix, the
 * application's first, and the bundler's configuration, where a resolver or
 * a plugin takes one.
 */
export interface LibrarySettings {
  readonly modules: readonly string[];
  readonly configs: ReadonlyArray<{ readonly value: unknown; readonly file: string }>;
  readonly bundler?: { readonly text: string; readonly file: string };
}

/**
 * What the application says about its libraries beyond its manifest
 * (P262): for Nuxt, the modules every part installs and every part's
 * configuration, the application's first; the bundler's configuration either
 * way.
 */
export const librarySettingsOf = (repoDir: string, pkg: PackageJson, nuxt: boolean): LibrarySettings => {
  const application = nuxt ? nuxtApplicationOf(repoDir, pkg) : undefined;
  const configs = (application?.layers ?? []).flatMap(({ layout }) => (layout.config === undefined ? [] : [{ value: layout.config.value, file: layout.config.file }]));
  const modules = (application?.modules.installed ?? []).map((module) => module.name);
  const file = VITE_CONFIGS.map((name) => join(repoDir, name)).find((path) => existsSync(path));
  let text: string | undefined;
  try {
    text = file === undefined ? undefined : readFileSync(file, 'utf8');
  } catch {
    text = undefined;
  }
  return { modules, configs, ...(file === undefined || text === undefined ? {} : { bundler: { text, file } }) };
};

/** The line a key is written on in a file's text, or the first. */
const lineOfKey = (text: string, key: string): number => {
  const at = new RegExp(`\\b${key}\\s*:`).exec(text);
  return at === null ? 1 : text.slice(0, at.index).split('\n').length;
};

/**
 * The prefix the application sets for a library, where it sets one: its
 * value, or what it is written as where that is code (named in the row of a
 * tag nothing else registers).
 */
const prefixSetOf = (library: ComponentLibrary, settings: LibrarySettings | undefined): { prefix: string } | { unread: UnknownPlugin } | undefined => {
  const setting = library.prefixSetting;
  if (setting === undefined || settings === undefined) return undefined;
  for (const config of settings.configs) {
    const value = configValueAt(config.value, setting.config);
    if (value === undefined) continue;
    if (typeof value === 'string') return { prefix: value };
    let text = '';
    try {
      text = readFileSync(config.file, 'utf8');
    } catch {
      // The line is the first where the file cannot be read again.
    }
    return { unread: { written: setting.config, file: config.file, line: lineOfKey(text, setting.config.split('.').pop() ?? '') } };
  }
  const bundler = settings.bundler;
  if (bundler === undefined) return undefined;
  const file = parseSyntax(bundler.text, bundler.file);
  const imported = new Set<string>();
  if (setting.from !== undefined) {
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== setting.from) continue;
      const name = statement.importClause?.name?.text;
      if (name !== undefined) imported.add(name);
    }
  }
  let found: { prefix: string } | { unread: UnknownPlugin } | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === setting.call || imported.has(node.expression.text))) {
      const [options] = node.arguments;
      const property = (object: ts.Expression | undefined, key: string): ts.Expression | undefined => {
        if (object === undefined || !ts.isObjectLiteralExpression(object)) return undefined;
        const written = object.properties.find((each) => ts.isPropertyAssignment(each) && (ts.isIdentifier(each.name) || ts.isStringLiteral(each.name)) && each.name.text === key);
        return written !== undefined && ts.isPropertyAssignment(written) ? written.initializer : undefined;
      };
      const value = property(options, 'prefix') ?? property(property(options, 'components'), 'prefix');
      if (value !== undefined) {
        const line = file.getLineAndCharacterOfPosition(value.getStart(file)).line + 1;
        found = ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? { prefix: value.text } : { unread: { written: `${node.expression.text}({ prefix })`, file: bundler.file, line } };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
};

/** A plugin the application installs that the table does not know: it may register components the reader cannot see. */
export interface UnknownPlugin {
  /** As written: `app.use(UiKit)`. */
  readonly written: string;
  readonly file: string;
  readonly line: number;
}

/** What the application installs: libraries the table knows, and plugins it does not. */
export interface InstalledPlugins {
  readonly libraries: readonly ComponentLibrary[];
  readonly unknown: readonly UnknownPlugin[];
}

const packageOf = (specifier: string): string | undefined =>
  specifier.startsWith('.') || /^[@~#]\//.test(specifier) || specifier.startsWith('/') ? undefined : packageOfSpecifier(specifier);

/** The module a name of a file is imported from, following one `const x = make(...)` to the name it calls. */
const importedFrom = (sourceFile: SourceFile, expression: TsNode, depth = 0): string | undefined => {
  let at: TsNode = expression;
  while (Node.isCallExpression(at) || Node.isPropertyAccessExpression(at)) at = at.getExpression();
  if (!Node.isIdentifier(at)) return undefined;
  const name = at.getText();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const named =
      declaration.getDefaultImport()?.getText() === name ||
      declaration.getNamespaceImport()?.getText() === name ||
      declaration.getNamedImports().some((specifier) => (specifier.getAliasNode()?.getText() ?? specifier.getName()) === name);
    if (named) return declaration.getModuleSpecifierValue();
  }
  const held = depth === 0 ? sourceFile.getVariableDeclaration(name)?.getInitializer() : undefined;
  return held === undefined ? undefined : importedFrom(sourceFile, held, depth + 1);
};

/** Whether an expression is a Vue application: `createApp(...)` and its chain, a name it is held in, `nuxtApp.vueApp`, `Vue`, or the `app` a plugin's `install` is handed. */
export const isVueApp = (expression: TsNode): boolean => {
  if (Node.isPropertyAccessExpression(expression) && expression.getName() === 'vueApp') return true;
  if (Node.isCallExpression(expression)) {
    const callee = expression.getExpression();
    if (Node.isIdentifier(callee)) return callee.getText() === 'createApp' || callee.getText() === 'createSSRApp';
    return Node.isPropertyAccessExpression(callee) && ['use', 'component', 'directive', 'provide', 'mixin'].includes(callee.getName()) && isVueApp(callee.getExpression());
  }
  if (!Node.isIdentifier(expression)) return false;
  if (expression.getText() === 'Vue') return true;
  for (const declaration of expression.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(declaration)) {
      const value = declaration.getInitializer();
      if (value !== undefined && isVueApp(value)) return true;
    }
    // `install(app) { ... }`: what a plugin is handed is the application.
    if (Node.isParameterDeclaration(declaration)) {
      const fn = declaration.getParent();
      const name = Node.isMethodDeclaration(fn) || Node.isFunctionDeclaration(fn) ? fn.getName() : Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) ? holderName(fn) : undefined;
      if (name === 'install' && fn !== undefined && Node.isFunctionLikeDeclaration(fn) && fn.getParameters()[0] === declaration) return true;
    }
  }
  return false;
};

const holderName = (fn: TsNode): string | undefined => {
  const parent = fn.getParent();
  return parent !== undefined && (Node.isPropertyAssignment(parent) || Node.isVariableDeclaration(parent)) ? parent.getName() : undefined;
};

/** The application a chain of calls is made on, as a row names it: `app`, `nuxtApp.vueApp`, `createApp(...)`. */
const receiverName = (expression: TsNode): string => {
  let at = expression;
  for (let callee = Node.isCallExpression(at) ? at.getExpression() : undefined; callee !== undefined && Node.isPropertyAccessExpression(callee); callee = Node.isCallExpression(at) ? at.getExpression() : undefined) {
    at = callee.getExpression();
  }
  return Node.isCallExpression(at) ? `${at.getExpression().getText()}(...)` : at.getText();
};

/**
 * Every library and plugin a Vue application installs (P258): a library of
 * the table is installed where the repository declares one of its packages,
 * whichever way it registers it (a plugin, a Nuxt module, a resolver of the
 * bundler); a plugin of a package `<app>.use(X)` installs that the table
 * does not know is said by name. A plugin of the repository's own is read
 * where it registers what it registers.
 */
export const installedPlugins = (pkg: PackageJson, sources: readonly SourceFile[], repoDir: string, settings?: LibrarySettings): InstalledPlugins => {
  const libraries = new Set(
    COMPONENT_LIBRARIES.filter((library) => library.packages.some((name) => hasDependency(pkg, name) || (settings?.modules.includes(name) ?? false))),
  );
  const unknown: UnknownPlugin[] = [];
  for (const sourceFile of sources) {
    if (!/\.use\s*\(/.test(sourceFile.getFullText())) continue;
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'use' || !isVueApp(callee.getExpression())) return;
      const [plugin] = node.getArguments();
      if (plugin === undefined) return;
      const from = importedFrom(sourceFile, plugin);
      const name = from === undefined ? undefined : packageOf(from);
      // A plugin of the repository's own: what its `install` registers is read where it is written.
      if (name === undefined) return;
      const library = COMPONENT_LIBRARIES.find((each) => each.packages.includes(name));
      if (library !== undefined) {
        libraries.add(library);
        return;
      }
      if (PLUGINS_WITHOUT_COMPONENTS.has(name)) return;
      unknown.push({ written: `${receiverName(callee.getExpression())}.use(${plugin.getText().replace(/\s+/g, ' ').slice(0, 40)})`, file: normalizeFilePath(sourceFile.getFilePath(), repoDir), line: startLineOf(node) });
    });
  }
  // A prefix the application sets is the library's names (P262); one written as code names nothing, and is said.
  const named: ComponentLibrary[] = [];
  for (const library of libraries) {
    const set = prefixSetOf(library, settings);
    if (set === undefined) named.push(library);
    else if ('prefix' in set) named.push({ ...library, prefix: set.prefix });
    else unknown.push({ ...set.unread, file: normalizeFilePath(set.unread.file, repoDir) });
  }
  return { libraries: named, unknown };
};

/** Endings a lazy import of a component may leave off. */
const COMPONENT_ENDINGS = ['', '.vue', '.svelte', '/index.vue'];

/**
 * The component file `defineAsyncComponent(() => import('./X.vue'))` or
 * `defineAsyncComponent({ loader: () => import('./X.vue') })` loads (P258),
 * repo-relative, where the import names a file by a relative path or by `@/`
 * or `~/`.
 */
export const asyncComponentFile = (value: TsNode, repoDir: string, known: (file: string) => boolean): string | undefined => {
  if (!Node.isCallExpression(value) || !/(?:^|\.)defineAsyncComponent$/.test(value.getExpression().getText())) return undefined;
  const [first] = value.getArguments();
  if (first === undefined) return undefined;
  let loader: TsNode | undefined = first;
  if (Node.isObjectLiteralExpression(first)) {
    const property = first.getProperty('loader');
    loader = property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : property !== undefined && Node.isMethodDeclaration(property) ? property : undefined;
  }
  if (loader === undefined) return undefined;
  let call: TsNode | undefined;
  loader.forEachDescendant((node, traversal) => {
    if (Node.isCallExpression(node) && node.getExpression().getKind() === SyntaxKind.ImportKeyword) {
      call = node;
      traversal.stop();
    }
  });
  if (call === undefined || !Node.isCallExpression(call)) return undefined;
  const [specifierNode] = call.getArguments();
  if (specifierNode === undefined || !(Node.isStringLiteral(specifierNode) || Node.isNoSubstitutionTemplateLiteral(specifierNode))) return undefined;
  const specifier = specifierNode.getLiteralValue();
  const bases = specifier.startsWith('.')
    ? [resolve(dirname(value.getSourceFile().getFilePath()), specifier)]
    : /^[@~]\//.test(specifier)
      ? [join(repoDir, 'src', specifier.slice(2)), join(repoDir, 'app', specifier.slice(2)), join(repoDir, specifier.slice(2))]
      : [];
  for (const base of bases) {
    for (const ending of COMPONENT_ENDINGS) {
      const file = normalizeFilePath(`${base}${ending}`, repoDir);
      if (known(file)) return file;
    }
  }
  return undefined;
};
