import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallExpression, Project, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import {
  decoratorArgs,
  evaluateExpression,
  normalizeFilePath,
  resolveStaticString,
  UNREAD_SPAN,
  wasRead,
  workspacePackages,
  workspaceRootOf,
  type StaticValue,
  type Unresolved,
} from '@flowatlas/core';
import { resolveCallableRef, resolveClassExpression, type ClassRef } from './util/resolve-class.js';

/** The four wrapping layers, in the order the framework runs them. */
export const WRAPPING_LAYERS = ['middleware', 'guard', 'interceptor', 'pipe'] as const;

export type WrappingLayer = (typeof WRAPPING_LAYERS)[number];

/** A wrapper named somewhere, together with any arguments that configure it. */
export interface WrapperRef {
  ref: ClassRef;
  /** Arguments of a factory call such as a strategy name. */
  factoryArgs?: unknown[];
  line: number;
  text: string;
}

export interface BootstrapGlobal {
  layer: WrappingLayer;
  wrapper: WrapperRef;
}

/**
 * What the application was told about versions, when it was told anything.
 *
 * Only `uri` puts the version into the address, and that is the whole reason
 * this is read: under it a route the framework prints as `/api/v2/topics` was
 * being recorded as `/api/topics`, which is an address nothing reaches, and two
 * controllers for one resource at two versions collapsed onto one entry and were
 * reported as a route claimed by two handlers (R89).
 */
export interface Versioning {
  type: 'uri' | 'header' | 'media-type' | 'custom' | 'unknown';
  /** What precedes the version in the address. The framework's own default is `v`. */
  prefix: string;
  /** The version a route naming none is served at, when one was set. */
  defaultVersion?: string;
}

/** A site that decides every route's address and could not be read. */
export interface UnreadAddressing {
  /** The call as written, e.g. `setGlobalPrefix`. */
  call: string;
  /** Repo-relative POSIX path. */
  file: string;
  line: number;
  text: string;
}

/** The two calls that can put a part in front of every address. */
type AddressingCall = 'setGlobalPrefix' | 'enableVersioning';

/**
 * A part in front of every address that is read from settings, and what the
 * service's committed environment files say of those settings (R144).
 *
 * Only facts. Whether a join may take the part as empty is decided in one place,
 * the linker's `assumedMountOf`, because that is where a join is decided; this
 * records what that decision needs and nothing it does not.
 */
export interface Mount {
  /** The call whose argument begins with the part. */
  call: AddressingCall;
  /** Every setting the part is read from, sorted. */
  settings: string[];
  /** Committed environment files giving any of them a value, repo-relative and sorted. */
  setIn: string[];
  /** How many committed environment files the service has. */
  envFiles: number;
  /** Where the part is written, as `file:line`. */
  at: string;
}

/** The opening hole of an address part, kept until the repository can be asked about it. */
interface LeadingHole {
  node: Node;
  at: string;
}

export interface BootstrapInfo {
  /** Repo-relative path of the file that was read, when one was found. */
  file?: string;
  found: boolean;
  globalPrefix?: string;
  /** Literal paths excluded from the global prefix. */
  globalPrefixExcludes: string[];
  /** True when the exclude list could not be read statically. */
  globalPrefixExcludesDynamic: boolean;
  /**
   * Where the prefix or the versioning was read, when not the entry file itself.
   *
   * Kept so that a reader who checks a path against the framework's own start-up
   * log can find the line that decided it, which in a repository of this shape
   * is nowhere near the file named `main.ts`.
   */
  addressedIn?: string;
  /** Sites deciding an address that could not be read. */
  unreadAddressing: UnreadAddressing[];
  versioning?: Versioning;
  globals: BootstrapGlobal[];
  /** Call sites that name a wrapper the analysis could not follow. */
  dynamicGlobals: Array<{ layer: WrappingLayer; line: number; text: string }>;
  /** Address parts that open with a hole, by the call that wrote them. */
  leadingHoles: Partial<Record<AddressingCall, LeadingHole>>;
  /** The leading part of every address, when it is read from settings (R144). */
  mount?: Mount;
}

const GLOBAL_METHODS: Record<string, WrappingLayer> = {
  useGlobalGuards: 'guard',
  useGlobalInterceptors: 'interceptor',
  useGlobalPipes: 'pipe',
};

export const BOOTSTRAP_CANDIDATES = ['src/main.ts', 'main.ts', 'src/index.ts'] as const;

