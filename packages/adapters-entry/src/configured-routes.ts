import type { EntryAdapter, EntryNode, ExtractContext } from '@flowatlas/core';
import { hasAnyDependency } from '@flowatlas/core';
import { callRoutesAdapter } from './call-routes.js';
import { dialectOf } from './route-dialects.js';

export const CONFIGURED_ROUTES = 'entry-http-custom';

/**
 * Routes declared by a framework nobody shipped an adapter for.
 *
 * The third of the three descriptions this tool accepts instead of code, and
 * the one that was held back longest on purpose. A message bus and a table of
 * handlers were describable from one implementation each; HTTP is the kind with
 * the most frameworks and the most variation in them, and a description
 * generalised from one framework would have fitted that framework. This one was
 * written after four call-registered readers existed and is the shape all four
 * of them are now written in, so a fifth is a row in `adapters.entry.http` and
 * is read by exactly the code that reads them.
 *
 * Detection is the one thing a description cannot do for itself. An adapter is
 * offered the repository's manifest and nothing else, so this one cannot know
 * whether the project has described anything until it is already running; it
 * therefore recognises nothing, and a project with a description turns it on
 * with `adapters.force.entry`. That is a fact about the adapter interface
 * rather than about any framework, and it is written here rather than worked
 * around because working around it would mean this adapter appearing in the
 * report of every repository this tool has ever read.
 */
export const configuredRoutesAdapter: EntryAdapter = {
  name: CONFIGURED_ROUTES,
  // The same as every other call-registered framework: these answer before the
  // application the extractor reads is asked anything, so its guards and pipes
  // never run for them and none are drawn.
  outsideApplication: true,
  detect: () => false,
  extractEntries: (ctx: ExtractContext): EntryNode[] => {
    const entries: EntryNode[] = [];

    for (const description of ctx.config.adapters.entry.http) {
      // One configuration covers every repository of a project, and a
      // description written for one service says so by naming its packages.
      // Where it names none it is tried everywhere, which is what a project
      // with a framework of its own and no package to point at needs.
      if (
        description.packages.length > 0 &&
        !hasAnyDependency(ctx.pkg, description.packages)
      ) {
        ctx.builder.addUnresolved({
          file: 'package.json',
          line: 1,
          reason: 'entry-http-description-inactive',
          level: 'info',
          message: `The ${description.name} description was not tried here: nothing in this repository depends on ${description.packages.join(' or ')}.`,
          hint: 'That is ordinary in a project of several repositories. If this is the one it was written for, check the spelling of its packages.',
          symbol: description.name,
          adapter: CONFIGURED_ROUTES,
        });
        continue;
      }
      const read = callRoutesAdapter(dialectOf(description), {
        reportSilence: true,
      }).extractEntries(ctx);
      // Every entry of this adapter is reported under its one name, so without
      // this a project describing two frameworks could not tell which of its
      // descriptions read a route — and which one to correct when a route is
      // at the wrong address.
      for (const entry of read) {
        entries.push({ ...entry, meta: { ...entry.meta, description: description.name } });
      }
    }

    return entries;
  },
};
