import type { ExtractContext } from '@flowatlas/core';
import { Node, Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { batchAnswerOf } from './batch-answer.js';

/** What the export `handler` of a file answers, the other files beside it. */
const answer = (code: string, others: Record<string, string> = {}) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  project.createSourceFile('/repo/node_modules/@aws-lambda-powertools/batch/index.d.ts', 'export declare const processPartialResponse: (...args: any[]) => Promise<any>;');
  project.createSourceFile('/repo/node_modules/relay/index.d.ts', 'export declare const relay: (records: unknown[]) => Promise<unknown>;');
  for (const [path, text] of Object.entries(others)) project.createSourceFile(`/repo/${path}`, text);
  const file = project.createSourceFile('/repo/src/handler.ts', code);
  const declaration = file.getVariableDeclaration('handler') ?? file.getFunction('handler');
  if (declaration === undefined) throw new Error('no handler');
  const value = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
  const ctx = { repoDir: '/repo', project } as unknown as ExtractContext;
  return batchAnswerOf({ ...(value === undefined ? {} : { fn: value }), around: [declaration] }, ctx);
};

describe('whether a handler answers which messages of a batch failed (P389)', () => {
  it('reads the answer written in the handler', () => {
    expect(answer('export const handler = async () => { const failed: string[] = []; return { batchItemFailures: failed.map((id) => ({ itemIdentifier: id })) }; };')).toEqual({
      says: 'returns',
      at: 'src/handler.ts:1',
    });
  });

  it('reads it in a function of the repository the handler calls, through an import', () => {
    expect(
      answer("import { run } from './run';\nexport const handler = async (event: { Records: unknown[] }) => run(event.Records);", {
        'src/run.ts': 'export const run = async (records: unknown[]) => ({ batchItemFailures: [] as unknown[] });',
      }).says,
    ).toBe('returns');
  });

  it("reads a helper of the batch package as the answer", () => {
    expect(
      answer("import { processPartialResponse } from '@aws-lambda-powertools/batch';\nexport const handler = async (event: any) => processPartialResponse(event, async () => {}, {});").says,
    ).toBe('returns');
  });

  it('says never where the handler returns nothing, a literal, or what code of the repository returns without it', () => {
    expect(answer('export async function handler(event: { Records: string[] }) { for (const record of event.Records) console.log(record); }')).toEqual({ says: 'never' });
    expect(
      answer("import { count } from './count';\nexport const handler = async (event: { Records: string[] }) => { const n = await count(event.Records); return { processed: n }; };", {
        'src/count.ts': 'export const count = async (records: string[]) => records.length;',
      }),
    ).toEqual({ says: 'never' });
  });

  it('says unread where the handler returns what code outside the repository returns', () => {
    expect(answer("import { relay } from 'relay';\nexport const handler = async (event: { Records: unknown[] }) => relay(event.Records);")).toEqual({
      says: 'unread',
      why: 'the handler returns what relay returns, which this read does not hold',
    });
  });

  it('does not take a callback written inside the handler for what it returns', () => {
    expect(answer('export const handler = async (event: { Records: string[] }) => { event.Records.forEach((record) => { return record; }); };')).toEqual({ says: 'never' });
  });
});
