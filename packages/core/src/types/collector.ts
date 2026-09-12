import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Node as TsNode, Symbol as TsSymbol, Type } from 'ts-morph';
import { Node } from 'ts-morph';
import type { GraphBuilder } from '../builder.js';
import { makeTypeId, normalizeFilePath } from '../ids.js';
import type { Unresolved } from '../model/graph.js';
import type { TypeEntry, TypeField, TypeKind, TypeRegistry } from '../model/types.js';
import { mergeFieldMeta, type FieldDeclaration, type FieldMetaReader } from './field-meta.js';
import { DEFAULT_HASH_DEPTH, structuralHash } from './structural-hash.js';
import { formatTypeRef, parseTypeRef, type TypeRef } from './type-ref.js';

export interface TypeCollectorOptions {
  builder: GraphBuilder;
  /** Owning repository, used as the scope of ids for types declared here. */
  repo: string;
  /** Absolute path of the repository root, for repo-relative declaration paths. */
  repoDir?: string;
  /** Packages whose types are read in full rather than stubbed. */
  sharedPackages?: readonly string[];
  /** How deep anonymous shapes are written out before a reference is used. */
  maxDepth?: number;
  fieldMetaReaders?: readonly FieldMetaReader[];
  report?: (row: Unresolved) => void;
}

/** Shapes the language provides that are written as references, not expanded. */
const GENERIC_BUILTINS = new Set(['Map', 'Set', 'ReadonlyMap', 'ReadonlySet', 'Record', 'Promise']);

/**
 * A declaration file belonging to the language itself rather than to a
 * dependency. Its types are shapes every program has, so recording where they
 * came from says nothing.
 */
export const isLibFile = (filePath: string): boolean =>
  /\/lib\.[^/]*\.d\.ts$/.test(filePath);

const PRIMITIVE_NAMED = new Set(['Date', 'Buffer']);

const ASYNC_WRAPPERS = new Set(['Promise', 'Observable']);

/**
 * Drops `undefined` from a union.
 *
 * A field already carries an optional flag, so repeating it inside the type adds
 * nothing and makes two sides of a boundary look different when they are not.
 */
const withoutUndefined = (ref: TypeRef): TypeRef => {
  let ast;
  try {
    ast = parseTypeRef(ref);
  } catch {
    return ref;
  }
  if (ast.kind !== 'union') return ref;
  const kept = ast.members.filter(
    (member) => !(member.kind === 'primitive' && member.name === 'undefined'),
  );
  if (kept.length === 0 || kept.length === ast.members.length) return ref;
  return formatTypeRef(kept.length === 1 ? (kept[0] as typeof ast.members[number]) : { kind: 'union', members: kept });
};

const isDataProperty = (declaration: TsNode | undefined): declaration is FieldDeclaration =>
  declaration !== undefined &&
  (Node.isPropertyDeclaration(declaration) || Node.isPropertySignature(declaration));

const packageOf = (filePath: string): string | undefined => {
  const marker = '/node_modules/';
  const at = filePath.lastIndexOf(marker);
  if (at < 0) return undefined;
  const parts = filePath.slice(at + marker.length).split('/');
  const [first, second] = parts;
  if (first === undefined) return undefined;
  return first.startsWith('@') && second !== undefined ? `${first}/${second}` : first;
};

interface Pending {
  id: string;
  entry: TypeEntry;
}

/**
 * Builds the type registry.
 *
 * Nothing here knows about any particular library. It reads what the type
 * system says, writes each named declaration into the registry once, and hands
 * back a reference. Anything without a name is written out in place, up to a
 * depth, so that a recursive structure cannot expand forever.
 *
 * Entries are registered at the end rather than as they are found, because a
 * structural hash can only be taken once everything it refers to is known.
 */
export class TypeCollector {
  readonly #builder: GraphBuilder;
  readonly #repo: string;
  readonly #repoDir: string | undefined;
  readonly #shared: ReadonlySet<string>;
  readonly #maxDepth: number;
  readonly #readers: readonly FieldMetaReader[];
  readonly #report: (row: Unresolved) => void;

