/**
 * What a repository uses of a package, by name only (P78).
 *
 * `flowatlas shapes --suggest` says which members of a missing package the
 * code reaches for, so that a shape file can declare those and nothing else.
 * The answer is read off the syntax - no checker, since the package is exactly
 * what the checker cannot see - and it is names and nothing more: which names
 * are imported, which of them are constructed, called or written as a type,
 * and which property names are read off them, off what they construct, and off
 * whatever is declared with them as its type. No other text of the repository
 * is kept, so a starter shape built from this carries no code of anybody's.
 */
import { ts } from 'ts-morph';

/** What one imported name is used as, and which members are read off it. */
export interface UsedExport {
  /** The name the package exports it under; `default` for a default import. */
  readonly name: string;
  /** Written with `new`. */
  constructed: boolean;
  /** Called as a function. */
  called: boolean;
  /** Written as a type. */
  typed: boolean;
  /** Read as a value some other way: passed, returned, spread. */
  valued: boolean;
  /** Members read off the name itself (`X.y`), with whether each is called. */
  readonly statics: Map<string, MemberUse>;
  /** Members read off what it constructs or types (`new X().y`, `x: X; x.y`). */
  readonly members: Map<string, MemberUse>;
  /** Places it is used at. */
  uses: number;
  /** The most type arguments it is written with, `Event<A, B>` or `fn<A>()`. */
  typeArgs: number;
}

export interface MemberUse {
  called: boolean;
  uses: number;
}

/** Every name used from one module specifier (`@scope/name` or `@scope/name/sub`). */
export interface ModuleUses {
  readonly specifier: string;
  readonly exports: Map<string, UsedExport>;
  /** Files importing it. */
  files: number;
}

const used = (name: string): UsedExport => ({
  name,
  constructed: false,
  called: false,
  typed: false,
  valued: false,
  statics: new Map(),
  members: new Map(),
  uses: 0,
  typeArgs: 0,
});

const touch = (into: Map<string, MemberUse>, name: string, called: boolean): void => {
  const seen = into.get(name) ?? { called: false, uses: 0 };
  seen.called ||= called;
  seen.uses += 1;
  into.set(name, seen);
};

/** The package a bare specifier names, or undefined for a relative or a runtime one. */
export const packageOfImport = (specifier: string): string | undefined => {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return undefined;
  const parts = specifier.split('/');
  const width = specifier.startsWith('@') ? 2 : 1;
  if (parts.length < width || parts.slice(0, width).some((part) => part === '')) return undefined;
  return parts.slice(0, width).join('/');
};

const isCalled = (node: ts.Node): boolean => {
  const parent = node.parent;
  return parent !== undefined && ts.isCallExpression(parent) && parent.expression === node;
};

/** The type a declaration is written with, when it is a plain reference to one name. */
const typeNameOf = (type: ts.TypeNode | undefined): string | undefined => {
  if (type === undefined) return undefined;
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) return type.typeName.text;
  if (ts.isTypeReferenceNode(type) && ts.isQualifiedName(type.typeName)) return type.typeName.getText();
  return undefined;
};

/** The name a `new` builds, as written: `X` or `ns.X`. */
const constructedName = (expression: ts.Expression | undefined): string | undefined => {
  if (expression === undefined) return undefined;
  let at = expression;
  while (ts.isAwaitExpression(at) || ts.isParenthesizedExpression(at)) at = at.expression;
  if (!ts.isNewExpression(at)) return undefined;
  if (ts.isIdentifier(at.expression)) return at.expression.text;
  if (ts.isPropertyAccessExpression(at.expression) && ts.isIdentifier(at.expression.expression)) {
    return `${at.expression.expression.text}.${at.expression.name.text}`;
  }
  return undefined;
};

/**
 * Adds what one file uses of the wanted packages to `into`, keyed by specifier.
 * `wanted` holds package names; a subpath import of one counts under its own
 * specifier, since that is the module a shape would declare.
 */