export const findBootstrapFile = (rootDir: string, bootstrap?: string): string | undefined => {
  const candidates = bootstrap === undefined ? BOOTSTRAP_CANDIDATES : [bootstrap];
  for (const candidate of candidates) {
    const path = candidate.startsWith('/') ? candidate : join(rootDir, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
};

/**
 * Reads one wrapper argument.
 *
 * `new AuthGuard('jwt')` names a class and configures it, and the configuration
 * matters: two strategies of the same guard class behave differently, so the
 * arguments travel with the reference.
 */
const readWrapper = (argument: Node): WrapperRef | undefined => {
  const line = argument.getStartLineNumber();
  const text = argument.getText();

  if (Node.isNewExpression(argument)) {
    const ref = resolveClassExpression(argument.getExpression());
    if (ref.kind === 'unknown') return undefined;
    const args = argument.getArguments().map((item) => evaluateExpression(item));
    const factoryArgs = args.every((value: StaticValue) => value.resolved)
      ? args.map((value) => (value.resolved ? value.value : undefined))
      : undefined;
    return {
      ref,
      ...(factoryArgs !== undefined && factoryArgs.length > 0 ? { factoryArgs } : {}),
      line,
      text,
    };
  }

  if (Node.isCallExpression(argument)) {
    const callee = argument.getExpression();
    // `app.get(SomeGuard)` asks the container for an instance of a named class.
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'get') {
      const [first] = argument.getArguments();
      if (first !== undefined) {
        const ref = resolveClassExpression(first);
        if (ref.kind !== 'unknown') return { ref, line, text };
      }
      return undefined;
    }
    const ref = resolveCallableRef(callee);
    if (ref.kind === 'unknown') return undefined;
    const args = argument.getArguments().map((item) => evaluateExpression(item));
    const factoryArgs = args.every((value: StaticValue) => value.resolved)
      ? args.map((value) => (value.resolved ? value.value : undefined))
      : undefined;
    return {
      ref,
      ...(factoryArgs !== undefined && factoryArgs.length > 0 ? { factoryArgs } : {}),
      line,
      text,
    };
  }

  const ref = resolveClassExpression(argument);
  return ref.kind === 'unknown' ? undefined : { ref, line, text };
};

/** Where one call sits, in the form a row and a record both want. */
const siteOf = (call: CallExpression, file: string): Omit<UnreadAddressing, 'call'> => ({
  file,
  line: call.getStartLineNumber(),
  // One line, however it was laid out in the source: an options object spread
  // over six lines is six lines of noise in a report that has one row per line.
  text: call.getText().replace(/\s+/g, ' ').slice(0, 90),
});

/**
 * A part of every address, read as far as it can be read.
 *
 * What comes back may hold the marker for text nobody has seen, and keeping that
 * rather than discarding the whole string is the point: an address assembled from
 * a setting is still an address whose *shape* is known, and two routes that
 * differ only behind the unread part still differ. Whether it was read in full is
 * answered separately, because that is what decides whether a row is written.
 */
const readAddressPart = (node: Node): { value: string; complete: boolean } | undefined => {
  const found = resolveStaticString(node);
  return found === null ? undefined : { value: found.value, complete: wasRead(found.value) };
};

/**
 * The expression an address part opens with, when the part opens with a hole.
 *
 * Only a template whose very first character is a hole nobody read. A hole later
 * in the part is not in front of anything, and a part read in full has nothing
 * to ask about.
 */
const noteLeadingHole = (
  node: Node,
  value: string | undefined,
  call: AddressingCall,
  info: BootstrapInfo,
  file: string,
): void => {
  if (value === undefined || !value.startsWith(UNREAD_SPAN)) return;
  if (!Node.isTemplateExpression(node) || node.getHead().getLiteralText() !== '') return;
  const [first] = node.getTemplateSpans();
  if (first === undefined) return;
  info.leadingHoles[call] = { node: first.getExpression(), at: `${file}:${node.getStartLineNumber()}` };
};

const readGlobalPrefix = (call: CallExpression, info: BootstrapInfo, file: string): void => {
  const [pathArg, optionsArg] = call.getArguments();
  if (pathArg === undefined) return;
  const prefix = readAddressPart(pathArg);
  if (prefix !== undefined) {
    info.globalPrefix = prefix.value;
    info.addressedIn = file;
  }
  noteLeadingHole(pathArg, prefix?.value, 'setGlobalPrefix', info, file);
  // The prefix decides every route's address, so a prefix nobody could read in
  // full is every address in the service being wrong by the same amount. Until
  // R89 that was silent: the field stayed unset and the paths came out short,
  // which reads exactly like a service that has no prefix at all.
  if (prefix === undefined || !prefix.complete) {
    info.unreadAddressing.push({ call: 'setGlobalPrefix', ...siteOf(call, file) });
  }
  if (optionsArg === undefined) return;
  const options = evaluateExpression(optionsArg);
  if (!options.resolved || typeof options.value !== 'object' || options.value === null) {
    info.globalPrefixExcludesDynamic = true;
    return;
  }
  const exclude = (options.value as { exclude?: unknown }).exclude;
  if (exclude === undefined) return;
  if (Array.isArray(exclude) && exclude.every((item) => typeof item === 'string')) {
    info.globalPrefixExcludes = exclude as string[];
    return;
  }
  info.globalPrefixExcludesDynamic = true;
};

/**
 * Which kind of versioning an option names, by the name that was written.
 *
 * The member's value is not asked for. `VersioningType.URI` is a numeric member
 * of an enum that lives in an installed package, so on a fresh clone — which is
 * half of every measurement this tool publishes — there is nothing to evaluate,
 * and evaluating it would answer `0`. The name is in the source either way, and
 * it is the same name in every repository because it is the framework's.
 */
const VERSIONING_TYPES: ReadonlyMap<string, Versioning['type']> = new Map([
  ['URI', 'uri'],
  ['HEADER', 'header'],
  ['MEDIA_TYPE', 'media-type'],
  ['CUSTOM', 'custom'],
]);

/** The framework's own default, used whenever URI versioning names no prefix. */
const DEFAULT_VERSION_PREFIX = 'v';

/** The property initialiser of an object literal written out in place. */
const propertyIn = (argument: Node, name: string): Node | undefined => {
  if (!Node.isObjectLiteralExpression(argument)) return undefined;
  const property = argument.getProperty(name);
  return property !== undefined && Node.isPropertyAssignment(property)
    ? property.getInitializer()
    : undefined;
};

/**
 * Reads `enableVersioning({ type, prefix, defaultVersion })`.
 *
 * The options are read one property at a time rather than by evaluating the
 * object, because one property nobody can read makes the whole object
 * unresolved and here that would throw away the two that were perfectly
 * legible. novu's is exactly that shape: the type is an enum member of an
 * installed package and the prefix is a template rooted at a setting, while
 * `defaultVersion: '1'` — the value that decides where three hundred and fifty
 * six routes are served — is a string literal sitting beside them.
 */
const readVersioning = (call: CallExpression, info: BootstrapInfo, file: string): void => {
  const [optionsArg] = call.getArguments();
  if (optionsArg === undefined) return;

  const typeNode = propertyIn(optionsArg, 'type');
  // The last name in the expression, so `VersioningType.URI` and a bare `URI`
  // read the same, and upper-cased so that a project spelling it as a plain
  // string is not filed as a kind nobody knows.
  const named = typeNode === undefined ? undefined : /(\w+)\W*$/.exec(typeNode.getText())?.[1];
  const type =
    (named === undefined ? undefined : VERSIONING_TYPES.get(named.toUpperCase())) ?? 'unknown';

  const prefixNode = propertyIn(optionsArg, 'prefix');
  // A prefix that is only half readable stays half readable. The unread half
  // travels as the marker nothing matches, so a caller is never joined to an
  // address part of which nobody has seen, while the route ids still differ by
  // version — which is the whole of what the false duplicate claims were about.
  const prefix = prefixNode === undefined ? undefined : readAddressPart(prefixNode);
  if (prefixNode !== undefined) noteLeadingHole(prefixNode, prefix?.value, 'enableVersioning', info, file);

  const defaultNode = propertyIn(optionsArg, 'defaultVersion');
  const defaultVersion =
    defaultNode === undefined ? undefined : readAddressPart(defaultNode)?.value;

  const unread =
    (prefixNode !== undefined && prefix?.complete !== true) ||
    (defaultNode !== undefined && defaultVersion === undefined) ||
    type === 'unknown';
  if (unread) info.unreadAddressing.push({ call: 'enableVersioning', ...siteOf(call, file) });

  info.versioning = {
    type,
    prefix: prefix?.value ?? DEFAULT_VERSION_PREFIX,
    ...(defaultVersion === undefined ? {} : { defaultVersion }),
  };
  info.addressedIn = file;
};

/**
 * Every call this reader knows, by the method name that was written.
 *
 * A table rather than a run of branches: the dispatch is the whole of the walk
 * below, and a call this reader does not know costs one lookup that misses.
 */
type CallReader = (call: CallExpression, info: BootstrapInfo, file: string) => void;

/** Reads one wrapping layer's registration, whichever of the three it is. */
const readGlobals =
  (layer: WrappingLayer): CallReader =>
  (call, info) => {
    for (const argument of call.getArguments()) {
      const wrapper = readWrapper(argument);
      if (wrapper === undefined) {
        info.dynamicGlobals.push({
          layer,
          line: argument.getStartLineNumber(),
          text: argument.getText(),
        });
        continue;
      }
      info.globals.push({ layer, wrapper });
    }
  };

/**
 * The two calls that decide where every route of the service answers.
 *
 * Separated from the wrapping registrations because these two are looked for in
 * places the others are not: a global guard belongs to the application that was
 * created, and an address belongs to the whole service however far from the
 * entry file the line that sets it happens to sit.
 */
const ADDRESS_READERS: ReadonlyMap<string, CallReader> = new Map([
  ['setGlobalPrefix', readGlobalPrefix],
  ['enableVersioning', readVersioning],
]);

/**
 * `Map`s, because they are asked about every method called in the file. As
 * object literals they answered `x.valueOf()` with the language's own
 * `valueOf`, called it unbound, and the throw made the whole service
 * unreadable (R130).
 */
const ENTRY_READERS: ReadonlyMap<string, CallReader> = new Map([
  ...ADDRESS_READERS,
  ...Object.entries(GLOBAL_METHODS).map(([name, layer]) => [name, readGlobals(layer)] as const),
]);

/** Walks one file, handing each call it knows to the reader for it. */
const readCallsIn = (
  sourceFile: SourceFile,
  readers: ReadonlyMap<string, CallReader>,
  info: BootstrapInfo,
  file: string,
): void => {
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const reader = readers.get(callee.getName());
    if (reader !== undefined) reader(node, info, file);
  });
};

