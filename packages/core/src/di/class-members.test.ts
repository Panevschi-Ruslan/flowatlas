import { Project, type ClassDeclaration, type SourceFile } from 'ts-morph';
import { describe, expect, it, vi } from 'vitest';
import { classMembersOf } from './class-members.js';
import { methodNamedOn, methodsOfClass } from './member-call.js';

const SOURCE = `
const key = 'dynamic';

export class Catalog {
  find(id: string): string;
  find(id: number): string;
  find(id: string | number): string { return String(id); }

  get size(): number { return 0; }
  set size(value: number) {}

  static create(): Catalog { return new Catalog(); }
  create(): void {}

  static shared = 1;
  shared = () => 2;

  [key](): void {}
  ['literal'](): void {}
  'quoted'(): void {}
  #hidden(): void {}

  readonly value = 3;
  handler = function () {};
}

export abstract class Shape {
  abstract area(): number;
  area2(): number { return 0; }
}
`;

const AMBIENT = `
export declare class Remote {
  send(body: string): void;
  send(body: number): void;
  get ready(): boolean;
}
`;

const read = (): { file: SourceFile; ambient: SourceFile } => {
  const project = new Project({ useInMemoryFileSystem: true });
  return {
    file: project.createSourceFile('catalog.ts', SOURCE),
    ambient: project.createSourceFile('remote.d.ts', AMBIENT),
  };
};

/** Every name a member of the class is written with, as ts-morph spells it, and one nobody has. */
const namesOf = (owner: ClassDeclaration): string[] => [
  ...new Set(
    owner
      .getMembers()
      .flatMap((member) => ('getName' in member && typeof member.getName === 'function' ? [String(member.getName())] : [])),
  ),
  'missing',
];

describe('classMembersOf', () => {
  it("answers what ts-morph's own lookups answer, for every member name", () => {
    const { file, ambient } = read();
    const classes = [
      file.getClassOrThrow('Catalog'),
      file.getClassOrThrow('Shape'),
      ambient.getClassOrThrow('Remote'),
    ];
    for (const owner of classes) {
      const members = classMembersOf(owner);
      expect(members.methods).toEqual(owner.getMethods());
      expect(members.properties).toEqual(owner.getProperties());
      for (const name of namesOf(owner)) {
        const at = `${owner.getName()}.${name}`;
        expect(members.method(name), at).toBe(owner.getMethod(name));
        expect(members.property(name), at).toBe(owner.getProperty(name));
        expect(members.getAccessor(name), at).toBe(owner.getGetAccessor(name));
      }
    }
  });

  it('reads the shapes the class is written with as ts-morph does', () => {
    const { file, ambient } = read();
    const catalog = classMembersOf(file.getClassOrThrow('Catalog'));
    // The implementation, not an overload signature, outside a declaration file.
    expect(catalog.method('find')?.hasBody()).toBe(true);
    // The first written of a static and an instance member of one name.
    expect(catalog.method('create')?.isStatic()).toBe(true);
    expect(catalog.property('shared')?.isStatic()).toBe(true);
    // A computed name is its text.
    expect(catalog.method('[key]')).toBeDefined();
    expect(catalog.method("['literal']")).toBeDefined();
    expect(catalog.method('#hidden')).toBeDefined();
    expect(catalog.getAccessor('size')).toBeDefined();
    expect(catalog.method('size')).toBeUndefined();
    // An abstract method is a method.
    expect(classMembersOf(file.getClassOrThrow('Shape')).method('area')).toBeDefined();
    // In a declaration file every overload is a member, and the first answers.
    const remote = classMembersOf(ambient.getClassOrThrow('Remote'));
    expect(remote.methods).toHaveLength(2);
    expect(remote.method('send')?.getParameters()[0]?.getType().getText()).toBe('string');
  });

  it('gives methodNamedOn and methodsOfClass the answers they gave before the index', () => {
    const { file } = read();
    const owner = file.getClassOrThrow('Catalog');
    const before = (name: string) => {
      const method = owner.getMethod(name);
      if (method !== undefined) return method;
      const property = owner.getProperty(name);
      const initializer = property?.getInitializer();
      return initializer !== undefined &&
        (initializer.getKindName() === 'ArrowFunction' || initializer.getKindName() === 'FunctionExpression')
        ? property
        : undefined;
    };
    for (const name of namesOf(owner)) expect(methodNamedOn(owner, name), name).toBe(before(name));
    expect(methodsOfClass(owner).map((method) => method.getName())).toEqual([
      'find',
      'create',
      'create',
      '[key]',
      "['literal']",
      "'quoted'",
      '#hidden',
      'shared',
      'handler',
    ]);
  });

  it("walks a class's members once however many names are asked, and reads the new text after a refresh", () => {
    const { file } = read();
    const owner = file.getClassOrThrow('Catalog');
    const names = namesOf(owner);
    const spy = vi.spyOn(owner, 'getMembers');
    for (let round = 0; round < 50; round += 1) {
      for (const name of names) methodNamedOn(owner, name);
    }
    classMembersOf(owner).getAccessor('size');
    methodsOfClass(owner);
    expect(spy).toHaveBeenCalledTimes(1);

    // A watch refreshes the file from disk, which gives the class a new
    // compiler node, and the new text answers rather than the old.
    file.getProject().getFileSystem().writeFileSync(file.getFilePath(), SOURCE.replace('create(): void {}', 'renamed(): void {}'));
    const before = owner.compilerNode;
    file.refreshFromFileSystemSync();
    const refreshed = file.getClassOrThrow('Catalog');
    expect(refreshed.compilerNode).not.toBe(before);
    expect(methodNamedOn(refreshed, 'renamed')).toBeDefined();
    expect(methodNamedOn(refreshed, 'create')?.isStatic()).toBe(true);
    expect(classMembersOf(refreshed).methods.filter((method) => method.getName() === 'create')).toHaveLength(1);
    spy.mockRestore();
  });
});