export const collectPackageUses = (
  fileName: string,
  text: string,
  wanted: ReadonlySet<string>,
  into: Map<string, ModuleUses>,
): void => {
  if (![...wanted].some((name) => text.includes(name))) return;
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // Local name -> the export it stands for, or the module it is a namespace of.
  const bound = new Map<string, { module: ModuleUses; export?: UsedExport }>();
  const seen = new Set<ModuleUses>();
  const moduleFor = (specifier: string): ModuleUses => {
    const known = into.get(specifier) ?? { specifier, exports: new Map(), files: 0 };
    into.set(specifier, known);
    if (!seen.has(known)) {
      seen.add(known);
      known.files += 1;
    }
    return known;
  };
  const exportOf = (module: ModuleUses, name: string): UsedExport => {
    const known = module.exports.get(name) ?? used(name);
    module.exports.set(name, known);
    return known;
  };
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const pkg = packageOfImport(specifier);
    if (pkg === undefined || !wanted.has(pkg)) continue;
    const module = moduleFor(specifier);
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) bound.set(clause.name.text, { module, export: exportOf(module, 'default') });
    const named = clause.namedBindings;
    if (named === undefined) continue;
    if (ts.isNamespaceImport(named)) {
      bound.set(named.name.text, { module });
      continue;
    }
    for (const element of named.elements) {
      const name = (element.propertyName ?? element.name).text;
      bound.set(element.name.text, { module, export: exportOf(module, name) });
    }
  }
  if (bound.size === 0) return;

  /** The export a name or `ns.Name` written in the file stands for. */
  const exportNamed = (written: string): UsedExport | undefined => {
    const [head = '', member] = written.split('.');
    const binding = bound.get(head);
    if (binding === undefined) return undefined;
    if (binding.export !== undefined) return member === undefined ? binding.export : undefined;
    return member === undefined ? undefined : exportOf(binding.module, member);
  };

  // Names (`x`, `this.x`) declared as an instance of an export, to that export.
  const instances = new Map<string, UsedExport>();
  const instanceKey = (node: ts.Expression): string | undefined => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) return `this.${node.name.text}`;
    return undefined;
  };
  const declare = (name: ts.Node, member: boolean, type: ts.TypeNode | undefined, init: ts.Expression | undefined): void => {
    if (!ts.isIdentifier(name)) return;
    const written = typeNameOf(type) ?? constructedName(init);
    const target = written === undefined ? undefined : exportNamed(written);
    if (target === undefined) return;
    instances.set(member ? `this.${name.text}` : name.text, target);
  };
  const declarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) declare(node.name, false, node.type, node.initializer);
    else if (ts.isPropertyDeclaration(node)) declare(node.name, true, node.type, node.initializer);
    else if (ts.isParameter(node)) {
      const owner = node.parent;
      const property =
        ts.isConstructorDeclaration(owner) &&
        (ts.getModifiers(node) ?? []).some((modifier) =>
          [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(modifier.kind),
        );
      declare(node.name, false, node.type, node.initializer);
      if (property) declare(node.name, true, node.type, node.initializer);
    }
    ts.forEachChild(node, declarations);
  };
  declarations(file);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isTypeReferenceNode(node)) {
      const target = exportNamed(node.typeName.getText(file));
      if (target !== undefined) {
        target.typed = true;
        target.uses += 1;
        target.typeArgs = Math.max(target.typeArgs, node.typeArguments?.length ?? 0);
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const holder = node.expression;
      const key = instanceKey(holder);
      const instance = key === undefined ? undefined : instances.get(key);
      if (instance !== undefined) {
        touch(instance.members, node.name.text, isCalled(node));
      } else if (ts.isIdentifier(holder) && bound.has(holder.text)) {
        const binding = bound.get(holder.text) as { module: ModuleUses; export?: UsedExport };
        if (binding.export !== undefined) {
          binding.export.uses += 1;
          touch(binding.export.statics, node.name.text, isCalled(node));
        } else {
          const member = exportOf(binding.module, node.name.text);
          member.uses += 1;
          const parent = node.parent;
          if (isCalled(node)) member.called = true;
          else if (ts.isNewExpression(parent) && parent.expression === node) member.constructed = true;
          else member.valued = true;
        }
        return;
      } else if (ts.isNewExpression(holder) || (ts.isParenthesizedExpression(holder) && ts.isNewExpression(holder.expression))) {
        const target = exportNamed(constructedName(holder) ?? '');
        if (target !== undefined) touch(target.members, node.name.text, isCalled(node));
      }
    } else if (ts.isIdentifier(node) && bound.get(node.text)?.export !== undefined) {
      const parent = node.parent;
      const target = bound.get(node.text)?.export as UsedExport;
      const isDeclarationName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        ts.isImportSpecifier(parent) ||
        ts.isImportClause(parent) ||
        ts.isTypeReferenceNode(parent) ||
        ts.isQualifiedName(parent) ||
        ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node);
      if (!isDeclarationName) {
        target.uses += 1;
        if (ts.isNewExpression(parent) && parent.expression === node) {
          target.constructed = true;
          target.typeArgs = Math.max(target.typeArgs, parent.typeArguments?.length ?? 0);
        } else if (isCalled(node)) {
          target.called = true;
          target.typeArgs = Math.max(target.typeArgs, (parent as ts.CallExpression).typeArguments?.length ?? 0);
        }
        else if (!(ts.isPropertyAccessExpression(parent) && parent.expression === node)) target.valued = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
};

/* ── A starter shape, from the names alone ── */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set(['default', 'constructor', 'prototype']);

const ranked = (members: ReadonlyMap<string, MemberUse>, limit: number): Array<[string, MemberUse]> =>
  [...members]
    .filter(([name]) => IDENTIFIER.test(name) && !RESERVED.has(name))
    .sort(([a, x], [b, y]) => y.uses - x.uses || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, limit);

const memberLines = (members: ReadonlyMap<string, MemberUse>, limit: number, indent: string, prefix = ''): string[] =>
  ranked(members, limit).map(([name, use]) => `${indent}${prefix}${name}${use.called ? '(...args: any[]): any;' : ': any;'}`);

/** How an export is declared in a starter shape: a class, a function, a value, or a type. */
export const exportKindOf = (use: UsedExport): 'class' | 'function' | 'value' | 'type' => {
  if (use.constructed || (use.typed && use.members.size > 0)) return 'class';
  if (use.called && use.statics.size === 0) return 'function';
  if (use.called || use.valued || use.statics.size > 0) return 'value';
  return use.typed ? 'type' : 'value';
};

/**
 * The text of a starter shape file for some modules: one `declare module`
 * block each, every export this project uses declared with the members it
 * reads, and every type `any` - parameters, results and fields - so the file
 * types nothing until somebody refines it, and every member it does not list
 * is still there through an index signature. Names only.
 */
export const starterShape = (
  modules: readonly ModuleUses[],
  options: { members?: number; header?: readonly string[] } = {},
): string => {
  const limit = options.members ?? 12;
  const lines: string[] = [...(options.header ?? []).map((line) => `// ${line}`)];
  for (const module of modules) {
    if (lines.length > 0) lines.push('');
    lines.push(`declare module '${module.specifier}' {`);
    const exports = [...module.exports.values()].sort((a, b) => b.uses - a.uses || (a.name < b.name ? -1 : 1));
    for (const use of exports) {
      const name = use.name === 'default' ? '_default' : use.name;
      if (!IDENTIFIER.test(name)) continue;
      const kind = exportKindOf(use);
      // As many type parameters as the project ever writes, each `any` unless given.
      const generics =
        use.typeArgs === 0 ? '' : `<${Array.from({ length: use.typeArgs }, (_, at) => `T${at} = any`).join(', ')}>`;
      if (kind === 'class') {
        lines.push(`  export class ${name}${generics} {`, '    constructor(...args: any[]);');
        lines.push(...memberLines(use.statics, limit, '    ', 'static '));
        lines.push(...memberLines(use.members, limit, '    '), '    [member: string]: any;', '  }');
      } else if (kind === 'function') {
        lines.push(`  export function ${name}${generics}(...args: any[]): any;`);
      } else if (kind === 'type') {
        lines.push(`  export type ${name}${generics} = any;`);
      } else {
        const body = [
          ...(use.called ? ['    (...args: any[]): any;'] : []),
          ...memberLines(use.statics, limit, '    '),
          '    [member: string]: any;',
        ];
        lines.push(`  export const ${name}: {`, ...body, '  };');
      }
      if (use.name === 'default') lines.push(`  export default ${name};`);
    }
    lines.push('}');
  }
  return `${lines.join('\n')}\n`;
};
