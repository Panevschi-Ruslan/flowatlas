import { Node, Project, SyntaxKind, type Node as TsNode } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { addressTestOf, guardsAround, literalAddress, prefixOfRewrite, rewriteTestOf } from './address-rewrite.js';
import { resolveStaticString } from './static-string.js';
import { underBase } from './under-base.js';

/** A function `(url) => { ... }` written in memory, and the expression `url` stands for in it. */
const fnOf = (body: string) => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('rewrite.ts', `export const rewrite = (url: string, flag: boolean) => { ${body} };`);
  const fn = file.getFirstDescendantByKindOrThrow(SyntaxKind.ArrowFunction);
  const parameter = fn.getParameters()[0];
  const isAddress = (node: TsNode): boolean => Node.isIdentifier(node) && node.getSymbol()?.getDeclarations()[0] === parameter;
  const marked = fn.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => call.getExpression().getText() === 'mark');
  return { fn, isAddress, marked };
};

const conditionOf = (text: string) => {
  const { fn, isAddress } = fnOf(`return ${text};`);
  const returned = fn.getFirstDescendantByKindOrThrow(SyntaxKind.ReturnStatement).getExpressionOrThrow();
  return addressTestOf(returned, isAddress);
};

describe('a base written as text (P280)', () => {
  it('keeps a host apart from the path after it', () => {
    expect(literalAddress('https://api.example.test/api')).toMatchObject({ host: 'api.example.test', path: '/api', url: 'https://api.example.test/api' });
    expect(literalAddress('https://API.example.test')).toMatchObject({ host: 'api.example.test', path: '/' });
    expect(literalAddress('/api/v1')).toMatchObject({ host: null, path: '/api/v1' });
    expect(underBase(literalAddress('https://api.example.test/api'), { ...literalAddress('/orders/:param'), via: 'literal' })).toMatchObject({
      url: 'https://api.example.test/api/orders/:param',
      path: '/api/orders/:param',
      host: 'api.example.test',
    });
  });

  it('reads a template opening with a host in front of the address it rewrites', () => {
    const { fn, isAddress } = fnOf('return `https://api.example.test/api${url}`;');
    const written = fn.getFirstDescendantByKindOrThrow(SyntaxKind.TemplateExpression);
    expect(prefixOfRewrite(written, isAddress, () => literalAddress(''))).toMatchObject({ host: 'api.example.test', path: '/api' });
  });
});

describe('a condition read as a test of the address (P280)', () => {
  it('reads the tests a string answers, negated and joined', () => {
    const starts = conditionOf(`url.startsWith('/api/')`);
    expect(starts?.('/api/orders')).toBe(true);
    expect(starts?.('/health')).toBe(false);
    // A hole after enough is read decides nothing; one before it leaves the test open.
    expect(starts?.('/api/orders/:param')).toBe(true);
    expect(starts?.('/:param/list')).toBeUndefined();
    expect(starts?.('/pages/:param')).toBe(false);
    const either = conditionOf(`!(url.endsWith('.json') || url.includes('/assets/'))`);
    expect(either?.('/orders')).toBe(true);
    expect(either?.('/assets/icons')).toBe(false);
    expect(either?.('/orders/:param')).toBeUndefined();
    const equal = conditionOf(`url === '/login'`);
    expect(equal?.('/login')).toBe(true);
    expect(equal?.('/orders/:param')).toBe(false);
    expect(equal?.('/:param')).toBeUndefined();
    const pattern = conditionOf(`/^\\/(api|auth)\\//.test(url)`);
    expect(pattern?.('/auth/login')).toBe(true);
    expect(pattern?.('/pages')).toBe(false);
  });

  it('reads nothing of a condition about anything but the address', () => {
    expect(conditionOf('flag')).toBeUndefined();
    expect(conditionOf(`url.startsWith('/api') && flag`)).toBeUndefined();
    expect(conditionOf(`url.startsWith(prefix)`)).toBeUndefined();
  });
});

describe('the side of each condition a rewrite is written on (P280)', () => {
  it('says which side, and what a guard that does not leave does not say', () => {
    const inside = fnOf(`if (url.startsWith('/api')) { mark(); } else { other(); }`);
    expect(guardsAround(inside.marked as TsNode, inside.fn).map((guard) => guard.holds)).toEqual([true]);
    const after = fnOf(`if (url.startsWith('/assets')) return url; if (flag) log(); mark();`);
    expect(guardsAround(after.marked as TsNode, after.fn).map((guard) => guard.holds)).toEqual([false, undefined]);
  });

  it('turns the guards into one test, and gives up on one about anything else', () => {
    const guarded = fnOf(`if (url.startsWith('/assets')) return url; if (url.startsWith('http')) return url; return flag ? url : mark();`);
    expect(rewriteTestOf(guarded.marked as TsNode, guarded.fn, guarded.isAddress)).toBeUndefined();
    const only = fnOf(`if (url.startsWith('/assets')) return url; if (url.startsWith('http')) return url; mark();`);
    const test = rewriteTestOf(only.marked as TsNode, only.fn, only.isAddress);
    expect(test?.('/orders')).toBe(true);
    expect(test?.('/assets/a.png')).toBe(false);
    const plain = fnOf(`if (!url.startsWith('http')) mark();`);
    expect(rewriteTestOf(plain.marked as TsNode, plain.fn, plain.isAddress)).toBeNull();
  });
});

describe('text joined with + read as the template it spells (P280)', () => {
  const read = (text: string, concatenation = true) => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile('join.ts', `declare const name: string; declare const env: { apiUrl: string };\nexport const value = ${text};`);
    const value = file.getVariableDeclarationOrThrow('value').getInitializerOrThrow();
    return resolveStaticString(value, { envRoots: ['env'], concatenation });
  };

  it('reads holes as a template does, and a setting it opens with', () => {
    expect(read(`'/sellers/' + name + '/follow'`)?.value).toBe('/sellers/:param/follow');
    expect(read(`'/sellers/' + name`)?.value).toBe('/sellers/:param');
    expect(read(`env.apiUrl + '/orders/' + name`)).toMatchObject({ value: '/orders/:param', envRefs: ['apiUrl'] });
    expect(read('`/a/${name}` + \'/b\'')?.value).toBe('/a/:param/b');
  });

  it('reads nothing unless asked, and nothing of a sum that holds no text', () => {
    expect(read(`'/sellers/' + name`, false)).toBeNull();
    expect(read(`name.length + 1`)).toBeNull();
  });
});
