import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project, SourceFile } from 'ts-morph';
import { implicitImportsFor } from './conventions.js';
import { nameMadeUpFile, toPosixPath } from './ids.js';

/**
 * Code written inside a file of another format (P233): a component file whose
 * script blocks are TypeScript between markup the compiler cannot read.
 *
 * Each such file is given to the checker as a file of its own beside it,
 * `<name><ending>.ts`, holding the file's text with everything outside its
 * scripts turned to spaces. Nothing moves: every line and column of the
 * script is where it is in the file it came from, so a position the readers
 * record needs no map, only the file's name, which `normalizeFilePath` gives
 * back (`nameMadeUpFile`). An import of `./X<ending>` resolves to the file
 * made up for it, because the compiler tries `.ts` after the name it is
 * given, so a component's functions are followed into it like any module's.
 *
 * Which formats there are, and where their scripts are, is the reader's to
 * say: this names no format.
 */
export interface EmbeddedFormat {
  /** The ending of the files that hold scripts, with its dot. */
  readonly extension: string;
  /** Where one file's scripts are, by offsets into its text, and what follows its own lines. */
  readonly scripts: (text: string, file: string) => EmbeddedScripts | undefined;
}

export interface EmbeddedScripts {
  /** `[start, end)` of each script's text. */
  readonly ranges: ReadonlyArray<readonly [number, number]>;
  /** The scripts hold markup of their own (`.tsx`). */
  readonly markup?: boolean;
  /** Code the reader adds after the file's last line, where no position of the file is. */
  readonly tail?: string;
  /**
   * Names the file's markup uses outside its scripts: a handler a template
   * names. A name a framework imports with no import line (P240) is imported
   * for the script when only the markup uses it.
   */
  readonly uses?: readonly string[];
}

/** One file made up for the checker, and the one it stands for. */
export interface EmbeddedFile {
  readonly sourceFile: SourceFile;
  /** Repo-relative POSIX path of the file it was made from. */
  readonly file: string;
  readonly format: EmbeddedFormat;
  /** The text of the file it was made from, for a reader of its other parts. */
  readonly text: string;
}

/**
 * A file's text with everything outside `ranges` turned to spaces, line
 * breaks kept, so every offset, line and column inside a range is unchanged.
 */
export const blankOutside = (text: string, ranges: ReadonlyArray<readonly [number, number]>): string => {
  const keep = [...ranges].sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  const blank = (to: number): void => {
    for (; at < to; at += 1) {
      const char = text[at] as string;
      out += char === '\n' || char === '\r' ? char : ' ';
    }
  };
  for (const [start, end] of keep) {
    if (start < at) continue;
    blank(start);
    out += text.slice(start, end);
    at = end;
  }
  blank(text.length);
  return out;
};

/**
 * Makes up the checker's file for every listed file of a format, once.
 *
 * `files` are repo-relative paths, as the build lists them. A file with no
 * script, or one whose made-up name is a real file already, is left alone.
 */
export const addEmbeddedScripts = (
  project: Project,
  rootDir: string,
  files: readonly string[],
  formats: readonly EmbeddedFormat[],
): EmbeddedFile[] => {
  const made: EmbeddedFile[] = [];
  for (const file of files) {
    const format = formats.find((each) => file.endsWith(each.extension));
    if (format === undefined) continue;
    const real = join(rootDir, file);
    let text: string;
    try {
      text = readFileSync(real, 'utf8');
    } catch {
      continue;
    }
    const scripts = format.scripts(text, file);
    if (scripts === undefined) continue;
    const virtual = `${real}${scripts.markup === true ? '.tsx' : '.ts'}`;
    if (existsSync(virtual)) continue;
    const existing = project.getSourceFile(virtual);
    const script = blankOutside(text, scripts.ranges);
    // The imports a framework adds go after the tail, past every line of the file (P240).
    const implicit = existing === undefined ? implicitImportsFor(project, toPosixPath(file), script, scripts.uses) : '';
    const sourceFile =
      existing ?? project.createSourceFile(virtual, `${script}${scripts.tail === undefined ? '' : `\n${scripts.tail}`}${implicit}`, { overwrite: true });
    nameMadeUpFile(toPosixPath(virtual), toPosixPath(real));
    made.push({ sourceFile, file: toPosixPath(file), format, text });
  }
  return made;
};
