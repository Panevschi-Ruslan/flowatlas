import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { toPosixPath } from '@flowatlas/core';
import { isRecord, readServiceFile, serverlessReader, serviceFiles, textOf } from '@flowatlas/serverless';
import { CONFIG_FILES, deployConfigOf, TEMPLATE_FILES } from './config.js';
import { JINJA_TEMPLATE, jinjaFileRole } from './deployers.js';
import { localPath } from './reading.js';
import { nestedFilesOf, SAM_TRANSFORM } from './template.js';

/**
 * Which files of a repository are templates (P246, P248).
 *
 * A template has no name of its own: it is any YAML or JSON file (or
 * `.template`) that says it is one - a format version, or a `Resources` map of
 * AWS types - wherever it is kept, and it is a SAM template where it names the
 * transform. The file a directory's `samconfig` names, or the CLI's
 * `template.yaml`, is one too. Left out of both: installs and build output; a
 * template another nests, which is read as part of it; the copy `sam package`
 * or `aws cloudformation package` writes of one, with its local paths swapped
 * for uploads; the files a Serverless Framework service loads into its own
 * `resources`, which are the Serverless reader's; and a `cdk.out` beside the
 * `cdk.json` of an app the CDK reader reads.
 */

/** Directories that never hold a template of a repository's own: installs, build output, the tools' own. */
const NOT_TEMPLATES = new Set(['node_modules', 'dist', 'build', 'coverage', 'cdk.out', '__snapshots__']);

/** How far below the repository a template is looked for: `services/orders/template.yaml` is two. */
const MOST_DEPTH = 4;

/** A file larger than this is generated, not written: it is not opened to see whether it is a template. */
const MOST_BYTES = 1024 * 1024;

/** What a template's file name ends in: a Jinja template sceptre renders (`.j2`) too (P261). */
const TEMPLATE_EXTENSIONS = /\.(?:ya?ml|json|template|j2)$/;

/** Whether a file is in a sceptre project's `templates/`: a directory of that name beside a `config/`. */
const inSceptreProject = (repoDir: string, file: string): boolean => {
  const parts = file.split('/');
  return parts.some((part, at) => part === 'templates' && existsSync(join(repoDir, ...parts.slice(0, at), 'config')));
};

/** Files of those endings that are something else by their name. */
const NOT_TEMPLATE_NAMES = /^(?:package(?:-lock)?\.json|tsconfig.*\.json|samconfig\.ya?ml|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/;

/** Whether a parsed document is a CloudFormation template: it says its format version, or it declares resources of AWS types. */
export const isTemplateDocument = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value['AWSTemplateFormatVersion'] !== undefined) return true;
  const resources = value['Resources'];
  return isRecord(resources) && Object.values(resources).some((resource) => isRecord(resource) && typeof resource['Type'] === 'string' && resource['Type'].startsWith('AWS::'));
};

/** A template the walk found. */
interface Found {
  /** Repo-relative path. */
  readonly file: string;
  readonly document: Record<string, unknown>;
  /** Written for the SAM transform. */
  readonly sam: boolean;
}

/** The text of a file, `undefined` where it cannot be read or is too large to be one written by hand. */
const textAt = (path: string): string | undefined => {
  try {
    return statSync(path).size > MOST_BYTES ? undefined : readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** A file as a template, `undefined` where it is not one. Cheap first: only a text that could be one is parsed. */
const templateAt = (repoDir: string, file: string): Found | undefined => {
  const path = join(repoDir, file);
  const text = textAt(path);
  if (text === undefined) return undefined;
  const declares = text.includes('AWSTemplateFormatVersion') || (text.includes('Resources') && text.includes('AWS::'));
  // A Jinja template is one only in a sceptre project, which renders it; what it declares is read once it is rendered.
  // One a stack names is one whatever its own text holds (it may extend another), and one another includes,
  // imports or extends and no stack names is a part of those (P273).
  if (JINJA_TEMPLATE.test(file)) {
    if (!inSceptreProject(repoDir, file)) return undefined;
    const role = jinjaFileRole(repoDir, file);
    return role === 'template' || (role !== 'part' && declares) ? { file, document: {}, sam: text.includes(SAM_TRANSFORM) } : undefined;
  }
  if (!declares) return undefined;
  let value: unknown;
  try {
    value = readServiceFile(path).value;
  } catch {
    // A template that does not parse is read as one where the CLI would deploy it, and its row says why; anything else says nothing.
    return TEMPLATE_FILES.includes(posix.basename(file)) && text.includes(SAM_TRANSFORM) ? { file, document: {}, sam: true } : undefined;
  }
  // A template that names the transform is one, however little it declares yet.
  const sam = isRecord(value) && JSON.stringify(value['Transform'] ?? null).includes(SAM_TRANSFORM);
  return sam || isTemplateDocument(value) ? { file, document: value as Record<string, unknown>, sam } : undefined;
};

/** Every template file of a repository, and the templates each directory's `samconfig` names. */
const walk = (repoDir: string): Found[] => {
  const found = new Map<string, Found>();
  const step = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const rel = toPosixPath(relative(repoDir, dir)) || '.';
    const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
    const named = names.some((name) => CONFIG_FILES.includes(name)) ? deployConfigOf(repoDir, rel, {}).template : undefined;
    const configured = named === undefined ? undefined : localPath(rel, named);
    for (const file of [...(configured === undefined ? [] : [configured]), ...names.filter((name) => TEMPLATE_EXTENSIONS.test(name) && !NOT_TEMPLATE_NAMES.test(name)).map((name) => (rel === '.' ? name : `${rel}/${name}`))]) {
      if (found.has(file)) continue;
      const template = templateAt(repoDir, file);
      if (template !== undefined) found.set(file, template);
    }
    if (depth >= MOST_DEPTH) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      // A `cdk.out` beside its app's `cdk.json` is what the CDK reader reads from the app itself.
      if (NOT_TEMPLATES.has(entry.name) && !(entry.name === 'cdk.out' && !existsSync(join(dir, 'cdk.json')))) continue;
      step(join(dir, entry.name), depth + 1);
    }
  };
  step(repoDir, 0);
  return [...found.values()].sort((a, b) => (a.file < b.file ? -1 : 1));
};

