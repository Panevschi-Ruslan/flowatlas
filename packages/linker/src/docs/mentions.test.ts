import { describe, expect, it } from 'vitest';
import { mentionsOf } from './mentions.js';

describe('the names a page mentions in code (P234)', () => {
  it('reads code spans and plain fences with the heading above each, never prose or a language fence', () => {
    const page = [
      '# Orders',
      '',
      'The orders service answers `POST /orders` and publishes order.created in prose.',
      '',
      '## Channels',
      '',
      '```',
      'order.created',
      '```',
      '',
      '```ts',
      'OrdersService.create(dto);',
      '```',
      '',
      'Short: `ok`.',
    ].join('\n');
    expect(mentionsOf(page)).toEqual([
      { text: 'POST /orders', line: 3, heading: 'Orders' },
      { text: 'order.created', line: 8, heading: 'Channels' },
    ]);
  });

  it('skips what a flowatlas block wrote, which the block already links', () => {
    const page = ['<!-- flowatlas:flow id="POST /orders" -->', '- `OrdersService.create`', '<!-- /flowatlas:flow fingerprint="ab12cd34" -->', 'After: `GET /orders/:id`'].join('\n');
    expect(mentionsOf(page).map((mention) => mention.text)).toEqual(['GET /orders/:id']);
  });
});