/**
 * Files of the repository itself, skipping packages, declarations and tests.
 *
 * Exported because a second reading walks the same set for a different question
 * — which applications this repository creates — and two answers to "is this file
 * part of the repository" would be two answers to which files were read at all.
 */
export const repoSourcesOf = function* (
  project: Project,
  rootDir: string,
  except: string | undefined,
): Generator<SourceFile> {
  for (const sourceFile of project.getSourceFiles()) {
    const path = sourceFile.getFilePath();
    if (!path.startsWith(rootDir) || path === except) continue;
    if (path.includes('/node_modules/') || path.endsWith('.d.ts')) continue;
    // A test may set a prefix of its own for one case, and that is not the
    // prefix the service answers on.
    if (/\.(?:spec|test|e2e-spec)\.tsx?$/.test(path)) continue;
    yield sourceFile;
  }
};

/**
 * The same two calls, looked for anywhere in the repository.
 *
 * Asked when the entry file settled fewer than both of them, and it is a real
 * change of mind about this file's oldest rule. Reading only the named file was right
 * about *what creates the application* — a search for that picks the wrong one
 * of several silently — and simply wrong about *where the address is decided*,
 * because the two are routinely different files. immich sets its prefix in
 * `app.common.ts`, called from a worker its supervisor forks by path, and novu
 * enables versioning in `bootstrap.ts`, reached through a dynamic import inside
 * a callback. Neither is reachable by following calls out of `main.ts`, so
 * following calls would have fixed neither, and all 292 of immich's routes were
 * recorded without the `/api` every one of them answers on.
 *
 * What keeps the old objection answered is that nothing is guessed. Every
 * readable prefix in the repository is collected, and it is adopted only when
 * they all agree; where two files disagree, a row says so and no prefix is set,
 * which is the same answer as before plus the reason. Cheap because a file is
 * only walked when its text contains the name.
 */
