import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDoctorCommand } from '../commands/doctor.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'folded-consumes', 'flowatlas.config.json');

const quiet = { out(): void {}, err(): void {}, tty: false };

/**
 * A subscription that reaches three channels, and three annotations about it.
 *
 * The fixture is the defect: one `pSubscribe` written as a template over a
 * closed set folds into three `consumes` edges, and the handler carries one
 * `@Consumes` per channel. The check used to read the first of those edges, so
 * two of the three annotations went unreported — a reader followed the one row,
 * deleted the one annotation, and left the other two behind with nothing to say
 * they were next (R45).
 */
describe('@Consumes on a subscription that reaches several channels', () => {
  const rowsOf = () => {
    const { report } = runDoctorCommand({ config: CONFIG, contracts: false }, quiet);
    return report.markers.issues.filter((issue) => issue.code === 'marker-consumes-shadowed');
  };

  it('reports every channel the subscription reaches, not just the first', () => {
    expect(rowsOf().map((issue) => issue.argument)).toEqual([
      'order:opened',
      'order:on-hold',
      'order:closed',
    ]);
  });

  it('says the same thing about each of them, on the annotated handler', () => {
    for (const issue of rowsOf()) {
      expect(issue.severity).toBe('warning');
      expect(issue.marker).toBe('Consumes');
      expect(issue.message).toContain('LifecycleProjections.onLifecycle');
      expect(issue.message).toContain('says what the code already says');
    }
  });

  /**
   * "Remove it" is only safe advice if removing it changes nothing, so the
   * other half of the row is checked here: the extractor recorded each folded
   * name as already static, the annotation pass drew nothing for any of them,
   * and the three edges in the graph are the subscription's own.
   */
  it('leaves the channels and the edges to the code, so deleting the three is free', () => {
    const graph = JSON.parse(
      readFileSync(join(ROOT, 'fixtures', 'folded-consumes', 'expected.project-graph.json'), 'utf8'),
    ) as { nodes: Array<{ type: string; meta?: Record<string, unknown> }>; edges: Array<{ type: string; confidence: string }> };

    const consumes = graph.edges.filter((edge) => edge.type === 'consumes');
    expect(consumes).toHaveLength(3);
    expect(consumes.every((edge) => edge.confidence === 'static')).toBe(true);

    // Nothing in the graph was drawn by the annotations: one consumer, and it
    // is the subscription's. Take the three `@Consumes` out of the file and
    // this picture is unchanged, which is what makes "remove it" safe advice.
    const consumers = graph.nodes.filter((node) => node.type === 'consumer');
    expect(consumers).toHaveLength(1);
    expect(consumers[0]?.meta?.['decorator']).toBe('pSubscribe');
  });
});
