import { describe, expect, it } from 'vitest';
import { createSheet } from './sheet.js';
import { mountPage, testPack } from './test-page.js';

/** The open tab's title and the sheet the table tabs draw into (P99). */
describe('the sheet', () => {
  const data = testPack('sheet');

  it('hands the tables the title and the sheet, and nothing is drawn in either yet', () => {
    const { document } = mountPage(data, { upTo: createSheet });
    const { sheetEl, titleEl } = createSheet();
    expect(sheetEl).toBe(document.getElementById('tab-sheet'));
    expect(titleEl).toBe(document.getElementById('view-title'));
    expect(sheetEl.childNodes).toHaveLength(0);
  });
});