const readAddressingElsewhere = (
  project: Project,
  rootDir: string,
  entry: string | undefined,
): BootstrapInfo[] => {
  const names = [...ADDRESS_READERS.keys()];
  const found: BootstrapInfo[] = [];
  // The entry file is left out because it has already been read. Reading it
  // twice would say everything it says twice, including its rows.
  for (const sourceFile of repoSourcesOf(project, rootDir, entry)) {
    const text = sourceFile.getFullText();
    if (!names.some((name) => text.includes(name))) continue;
    const here = emptyInfo();
    readCallsIn(sourceFile, ADDRESS_READERS, here, normalizeFilePath(sourceFile.getFilePath(), rootDir));
    if (here.globalPrefix !== undefined || here.versioning !== undefined || here.unreadAddressing.length > 0) {
      found.push(here);
    }
  }
  return found;
};

/** Distinct values of one field across what the search found, in order. */
const agreedOn = <T>(found: readonly BootstrapInfo[], of: (info: BootstrapInfo) => T | undefined): T[] => {
  const seen = new Map<string, T>();
  for (const info of found) {
    const value = of(info);
    if (value !== undefined) seen.set(JSON.stringify(value), value);
  }
  return [...seen.values()];
};

/**
 * Folds what the search found into the entry file's reading.
 *
 * Only fills what the entry file left empty, so a repository that says where its
 * routes answer in the file this reader has always read is unaffected by any of
 * this, and a disagreement between two other files can never overrule it.
 */
