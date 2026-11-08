import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyParts, Unread, type Exported } from '@flowatlas/serverless';
import { parameterKey } from '@flowatlas/core';
import { readTemplate, type ExportSink } from './template.js';

/**
 * What the templates of one repository export to one another (P248).
 *
 * A stack hands a value to another by an output with `Export.Name`, which the
 * other reads with `Fn::ImportValue`: the queue one stack declares, the table
 * whose stream another maps, the topic a third subscribes to. Where both
 * templates are in the repository the import is the exported value, read as
 * statically as a `Ref` within one template; where the export is declared by
 * none, or by two, the import stays the row it was. A parameter of the account
 * one template writes (`AWS::SSM::Parameter`) and another resolves
 * (`{{resolve:ssm:...}}`, a parameter typed `AWS::SSM::Parameter::Value`) is
 * read across the same way, by its name (P253).
 *
 * Every template is read for its exports with the exports known so far, until
 * a reading adds nothing - so an export whose value is itself imported is
 * settled too, however the templates are ordered - and the readers then read
 * each template once with what this gives.
 */

/**
 * What an export of the repository is, by its key (`export:<name>`,
 * `parameter:<name>`); `undefined` where no template declares it.
 */
export type Imports = (key: string) => Exported | Unread | undefined;

/** A key as a person reads it. */
const describeKey = (key: string): string =>
  key.startsWith('parameter:') ? `the parameter ${key.slice('parameter:'.length)}` : `the export ${key.slice(key.indexOf(':') + 1)}`;

/** One value per export name: the value, or why it is not one. */
const settled = (sink: ExportSink): Map<string, Exported | Unread> => {
  const out = new Map<string, Exported | Unread>();
  for (const [key, declared] of sink) {
    const files = [...new Set(declared.map((item) => item.file))];
    out.set(
      key,
      declared.length === 1 && declared[0] !== undefined
        ? declared[0].exported
        : new Unread(`${describeKey(key)} is declared ${files.length === 1 ? `twice in ${files[0] ?? 'one template'}` : `by ${files.length} templates (${files.join(', ')})`}, and a stack can import only one`),
    );
  }
  return out;
};

const same = (left: ReadonlyMap<string, unknown>, right: ReadonlyMap<string, unknown>): boolean => JSON.stringify([...left]) === JSON.stringify([...right]);

/** Whether any of the templates imports anything: only then are the exports worth reading. */
export const importsAny = (repoDir: string, files: readonly string[]): boolean =>
  files.some((file) => {
    try {
      const text = readFileSync(join(repoDir, file), 'utf8');
      return text.includes('ImportValue') || text.includes('{{resolve:ssm:') || text.includes('AWS::SSM::Parameter::Value');
    } catch {
      return false;
    }
  });

/** Every export of the repository's templates, read with the options the deployment is read with. */
export const repositoryExports = (repoDir: string, files: readonly string[], options: Readonly<Record<string, string>>, vars: readonly string[] = []): Imports => {
  let known = new Map<string, Exported | Unread>();
  if (importsAny(repoDir, files)) {
    // One more pass than there are templates: a chain of imports through every one of them is settled.
    for (let pass = 0; pass <= files.length; pass += 1) {
      const sink: ExportSink = new Map();
      const current = known;
      for (const file of files) readTemplate(emptyParts(), { repoDir, file, options, loaded: new Set(), imports: (key) => current.get(key), exports: sink, vars, templates: files });
      const next = settled(sink);
      if (same(next, known)) break;
      known = next;
    }
  }
  const exports = known;
  return (name) => exports.get(name);
};
