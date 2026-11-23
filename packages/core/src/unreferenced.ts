import { join, resolve } from 'node:path';
import { ts, type Project } from 'ts-morph';
import type { GraphBuilder } from './builder.js';
import type { GraphNode } from './model/nodes.js';

/**
 * Code its repository writes nowhere (P370).
 *
 * A client method nothing calls, in a class something injects, is
 * `likely-dead`: a call through a receiver the reading could not type may be
 * the one that reaches it. But such a call writes the method's name, and so
 * does every other way to reach it - a reference by name, a string key, a
 * template binding, a value handed on. Where the name is written nowhere in
 * the repository but at its own declaration, no unread call could name it:
 * the node is marked `unreferenced`, and `reach` says `unreached` for it
 * rather than `maybe`.
 *
 * The count is of names, not of uses, so it errs towards "written": every
 * identifier of every source file the reading opened, every word of every
 * string, template literal and JSX text, and every word of the markup the
 * reading read beside them (a template in its own file, a single-file
 * component: `noteMarkup`), comments alone left out. A name
 * written twice anywhere - an overload, an interface member, a mention in a
 * test - is written. Left unmarked too, since something outside the
 * repository may call them by contract or by where they sit: what the
 * reading drew an edge into, a member of a class that extends or implements
 * anything, a decorated member, a framework's hook (`ngOnChanges`), a
 * file's default export (a layout a framework renders, a module imported
 * under another name) and its members, a component a file declares by
 * where it sits rather than in code (a single-file component), and everything in a
 * repository that publishes an entry for others to import (`main`, `module`,
 * `exports`, `types` in its manifest).
 *
 * A front-end reader marks the same key on a method that makes a request
 * when the compiler finds no reference to it (`noteIfUnreferenced`, read by
 * the contract check); both say nothing in the repository names it.
 */

/** Files that declare code in code, where a declaration writes its name. */
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/** The meta key a node carries when its name is written nowhere else in its repository. */
export const UNREFERENCED_META = 'unreferenced';

/** The markup each reading read beside its sources (a template in its own file, a single-file component), by builder. */
const MARKUP_READ = new WeakMap<GraphBuilder, string[]>();

/**
 * Notes markup a reader read beside the project's sources, whose words a
 * template binds (`(click)="checkout()"`): counted as written (P370).
 */
export const noteMarkup = (builder: GraphBuilder, text: string): void => {
  const known = MARKUP_READ.get(builder);
  if (known === undefined) MARKUP_READ.set(builder, [text]);
  else known.push(text);
};

const WORD = /[A-Za-z_$][\w$]*/g;

const countWords = (counts: Map<string, number>, text: string): void => {
  for (const match of text.matchAll(WORD)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
};

/** The kinds of token whose text holds names a string can write. */
const TEXTUAL = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

/** Every name a source file writes, by its syntax tree: comments are trivia and never visited. */
const countFile = (counts: Map<string, number>, file: ts.SourceFile): void => {
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      const name = node.text.replace(/^#/, '');
      counts.set(name, (counts.get(name) ?? 0) + 1);
    } else if (TEXTUAL.has(node.kind)) {
      countWords(counts, (node as ts.LiteralLikeNode).text);
    } else if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isStringLiteral(node.initializer)) {
      countWords(counts, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
};

/** How often each name is written in the repository's code and markup, comments left out. */
export const namesWritten = (project: Pick<Project, 'getSourceFiles'>, markup: readonly string[] = []): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const source of project.getSourceFiles()) {
    const path = source.getFilePath();
    if (path.includes('/node_modules/') || source.isDeclarationFile()) continue;
    countFile(counts, source.compilerNode);
  }
  for (const text of markup) countWords(counts, text);
  return counts;
};

/** Whether a repository publishes an entry for others to import: its code may be called from outside it. */
export const publishesEntry = (manifest: Readonly<Record<string, unknown>>): boolean =>
  ['main', 'module', 'exports', 'types', 'typings'].some((key) => manifest[key] !== undefined);

/** A framework's hook by its name: `ngOnChanges`, `ngDoCheck`. */
const HOOK = /^ng[A-Z]/;

