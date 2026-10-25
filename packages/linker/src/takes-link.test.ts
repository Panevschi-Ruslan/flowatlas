import { GUESSED_META, RECORDED_META, TAKEN_BY_META, TAKES_META, type GraphEdge, type GraphNode, type Takes } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { edgeKey } from './order.js';
import { matchTakenPublishes } from './takes-link.js';

const CHANNEL: GraphNode = { id: 'channel:s3/library-covers', type: 'channel', label: 's3/library-covers', repo: 'media' };

const consumer = (id: string, takes: Takes): GraphNode => ({ id, type: 'consumer', label: `notification ${id}`, repo: 'media', meta: { [TAKES_META]: takes } });

const producer = (id: string, kind: string, meta: Record<string, unknown> = {}): GraphNode => ({
  id,
  type: 'producer',
  label: `${kind} s3/library-covers`,
  repo: 'media',
  file: 'src/covers.ts',
  line: 3,
  kind,
  meta: { kind, ...meta },
});

const thumbnail = consumer('thumbnail', { kinds: ['s3:ObjectCreated:*'], by: { field: 'Key', prefix: 'incoming/' } });
const index = consumer('index', { kinds: ['s3:ObjectCreated:*'], by: { field: 'Key', prefix: 'thumbnails/' } });

const run = (producers: GraphNode[]) => {
  const nodes = new Map([CHANNEL, thumbnail, index, ...producers].map((node) => [node.id, node]));
  const edges = new Map<string, GraphEdge>();
  const add = (edge: GraphEdge): void => void edges.set(edgeKey(edge), edge);
  for (const taker of [thumbnail, index]) add({ from: CHANNEL.id, to: taker.id, type: 'consumes', confidence: 'static' });
  for (const each of producers) add({ from: each.id, to: CHANNEL.id, type: 'emits', confidence: 'static' });
  const rows = matchTakenPublishes(nodes, edges);
  const out = (id: string) => [...edges.values()].find((edge) => edge.from === id && edge.type === 'emits') as GraphEdge;
  return { rows, out };
};

describe('matchTakenPublishes', () => {
  it('says which consumers take a write, and keeps the edge static where one surely does', () => {
    const { rows, out } = run([producer('put', 's3:ObjectCreated:Put', { [RECORDED_META]: { Key: ['incoming/*.png'] } })]);
    expect(rows).toEqual([]);
    expect(out('put')).toMatchObject({ confidence: 'static', meta: { [TAKEN_BY_META]: ['thumbnail'] } });
  });

  it('guesses, with the reason, where the key is not read', () => {
    const { out } = run([producer('put', 's3:ObjectCreated:Put')]);
    expect(out('put').confidence).toBe('heuristic');
    expect(out('put').meta?.[TAKEN_BY_META]).toEqual(['index', 'thumbnail']);
    expect(out('put').meta?.['because']).toEqual(['Key is not read, and only one starting "incoming/" is taken']);
  });

  it('is an info row where nothing takes the write', () => {
    const { rows, out } = run([producer('delete', 's3:ObjectRemoved:Delete')]);
    expect(out('delete')).toMatchObject({ confidence: 'heuristic', meta: { [TAKEN_BY_META]: [], because: ['nothing on the channel takes it'] } });
    expect(rows).toMatchObject([{ reason: 's3-write-matches-nothing', level: 'info', symbol: 'delete' }]);
  });

  it('keeps a presigned write a guess, whatever takes it', () => {
    const { out } = run([producer('signed', 's3:ObjectCreated:Put', { [RECORDED_META]: { Key: ['incoming/a.png'] }, [GUESSED_META]: 'presigned' })]);
    expect(out('signed')).toMatchObject({ confidence: 'heuristic', meta: { because: ['presigned'], [TAKEN_BY_META]: ['thumbnail'] } });
  });
});
