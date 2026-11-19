import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { answerLine, routeOf, score, symbolOf } from './score.mjs';

const symbols = { scorer: 'symbols', expected: ['GatewayCatalogImagesClient.create', 'OrdersBillingClient.createInvoice'] };
const routes = { scorer: 'routes', expected: ['GET /images/:id', 'DELETE /images/:id', 'POST /images'] };
const files = { scorer: 'files', expected: ['web/src/catalog-images/CatalogImagesPanel.tsx', 'admin/src/app/catalog-images/catalog-images.component.ts'] };

describe('the scorers (P238)', () => {
  it('read the last ANSWER line, as JSON or as text', () => {
    assert.deepEqual(answerLine('thinking\nANSWER: ["a"]\nmore\nANSWER: ["b", "c"]'), ['b', 'c']);
    assert.equal(answerLine('**ANSWER:** "no"'), 'no');
    assert.equal(answerLine('ANSWER: yes'), 'yes');
    assert.equal(answerLine('no line here'), undefined);
  });

  it('mark a set fully right, partly right, and wrong', () => {
    assert.deepEqual(score(symbols, 'Two callers.\nANSWER: ["OrdersBillingClient.createInvoice", "GatewayCatalogImagesClient.create"]'), {
      score: 1,
      correct: true,
      by: 'answer-line',
      precision: 1,
      recall: 1,
      given: ['OrdersBillingClient.createInvoice', 'GatewayCatalogImagesClient.create'],
    });
    const partly = score(symbols, 'ANSWER: ["GatewayCatalogImagesClient.create()", "GatewayCatalogImagesController.create"]');
    assert.equal(partly.correct, false);
    assert.equal(partly.precision, 0.5);
    assert.equal(partly.recall, 0.5);
    assert.equal(partly.score, 0.5);
    assert.equal(score(symbols, 'ANSWER: []').score, 0);
  });

  it('read routes however the parameters are spelled', () => {
    assert.equal(routeOf('get /images/{imageId}/'), 'GET /images/:');
    assert.equal(routeOf('`DELETE /images/:id`'), 'DELETE /images/:');
    assert.equal(score(routes, 'ANSWER: ["GET /images/{id}", "DELETE /images/:param", "POST /images"]').correct, true);
    assert.equal(score(routes, 'ANSWER: ["GET /images/:id"]').recall, 1 / 3);
  });

  it('read files by their name, wherever the answer says they are', () => {
    assert.equal(score(files, 'ANSWER: ["src/catalog-images/CatalogImagesPanel.tsx", "admin: catalog-images.component.ts"]').correct, true);
    assert.equal(score(files, 'ANSWER: ["CatalogImagesPanel.tsx"]').recall, 0.5);
  });

  it('mark an expected empty set right only when the answer is empty', () => {
    const none = { scorer: 'symbols', expected: [] };
    assert.equal(score(none, 'Nothing handles it.\nANSWER: []').correct, true);
    assert.equal(score(none, 'ANSWER: ["OrdersRateEvents.onRateUpdated"]').correct, false);
  });

  it('mark yes or no, and exact values, by the line or by the words', () => {
    assert.equal(score({ scorer: 'yesno', expected: 'no' }, 'ANSWER: "no"').correct, true);
    assert.equal(score({ scorer: 'yesno', expected: 'no' }, 'ANSWER: "Yes."').correct, false);
    assert.deepEqual(score({ scorer: 'yesno', expected: 'no' }, 'No, it sends qty.'), { score: 1, correct: true, by: 'patterns', value: 'no' });
    assert.equal(score({ scorer: 'exact', expected: '46' }, 'ANSWER: 46').correct, true);
    assert.equal(score({ scorer: 'exact', expected: 'shipping' }, 'ANSWER: "Shipping"').correct, true);
  });

  it('count an answer nothing can be read from as unscored', () => {
    assert.deepEqual(score({ scorer: 'exact', expected: '46' }, 'I could not find it.'), { score: 0, correct: false, by: 'unscored' });
    assert.equal(score(routes, 'I could not tell.').by, 'unscored');
  });

  it('read a symbol out of the ways answers write one', () => {
    assert.equal(symbolOf('GatewayCatalogImagesClient.create()'), 'GatewayCatalogImagesClient.create');
    assert.equal(symbolOf('gateway/src/clients/x.ts: GatewayX.list'), 'GatewayX.list');
    assert.equal(symbolOf('createCatalogImages'), 'createCatalogImages');
  });
});
