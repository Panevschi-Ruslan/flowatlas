import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import {
  readExpressionDocument,
  readJson,
  UnreadMember,
  type DefinitionPosition,
  type PathStep,
  type PositionedDocument,
} from '@flowatlas/core';
import { Node, Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { isAlias, isMap, isPair, isScalar, isSeq, LineCounter, parseDocument, type Document, type Node as YamlNode } from 'yaml';

/**
 * A service file, read as a positioned document, whatever it is written in.
 *
 * The Serverless Framework reads `serverless.yml`, `serverless.yaml`,
 * `serverless.json`, `serverless.ts` and `serverless.js`. All five say the
 * same thing, and once read nothing downstream should care which: so each is
 * adapted to the core's `PositionedDocument` - plain values, and a line for
 * every member - and every reader below is written against that.
 *
 * YAML is read with the short tags of CloudFormation's intrinsic functions
 * (`!Ref`, `!GetAtt`, `!Sub`, ...), each turned into the long form JSON writes
 * (`{ "Fn::GetAtt": ["Queue", "Arn"] }`), so a reference is one shape whichever
 * spelling the file used. A TypeScript or JavaScript file is read for the
 * object it exports, statically: nothing is run.
 */

/** Text that could not be read as the document it claims to be. */
export class ServiceFileUnreadable extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'ServiceFileUnreadable';
  }
}

/** The short tag of each intrinsic function, and the long form it stands for. */
const INTRINSIC_TAGS: ReadonlyMap<string, string> = new Map([
  ['!Ref', 'Ref'],
  ['!Condition', 'Condition'],
  ...[
    'GetAtt',
    'Sub',
    'Join',
    'ImportValue',
    'Select',
    'Split',
    'If',
    'Equals',
    'FindInMap',
    'GetAZs',
    'Base64',
    'Cidr',
    'And',
    'Or',
    'Not',
    'Transform',
  ].map((name) => [`!${name}`, `Fn::${name}`] as const),
]);

const keyOf = (path: readonly PathStep[]): string => JSON.stringify(path);

/** `!GetAtt Queue.Arn` is `["Queue", "Arn"]`, split at the first dot. */
const getAttParts = (written: string): string[] => {
  const dot = written.indexOf('.');
  return dot < 0 ? [written] : [written.slice(0, dot), written.slice(dot + 1)];
};

class YamlReading {
  readonly positions = new Map<string, DefinitionPosition>();

  constructor(
    readonly document: Document,
    readonly lines: LineCounter,
  ) {}

  #record(path: readonly PathStep[], offset: number | undefined): void {
    if (offset === undefined) return;
    const { line, col } = this.lines.linePos(offset);
    this.positions.set(keyOf(path), { line, column: col });
  }

  value(node: YamlNode | null | undefined, path: PathStep[], depth = 0): unknown {
    if (node === null || node === undefined || depth > 64) return null;
    if (isAlias(node)) return this.value(node.resolve(this.document) as YamlNode | undefined, path, depth + 1);
    let value: unknown;
    if (isScalar(node)) {
      value = node.value;
    } else if (isSeq(node)) {
      value = node.items.map((item, index) => {
        const inner = [...path, index];
        this.#record(inner, (item as YamlNode | null)?.range?.[0]);
        return this.value(item as YamlNode | null, inner, depth + 1);
      });
    } else if (isMap(node)) {
      const out: Record<string, unknown> = {};
      for (const pair of node.items) {
        if (!isPair(pair)) continue;
        const keyNode = pair.key as YamlNode | null;
        const key = isScalar(keyNode) ? String(keyNode.value) : undefined;
        if (key === undefined) continue;
        // A merge key brings another mapping's members in, under this one's.
        if (key === '<<') {
          const merged = this.value(pair.value as YamlNode | null, path, depth + 1);
          const sources = Array.isArray(merged) ? merged : [merged];
          for (const source of sources) {
            if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
              for (const [name, member] of Object.entries(source as Record<string, unknown>)) if (!(name in out)) out[name] = member;
            }
          }
          continue;
        }
        const inner = [...path, key];
        this.#record(inner, keyNode?.range?.[0]);
        out[key] = this.value(pair.value as YamlNode | null, inner, depth + 1);
      }
      value = out;
    } else {
      value = null;
    }
    const tag = 'tag' in node ? (node.tag as string | undefined) : undefined;
    const intrinsic = tag === undefined ? undefined : INTRINSIC_TAGS.get(tag);
    if (intrinsic === undefined) return value;
    if (intrinsic === 'Fn::GetAtt' && typeof value === 'string') return { [intrinsic]: getAttParts(value) };
    return { [intrinsic]: value };
  }
}

