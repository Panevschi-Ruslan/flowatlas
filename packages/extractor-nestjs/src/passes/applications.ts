import { recordApplications } from '@flowatlas/core';
import {
  applicationFindings,
  applicationMembership,
  readApplicationRoots,
} from '../applications.js';
import { definePass } from './types.js';

/**
 * Works out which applications this service creates and which of them mounts
 * what, and leaves the answer where the entry adapters read it.
 *
 * After the module pass, because membership is the module pass's answer and
 * reading the modules a second time here would be a second opinion about the
 * same source. Before the entries pass, because that is what mints the ids.
 *
 * The answer goes onto `meta`, the record the extractor hands the adapters, for
 * the reason the global prefix and the versioning already go there: an adapter
 * for one framework may not import the reader for it. Nothing reads it before
 * this pass has run.
 *
 * Written through the same `recordApplications` every other reader uses, so
 * that which map a service holds is decided in one place. Where no application
 * root was read, what was read is no map at all, and the entry adapters are
 * asked instead: a repository whose applications are directories holds the map
 * that says so, and a request its files make can be placed in one (R136).
 */
export const applicationsPass = definePass('applications', (ctx) => {
  const { roots, unread } = readApplicationRoots({
    project: ctx.project,
    rootDir: ctx.repoDir,
  });
  for (const row of applicationFindings(unread)) ctx.report(row);

  recordApplications(ctx, applicationMembership(roots, ctx.modules, ctx.classes));
});