const foldAddressing = (info: BootstrapInfo, found: readonly BootstrapInfo[]): void => {
  for (const each of found) info.unreadAddressing.push(...each.unreadAddressing);

  /** The file a row about a disagreement points at: the first that set one. */
  const wherever = (of: (each: BootstrapInfo) => unknown): string =>
    info.file ?? found.find((each) => of(each) !== undefined)?.addressedIn ?? '';

  if (info.globalPrefix === undefined) {
    const prefixes = agreedOn(found, (each) => each.globalPrefix);
    const from = found.find((each) => each.globalPrefix === prefixes[0]);
    if (prefixes.length === 1 && from !== undefined) {
      info.globalPrefix = prefixes[0];
      info.globalPrefixExcludes = from.globalPrefixExcludes;
      info.globalPrefixExcludesDynamic = from.globalPrefixExcludesDynamic;
      info.addressedIn = from.addressedIn;
      if (from.leadingHoles.setGlobalPrefix !== undefined) {
        info.leadingHoles.setGlobalPrefix = from.leadingHoles.setGlobalPrefix;
      }
    } else if (prefixes.length > 1) {
      info.unreadAddressing.push({
        call: 'setGlobalPrefix',
        file: wherever((each) => each.globalPrefix),
        line: 1,
        // Sorted, because the order the files were opened in is the filesystem's
        // and a row that reads differently on two machines is a row nobody trusts.
        text: `${prefixes.length} files set a different global prefix: ${[...prefixes].sort().join(', ')}`,
      });
    }
  }

  if (info.versioning === undefined) {
    const versionings = agreedOn(found, (each) => each.versioning);
    if (versionings.length === 1) {
      info.versioning = versionings[0];
      const from = found.find((each) => each.versioning !== undefined);
      info.addressedIn ??= from?.addressedIn;
      if (from?.leadingHoles.enableVersioning !== undefined) {
        info.leadingHoles.enableVersioning = from.leadingHoles.enableVersioning;
      }
    } else if (versionings.length > 1) {
      info.unreadAddressing.push({
        call: 'enableVersioning',
        file: wherever((each) => each.versioning),
        line: 1,
        text: `${versionings.length} files enable versioning differently`,
      });
    }
  }
};

const emptyInfo = (): BootstrapInfo => ({
  found: false,
  globalPrefixExcludes: [],
  globalPrefixExcludesDynamic: false,
  unreadAddressing: [],
  globals: [],
  dynamicGlobals: [],
  leadingHoles: {},
});

/**
 * # A mount read from settings (R144)
 *
 * novu writes its versioning prefix as `${CONTEXT_PATH}v`, where `CONTEXT_PATH`
 * is what `getContextPath()` makes of two settings, and every committed
 * environment file leaves both empty. The address is recorded with a hole in
 * front, as R89 says it must be, and nothing joins to it. What is established
 * here is the pair of facts a narrower rule needs: which settings the opening
 * hole is read from, and what the service's committed environment files say of
 * them. Whether that licenses a join is not decided here.
 *
 * "Read from settings" is meant narrowly, and the trace below refuses anything
 * wider. Every piece of text that could reach the part must be a setting or a
 * separator: a literal of any other text, a parameter that could carry text, or
 * a name the trace cannot follow makes the part something computed some other
 * way, and it is left to R89's rule.
 */

/** How far a name is followed before the trace gives up on it. */
const MOUNT_TRACE_DEPTH = 6;

/** A settings key as environment files write one. */
const SETTING_KEY = /^[A-Z][A-Z0-9_]*$/;

/** The settings object itself, as the two runtimes spell it. */
const ENV_OBJECT = /^(?:process\??\.env|import\.meta\.env)$/;

/** Text that adds nothing to an address once it is normalised. */
const SEPARATORS_ONLY = /^\/*$/;

/** Whether an expression is the settings object, or a name bound to something that reads it. */
const isSettingsObject = (node: Node): boolean => {
  if (ENV_OBJECT.test(node.getText().replace(/\s+/g, ''))) return true;
  if (!Node.isIdentifier(node)) return false;
  const declaration = node.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return false;
  const initializer = declaration.getInitializer();
  return initializer !== undefined && /\bprocess\??\.env\b|import\.meta\.env/.test(initializer.getText());
};

