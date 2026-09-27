import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { addressingFindings, readBootstrap } from './bootstrap.js';

const ROOT = '/repo';

/**
 * A repository of nothing but the files one question needs.
 *
 * In memory rather than on disk because every case below is about which file the
 * reader opens, and a fixture per case would be a directory per sentence.
 */
const repoOf = (files: Record<string, string>): Project => {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(files)) {
    project.createSourceFile(`${ROOT}/${path}`, text);
  }
  return project;
};

const read = (files: Record<string, string>, entry = 'src/main.ts') =>
  readBootstrap({
    project: repoOf(files),
    rootDir: ROOT,
    absolutePath: `${ROOT}/${entry}`,
    relativePath: entry,
  });

const ENTRY_WITH_HELPER = `
  import { configure } from './setup';
  async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    await configure(app);
  }
`;

/**
 * The readers are looked up by whatever method name the entry file calls, and an
 * object literal answered `valueOf` with the language's own, called unbound:
 * `Cannot convert undefined or null to object`, and the service read as nothing
 * (R130). The helper file is read too, since it names `setGlobalPrefix`.
 */
describe('a method every object has, called in the files the reader walks', () => {
  it.each(['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__', '__defineGetter__'])(
    '`%s` is not a reader, and the prefix is still read',
    (method) => {
      const info = read({
        'src/main.ts': `const app = x; process.env.${method}('PORT'); app.setGlobalPrefix('api');`,
        'src/setup.ts': `export function configure(app) { app.${method}('api'); app.setGlobalPrefix('v2'); }`,
      });
      expect(info.globalPrefix).toBe('api');
      expect(info.globals).toEqual([]);
      expect(addressingFindings(info)).toEqual([]);
    },
  );
});

/**
 * Where a service's addresses are decided, which is routinely not the file this
 * reader has always opened (R89).
 */
describe('reading the global prefix', () => {
  it('reads it from the entry file when that is where it is', () => {
    const info = read({ 'src/main.ts': `const app = x; app.setGlobalPrefix('api');` });
    expect(info.globalPrefix).toBe('api');
    expect(info.addressedIn).toBe('src/main.ts');
    expect(addressingFindings(info)).toEqual([]);
  });

  it('finds it in the helper the entry file hands the application to', () => {
    // immich's shape: the entry file forks a worker, the worker calls a helper,
    // and the helper is where the prefix is. Following calls out of the entry
    // file reaches none of it, so the repository is searched instead.
    const info = read({
      'src/main.ts': ENTRY_WITH_HELPER,
      'src/setup.ts': `export function configure(app) { app.setGlobalPrefix('api'); }`,
    });
    expect(info.globalPrefix).toBe('api');
    expect(info.addressedIn).toBe('src/setup.ts');
  });

  it('leaves it unset and says so when two files set a different one', () => {
    // The old objection to searching, answered rather than ignored: where the
    // repository disagrees with itself nothing is adopted, and the row names
    // both values instead of one being picked silently.
    const info = read({
      'src/main.ts': ENTRY_WITH_HELPER,
      'src/setup.ts': `export function a(app) { app.setGlobalPrefix('api'); }`,
      'src/admin.ts': `export function b(app) { app.setGlobalPrefix('admin'); }`,
    });
    expect(info.globalPrefix).toBeUndefined();
    expect(addressingFindings(info)[0]?.message).toContain('admin, api');
  });

  it('keeps what the entry file said, whatever another file says', () => {
    const info = read({
      'src/main.ts': `const app = x; app.setGlobalPrefix('api');`,
      'src/setup.ts': `export function b(app) { app.setGlobalPrefix('admin'); }`,
    });
    expect(info.globalPrefix).toBe('api');
  });

  it('ignores a prefix a test sets for itself', () => {
    const info = read({
      'src/main.ts': ENTRY_WITH_HELPER,
      'src/app.spec.ts': `it('x', () => { app.setGlobalPrefix('test'); });`,
    });
    expect(info.globalPrefix).toBeUndefined();
  });

  it('says so where the prefix could not be read at all', () => {
    const info = read({ 'src/main.ts': `const app = x; app.setGlobalPrefix(config.prefix);` });
    expect(info.globalPrefix).toBeUndefined();
    const [row] = addressingFindings(info);
    expect(row?.reason).toBe('route-path-dynamic');
    expect(row?.message).toContain('the global prefix could not be read in full');
    expect(row?.line).toBe(1);
  });

  it('keeps the half of it that was readable, and still says so', () => {
    const info = read({
      'src/main.ts': 'const app = x;\napp.setGlobalPrefix(`${root}/api`);',
    });
    expect(info.globalPrefix).toContain('api');
    expect(info.globalPrefix).not.toBe('api');
    expect(addressingFindings(info)).toHaveLength(1);
  });
});

describe('reading how the service versions its routes', () => {
  it('reads the kind by the name written, not by the value of the enum member', () => {
    // The member belongs to an installed package, so on a fresh clone there is
    // nothing to evaluate — and the value of `VersioningType.URI` is 0 anyway.
    const info = read({
      'src/main.ts': `const app = x; app.enableVersioning({ type: VersioningType.URI, prefix: 'v', defaultVersion: '1' });`,
    });
    expect(info.versioning).toEqual({ type: 'uri', prefix: 'v', defaultVersion: '1' });
    expect(addressingFindings(info)).toEqual([]);
  });

  it('finds it in a helper, as it does the prefix', () => {
    const info = read({
      'src/main.ts': ENTRY_WITH_HELPER,
      'src/setup.ts': `export function configure(app) { app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' }); }`,
    });
    // No prefix named, so the framework's own default stands.
    expect(info.versioning).toEqual({ type: 'uri', prefix: 'v', defaultVersion: '2' });
  });

  it('keeps the readable options when one beside them cannot be read', () => {
    // novu's shape: the prefix is a template rooted at a setting, while the
    // default version that decides where 356 routes answer is a literal beside
    // it. Evaluating the object whole threw away both.
    const info = read({
      'src/main.ts':
        'const app = x;\napp.enableVersioning({ type: VersioningType.URI, prefix: `${CONTEXT_PATH}v`, defaultVersion: \'1\' });',
    });
    expect(info.versioning?.defaultVersion).toBe('1');
    expect(info.versioning?.prefix).toContain('v');
    expect(info.versioning?.prefix).not.toBe('v');
    expect(addressingFindings(info)[0]?.message).toContain('the versioning could not be read in full');
  });

  it('records a kind it does not know, and says so', () => {
    const info = read({
      'src/main.ts': `const app = x; app.enableVersioning({ type: whatever() });`,
    });
    expect(info.versioning?.type).toBe('unknown');
    expect(addressingFindings(info)).toHaveLength(1);
  });

  it('says nothing about versions when the service enables none', () => {
    const info = read({ 'src/main.ts': `const app = x; app.setGlobalPrefix('api');` });
    expect(info.versioning).toBeUndefined();
  });
});