  readonly #pending = new Map<string, Pending>();
  readonly #started = new Set<string>();
  readonly #packages = new Map<string, { dir: string; name: string } | null>();
  /** Which file each id was claimed by, so a repeated name gets its own id. */
  readonly #idOwner = new Map<string, string>();
  #finalized = false;

  constructor(options: TypeCollectorOptions) {
    this.#builder = options.builder;
    this.#repo = options.repo;
    this.#repoDir = options.repoDir;
    this.#shared = new Set(options.sharedPackages ?? []);
    this.#maxDepth = options.maxDepth ?? DEFAULT_HASH_DEPTH;
    this.#readers = options.fieldMetaReaders ?? [];
    this.#report = options.report ?? (() => undefined);
  }

  get size(): number {
    return this.#pending.size;
  }

  /** `Promise<T>` and `Observable<T>` describe delivery, not shape. */
  unwrapAsync(type: Type): Type {
    let current = type;
    for (let depth = 0; depth < 8; depth += 1) {
      const name = current.getSymbol()?.getName() ?? current.getAliasSymbol()?.getName();
      if (name === undefined || !ASYNC_WRAPPERS.has(name)) return current;
      const [argument] = current.getTypeArguments();
      if (argument === undefined) return current;
      current = argument;
    }
    return current;
  }

  collectSignature(fn: {
    getParameters(): Array<{ getType(): Type; getName(): string }>;
    getReturnType(): Type;
  } & TsNode): { params: TypeRef[]; returns: TypeRef } {
    const params = fn.getParameters().map((parameter) => this.collectType(parameter.getType(), fn));
    const returns = this.collectType(this.unwrapAsync(fn.getReturnType()), fn);
    return { params, returns };
  }

  collectType(type: Type, site: TsNode, depth = 0): TypeRef {
    try {
      return this.#collect(type, site, depth);
    } catch {
      // A type the checker cannot describe is recorded as unknown rather than
      // allowed to abort a whole extraction.
      return 'unknown';
    }
  }

