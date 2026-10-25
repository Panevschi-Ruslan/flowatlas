import { describe, expect, it } from 'vitest';
import type { RecordedStep } from './blocks.js';
import { flowFingerprint, positionFreeId, type FingerprintTree } from './fingerprint.js';
import { NOTE_SLOT, ORPHANED_HEADING, renderTour, tourNotesOf } from './tour.js';

/** A way in that calls a client, which asks another service; `line` is where the request is written. */
const walk = (line: number, extra: FingerprintTree[] = [], returns = 'type:catalog#BookDto'): FingerprintTree => ({
  node: { id: 'entry:shop:http:GET:/books/:param', type: 'entry', label: 'GET /books/:param' },
  children: [
    {
      node: { id: 'shop#src/books.controller.ts:BooksController.get', type: 'method', label: 'BooksController.get' },
      edge: { type: 'handles', confidence: 'static', params: ['string'] },
      children: [
        {
          node: { id: `http_out:shop#src/books.client.ts:${line}:4`, type: 'http_out', label: 'GET /books/:param' },
          edge: { type: 'calls', confidence: 'static' },
          children: [
            {
              node: { id: 'entry:catalog:http:GET:/books/:param', type: 'entry', label: 'GET /books/:param' },
              edge: { type: 'http_calls', confidence: 'static', returns },
              children: [],
            },
          ],
        },
        ...extra,
      ],
    },
  ],
});

const steps: RecordedStep[] = [
  { kind: 'enters', from: 'caller', to: 'shop', label: 'GET /books/:param', confidence: 'static' },
  { kind: 'http_calls', from: 'shop', to: 'catalog', label: 'GET /books/:param', confidence: 'static', returns: 'type:catalog#BookDto' },
];

describe('flowFingerprint (P120 D2)', () => {
  it('is the same when only the lines moved', () => {
    expect(flowFingerprint(walk(20), steps)).toBe(flowFingerprint(walk(23), steps));
    expect(flowFingerprint(walk(20), steps)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('changes with a new step, a removed one, or a changed shape', () => {
    const before = flowFingerprint(walk(20), steps);
    const publish: FingerprintTree = {
      node: { id: 'producer:shop#src/books.controller.ts:30:6', type: 'producer', label: 'event book.viewed' },
      edge: { type: 'calls', confidence: 'static' },
      children: [{ node: { id: 'channel:book.viewed', type: 'channel', label: 'book.viewed' }, edge: { type: 'emits', confidence: 'static' }, children: [] }],
    };
    expect(flowFingerprint(walk(20, [publish]), steps)).not.toBe(before);
    expect(flowFingerprint(walk(20), steps.slice(0, 1))).not.toBe(before);
    expect(flowFingerprint(walk(20, [], 'type:catalog#BookSummary'), steps)).not.toBe(before);
    // A shape that changed under the same id changes what a contract shows, handed in as extra.
    expect(flowFingerprint(walk(20), steps, { shapes: [['type:catalog#BookDto', 'aaaa']] })).not.toBe(
      flowFingerprint(walk(20), steps, { shapes: [['type:catalog#BookDto', 'bbbb']] }),
    );
  });

  it('names a call site by its file and what it calls, not its line', () => {
    expect(positionFreeId({ id: 'http_out:shop#src/books.client.ts:20:4', label: 'GET /books/:param' })).toBe('http_out:shop#src/books.client.ts|GET /books/:param');
    expect(positionFreeId({ id: 'shop#src/books.controller.ts:BooksController.get', label: 'x' })).toBe('shop#src/books.controller.ts:BooksController.get');
  });
});

describe('tours (P120 D4)', () => {
  const tourSteps = [
    { key: 'a', text: '**A**' },
    { key: 'b', text: '**B**' },
  ];

  it('gives every step a slot, and keeps a note under its step by key', () => {
    const empty = renderTour(tourSteps, new Map());
    expect(empty.text).toBe(`1. **A** <!-- step key="a" -->\n   ${NOTE_SLOT}\n2. **B** <!-- step key="b" -->\n   ${NOTE_SLOT}\n<!-- /steps -->\n`);
    const written = empty.text.replace(`<!-- step key="b" -->\n   ${NOTE_SLOT}`, '<!-- step key="b" -->\n   B is where it\n   gets interesting.');
    const notes = tourNotesOf(written);
    expect([...notes.keys()]).toEqual(['b']);
    // The order changed and a step came in front: the note follows its step.
    const again = renderTour([{ key: 'b', text: '**B**' }, { key: 'c', text: '**C**' }, { key: 'a', text: '**A**' }], notes, ['_cut_']);
    expect(again.text).toContain('1. **B** <!-- step key="b" -->\n   B is where it\n   gets interesting.\n2. **C**');
    expect(again.orphaned).toEqual([]);
    expect(tourNotesOf(again.text).get('b')?.lines).toEqual(['   B is where it', '   gets interesting.']);
    // What the tool writes after the steps is never read as a note.
    expect(tourNotesOf(again.text).size).toBe(1);
  });

  it('keeps a note whose step is gone under orphaned notes, and gives it back when the step returns', () => {
    const notes = tourNotesOf('1. **A** <!-- step key="a" -->\n   about A\n2. **B** <!-- step key="b" -->\n   about B\n');
    const without = renderTour([{ key: 'a', text: '**A**' }], notes);
    expect(without.orphaned).toEqual(['b']);
    expect(without.text).toContain(`${ORPHANED_HEADING}\n\n- **B** <!-- step key="b" -->\n   about B`);
    // Regenerated as it is, nothing moves.
    expect(renderTour([{ key: 'a', text: '**A**' }], tourNotesOf(without.text)).text).toBe(without.text);
    const back = renderTour(tourSteps, tourNotesOf(without.text));
    expect(back.orphaned).toEqual([]);
    expect(back.text).toContain('2. **B** <!-- step key="b" -->\n   about B');
    expect(back.text).not.toContain(ORPHANED_HEADING);
  });
});
