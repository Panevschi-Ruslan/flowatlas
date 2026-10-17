import { describe, expect, it } from 'vitest';
import { createMissing } from './missing.js';
import { textOf } from './test-dom.js';
import { mountPage, testPack } from './test-page.js';

/** The Not joined tab (P103). */
describe('what did not join', () => {
  const data = testPack('missing');

  it('lists each reason under its kind, with an example to copy as a prompt or accept', () => {
    const { page, document } = mountPage(data, { upTo: createMissing });
    createMissing(page).drawMissing();
    expect(textOf(document.getElementById('walk-title'))).toBe('What did not join');
    const reasons = document.querySelectorAll('#walk tbody tr:not(.kind-head) td .tag').map(textOf);
    expect(reasons.sort()).toEqual(data.unresolved.map((u) => u.reason).sort());
    expect(document.querySelectorAll('#walk tr.kind-head').map(textOf)[0]).toMatch(/^Missed/);
    const prompts = document.querySelectorAll('#walk [data-prompt]');
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((button: any) => /^row:\d+$/.test(button.dataset.prompt))).toBe(true);
    expect(document.querySelectorAll('#walk [data-accept-cmd]')).toHaveLength(data.unresolved.length);
  });
});