  #collect(type: Type, site: TsNode, depth: number): TypeRef {
    if ((type.compilerType as { intrinsicName?: string }).intrinsicName === 'error') {
      this.#report({
        file: this.#fileOf(site),
        line: site.getStartLineNumber(),
        reason: 'type-unresolved',
        hint: 'The checker could not resolve this type. Install the dependencies or fix the tsconfig paths.',
        symbol: type.getText(),
      });
      return 'unknown';
    }

    if (type.isString()) return 'string';
    if (type.isNumber()) return 'number';
    if (type.isBoolean()) return 'boolean';
    if (type.isBigInt()) return 'bigint';
    if (type.isNull()) return 'null';
    if (type.isUndefined()) return 'undefined';
    if (type.isVoid()) return 'void';
    if (type.isNever()) return 'never';
    if (type.isUnknown()) return 'unknown';
    if (type.isAny()) return 'any';

    if (type.isTypeParameter()) {
      this.#report({
        file: this.#fileOf(site),
        line: site.getStartLineNumber(),
        reason: 'type-generic-uninstantiated',
        hint: 'The type argument is not known here, so the reference names the parameter.',
        symbol: type.getText(),
        level: 'info',
      });
      return type.getText();
    }

    if (type.isStringLiteral()) return `'${String(type.getLiteralValue())}'`;
    if (type.isNumberLiteral()) return String(type.getLiteralValue());
    if (type.isBooleanLiteral()) return type.getText() === 'true' ? 'true' : 'false';

    if (type.isArray()) {
      const element = type.getArrayElementType();
      const inner = element === undefined ? 'unknown' : this.collectType(element, site, depth);
      return inner.includes('|') || inner.includes('&') ? `(${inner})[]` : `${inner}[]`;
    }

    if (type.isTuple()) {
      return `[${type.getTupleElements().map((element) => this.collectType(element, site, depth)).join(',')}]`;
    }

    const aliasSymbol = type.getAliasSymbol();
    if (aliasSymbol !== undefined && (type.isUnion() || type.isIntersection())) {
      const named = this.#registerNamed(type, aliasSymbol, site, depth);
      if (named !== undefined) return named;
    }

    if (type.isUnion()) {
      // Sorted, so that the same union always reads the same way whatever order
      // the checker happened to produce its members in.
      return type
        .getUnionTypes()
        .map((member) => this.collectType(member, site, depth))
        .sort()
        .join('|');
    }

    if (type.isIntersection()) {
      return type
        .getIntersectionTypes()
        .map((member) => this.collectType(member, site, depth))
        .join('&');
    }

    const symbol = type.getSymbol() ?? aliasSymbol;
    if (symbol === undefined) return this.#inlineObject(type, site, depth);

    const name = symbol.getName();
    if (PRIMITIVE_NAMED.has(name)) return name;
    if (GENERIC_BUILTINS.has(name)) {
      const args = type.getTypeArguments().map((argument) => this.collectType(argument, site, depth));
      return args.length === 0 ? name : `${name}<${args.join(',')}>`;
    }

    const named = this.#registerNamed(type, symbol, site, depth);
    if (named !== undefined) return named;

    return this.#inlineObject(type, site, depth);
  }

  #fileOf(node: TsNode): string {
    return normalizeFilePath(node.getSourceFile().getFilePath(), this.#repoDir);
  }

  /**
   * Which package a file belongs to, by the nearest manifest above it.
   *
   * Going by the path alone would be wrong wherever a package is reached
   * through a link rather than a copy, which is how a workspace resolves its own
   * packages: the file then has no `node_modules` in its path at all.
   */
  #packageOf(filePath: string): { dir: string; name: string } | undefined {
    let dir = dirname(filePath);
    for (let up = 0; up < 12; up += 1) {
      const cached = this.#packages.get(dir);
      if (cached !== undefined) return cached ?? undefined;
      const manifest = join(dir, 'package.json');
      if (existsSync(manifest)) {
        try {
          const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name;
          const found = name === undefined ? undefined : { dir, name };
          this.#packages.set(dir, found ?? null);
          return found;
        } catch {
          this.#packages.set(dir, null);
          return undefined;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
    return undefined;
  }

  /** Scope an id belongs to: this repository, a shared package, or a dependency. */
  #scopeOf(declaration: TsNode): { scope: string; external: boolean; declaredIn: string } {
    const filePath = declaration.getSourceFile().getFilePath();
    const local = {
      scope: this.#repo,
      external: false,
      declaredIn: `${this.#repo}#${normalizeFilePath(filePath, this.#repoDir)}`,
    };

    const owner = this.#packageOf(filePath);
    if (owner === undefined) {
      return packageOf(filePath) === undefined
        ? local
        : { scope: packageOf(filePath) as string, external: true, declaredIn: packageOf(filePath) as string };
    }
    if (this.#repoDir !== undefined && resolve(owner.dir) === resolve(this.#repoDir)) return local;
    if (this.#shared.has(owner.name)) {
      return { scope: owner.name, external: false, declaredIn: owner.name };
    }
    return { scope: owner.name, external: true, declaredIn: owner.name };
  }

  #declarationOf(symbol: TsSymbol): TsNode | undefined {
    for (const declaration of symbol.getDeclarations()) {
      if (
        Node.isClassDeclaration(declaration) ||
        Node.isInterfaceDeclaration(declaration) ||
        Node.isTypeAliasDeclaration(declaration) ||
        Node.isEnumDeclaration(declaration)
      ) {
        return declaration;
      }
    }
    return undefined;
  }

  #kindOf(declaration: TsNode, type: Type): TypeKind {
    if (Node.isEnumDeclaration(declaration)) return 'enum';
    if (type.isUnion()) return 'union';
    if (Node.isTypeAliasDeclaration(declaration) && !type.isObject()) return 'union';
    return 'object';
  }

  #registerNamed(type: Type, symbol: TsSymbol, site: TsNode, depth: number): TypeRef | undefined {
    const declaration = this.#declarationOf(symbol);
    if (declaration === undefined) return undefined;

    const name = symbol.getName();
    if (name === '' || name === '__type') return undefined;

    // A shape the language itself provides is written by name, not registered.
    if (isLibFile(declaration.getSourceFile().getFilePath())) {
      const libArgs = type
        .getTypeArguments()
        .map((argument) => this.collectType(argument, site, depth));
      return libArgs.length === 0 ? name : `${name}<${libArgs.join(',')}>`;
    }

    const { scope, external, declaredIn } = this.#scopeOf(declaration);
    // Two declarations of one name in a single repository are two types. Giving
    // the second the same id would silently describe one of them as the other,
    // so the file it was declared in disambiguates it.
    const declarationFile = normalizeFilePath(
      declaration.getSourceFile().getFilePath(),
      this.#repoDir,
    );
    let baseId = makeTypeId(scope, name);
    const owner = this.#idOwner.get(baseId);
    if (owner === undefined) this.#idOwner.set(baseId, declarationFile);
    else if (owner !== declarationFile) baseId = `${baseId}@${declarationFile}`;

    const args = type.getTypeArguments().map((argument) => this.collectType(argument, site, depth));
    const id = args.length === 0 ? baseId : `${baseId}<${args.join(',')}>`;

    if (this.#started.has(id)) return id;
    this.#started.add(id);

    if (external) {
      this.#add(id, {
        name,
        kind: 'external',
        declaredIn,
        structuralHash: '',
        meta: { declKind: 'external', package: scope },
      });
      return id;
    }

    // The template of a generic is worth registering too: a reader asking what
    // the type is called wants the declaration, not only one instantiation.
    if (args.length > 0) {
      this.#registerTemplate(symbol, declaration, scope, declaredIn, site, depth);
    }

    const entry = this.#buildEntry(type, declaration, name, declaredIn, site, depth, args);
    this.#add(id, entry);
    return id;
  }

  #registerTemplate(
    symbol: TsSymbol,
    declaration: TsNode,
    scope: string,
    declaredIn: string,
    site: TsNode,
    depth: number,
  ): void {
    const name = symbol.getName();
    const id = makeTypeId(scope, name);
    if (this.#started.has(id)) return;
    this.#started.add(id);
    const declared = symbol.getDeclaredType();
    const entry = this.#buildEntry(declared, declaration, name, declaredIn, site, depth, []);
    const typeParams = Node.isClassDeclaration(declaration) ||
      Node.isInterfaceDeclaration(declaration) ||
      Node.isTypeAliasDeclaration(declaration)
      ? declaration.getTypeParameters().map((parameter) => parameter.getName())
      : [];
    this.#add(id, {
      ...entry,
      ...(typeParams.length > 0 ? { kind: 'generic' as const, typeParams } : {}),
    });
  }

  #buildEntry(
    type: Type,
    declaration: TsNode,
    name: string,
    declaredIn: string,
    site: TsNode,
    depth: number,
    args: readonly TypeRef[],
  ): TypeEntry {
    const kind = this.#kindOf(declaration, type);
    const declKind = Node.isClassDeclaration(declaration)
      ? 'class'
      : Node.isInterfaceDeclaration(declaration)
        ? 'interface'
        : Node.isEnumDeclaration(declaration)
          ? 'enum'
          : 'alias';

    const meta: Record<string, unknown> = {
      declKind,
      exported: Node.isExportable(declaration) ? declaration.isExported() : false,
    };
    if (args.length > 0) meta['typeArgs'] = [...args];

    if (kind === 'enum') {
      const members = Node.isEnumDeclaration(declaration)
        ? declaration.getMembers().map((member) => String(member.getValue() ?? member.getName()))
        : [];
      return { name, kind, declaredIn, structuralHash: '', members, meta };
    }

    if (kind === 'union') {
      const members = type.isUnion()
        ? type.getUnionTypes().map((member) => this.collectType(member, site, depth + 1))
        : [this.collectType(type, site, depth + 1)];
      return { name, kind, declaredIn, structuralHash: '', members, meta };
    }

    const extendsRefs = this.#extendsOf(declaration, site, depth);
    if (extendsRefs.length > 0) meta['extends'] = extendsRefs;

    return {
      name,
      kind: 'object',
      declaredIn,
      structuralHash: '',
      fields: this.#fieldsOf(type, site, depth),
      meta,
    };
  }

  #extendsOf(declaration: TsNode, site: TsNode, depth: number): TypeRef[] {
    if (Node.isInterfaceDeclaration(declaration)) {
      return declaration
        .getExtends()
        .map((clause) => this.collectType(clause.getType(), site, depth + 1));
    }
    if (Node.isClassDeclaration(declaration)) {
      const base = declaration.getExtends();
      return base === undefined ? [] : [this.collectType(base.getType(), site, depth + 1)];
    }
    return [];
  }

  /**
   * Fields as they appear on the wire.
   *
   * Apparent properties are used so that what a type inherits or intersects in
   * is flattened into one list. That is the shape the data actually has, and it
   * is the shape a comparison across a service boundary has to work with.
   */
  #fieldsOf(type: Type, site: TsNode, depth: number): TypeField[] {
    const fields: TypeField[] = [];
    for (const property of type.getApparentProperties()) {
      const declaration = property.getDeclarations()[0];
      if (!isDataProperty(declaration)) continue;
      const propertyType = property.getTypeAtLocation(declaration);
      const ref = this.collectType(propertyType, declaration, depth + 1);

      const questionToken = declaration.hasQuestionToken();
      const undefinedUnion = propertyType.isUnion()
        ? propertyType.getUnionTypes().some((member) => member.isUndefined())
        : false;
      const fromReaders = mergeFieldMeta(this.#readers.map((reader) => reader.read(declaration)));

      const optional = questionToken || undefinedUnion || fromReaders.optional === true;
      const optionalBy = questionToken
        ? 'question'
        : fromReaders.optional === true
          ? 'IsOptional'
          : undefinedUnion
            ? 'undefined-union'
            : undefined;

      const meta = {
        ...fromReaders.meta,
        ...(optionalBy === undefined ? {} : { optionalBy }),
      };

      fields.push({
        name: property.getName(),
        type: optional ? withoutUndefined(ref) : ref,
        optional,
        ...(Object.keys(meta).length > 0 ? { meta } : {}),
      });
    }
    return fields;
  }

  #inlineObject(type: Type, site: TsNode, depth: number): TypeRef {
    if (depth >= this.#maxDepth) {
      this.#report({
        file: this.#fileOf(site),
        line: site.getStartLineNumber(),
        reason: 'type-depth-exceeded',
        hint: `Nesting is written out to ${this.#maxDepth} levels. Raise types.maxDepth to see further.`,
        symbol: type.getText(),
        level: 'info',
      });
      return 'object';
    }
    const fields = this.#fieldsOf(type, site, depth);
    if (fields.length === 0) return 'object';
    return `{${fields
      .map((field) => `${field.name}${field.optional ? '?' : ''}:${field.type}`)
      .join(';')}}`;
  }

  #add(id: string, entry: TypeEntry): void {
    this.#pending.set(id, { id, entry });
  }

  /**
   * Writes everything collected into the graph.
   *
   * Hashes are taken here, once every entry is known, because a hash reaching
   * through a reference needs whatever it points at to exist.
   */
  finalize(): void {
    if (this.#finalized) return;
    this.#finalized = true;

    const registry: TypeRegistry = {};
    for (const { id, entry } of this.#pending.values()) registry[id] = entry;

    for (const { id, entry } of this.#pending.values()) {
      const hashed: TypeEntry = {
        ...entry,
        structuralHash: structuralHash(entry, registry, { maxDepth: this.#maxDepth }),
      };
      try {
        this.#builder.addType(id, hashed);
      } catch {
        // Two copies of one package at different versions produce one id with
        // two shapes. The first wins, and the clash is reported rather than
        // allowed to abort the build.
        this.#report({
          file: entry.declaredIn,
          line: 0,
          reason: 'type-unresolved',
          hint: 'The same type resolved to two different shapes, which usually means two versions of a shared package.',
          symbol: id,
        });
      }
    }
  }
}