/** The setting a property read names, when it reads one off the settings object. */
const settingRead = (node: Node): string | undefined => {
  if (Node.isPropertyAccessExpression(node)) {
    const key = node.getName();
    return SETTING_KEY.test(key) && isSettingsObject(node.getExpression()) ? key : undefined;
  }
  if (Node.isElementAccessExpression(node)) {
    const argument = node.getArgumentExpression();
    if (argument === undefined || !Node.isStringLiteral(argument)) return undefined;
    const key = argument.getLiteralValue();
    return SETTING_KEY.test(key) && isSettingsObject(node.getExpression()) ? key : undefined;
  }
  return undefined;
};

/** A literal whose text never reaches the value: a comparison operand, a key, a property name. */
const textGoesNowhere = (literal: Node): boolean => {
  const parent = literal.getParent();
  if (parent === undefined) return false;
  if (Node.isBinaryExpression(parent)) {
    const operator = parent.getOperatorToken().getKind();
    return (
      operator === SyntaxKind.EqualsEqualsEqualsToken ||
      operator === SyntaxKind.ExclamationEqualsEqualsToken ||
      operator === SyntaxKind.EqualsEqualsToken ||
      operator === SyntaxKind.ExclamationEqualsToken
    );
  }
  if (Node.isElementAccessExpression(parent)) return parent.getArgumentExpression() === literal;
  if (Node.isPropertyAssignment(parent)) return parent.getNameNode() === literal;
  return false;
};

/** Literal text a node writes, for the kinds of node that write any. */
const literalTextOf = (node: Node): string | undefined => {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  if (Node.isTemplateHead(node) || Node.isTemplateMiddle(node) || Node.isTemplateTail(node)) {
    return node.getLiteralText();
  }
  return undefined;
};

/** What the trace can be asked beyond the node in front of it. */
interface MountTrace {
  /** The declaration a name imported from a package of this workspace stands for, when the resolver has none. */
  importedFromWorkspace: (specifier: string, name: string) => Node | undefined;
  /** Declarations already being read, so a recursion is read once. */
  reading: Set<Node>;
}

/**
 * The declaration a name stands for, through an import the resolver may not be
 * able to follow.
 *
 * `null` is a global the checker was never told about — `process` or `window`
 * without their type packages — which carries no text of its own; `undefined`
 * is a name that stands for something nobody can read.
 */
const declarationBehind = (identifier: Node, trace: MountTrace): Node | undefined | null => {
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return null;
  const own = symbol.getDeclarations()[0];
  const target = symbol.getAliasedSymbol()?.getDeclarations()[0];
  if (target !== undefined) return target;
  // A package of the same workspace that is only reachable through its build
  // output, which a clone does not have. Its source is in the project anyway.
  if (own !== undefined && Node.isImportSpecifier(own)) {
    const specifier = own.getImportDeclaration().getModuleSpecifierValue();
    return trace.importedFromWorkspace(specifier, own.getName());
  }
  return own;
};

/** Whether a declaration sits in an installed package or the language's own library. */
const isAmbient = (declaration: Node): boolean => {
  const sourceFile = declaration.getSourceFile();
  return sourceFile.getFilePath().includes('/node_modules/') || sourceFile.isDeclarationFile();
};

