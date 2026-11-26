import { NotLiteral } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { COMPONENT_LIBRARIES, installedPlugins, libraryOf, type LibrarySettings } from './registrations.js';

/** The libraries a repository installs, by name, and what may register a tag beside them. */
const installed = (dependencies: Record<string, string>, settings: LibrarySettings) => {
  const plugins = installedPlugins({ dependencies }, [], '/repo', settings);
  return { names: (tag: string) => libraryOf(tag, plugins.libraries)?.name, unknown: plugins.unknown };
};

const NONE: LibrarySettings = { modules: [], configs: [] };

describe('the prefix a library is set to, and a library a Nuxt module installs (P262)', () => {
  it("knows Nuxt UI by `U`, and PrimeVue's names without a prefix until one is set", () => {
    const { names } = installed({ '@nuxt/ui': '^3.0.0', primevue: '^4.0.0' }, NONE);
    expect(names('UButton')).toBe('Nuxt UI');
    expect(names('DataTable')).toBe('PrimeVue');
    expect(names('PrimeDataTable')).toBeUndefined();
  });

  it("reads the prefix the framework's configuration sets, the application's over a layer's", () => {
    const { names } = installed(
      { '@nuxt/ui': '^3.0.0', '@primevue/nuxt-module': '^4.0.0' },
      {
        modules: [],
        configs: [
          { value: { ui: { prefix: 'Nu' } }, file: '/repo/nuxt.config.ts' },
          { value: { primevue: { components: { prefix: 'Prime' } }, ui: { prefix: 'Layer' } }, file: '/brand/nuxt.config.ts' },
        ],
      },
    );
    expect(names('NuButton')).toBe('Nuxt UI');
    expect(names('UButton')).toBeUndefined();
    expect(names('PrimeDataTable')).toBe('PrimeVue');
    expect(names('DataTable')).toBeUndefined();
  });

  it("reads the prefix a resolver or a plugin of the bundler's configuration is handed, by its name or by the module it comes from", () => {
    const bundler = {
      file: '/repo/vite.config.ts',
      text: [
        "import ui from '@nuxt/ui/vite';",
        "import { PrimeVueResolver } from '@primevue/auto-import-resolver';",
        "export default defineConfig({ plugins: [ui({ prefix: 'Kit' }), Components({ resolvers: [PrimeVueResolver({ components: { prefix: 'P' } })] })] });",
      ].join('\n'),
    };
    const { names } = installed({ '@nuxt/ui': '^3.0.0', primevue: '^4.0.0' }, { modules: [], configs: [], bundler });
    expect(names('KitButton')).toBe('Nuxt UI');
    expect(names('PButton')).toBe('PrimeVue');
  });

  it('takes a library a Nuxt module installs that the manifest does not declare, and names a prefix written as code where a tag names nothing', () => {
    const { names, unknown } = installed(
      {},
      { modules: ['@primevue/nuxt-module', '@nuxt/ui'], configs: [{ value: { ui: { prefix: new NotLiteral('process.env.UI_PREFIX') } }, file: '/repo/nuxt.config.ts' }] },
    );
    expect(names('Button')).toBe('PrimeVue');
    expect(names('UButton')).toBeUndefined();
    expect(unknown).toEqual([{ written: 'ui.prefix', file: 'nuxt.config.ts', line: 1 }]);
  });

  it('keeps the table to libraries whose names their package fixes', () => {
    expect(COMPONENT_LIBRARIES.map((library) => library.name)).toEqual(['Vuetify', 'PrimeVue', 'Element Plus', 'Naive UI', 'Quasar', 'Ant Design Vue', 'Nuxt UI']);
  });
});
