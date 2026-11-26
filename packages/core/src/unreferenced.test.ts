import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { SCHEMA_VERSION, schemaMismatchSaid } from './schema/version.js';
import { markUnreferenced, namesWritten, noteMarkup, UNREFERENCED_META } from './unreferenced.js';

const projectOf = (files: Record<string, string>): Project => {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  return project;
};

const API = `
/** oneLegacy is mentioned here, in a comment, which writes nothing. */
export class ItemsApi {
  one(id: string) { return id; }
  oneLegacy(id: string) { return id; }
  byKey(id: string) { return id; }
  bound(id: string) { return id; }
}
export class Base { run() {} }
export class Child extends Base { spare() {} }
export class Decorated { @Listen('click') onClick() {} }
declare function Listen(name: string): MethodDecorator;
export class Shown {}
export class Unused {}
`;
const LAYOUT = `
export default function Layout() { return null; }
`;
const CARD = `
import { ItemsApi, Shown } from './api';
export class Card {
  constructor(private api: ItemsApi) {}
  load() { this.api.one('1'); this['byKey']('2'); }
  readonly shown = Shown;
}
`;

const built = (manifest: Record<string, unknown> = {}, markup?: string) => {
  const project = projectOf({ '/src/api.ts': API, '/src/card.ts': CARD, '/src/layout.ts': LAYOUT });
  const builder = new GraphBuilder({ repo: 'web' });
  const method = (name: string, owner = 'ItemsApi') =>
    builder.addNode({ id: `web#src/api.ts:${owner}.${name}`, type: 'method', label: `${owner}.${name}`, repo: 'web', file: 'src/api.ts', line: 1 });
  for (const name of ['one', 'oneLegacy', 'byKey', 'bound']) method(name);
  method('spare', 'Child');
  method('onClick', 'Decorated');
  for (const name of ['Shown', 'Unused']) builder.addNode({ id: `web#src/api.ts:${name}`, type: 'ui_component', label: name, repo: 'web', file: 'src/api.ts', line: 1 });
  // A file's default export, which a framework may render from where the file sits.
  builder.addNode({ id: 'web#src/layout.ts:Layout', type: 'ui_component', label: 'Layout', repo: 'web', file: 'src/layout.ts', line: 2 });
  if (markup !== undefined) noteMarkup(builder, markup);
  const marked = markUnreferenced(builder, project, '/', manifest);
  const unreferenced = builder.nodes.filter((node) => node.meta?.[UNREFERENCED_META] === true).map((node) => node.label).sort();
  return { marked, unreferenced };
};

describe('code its repository writes nowhere else (P370)', () => {
  it('counts names in code and strings, never in comments', () => {
    const counts = namesWritten(projectOf({ '/a.ts': "// gone()\nconst x = { key: 'gone' }; call(x);" }));
    expect(counts.get('gone')).toBe(1);
    expect(counts.get('call')).toBe(1);
  });

  it('marks a method and a component named only where declared, and nothing a name, a key, a contract or a decorator reaches', () => {
    expect(built()).toEqual({ marked: 3, unreferenced: ['ItemsApi.bound', 'ItemsApi.oneLegacy', 'Unused'] });
  });

  it('counts a name a template in its own file binds as written', () => {
    expect(built({}, '<button (click)="bound(item)">Go</button>').unreferenced).toEqual(['ItemsApi.oneLegacy', 'Unused']);
  });

  it('marks nothing in a repository that publishes an entry for others to import', () => {
    expect(built({ main: 'dist/index.js' })).toEqual({ marked: 0, unreferenced: [] });
  });
});

describe('a graph of another schema version (P370)', () => {
  it('says an older graph is rebuilt and a newer one needs a newer flowatlas', () => {
    expect(schemaMismatchSaid(SCHEMA_VERSION - 1).message).toContain('built by an older flowatlas');
    expect(schemaMismatchSaid(SCHEMA_VERSION - 1).hint).toContain('flowatlas build');
    expect(schemaMismatchSaid(SCHEMA_VERSION + 1).message).toContain('built by a newer flowatlas');
    expect(schemaMismatchSaid(SCHEMA_VERSION + 1).hint).toContain('Update flowatlas');
    expect(schemaMismatchSaid('x').message).toContain('no schema version');
  });
});
