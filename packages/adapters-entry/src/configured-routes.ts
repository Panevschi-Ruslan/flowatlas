import type {
  EntryAdapter,
  EntryHttpConfig,
  EntryNode,
  ExtractContext,
  PackageJson,
} from '@flowatlas/core';
import { hasAnyDependency } from '@flowatlas/core';
import { callRoutesAdapter } from './call-routes.js';
import { dialectOf } from './route-dialects.js';

export const CONFIGURED_ROUTES = 'entry-http-custom';

/**
 * Whether one description is about this repository.
 *
 * One configuration covers every repository of a project, and a description
 * written for one service says so by naming its packages. Where it names none
 * it is tried everywhere, which is what a project with a framework of its own
 * and no package to point at needs.
 */
const appliesHere = (description: EntryHttpConfig, pkg: PackageJson): boolean =>
  description.packages.length === 0 || hasAnyDependency(pkg, description.packages);

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
 * Detection is a description's own answer. An entry adapter is offered the
 * configuration alongside the manifest, so this one reads the descriptions and
 * recognises a repository when one of them is about it — which is the same
 * question, asked with the same code, that decides whether a description is
 * tried once the reading has started. Answering `true` unconditionally was the
 * alternative and is why this recognised nothing for a while: it would have put
 * this adapter's name on the repository node of every repository this tool has
 * ever read, including the ones whose project has described nothing at all.
 *
 * A description that names no packages is tried everywhere by the same rule,
 * and so turns this adapter on in every repository of that project. That is not
 * the failure above but the description saying what it says: a project whose
 * own framework has no package to point at is a project where this reader
 * really does run everywhere.
 */
export const configuredRoutesAdapter: EntryAdapter = {
  name: CONFIGURED_ROUTES,
  // The same as every other call-registered framework: these answer before the
  // application the extractor reads is asked anything, so its guards and pipes
  // never run for them and none are drawn.
  outsideApplication: true,
  detect: (pkg, config) =>
    (config?.adapters.entry.http ?? []).some((description) => appliesHere(description, pkg)),
  extractEntries: (ctx: ExtractContext): EntryNode[] => {
    const entries: EntryNode[] = [];

    for (const description of ctx.config.adapters.entry.http) {
      // The same question detection asked, and it is asked again because the
      // answer is not the same for every description: detection is on when any
      // one of them is about this repository, and the rest still have to be
      // told apart from it here.
      if (!appliesHere(description, ctx.pkg)) {
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
