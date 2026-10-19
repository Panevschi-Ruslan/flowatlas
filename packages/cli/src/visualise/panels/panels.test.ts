import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAGE_PARTS } from '../../commands/visualise.js';
import { bootPage, PANELS } from './boot.js';
import { createPageContext } from './context.js';
import { installDocument } from './test-dom.js';
import { pageMarkup, testPack } from './test-page.js';

/**
 * What every panel module promises (P103): one factory and nothing else at its
 * top level, since every part shares the page's one script; imports only of
 * the logic modules, since a panel reaches another through the page it is
 * handed; and exactly the names its `.d.ts` says it returns.
 */
const HERE = new URL('./', import.meta.url);
const read = (file: string): string => readFileSync(new URL(file, HERE), 'utf8');
const modules = readdirSync(HERE).filter((file) => file.endsWith('.js'));

/** The names a panel's `.d.ts` says its factory returns. */
const declared = (file: string): string[] => {
  const text = read(file.replace(/\.js$/, '.d.ts'));
  const union = /Panel<([^>]*)>/.exec(text);
  return union === null ? [] : [...union[1]!.matchAll(/'([^']+)'/g)].map(([, name]) => name!);
};

describe('the panel modules', () => {
  it('declare nothing at their top level but what they export', () => {
    for (const file of modules) {
      const loose = read(file).split('\n').filter((line) => /^(?:const|let|var|function|class|async)\b/.test(line));
      expect(loose, file).toEqual([]);
      const exported = [...read(file).matchAll(/^export (?:function|const) (\w+)/gm)].map(([, name]) => name);
      expect(exported.length, file).toBeGreaterThan(0);
    }
  });

  it('import the logic modules only, never one another, except the boot that lists them', () => {
    for (const file of modules.filter((name) => name !== 'boot.js')) {
      const from = [...read(file).matchAll(/^import [^;]* from '([^']+)';$/gm)].map(([, path]) => path!);
      expect(from.filter((path) => path.startsWith('./')), file).toEqual([]);
    }
  });

  it('are written into the page in the order the boot calls them', () => {
    const factoryOf = (file: string): string => /^export function (\w+)/m.exec(read(file.slice('panels/'.length)))![1]!;
    const written = PAGE_PARTS.map(([, file]) => file)
      .filter((file) => file.startsWith('panels/') && file !== 'panels/context.js' && file !== 'panels/boot.js');
    expect(written.map(factoryOf)).toEqual(PANELS.map((create) => create.name));
    // Every module here is written in, and every panel the page names is here.
    const parts = PAGE_PARTS.map(([, file]) => file).filter((file) => file.startsWith('panels/'));
    expect(parts.map((file) => file.slice('panels/'.length)).sort()).toEqual([...modules].sort());
  });

  it('each return what their .d.ts says, and no name twice', () => {
    installDocument(pageMarkup());
    const page = createPageContext(testPack('panels'));
    const given = new Map<string, string>(Object.keys(page).map((name) => [name, 'context']));
    for (const create of PANELS) {
      const returned = create(page);
      const file = modules.find((name) => new RegExp(`^export function ${create.name}\\b`, 'm').test(read(name)))!;
      expect(Object.keys(returned).sort(), file).toEqual(declared(file).sort());
      for (const name of Object.keys(returned)) {
        expect(given.get(name), `${name} from ${file}`).toBeUndefined();
        given.set(name, file);
      }
      Object.assign(page, returned);
    }
  });

  it('boot into the page, each panel set up and then the first view', () => {
    installDocument(pageMarkup());
    const page = bootPage(testPack('boot'));
    expect(page.store.get('view')).toBe('map');
    expect(typeof page.showView).toBe('function');
  });
});
