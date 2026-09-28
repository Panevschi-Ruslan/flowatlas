import { resolve } from 'node:path';
import type { GraphEdge, RepoGraph } from '@flowatlas/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractRepo } from '../extract-repo.js';
import { definePass } from './types.js';

/**
 * R156. A function the graph holds for a reason of its own - a later reader hung
 * a request or a configuration read off it - is a function whose calls matter,
 * and a call into one is a hop towards that leaf.
 *
 * The data-layer reader is not a dependency of this package, so what it does is
 * played here by a pass that joins the two functions it would join to a leaf:
 * the one reading configuration and the one making the request. The fixture's own
 * snapshot is the same question asked with the real reader.
 */
const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/nest-held-calls');
const FILE = 'src/skills/github-bundle.ts';
const HELD = ['buildGithubHeaders', 'streamTarball'];

const holdLeaves = definePass('hold-leaves', (ctx) => {
  for (const name of HELD) {
    const fn = ctx.functionAt(FILE, name);
    if (fn === undefined) continue;
    ctx.ensureFunctionNode(fn);
    const key = `config:${name}`;
    ctx.builder.addNode({ id: key, type: 'config_key', label: name, repo: ctx.repo });
    ctx.builder.addEdge({ from: ctx.functionIdOf(fn), to: key, type: 'reads_config', confidence: 'static' });
  }
  // A node joined to nothing it holds, as a helper the call walk followed into
  // from a handler is: being in the graph is not the same as holding something.
  const helper = ctx.functionAt(FILE, 'repoSlug');
  if (helper !== undefined) ctx.ensureFunctionNode(helper);
});

const fn = (name: string): string => `held#${FILE}:${name}`;
const method = (name: string): string => `held#src/skills/skills.service.ts:SkillsService.${name}`;

let graph: RepoGraph;
const calls = (from: string, to: string): GraphEdge | undefined =>
  graph.edges.find((edge) => edge.type === 'calls' && edge.from === from && edge.to === to);
const has = (id: string): boolean => graph.nodes.some((node) => node.id === id);

beforeAll(async () => {
  graph = await extractRepo({ rootDir: FIXTURE, repo: 'held', extraPasses: [holdLeaves] });
});

describe('calls into the functions the graph holds', () => {
  it('draws a call between two held functions', () => {
    expect(calls(fn('streamTarball'), fn('buildGithubHeaders'))).toMatchObject({
      confidence: 'static',
      file: FILE,
      line: 20,
    });
  });

  it('draws a method calling a held function by name', () => {
    expect(calls(method('hasToken'), fn('buildGithubHeaders'))).toBeDefined();
  });

  it('draws a helper between a method and a held function, and the helper with it', () => {
    expect(calls(method('bundle'), fn('fetchSkillBundle'))).toBeDefined();
    expect(calls(fn('fetchSkillBundle'), fn('streamTarball'))).toBeDefined();
    expect(has(fn('fetchSkillBundle'))).toBe(true);
  });

  it('draws a function nothing calls when it reaches a held one', () => {
    expect(calls(fn('isGithubConfigured'), fn('buildGithubHeaders'))).toBeDefined();
  });

  it('leaves out a helper that holds nothing and reaches nothing', () => {
    expect(has(fn('mapGithubError'))).toBe(false);
    expect(calls(fn('streamTarball'), fn('mapGithubError'))).toBeUndefined();
  });

  it('leaves out a call to a function that is a node and holds nothing', () => {
    expect(has(fn('repoSlug'))).toBe(true);
    expect(calls(method('bundle'), fn('repoSlug'))).toBeUndefined();
  });
});
