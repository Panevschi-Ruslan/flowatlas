import type {
  EntryAdapter,
  EntryNode,
  EntryProcedureConfig,
  ExtractContext,
  PackageJson,
} from '@flowatlas/core';
import { hasAnyDependency } from '@flowatlas/core';
import { procedureDialectOf } from './procedure-dialects.js';
import { procedureRoutersAdapter } from './procedure-routers.js';

export const CONFIGURED_PROCEDURES = 'entry-procedures-custom';

/**
 * Whether one description is about this repository.
 *
 * The same question, asked the same way, as for a described HTTP framework: one
 * configuration covers every repository of a project, and a description written
 * for one service says so by naming its packages. Where it names none it is tried
 * everywhere, which is what a project whose procedure builder is its own and has
 * no package to point at needs.
 */
const appliesHere = (description: EntryProcedureConfig, pkg: PackageJson): boolean =>
  description.packages.length === 0 || hasAnyDependency(pkg, description.packages);

/**
 * Trees of procedures assembled by something nobody shipped a reader for.
 *
 * The fourth description this tool accepts instead of code, and it exists for the
 * same reason the third does: what ships is one framework of this family, and the
 * family has more than one member. A project on a different one is a row in
 * `adapters.entry.procedures` and is read by exactly the code that reads the
 * shipped row — there is no second path, so a description that reads a repository
 * correctly here reads it correctly there.
 *
 * It is also what keeps the schema honest. A description nothing but the tool's
 * own row ever went through would be a shape only the tool had ever tested, and
 * the first person to copy that row into their configuration would find out which
 * half of it the reader actually uses.
 *
 * Detection is a description's own answer, as it is next door: an entry adapter is
 * offered the configuration alongside the manifest, so this reads the descriptions
 * and recognises a repository when one of them is about it — the same question,
 * asked with the same code, that decides whether a description is tried once the
 * reading has started. Answering `true` unconditionally would put this adapter's
 * name on the repository node of every repository this tool has ever read.
 */
export const configuredProceduresAdapter: EntryAdapter = {
  name: CONFIGURED_PROCEDURES,
  // The same as the shipped reader: a tree is served by a handler built out of it,
  // so the application the extractor reads never asks anything of it and none of
  // its guards are drawn. What does stand in front of a procedure is on the chain.
  outsideApplication: true,
  detect: (pkg, config) =>
    (config?.adapters.entry.procedures ?? []).some((description) =>
      appliesHere(description, pkg),
    ),
  extractEntries: (ctx: ExtractContext): EntryNode[] => {
    const entries: EntryNode[] = [];

    for (const description of ctx.config.adapters.entry.procedures) {
      // The same question detection asked, and asked again because the answer is
      // not the same for every description: detection is on when any one of them
      // is about this repository, and the rest still have to be told apart from it
      // here.
      if (!appliesHere(description, ctx.pkg)) {
        ctx.builder.addUnresolved({
          file: 'package.json',
          line: 1,
          reason: 'entry-procedures-description-inactive',
          level: 'info',
          message: `The ${description.name} description was not tried here: nothing in this repository depends on ${description.packages.join(' or ')}.`,
          hint: 'That is ordinary in a project of several repositories. If this is the one it was written for, check the spelling of its packages.',
          symbol: description.name,
          adapter: CONFIGURED_PROCEDURES,
        });
        continue;
      }
      const read = procedureRoutersAdapter(procedureDialectOf(description), {
        reportSilence: true,
      }).extractEntries(ctx);
      // Every entry of this adapter is reported under its one name, so without
      // this a project describing two such frameworks could not tell which of its
      // descriptions read a way in.
      for (const entry of read) {
        entries.push({ ...entry, meta: { ...entry.meta, description: description.name } });
      }
    }

    return entries;
  },
};
