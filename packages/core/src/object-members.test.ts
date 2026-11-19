import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { factoryMembers, moduleFunctions, objectMemberFunction, onlyHandsBackMembers } from './functions.js';
import { declarationOf } from './static-value.js';

const source = (text: string) => new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', text);

/** The function the member access `access` in `text` lands on, by the checker's declaration. */
const landing = (text: string, access: string) => {
  const file = source(text);
  const node = file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).find((each) => each.getText() === access);
  const declaration = node === undefined ? undefined : declarationOf(node);
  return declaration === undefined ? undefined : objectMemberFunction(declaration)?.name;
};

describe('an object of functions a factory hands back (P276)', () => {
  it('names a member of the object a factory returns by the factory and the member', () => {
    const text = 'const Gateway = () => ({ listOrders(id: string) { return id; }, placeOrder: async () => 1 });\nconst gateway = Gateway();\ngateway.listOrders("a"); gateway.placeOrder();';
    expect(landing(text, 'gateway.listOrders')).toBe('Gateway.listOrders');
    expect(landing(text, 'gateway.placeOrder')).toBe('Gateway.placeOrder');
  });

  it('reads a block that returns the object, a function declaration, and a `const` object', () => {
    expect(landing('function Repo() { return { list() { return []; } }; }\nRepo().list();', 'Repo().list')).toBe('Repo.list');
    expect(landing('const api = { a() { return 1; }, b: () => 2 };\napi.b();', 'api.b')).toBe('api.b');
  });

  it('names nothing for an object handed to a call, or a member that is not a function', () => {
    expect(landing('declare const keep: (x: unknown) => any;\nconst held = keep({ run() { return 1; } });\nheld.run();', 'held.run')).toBeUndefined();
    expect(landing('const Make = () => ({ size: 3 });\nMake().size;', 'Make().size')).toBeUndefined();
  });

  it('gives a factory its members, and says when it does nothing else', () => {
    const [plain, busy, other] = moduleFunctions(
      source('const Plain = () => ({ a() { return 1; }, b: () => 2, size: 3 });\nconst Busy = () => { start(); return { c() { return 3; } }; };\nconst Other = () => 4;\ndeclare const start: () => void;'),
    );
    expect(factoryMembers(plain!).map((each) => each.name)).toEqual(['Plain.a', 'Plain.b']);
    expect(onlyHandsBackMembers(plain!)).toBe(true);
    expect(factoryMembers(busy!).map((each) => each.name)).toEqual(['Busy.c']);
    expect(onlyHandsBackMembers(busy!)).toBe(false);
    expect(factoryMembers(other!)).toEqual([]);
  });
});
