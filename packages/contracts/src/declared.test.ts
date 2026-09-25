import { describe, expect, it } from 'vitest';
import { checkContracts } from './check.js';
import { edge, field, graphOf, node, object } from './test-graph.js';

/**
 * A boundary with a service nobody could read on one side of it (P19).
 *
 * Two claims, and they pull in opposite directions on purpose. The first is
 * that a declared end is compared exactly like a read one, because the
 * comparison has no business knowing where a registry entry came from. The
 * second is that nothing it says is ever presented as though it had been
 * checked: the sentence names the document and so does the party in
 * `contracts.json`.
 *
 * Both have to hold at once. The first alone is the annotation this project
 * deleted — an unverifiable claim wearing the voice the tool uses for what it
 * proved. The second alone is the silence that was there before, where a call
 * to a third party was counted and the question stopped.
 */

/**
 * The graph below is built here, which bounds what this file can be trusted to
 * say. It asserts what the check does with an edge into a declared route; that
 * the linker actually draws such an edge, and draws it `marker` rather than
 * `static`, is asserted in `packages/linker/src/openapi/join.test.ts` over the
 * real fixture — because for one commit it did not, and nothing here noticed.
 */
const DOCUMENT = 'contracts/billing.json';

const types = {
  'type:api#CreateInvoiceDto': object('CreateInvoiceDto', [
    field('customerId', 'string'),
    field('traceId', 'string'),
  ]),
  'type:billing#CreateInvoice': object('CreateInvoice', [
    field('customerId', 'string'),
    field('currency', 'string'),
  ]),
};

/** The same boundary twice: once with billing read, once with it declared. */
const report = (declared: boolean) =>
  checkContracts(
    graphOf({
      nodes: [
        node('api#Client.create', 'method', 'api'),
        node('http_out:api#1', 'http_out', 'api'),
        node('entry:billing:http:POST:/invoices', 'entry', 'billing', {
          kind: 'http',
          ...(declared ? { meta: { declaredBy: DOCUMENT } } : {}),
        }),
        node('billing#createInvoice', 'method', 'billing', {
          ...(declared ? { meta: { declaredBy: DOCUMENT } } : {}),
        }),
      ],
      edges: [
        edge('api#Client.create', 'calls', 'http_out:api#1'),
        edge('http_out:api#1', 'http_calls', 'entry:billing:http:POST:/invoices', {
          params: ['type:api#CreateInvoiceDto'],
        }),
        edge('entry:billing:http:POST:/invoices', 'handles', 'billing#createInvoice', {
          confidence: declared ? 'marker' : 'static',
          meta: { body: 'type:billing#CreateInvoice' },
        }),
      ],
      types,
    }),
    { generatedAt: '2026-01-01T00:00:00.000Z' },
  );

/** One finding per field, as `severity kind field`, so a list reads as prose. */
const facts = (declared: boolean): string[] =>
  report(declared)
    .findings.map((finding) => `${finding.severity} ${finding.kind} ${finding.field}`)
    .sort();

describe('a shape compared against a declared one', () => {
  it('produces the same findings it produces against read source', () => {
    expect(facts(true)).toEqual(['error missing_required currency', 'info extra_field traceId']);
    expect(facts(true)).toEqual(facts(false));
  });

  it('is the same status, so a declared end is not drift by being declared', () => {
    const [read] = report(false).edges;
    const [said] = report(true).edges;
    expect(said?.status).toBe(read?.status);
  });
});

describe('what says which half was believed', () => {
  it('names the document on the end that came from it, and on no other', () => {
    const [request] = report(true).edges;
    expect(request?.receiver.declaredBy).toBe(DOCUMENT);
    expect(request?.sender.declaredBy).toBeUndefined();
  });

  it('leaves the key off entirely when both ends were read', () => {
    const [request] = report(false).edges;
    expect(request?.receiver.declaredBy).toBeUndefined();
  });

  it('says so in the sentence, not only in the JSON', () => {
    // The sentence is what reaches a person: the terminal, the document, and
    // the answer an agent is handed all print it. A finding that read the same
    // whether or not half of it was a third party's word for itself would be
    // the tool asserting something nobody checked in the voice it uses for
    // what it proved.
    const [finding] = report(true).findings;
    expect(finding?.message).toContain(`billing was declared by ${DOCUMENT}, not read`);
  });

  it('says it once when both ends of one boundary came from one document', () => {
    const both = checkContracts(
      graphOf({
        nodes: [
          node('a#Client.call', 'method', 'a', { meta: { declaredBy: DOCUMENT } }),
          node('http_out:a#1', 'http_out', 'a'),
          node('entry:a:http:POST:/x', 'entry', 'a', {
            kind: 'http',
            meta: { declaredBy: DOCUMENT },
          }),
          node('a#handler', 'method', 'a', { meta: { declaredBy: DOCUMENT } }),
        ],
        edges: [
          edge('a#Client.call', 'calls', 'http_out:a#1'),
          edge('http_out:a#1', 'http_calls', 'entry:a:http:POST:/x', {
            params: ['type:api#CreateInvoiceDto'],
          }),
          edge('entry:a:http:POST:/x', 'handles', 'a#handler', {
            confidence: 'marker',
            meta: { body: 'type:billing#CreateInvoice' },
          }),
        ],
        types,
      }),
      { generatedAt: '2026-01-01T00:00:00.000Z' },
    );
    const said = both.findings[0]?.message ?? '';
    expect(said.split('was declared by').length - 1).toBe(1);
  });
});
