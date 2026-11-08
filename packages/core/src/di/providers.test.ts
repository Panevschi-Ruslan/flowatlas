import { Node, Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { providerIndex, sameToken } from './providers.js';

/** The providers of a repository written in memory, and the token named `TOKEN` in its last file. */
const indexOf = (files: Record<string, string>) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } });
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  const index = providerIndex(() => project.getSourceFiles());
  const token = project
    .getSourceFiles()
    .flatMap((source) => source.getDescendants())
    .filter((node) => Node.isIdentifier(node) && node.getText() === 'TOKEN')
    .pop();
  if (token === undefined) throw new Error('no TOKEN');
  return { index, token };
};

describe('the providers a repository writes (P259)', () => {
  it('reads each shape, written outside any function or in one the repository calls', () => {
    const { index, token } = indexOf({
      '/tokens.ts': "export const TOKEN = 'TOKEN';",
      '/module.ts': `
        import { TOKEN } from './tokens';
        export class Configured {
          static forRoot(url: string) { return { providers: [{ provide: TOKEN, useFactory: () => url }] }; }
          static forRootAsync() { return { providers: [{ provide: TOKEN, useValue: 'never' }] }; }
        }
        export const listed = [{ provide: TOKEN, useClass: Object }];
        Configured.forRoot('http://orders');
        const use = TOKEN;
      `,
    });
    expect(index.of(token).map((provider) => Object.keys(provider).filter((key) => key !== 'token' && key !== 'object'))).toEqual([['factory'], ['useClass']]);
  });

  it('finds the calls of a function by what they resolve to, not by name alone', () => {
    const { index, token } = indexOf({
      '/a.ts': 'export function build(base: string) { return base; }\nbuild(\'one\');',
      '/b.ts': "function build(other: string) { return other; }\nbuild('two'); build('three');\nconst TOKEN = 1;",
    });
    const [declared] = token.getSourceFile().getProject().getSourceFileOrThrow('/a.ts').getFunctions();
    expect(index.callsOf(declared as Node).map((call) => call.getArguments()[0]?.getText())).toEqual(["'one'"]);
  });

  it('tells tokens apart by symbol, and a string by its text', () => {
    const { token } = indexOf({ '/t.ts': "const TOKEN = 'A'; const OTHER = 'A'; const again = TOKEN;" });
    const source = token.getSourceFile();
    const [, , declared] = source.getDescendants().filter((node) => Node.isIdentifier(node) && node.getText() === 'TOKEN');
    const other = source.getDescendants().find((node) => Node.isIdentifier(node) && node.getText() === 'OTHER') as Node;
    expect(sameToken(token, declared ?? token)).toBe(true);
    expect(sameToken(token, other)).toBe(false);
    const project = new Project({ useInMemoryFileSystem: true });
    const strings = project.createSourceFile('/s.ts', "const a = 'X'; const b = 'X';").getDescendants().filter((node) => Node.isStringLiteral(node));
    expect(sameToken(strings[0] as Node, strings[1] as Node)).toBe(true);
  });
});