/** Whether an identifier is a use of a name, rather than the name of a property or of a declaration. */
const isReference = (identifier: Node): boolean => {
  const parent = identifier.getParent();
  if (parent === undefined) return true;
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isVariableDeclaration(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isParameterDeclaration(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isFunctionDeclaration(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isTypeReference(parent) || Node.isQualifiedName(parent)) return false;
  return true;
};

const isWithin = (node: Node, root: Node): boolean =>
  node.getSourceFile() === root.getSourceFile() &&
  node.getPos() >= root.getPos() &&
  node.getEnd() <= root.getEnd();

/**
 * The part of a declaration whose text could reach a value: a constant's
 * initialiser, or a whole function, parameters included. Anything else — a
 * `let` somebody may reassign, a class, a method — is not read.
 */
const readableBodyOf = (declaration: Node): Node | undefined => {
  if (Node.isVariableDeclaration(declaration)) {
    if (declaration.getVariableStatement()?.getDeclarationKind() !== 'const') return undefined;
    return declaration.getInitializer();
  }
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  return undefined;
};

/** Whether a parameter can carry text into the value. */
const carriesText = (parameter: Node): boolean => {
  const type = parameter.getType();
  return (
    type.isAny() ||
    type.isUnknown() ||
    type.isString() ||
    type.isStringLiteral() ||
    type.isTemplateLiteral() ||
    (type.isUnion() && type.getUnionTypes().some((each) => each.isString() || each.isStringLiteral()))
  );
};

/**
 * Every setting a subtree reads, or `undefined` when something other than
 * settings and separators could reach its value.
 */
const settingsIn = (root: Node, trace: MountTrace, depth: number): Set<string> | undefined => {
  if (depth > MOUNT_TRACE_DEPTH) return undefined;
  const found = new Set<string>();
  let refused = false;

  const follow = (declaration: Node): void => {
    if (trace.reading.has(declaration)) return;
    trace.reading.add(declaration);
    const body = readableBodyOf(declaration);
    const inner = body === undefined ? undefined : settingsIn(body, trace, depth + 1);
    if (inner === undefined) refused = true;
    else for (const key of inner) found.add(key);
  };

  const visit = (node: Node): void => {
    if (refused) return;
    const setting = settingRead(node);
    if (setting !== undefined) {
      found.add(setting);
      return;
    }
    const text = literalTextOf(node);
    if (text !== undefined) {
      if (!SEPARATORS_ONLY.test(text) && !textGoesNowhere(node)) refused = true;
      return;
    }
    // A parameter is text from whoever calls, which nothing here has read. One
    // whose type can hold no text — an enum member, a number — is a key into
    // settings and not a part of the address.
    if (Node.isParameterDeclaration(node)) {
      if (carriesText(node)) refused = true;
      return;
    }
    if (Node.isIdentifier(node) && isReference(node)) {
      const declaration = declarationBehind(node, trace);
      if (declaration === null) return;
      if (declaration === undefined) {
        refused = true;
        return;
      }
      if (isAmbient(declaration) || isWithin(declaration, root)) return;
      if (Node.isEnumDeclaration(declaration)) return;
      if (Node.isEnumMember(declaration)) {
        const initializer = declaration.getInitializer();
        const written = initializer === undefined ? undefined : literalTextOf(initializer);
        if (written !== undefined && !SEPARATORS_ONLY.test(written)) refused = true;
        return;
      }
      follow(declaration);
      return;
    }
    node.forEachChild(visit);
  };

  visit(root);
  return refused ? undefined : found;
};

/** Environment files as a repository commits them: `.env`, `.env.production`, `.env.example`. */
const ENV_FILE = /^\.env(?:\.[\w.-]+)?$/;

/** Directories that hold no environment file of the service's own. */
const NOT_THE_SERVICES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.flowatlas']);

/** How deep under the service an environment file is looked for. */
const ENV_FILE_DEPTH = 8;

/** Every environment file under a service's directory, repo-relative and sorted. */
const envFilesUnder = (rootDir: string): string[] => {
  const out: string[] = [];
  const walk = (at: string, depth: number): void => {
    if (depth > ENV_FILE_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(join(rootDir, at), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = at === '' ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!NOT_THE_SERVICES.has(entry.name)) walk(path, depth + 1);
      } else if (ENV_FILE.test(entry.name)) {
        out.push(path);
      }
    }
  };
  walk('', 0);
  return out.sort();
};

/** The settings one environment file gives a value, empty values left out. */
const settingsSetIn = (text: string): Set<string> => {
  const set = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const written = line.slice(equals + 1).trim();
    const quoted = /^(['"`])(.*)\1$/.exec(written);
    const value = quoted === null ? written.replace(/(?:^|\s+)#.*$/, '').trim() : (quoted[2] ?? '');
    if (value !== '') set.add(key);
  }
  return set;
};

/**
 * The leading part of every address, when it is read from settings.
 *
 * Leading means in front of everything: the global prefix when the service sets
 * one, and otherwise the versioning prefix. A hole in a versioning prefix that
 * sits behind a global prefix is in the middle of the address, and is left to
 * R89's rule.
 *
 * The environment files are the service's own, under its directory. A file
 * elsewhere in the repository configures something else, and whether it sets a
 * setting of the same name says nothing certain about this service.
 */
const mountOf = (info: BootstrapInfo, project: Project, rootDir: string): Mount | undefined => {
  const call: AddressingCall | undefined =
    info.globalPrefix !== undefined && info.globalPrefix !== ''
      ? 'setGlobalPrefix'
      : info.versioning?.type === 'uri'
        ? 'enableVersioning'
        : undefined;
  const hole = call === undefined ? undefined : info.leadingHoles[call];
  if (call === undefined || hole === undefined) return undefined;

  const workspace = workspaceRootOf(rootDir);
  const packages = workspace === undefined ? [] : workspacePackages(workspace);
  const trace: MountTrace = {
    reading: new Set(),
    importedFromWorkspace: (specifier, name) => {
      const pkg = packages.find((each) => each.name === specifier);
      if (pkg === undefined) return undefined;
      for (const sourceFile of project.getSourceFiles()) {
        const path = sourceFile.getFilePath();
        if (!path.startsWith(`${pkg.dir}/`) || path.includes('/node_modules/')) continue;
        if (sourceFile.isDeclarationFile()) continue;
        const exported = sourceFile.getExportedDeclarations().get(name)?.[0];
        if (exported !== undefined) return exported;
      }
      return undefined;
    },
  };
  const settings = settingsIn(hole.node, trace, 0);
  if (settings === undefined || settings.size === 0) return undefined;

  const files = envFilesUnder(rootDir);
  const setIn = files.filter((file) => {
    let text: string;
    try {
      text = readFileSync(join(rootDir, file), 'utf8');
    } catch {
      return false;
    }
    const set = settingsSetIn(text);
    return [...settings].some((key) => set.has(key));
  });
  return { call, settings: [...settings].sort(), setIn, envFiles: files.length, at: hole.at };
};

export interface ReadBootstrapOptions {
  project: Project;
  /** Absolute path of the repository root, which bounds the search. */
  rootDir: string;
  /** Absolute path of the entry file, when one was found. */
  absolutePath?: string;
  /** The same file, repo-relative. */
  relativePath?: string;
}

/**
 * Reads the application entry file, and the address of its routes wherever that
 * is decided.
 *
 * Globals come from the named file and from nowhere else: which application was
 * created is a question with one right answer per entry point, and searching for
 * it picks the wrong one silently. The global prefix and the versioning are not
 * that question — see {@link readAddressingElsewhere} — so when the entry file
 * does not settle them, the repository is asked.
 */
export const readBootstrap = ({
  project,
  rootDir,
  absolutePath,
  relativePath,
}: ReadBootstrapOptions): BootstrapInfo => {
  const info = emptyInfo();

  if (absolutePath !== undefined) {
    let sourceFile: SourceFile | undefined = project.getSourceFile(absolutePath);
    if (sourceFile === undefined) {
      try {
        sourceFile = project.addSourceFileAtPath(absolutePath);
      } catch {
        sourceFile = undefined;
      }
    }
    if (sourceFile !== undefined) {
      info.found = true;
      if (relativePath !== undefined) info.file = relativePath;
      readCallsIn(sourceFile, ENTRY_READERS, info, relativePath ?? absolutePath);
    }
  }

  if (info.globalPrefix === undefined || info.versioning === undefined) {
    foldAddressing(info, readAddressingElsewhere(project, rootDir, absolutePath));
  }

  const mount = mountOf(info, project, rootDir);
  if (mount !== undefined) info.mount = mount;
  return info;
};

/**
 * What is said about a line that decides every address and could not be read.
 *
 * One row per site rather than one per route: a service has one prefix, and four
 * hundred rows saying the same sentence would bury the one line somebody has to
 * go and look at. The reason is the one every unreadable path already carries,
 * because that is what this is — a path that could not be read — and the row's
 * own sentence says which line and what it costs.
 */
const ADDRESSING_ROWS: Record<string, (text: string) => { message: string; hint: string }> = {
  setGlobalPrefix: (text) => ({
    message: `the global prefix could not be read in full, so no address recorded for this service is the one the framework prints: ${text}`,
    hint: 'Pass a string literal or a const string. The prefix is part of every address this service answers on, and a caller cannot be joined to an address nobody has read.',
  }),
  enableVersioning: (text) => ({
    message: `the versioning could not be read in full, so every versioned address carries a hole where the version belongs: ${text}`,
    hint: 'Give type, prefix and defaultVersion literal values. Under URI versioning all three are part of every address this service answers on.',
  }),
};

export const addressingFindings = (info: BootstrapInfo): Unresolved[] =>
  info.unreadAddressing.map((site) => ({
    file: site.file,
    line: site.line,
    reason: 'route-path-dynamic',
    ...(ADDRESSING_ROWS[site.call]?.(site.text) ?? { message: site.text }),
    symbol: site.call,
    adapter: 'nestjs-http',
  }));

export { decoratorArgs };
