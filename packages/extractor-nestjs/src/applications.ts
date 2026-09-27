import type { CallExpression, ClassDeclaration, Project } from 'ts-morph';
import { Node } from 'ts-morph';
import { normalizeFilePath, type ApplicationMap, type Unresolved } from '@flowatlas/core';
import { repoSourcesOf } from './bootstrap.js';
import type { ModuleIndex } from './modules-index.js';
import type { NestClassIndex } from './index-classes.js';
import { resolveClassExpression } from './util/resolve-class.js';

/**
 * Which applications a repository creates, and what each of them mounts.
 *
 * A service is not always one application, and the graph had no room for the
 * difference until R119: two applications writing the same path landed on one
 * entry id, the builder kept the node it already had, and the file that declared
 * the loser produced no node and no row while every total stayed correct.
 *
 * The set of applications was not read at all before this. The bootstrap reader
 * next door folds *one* record per service — assembled from every file that
 * mentions an addressing call and adopted only where they all agree — which is
 * the right shape for a global prefix and says nothing about how many
 * applications there are. Nothing anywhere read `NestFactory`.
 *
 * What is read here is only the roots. Everything else is already in the module
 * pass: it reads every `@Module`, resolves `imports` and `controllers`, and
 * records membership as metadata on the members. So an application is a root
 * module together with the modules it imports, transitively, and a controller
 * belongs to the application whose root reaches the module that declares it.
 */

/** Calls that create an application, by the method name that was written. */
const APPLICATION_FACTORIES = new Set(['create', 'createMicroservice']);

/**
 * The object those calls are written on.
 *
 * Matched by the name rather than by where it was imported from, for the same
 * reason the versioning kind is: this is the framework's own export and it is
 * spelled the same in every repository, while a barrel the checker cannot follow
 * is common enough that insisting on the import would read nothing.
 *
 * `app.connectMicroservice(...)` is deliberately not here, and it is the one
 * call in this family that looks like it belongs and does not. It attaches a
 * second transport to the application that was already created, from the same
 * module tree; it names no root module, and counting it would split one
 * application's addresses in two.
 */
const FACTORY = 'NestFactory';

/** One application, named after the root module the factory call was given. */
export interface ApplicationRoot {
  /** Unique within the repository; what an entry id carries. */
  name: string;
  module: ClassDeclaration;
  /** Repo-relative POSIX path of the call that created it. */
  file: string;
  line: number;
}

/** A call that creates an application whose root module could not be read. */
export interface UnreadApplication {
  file: string;
  line: number;
  text: string;
}

export interface ApplicationsRead {
  roots: ApplicationRoot[];
  unread: UnreadApplication[];
}

const isFactoryCall = (call: CallExpression): boolean => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (!APPLICATION_FACTORIES.has(callee.getName())) return false;
  // The last identifier of the expression, so both `NestFactory.create` and a
  // namespace import written as `core.NestFactory.create` answer.
  return /(\w+)\s*$/.exec(callee.getExpression().getText())?.[1] === FACTORY;
};

/**
 * A name per root that is unique in the repository and stable across machines.
 *
 * The root module's own name, which is what the factory call names and what
 * anybody reading the source would call the application. Where two roots are
 * classes of the same name — two `AppModule`s in a workspace of applications,
 * which is the shape this ticket came from — the file distinguishes them,
 * because a name that stood for both would put the two address spaces back
 * together again.
 */
const named = (
  found: ReadonlyArray<{ module: ClassDeclaration; file: string; line: number; moduleFile: string }>,
): ApplicationRoot[] => {
  const counted = new Map<string, number>();
  for (const root of found) {
    const name = root.module.getName() ?? '';
    counted.set(name, (counted.get(name) ?? 0) + 1);
  }
  return found.map((root) => {
    const name = root.module.getName() ?? 'anonymous';
    return {
      name: (counted.get(name) ?? 0) > 1 ? `${name}~${root.moduleFile}` : name,
      module: root.module,
      file: root.file,
      line: root.line,
    };
  });
};

/**
 * Every application this repository creates.
 *
 * The whole repository is walked rather than the entry file alone, because a
 * second application is routinely created in a file nothing reachable from
 * `main.ts` ever mentions: a worker a supervisor forks by path, a nested
 * application with a `main.ts` of its own. Cheap, because a file is only walked
 * when its text holds the name.
 *
 * One application per root module, not per call: the same module handed to the
 * factory twice is one address space created twice, and two of them would make
 * every address of it ambiguous against itself.
 */
