import { describe, expect, it } from 'vitest';
import { severityOf } from './severity.js';

describe('an optionality disagreement, by the end that may leave the field out (P384)', () => {
  it('is a warning where the sender may leave out what the receiver requires', () => {
    expect(severityOf('optionality_mismatch', null, undefined, 'sender')).toBe('warning');
  });

  it('is information where the receiver may go without what the sender always sends', () => {
    expect(severityOf('optionality_mismatch', null, undefined, 'receiver')).toBe('info');
    // A rule softens and never hardens it.
    expect(severityOf('optionality_mismatch', 'null-for-optional', undefined, 'receiver')).toBe('info');
  });

  it('keeps the warning where nobody said which end, as the traffic comparison asks', () => {
    expect(severityOf('optionality_mismatch', null)).toBe('warning');
  });
});
