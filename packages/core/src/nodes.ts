import type { ClassDeclaration, Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { normalizeFilePath } from './ids.js';
import { packageOfPath } from './origin.js';
import { lineAndColumnAt, startLineOf } from './line-numbers.js';

/** Repo-relative POSIX path of the file holding a node. */
export const fileOf = (node: TsNode | SourceFile, rootDir: string): string =>
  normalizeFilePath(
    (Node.isSourceFile(node) ? node : node.getSourceFile()).getFilePath(),
    rootDir,
  );

/** 1-based line number. */
export const lineOf = (node: TsNode): number => startLineOf(node);

/** 1-based line and column, for the identity of a node named by its call site. */
export const siteOf = (node: TsNode): { line: number; column: number } =>
  lineAndColumnAt(node.getSourceFile(), node.getStart());

/** True when the declaration comes from an installed package rather than the repository. */
export const isExternalFile = (filePath: string): boolean => filePath.includes('/node_modules/');

/** {@link packageOfPath} in the spelling the id-building code reads more easily. */
export const packageOfFile = (filePath: string): string | undefined =>
  packageOfPath(filePath) ?? undefined;

/** Path used inside ids for a class that lives in an installed package. */
export const externalFilePath = (pkg: string): string => `node_modules/${pkg}`;

export const className = (declaration: ClassDeclaration): string =>
  declaration.getName() ?? `<anonymous@${lineOf(declaration)}>`;