export const readApplicationRoots = (options: {
  project: Project;
  rootDir: string;
}): ApplicationsRead => {
  const { project, rootDir } = options;
  const found: Array<{
    module: ClassDeclaration;
    file: string;
    line: number;
    moduleFile: string;
  }> = [];
  const seen = new Set<ClassDeclaration>();
  const unread: UnreadApplication[] = [];

  for (const sourceFile of repoSourcesOf(project, rootDir, undefined)) {
    if (!sourceFile.getFullText().includes(FACTORY)) continue;
    const file = normalizeFilePath(sourceFile.getFilePath(), rootDir);
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node) || !isFactoryCall(node)) return;
      const line = node.getStartLineNumber();
      const [first] = node.getArguments();
      const ref = first === undefined ? undefined : resolveClassExpression(first);
      if (ref === undefined || ref.kind !== 'local') {
        unread.push({ file, line, text: node.getText().replace(/\s+/g, ' ').slice(0, 90) });
        return;
      }
      if (seen.has(ref.declaration)) return;
      seen.add(ref.declaration);
      found.push({
        module: ref.declaration,
        file,
        line,
        moduleFile: normalizeFilePath(ref.declaration.getSourceFile().getFilePath(), rootDir),
      });
    });
  }

  // By where the call sits, so the order is the repository's and not the
  // filesystem's: two machines that open the files in a different order must
  // name the same applications.
  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  unread.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { roots: named(found), unread };
};

/** Declarations one module tree holds: its own members, then its imports'. */
const membersReachedFrom = (root: ClassDeclaration, modules: ModuleIndex): ClassDeclaration[] => {
  const members: ClassDeclaration[] = [];
  const visited = new Set<ClassDeclaration>([root]);
  const queue: ClassDeclaration[] = [root];
  while (queue.length > 0) {
    const declaration = queue.shift() as ClassDeclaration;
    const info = modules.get(declaration);
    if (info === undefined) continue;
    members.push(...info.controllers);
    for (const provider of info.providers) {
      if (provider.declaration !== undefined) members.push(provider.declaration);
    }
    for (const imported of info.imports) {
      const target = imported.declaration;
      if (target === undefined || visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  return members;
};

/**
 * Which applications mount each declaration, keyed by symbol id.
 *
 * The symbol id rather than the declaration, because the answer is read by an
 * adapter that has a file and a class name and no parsed tree of this
 * repository's modules — and because it is the identity the rest of the graph
 * already uses for the same class.
 */
export const applicationMembership = (
  roots: readonly ApplicationRoot[],
  modules: ModuleIndex,
  classes: NestClassIndex,
): ApplicationMap => {
  const of = new Map<string, string[]>();
  for (const root of roots) {
    for (const member of membersReachedFrom(root.module, modules)) {
      const id = classes.get(member)?.id;
      if (id === undefined) continue;
      const mounted = of.get(id);
      if (mounted === undefined) of.set(id, [root.name]);
      else if (!mounted.includes(root.name)) mounted.push(root.name);
    }
  }
  const names = roots.map((root) => root.name).sort();
  return {
    names,
    of: Object.fromEntries([...of].map(([id, mounted]) => [id, [...mounted].sort()])),
  };
};

/**
 * What is said about a factory call whose root module could not be read.
 *
 * One row per call. It costs more than a missing detail: an application nobody
 * could name is an application whose addresses collapse onto another's, which is
 * the silence this ticket is about, so the row says that rather than merely that
 * an argument was computed.
 */
export const applicationFindings = (unread: readonly UnreadApplication[]): Unresolved[] =>
  unread.map((site) => ({
    file: site.file,
    line: site.line,
    reason: 'application-root-unread',
    message: `the root module of an application created here could not be read, so its addresses cannot be told apart from another application's in this service: ${site.text}`,
    hint: 'Pass the root module class itself. An application nobody can name shares an address space with every other one in the service, and the file that loses a shared address contributes no node.',
    symbol: 'NestFactory',
    adapter: 'nestjs-http',
  }));
