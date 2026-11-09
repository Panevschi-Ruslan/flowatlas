import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { analyzeApiUrl, settingKeyOf } from './url.js';

/** The address argument of the first call to `send` in a page, beside a settings module. */
const addressIn = (config: string, source: string) => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('config.ts', config);
  const file = project.createSourceFile('page.ts', source);
  const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'send');
  return analyzeApiUrl(call?.getArguments()[0] as never);
};

const keyOf = (expression: string): string | null => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('value.ts', `const value = ${expression};`);
  return settingKeyOf(file.getVariableDeclarationOrThrow('value').getInitializerOrThrow());
};

describe('a settings object injected into the page at run time (P275)', () => {
  it('reads the key under window._env_, window.__ENV__ and globalThis.env, a cast taken off', () => {
    expect(keyOf('window._env_?.SERVER_URL')).toBe('SERVER_URL');
    expect(keyOf('window.__ENV__.API_URL')).toBe('API_URL');
    expect(keyOf('globalThis.env.API_URL')).toBe('API_URL');
    expect(keyOf('(window as any)._env_.SERVER_URL')).toBe('SERVER_URL');
    expect(keyOf('window.__RUNTIME_CONFIG__.api.url')).toBe('api.url');
  });

  it('reads nothing of another member of the page', () => {
    expect(keyOf('window.location.origin')).toBeNull();
    expect(keyOf('window.store.SERVER_URL')).toBeNull();
    expect(keyOf('window._env_')).toBeNull();
  });

  it('roots an address at the key a constant reads, with the page origin as its fallback', () => {
    const address = addressIn(
      'export const SERVER_URL = window._env_?.SERVER_URL || window.location.origin;',
      "import { SERVER_URL } from './config';\nsend(`${SERVER_URL}/graphql`);",
    );
    expect(address).toMatchObject({ baseUrlEnv: 'SERVER_URL', path: '/graphql' });
  });
});
