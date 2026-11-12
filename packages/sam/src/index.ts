import { statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { toPosixPath, type Deployment, type DeploymentReadOptions, type DeploymentReader } from '@flowatlas/core';
import { emptyParts } from '@flowatlas/serverless';
import { importsAny, repositoryExports } from './exports.js';
import { cloudFormationFiles, templateCopies, templateFiles } from './files.js';
import { readTemplate } from './template.js';

export { readToml, TomlUnreadable } from './toml.js';
export { deployConfigOf, parameterOverrides, CONFIG_FILES, TEMPLATE_FILES, type DeployConfig } from './config.js';
export { Resolver, expandLoops } from './intrinsics.js';
export { SAM_KINDS, SAM_TRANSFORM, readTemplate, transformsOf, type Dialect, type ExportSink } from './template.js';
export { withGlobals } from './functions.js';
export { cloudFormationFiles, isTemplateDocument, templateCopies, templateFiles } from './files.js';
export { repositoryExports, type Imports } from './exports.js';

/** Every template of a repository, SAM and plain: what one stack's `Fn::ImportValue` of another's export is read across. */
const allTemplates = (repoDir: string): string[] => [...new Set([...templateFiles(repoDir), ...cloudFormationFiles(repoDir)])].sort();

const changedAt = (path: string): number | undefined => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
};

const stampOf = (paths: readonly string[]): string => paths.map((path) => `${path}@${changedAt(path) ?? '-'}`).join('|');

interface Reading {
  readonly deployment: Deployment;
  readonly stamp: string;
  /** Absolute paths of the files read beside the templates: configuration, nested templates, definitions, bodies. */
  readonly loaded: readonly string[];
  readonly loadedStamp: string;
}

/**
 * A reader of the SAM templates of a repository, or of its plain ones, and of
 * the copies a package command wrote of them, each a note. Its last reading
 * of each repository, by what it is read with, is taken again only once a
 * template of the repository - its own, or one whose exports its own import -
 * or a file read beside one has changed, as the other readers keep theirs
 * (R176).
 */
const templateReader = (name: string, sam: boolean): DeploymentReader => {
  const filesOf = sam ? templateFiles : cloudFormationFiles;
  const readings = new Map<string, Reading>();
  const readingOf = (options: DeploymentReadOptions): Reading => {
    const { repoDir } = options;
    const files = filesOf(repoDir);
    const all = allTemplates(repoDir);
    const copies = templateCopies(repoDir, sam);
    const given = options.service?.infra?.options ?? {};
    const vars = options.service?.infra?.vars ?? [];
    const key = `${repoDir}\0${JSON.stringify(given)}\0${JSON.stringify(vars)}`;
    const stamp = `${files.join('|')}\0${copies.map((copy) => copy.file).join('|')}\0${stampOf(all.map((file) => join(repoDir, file)))}`;
    const kept = readings.get(key);
    if (kept !== undefined && kept.stamp === stamp && stampOf(kept.loaded) === kept.loadedStamp) return kept;
    const parts = emptyParts();
    const loaded = new Set<string>();
    const imports = repositoryExports(repoDir, all, given, vars);
    for (const file of files) readTemplate(parts, { repoDir, file, options: given, loaded, imports, vars, templates: all });
    for (const copy of copies) {
      parts.rows.push({
        file: copy.file,
        line: 1,
        symbol: copy.file,
        reason: 'deployment-copy-not-read',
        level: 'info',
        message: `${copy.file} declares what ${copy.of} does, with uploads where ${copy.of} names files of the repository: it is the copy a package command writes, and is read once, as ${copy.of}`,
        hint: 'Nothing to fix. Keep the packaged copy out of the repository, and this note goes too.',
      });
    }
    const sorted = [...loaded].sort();
    const reading: Reading = { deployment: parts, stamp, loaded: sorted, loadedStamp: stampOf(sorted) };
    readings.set(key, reading);
    return reading;
  };
  return {
    name,
    declares: (repoDir) => filesOf(repoDir).length > 0,
    read: (options) => readingOf(options).deployment,
    files: (repoDir, options) => {
      const files = filesOf(repoDir);
      if (files.length === 0) return [];
      const { loaded } = readingOf({ repoDir, config: options?.config as DeploymentReadOptions['config'], ...(options?.service === undefined ? {} : { service: options.service }) });
      // A template whose exports these import is read with them, so a change to it is a change to this reading.
      const exporters = importsAny(repoDir, files) ? allTemplates(repoDir) : [];
      return [...new Set([...files, ...exporters, ...loaded.map((path) => toPosixPath(relative(repoDir, path)))])].sort();
    },
  };
};

/**
 * AWS SAM, read from the templates alone (P246).
 *
 * Nothing here runs `sam build`, `sam validate` or the transform, or asks the
 * account: a template is read as written, with what `samconfig.toml` and the
 * service's options give its parameters, and what only a deployment would
 * know - a name the platform generates, a value from another stack, a branch
 * under a condition nothing settles - is a stand-in or a row that says so.
 */
export const samReader: DeploymentReader = templateReader('sam', true);

/**
 * Plain CloudFormation templates, read the same way (P248).
 *
 * A template with no SAM transform is a SAM template with none of its types:
 * the functions, mappings, APIs written as resources, rules, subscriptions,
 * notifications and state machines are read by the same code, so it is a
 * second reader of the same package rather than a package of its own. It
 * has its own name, because `meta.deployedBy` says which tool a deployment is
 * written for, and its own way of finding files: a template of this kind may
 * be called anything and kept anywhere.
 */
export const cloudFormationReader: DeploymentReader = templateReader('cloudformation', false);
