import type { ClassDeclaration, Project } from 'ts-morph';
import { makeSymbolId } from './ids.js';
import { className, fileOf, lineOf } from './nodes.js';

/**
 * A class of the repository, with whatever the extractor decided it is.
 *
 * The role is the extractor's word, not the core's: what a class is called and
 * which node type that implies is framework knowledge, and it is settled once,
 * before any pass runs, so that whichever pass reaches a class first creates the
 * same node for it.
 */
export interface IndexedClass<Role extends string = string> {
  id: string;
  name: string;
  /** Repo-relative POSIX path. */
  file: string;
  line: number;
  role: Role;
  declaration: ClassDeclaration;
}

/** Every class declared in the repository, addressable by declaration, id or name. */
export class ClassIndex<Role extends string = string> {
  readonly #byDeclaration = new Map<ClassDeclaration, IndexedClass<Role>>();
  readonly #byId = new Map<string, IndexedClass<Role>>();
  readonly #byName = new Map<string, IndexedClass<Role>[]>();

  add(indexed: IndexedClass<Role>): void {
    this.#byDeclaration.set(indexed.declaration, indexed);
    this.#byId.set(indexed.id, indexed);
    const sameName = this.#byName.get(indexed.name);
    if (sameName === undefined) this.#byName.set(indexed.name, [indexed]);
    else sameName.push(indexed);
  }

  /** Upgrades a role once usage shows what a class really is. */
  setRole(declaration: ClassDeclaration, role: Role): void {
    const indexed = this.#byDeclaration.get(declaration);
    if (indexed !== undefined) indexed.role = role;
  }

  get(declaration: ClassDeclaration): IndexedClass<Role> | undefined {
    return this.#byDeclaration.get(declaration);
  }

  byId(id: string): IndexedClass<Role> | undefined {
    return this.#byId.get(id);
  }

  /** All classes sharing a name; more than one means the name is ambiguous. */
  byName(name: string): readonly IndexedClass<Role>[] {
    return this.#byName.get(name) ?? [];
  }

  all(): readonly IndexedClass<Role>[] {
    return [...this.#byDeclaration.values()];
  }

  withRole(role: Role): readonly IndexedClass<Role>[] {
    return this.all().filter((indexed) => indexed.role === role);
  }

  get size(): number {
    return this.#byDeclaration.size;
  }
}

export interface BuildClassIndexOptions<Role extends string> {
  project: Project;
  repo: string;
  repoDir: string;
  /** What a class is, as far as the extractor's graph is concerned. */
  roleOf(declaration: ClassDeclaration): Role;
}

export const buildClassIndex = <Role extends string>(
  options: BuildClassIndexOptions<Role>,
): ClassIndex<Role> => {
  const { project, repo, repoDir, roleOf } = options;
  const index = new ClassIndex<Role>();
  for (const sourceFile of project.getSourceFiles()) {
    const file = fileOf(sourceFile, repoDir);
    if (file.includes('node_modules/')) continue;
    for (const declaration of sourceFile.getClasses()) {
      const name = className(declaration);
      index.add({
        id: makeSymbolId(repo, file, name),
        name,
        file,
        line: lineOf(declaration),
        role: roleOf(declaration),
        declaration,
      });
    }
  }
  return index;
};