/** The properties that point at a local path a package command uploads, by resource type. */
const PACKAGED: ReadonlyMap<string, readonly string[]> = new Map([
  ['AWS::Serverless::Function', ['CodeUri']],
  ['AWS::Serverless::Api', ['DefinitionUri']],
  ['AWS::Serverless::HttpApi', ['DefinitionUri']],
  ['AWS::Serverless::StateMachine', ['DefinitionUri']],
  ['AWS::Serverless::LayerVersion', ['ContentUri']],
  ['AWS::Serverless::Application', ['Location']],
  ['AWS::Lambda::Function', ['Code']],
  ['AWS::Lambda::LayerVersion', ['Content']],
  ['AWS::ApiGateway::RestApi', ['BodyS3Location']],
  ['AWS::ApiGatewayV2::Api', ['BodyS3Location']],
  ['AWS::StepFunctions::StateMachine', ['DefinitionS3Location']],
  ['AWS::CloudFormation::Stack', ['TemplateURL']],
]);

const resourcesOf = (found: Found): Record<string, unknown> => (isRecord(found.document['Resources']) ? found.document['Resources'] : {});

/** What a template declares, by logical id and type: the same in a template and the copy a package command writes of it. */
const signatureOf = (found: Found): string =>
  Object.entries(resourcesOf(found))
    .map(([id, resource]) => `${id}:${isRecord(resource) ? String(resource['Type']) : ''}`)
    .sort()
    .join('|');

/** Whether a template points at local paths for what it deploys, where a package command's copy points at uploads. */
const pointsAtLocalPaths = (found: Found): boolean => {
  const globals = isRecord(found.document['Globals']) && isRecord(found.document['Globals']['Function']) ? found.document['Globals']['Function'] : {};
  return Object.values(resourcesOf(found)).some((resource) => {
    if (!isRecord(resource)) return false;
    const type = String(resource['Type']);
    const properties = isRecord(resource['Properties']) ? resource['Properties'] : {};
    return (PACKAGED.get(type) ?? []).some((key) => {
      // A SAM function's code is in `Globals`, or in the template's own directory, where it names none.
      const written = properties[key] ?? (type === 'AWS::Serverless::Function' && properties['InlineCode'] === undefined ? (globals['CodeUri'] ?? '.') : undefined);
      const text = textOf(written);
      return text !== undefined && !/^(s3|https?):/.test(text);
    });
  });
};

/**
 * The templates a repository deploys from: none another nests, none a copy
 * of another written by a package command (the same resources, with uploads
 * where the other has local paths), none a Serverless service loads.
 */
const deployedTemplates = (repoDir: string): { readonly roots: Found[]; readonly copies: Array<Found & { readonly of: string }> } => {
  const all = walk(repoDir);
  const nested = new Set<string>();
  for (const found of all) for (const child of nestedFilesOf(found.document, posix.dirname(found.file))) if (child !== found.file) nested.add(child);
  const sources = new Map<string, string>();
  for (const found of all) if (pointsAtLocalPaths(found) && !sources.has(signatureOf(found))) sources.set(signatureOf(found), found.file);
  const copies = all.flatMap((found) => {
    const of = pointsAtLocalPaths(found) ? undefined : sources.get(signatureOf(found));
    return of === undefined ? [] : [{ ...found, of }];
  });
  const copied = new Set(copies.map((found) => found.file));
  // What a service of the framework loads with `${file(...)}` is its own, and read with it.
  const serverless = serviceFiles(repoDir).length === 0 ? new Set<string>() : new Set(serverlessReader.files(repoDir));
  const kept = all.filter((found) => !copied.has(found.file) && !serverless.has(found.file));
  const roots = kept.filter((found) => !nested.has(found.file));
  // Templates that only nest one another have no root: the first is read as one.
  return { roots: roots.length === 0 ? kept.slice(0, 1) : roots, copies };
};

/** Every SAM template of a repository, repo-relative and sorted. */
export const templateFiles = (repoDir: string): string[] => deployedTemplates(repoDir).roots.filter((found) => found.sam).map((found) => found.file);

/** Every plain CloudFormation template of a repository (P248), repo-relative and sorted: one that names no SAM transform. */
export const cloudFormationFiles = (repoDir: string): string[] => deployedTemplates(repoDir).roots.filter((found) => !found.sam).map((found) => found.file);

/** The copies a package command wrote of a repository's templates, SAM or plain, each with the template it copies. */
export const templateCopies = (repoDir: string, sam: boolean): Array<{ readonly file: string; readonly of: string }> =>
  deployedTemplates(repoDir)
    .copies.filter((found) => found.sam === sam)
    .map(({ file, of }) => ({ file, of }));
