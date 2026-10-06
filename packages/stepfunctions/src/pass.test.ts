import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GraphBuilder, silentLogger, type ExtractContext } from '@flowatlas/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definitionFiles, formatOfDefinition, nameOfDefinition } from './files.js';
import { extractWorkflows, readDefinitionFile } from './pass.js';

const MACHINE = JSON.stringify({ StartAt: 'Hold', States: { Hold: { Type: 'Pass', End: true } } });

let repo: string;

const write = (file: string, text: string): void => {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), text);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'flowatlas-asl-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('definitionFiles', () => {
  it('finds definitions by their infix, in any directory a repository keeps code in', () => {
    write('statemachine/loan-approval.asl.json', MACHINE);
    write('workflows/returns.asl.yaml', 'StartAt: A');
    write('workflows/holds.asl.yml', 'StartAt: A');
    write('workflows/policy.json', '{}');
    write('node_modules/some-package/sample.asl.json', MACHINE);
    write('.aws-sam/build/copied.asl.json', MACHINE);
    expect(definitionFiles(repo)).toEqual([
      'statemachine/loan-approval.asl.json',
      'workflows/holds.asl.yml',
      'workflows/returns.asl.yaml',
    ]);
  });

  it('names a definition after its file, and reads its format from it', () => {
    expect(nameOfDefinition('statemachine/loan-approval.asl.json')).toBe('loan-approval');
    expect(formatOfDefinition('a/returns.asl.yml')).toBe('yaml');
    expect(formatOfDefinition('a/returns.asl.json')).toBe('json');
  });
});

describe('extractWorkflows', () => {
  const extract = (): ReturnType<GraphBuilder['build']> => {
    const builder = new GraphBuilder({ repo: 'circulation', generatedAt: '1970-01-01T00:00:00.000Z' });
    extractWorkflows({ repo: 'circulation', repoDir: repo, builder, logger: silentLogger } as unknown as ExtractContext);
    return builder.build();
  };

  it('draws every definition a repository keeps, named after its file', () => {
    write('statemachine/loan-approval.asl.json', MACHINE);
    write('workflows/returns.asl.yaml', 'StartAt: Back\nStates:\n  Back:\n    Type: Succeed\n');
    const graph = extract();
    expect(graph.nodes.filter((node) => node.kind === 'workflow').map((node) => node.id)).toEqual([
      'entry:circulation:workflow:loan-approval',
      'entry:circulation:workflow:returns',
    ]);
    // Informational rows are folded to one per reason, standing for each place.
    expect(graph.unresolved).toEqual([expect.objectContaining({ reason: 'workflow-named-by-file', sites: 2 })]);
  });

  it('draws the first of two definitions under one name, and a row for the second', () => {
    write('a/returns.asl.json', MACHINE);
    write('b/returns.asl.yaml', 'StartAt: Back\nStates:\n  Back:\n    Type: Succeed\n');
    const graph = extract();
    expect(graph.nodes.filter((node) => node.kind === 'state').map((node) => node.id)).toEqual([
      'circulation#a/returns.asl.json:returns/Hold',
    ]);
    expect(graph.unresolved).toContainEqual(
      expect.objectContaining({ reason: 'workflow-name-duplicate', file: 'b/returns.asl.yaml' }),
    );
  });

  it('turns a file it cannot read into one row at the place it stopped, and nothing else', () => {
    write('statemachine/broken.asl.json', '{\n  "StartAt": "A",\n  "States": {\n    "A": { "Type": "Pass" ,, }\n  }\n}');
    const fragment = readDefinitionFile(repo, 'circulation', 'statemachine/broken.asl.json');
    expect(fragment.nodes).toEqual([]);
    expect(fragment.rows).toEqual([
      expect.objectContaining({ reason: 'workflow-definition-unreadable', file: 'statemachine/broken.asl.json', line: 4 }),
    ]);
  });
});
