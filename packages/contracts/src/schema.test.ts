import { describe, expect, it } from 'vitest';
import { checkContracts } from './check.js';
import { contractReportSchema, parseContractReport } from './schema.js';
import { edge, field, graphOf, node, object } from './test-graph.js';

/**
 * The shape of the file, checked rather than assumed.
 *
 * `doctor` embeds this report and CI reads it, so a field that moves has to
 * fail here rather than somewhere downstream a fortnight later.
 */

const report = checkContracts(
  graphOf({
    nodes: [
      node('http_out:caller#1', 'http_out', 'caller'),
      node('entry:api:http:POST:/orders', 'entry', 'api', { kind: 'http' }),
      node('api#Controller.create', 'method', 'api'),
    ],
    edges: [
      edge('http_out:caller#1', 'http_calls', 'entry:api:http:POST:/orders', {
        params: ['type:caller#Body'],
      }),
      edge('entry:api:http:POST:/orders', 'handles', 'api#Controller.create', {
        meta: { body: 'type:api#Body' },
      }),
    ],
    types: {
      'type:caller#Body': object('Body', [field('id', 'string')]),
      'type:api#Body': object('Body', [field('id', 'string'), field('channel', 'string')]),
    },
  }),
  { generatedAt: '2026-01-01T00:00:00.000Z' },
);

describe('the report as a document', () => {
  it('goes through the schema and comes back the same', () => {
    expect(parseContractReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it('refuses a key nobody declared, so a typo is an error and not a default', () => {
    const strayed = { ...report, surprise: true };
    expect(contractReportSchema.safeParse(strayed).success).toBe(false);
  });

  it('refuses a report written by another version of the format', () => {
    const older = { ...report, contractsFormatVersion: 0 };
    expect(contractReportSchema.safeParse(older).success).toBe(false);
  });

  it('refuses a severity or a kind that is not one of the words', () => {
    const wrong = {
      ...report,
      findings: [{ ...report.findings[0], severity: 'critical' }],
    };
    expect(contractReportSchema.safeParse(wrong).success).toBe(false);
  });
});