/** YAML with CloudFormation's short tags, and a position for every key and list item. */
export const readServiceYaml = (text: string): PositionedDocument => {
  const lines = new LineCounter();
  const document = parseDocument(text, { lineCounter: lines, prettyErrors: false, uniqueKeys: false, logLevel: 'silent' });
  const error = document.errors[0];
  if (error !== undefined) {
    throw new ServiceFileUnreadable(error.message.split('\n')[0] ?? 'not YAML', lines.linePos(error.pos[0]).line);
  }
  const reading = new YamlReading(document, lines);
  const value = reading.value(document.contents as YamlNode | null, []);
  reading.positions.set(keyOf([]), { line: 1, column: 1 });
  return { value, at: (path) => reading.positions.get(keyOf(path)) };
};

/** What a module exports as its default, or assigns to `module.exports`. */
const exportedValue = (source: SourceFile): Node | undefined => {
  for (const statement of source.getStatements()) {
    if (Node.isExportAssignment(statement)) return statement.getExpression();
    if (Node.isExpressionStatement(statement)) {
      const expression = statement.getExpression();
      if (
        Node.isBinaryExpression(expression) &&
        expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        expression.getLeft().getText().replace(/\s+/g, '') === 'module.exports'
      ) {
        return expression.getRight();
      }
    }
  }
  return undefined;
};

/**
 * A `serverless.ts` or `serverless.js`, read for the object it exports. Every
 * TypeScript file beside it is in the program, so a constant imported from one
 * is followed; what cannot be read stays in its place as an `UnreadMember`.
 */
const readServiceModule = (path: string): PositionedDocument => {
  const project = new Project({
    compilerOptions: { allowJs: true, noEmit: true, skipLibCheck: true },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: false,
  });
  const source = project.addSourceFileAtPath(path);
  project.resolveSourceFileDependencies();
  const exported = exportedValue(source);
  if (exported === undefined) throw new ServiceFileUnreadable('the file exports no service object', 1);
  return readExpressionDocument(exported);
};

/** The formats, by what a file's name ends in. */
const READERS: ReadonlyMap<string, (path: string) => PositionedDocument> = new Map([
  ['.yml', (path: string) => readServiceYaml(readFileSync(path, 'utf8'))],
  ['.yaml', (path: string) => readServiceYaml(readFileSync(path, 'utf8'))],
  [
    '.json',
    (path: string) => {
      try {
        return readJson(readFileSync(path, 'utf8'));
      } catch (cause) {
        const line = (cause as { position?: { line: number } }).position?.line ?? 1;
        throw new ServiceFileUnreadable(cause instanceof Error ? cause.message : 'not JSON', line);
      }
    },
  ],
  ['.ts', readServiceModule],
  ['.js', readServiceModule],
  ['.mjs', readServiceModule],
  ['.cjs', readServiceModule],
]);

/** Reads a service file, or a file one of its variables loads, by its extension. */
export const readServiceFile = (path: string): PositionedDocument => {
  const read = READERS.get(extname(path));
  if (read === undefined) throw new ServiceFileUnreadable(`files ending ${extname(path)} are not read`, 1);
  return read(path);
};

export { UnreadMember };