/** The class a node of `Class.member` is a member of, and the member, by the node's file. */
const memberOf = (project: Pick<Project, 'getSourceFile'>, repoDir: string, node: GraphNode): { owner: ts.ClassLikeDeclaration; member?: ts.ClassElement } | undefined => {
  if (node.file === undefined) return undefined;
  const source = project.getSourceFile(join(resolve(repoDir), node.file));
  if (source === undefined) return undefined;
  const dot = node.label.lastIndexOf('.');
  const className = dot < 0 ? node.label : node.label.slice(0, dot);
  const memberName = dot < 0 ? undefined : node.label.slice(dot + 1);
  let found: { owner: ts.ClassLikeDeclaration; member?: ts.ClassElement } | undefined;
  const visit = (at: ts.Node): void => {
    if (found !== undefined) return;
    if ((ts.isClassDeclaration(at) || ts.isClassExpression(at)) && at.name?.text === className) {
      const member = memberName === undefined ? undefined : at.members.find((element) => element.name !== undefined && (ts.isIdentifier(element.name) || ts.isPrivateIdentifier(element.name)) && element.name.text === memberName);
      found = { owner: at, ...(member === undefined ? {} : { member }) };
      return;
    }
    ts.forEachChild(at, visit);
  };
  visit(source.compilerNode);
  return found;
};

/**
 * Whether a file's default export is the named class or function: imported
 * under any name, or by a framework from where the file sits (a layout, an
 * error screen), so its own name need be written nowhere.
 */
const exportedAsDefault = (project: Pick<Project, 'getSourceFile'>, repoDir: string, file: string | undefined, name: string): boolean => {
  if (file === undefined) return false;
  const source = project.getSourceFile(join(resolve(repoDir), file));
  const declarations = source?.getExportedDeclarations().get('default') ?? [];
  return declarations.some((declaration) => {
    const named = (declaration as { getName?: () => string | undefined }).getName?.();
    return named === name || declaration.getText() === name;
  });
};

const decorated = (node: ts.Node): boolean => ts.canHaveDecorators(node) && (ts.getDecorators(node)?.length ?? 0) > 0;

/**
 * Marks the methods and components of one repository whose name its code
 * writes nowhere but at their own declaration (see above). Returns how many
 * were marked.
 */
export const markUnreferenced = (
  builder: GraphBuilder,
  project: Pick<Project, 'getSourceFiles' | 'getSourceFile'>,
  repoDir: string,
  manifest: Readonly<Record<string, unknown>>,
): number => {
  if (publishesEntry(manifest)) return 0;
  let counts: Map<string, number> | undefined;
  let marked = 0;
  // What the reading drew an edge into is reached by it, by a name or not (a component by its selector).
  const reached = new Set(builder.edges.map((edge) => edge.to));
  for (const node of builder.nodes) {
    if (node.repo !== builder.repo || (node.type !== 'method' && node.type !== 'ui_component') || reached.has(node.id)) continue;
    if (node.file === undefined || !CODE_FILE.test(node.file) || node.meta?.[UNREFERENCED_META] === true) continue;
    const name = node.type === 'method' ? node.label.slice(node.label.lastIndexOf('.') + 1) : node.label;
    if (name === '' || HOOK.test(name)) continue;
    counts ??= namesWritten(project, MARKUP_READ.get(builder));
    if ((counts.get(name) ?? 0) > 1) continue;
    const owner = node.type === 'method' ? node.label.slice(0, node.label.lastIndexOf('.')) : node.label;
    if (exportedAsDefault(project, repoDir, node.file, owner)) continue;
    if (node.type === 'method') {
      const found = memberOf(project, repoDir, node);
      // A member the reading cannot find again, of a class that takes a contract, or that a decorator hands to a framework.
      if (found?.member === undefined || (found.owner.heritageClauses?.length ?? 0) > 0 || decorated(found.member)) continue;
    }
    node.meta = { ...node.meta, [UNREFERENCED_META]: true };
    marked += 1;
  }
  return marked;
};
