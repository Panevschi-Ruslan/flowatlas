import { describe, expect, it } from 'vitest';
import { textOf } from './test-dom.js';
import { mountPage, nodeAt, testPack } from './test-page.js';

/** The frame around the drawing (P103). */
describe('the frame', () => {
  const data = testPack('frame-ui');
  const at = nodeAt(data);

  it('turns the Types line on and remembers it in this browser', () => {
    const { page, document, window } = mountPage(data);
    page.showView('graph');
    page.graph.go(at('entry:gateway:http:POST:/orders'));
    document.getElementById('g-types')!.click();
    expect(page.state.types).toBe(true);
    expect(page.BOX.h).toBe(page.BOX_HEIGHTS.typed.h);
    expect(window.storage.get('flowatlas.graph.types')).toBe('true');
  });

  it('goes full screen and back', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    page.fullScreen.toggle();
    expect(document.documentElement.classList.contains('is-full')).toBe(true);
    expect(textOf(document.querySelector('#g-full span'))).toBe('Leave full screen');
    page.fullScreen.set(false);
    expect(document.documentElement.classList.contains('is-full')).toBe(false);
  });

  it('says over the drawing what a link could not give, until it is dismissed', () => {
    const { page, document } = mountPage(data);
    page.showView('graph');
    page.notice.say('gone');
    const notice = document.getElementById('g-notice')!;
    expect(notice.hidden).toBe(false);
    notice.querySelector('button')!.click();
    expect(notice.hidden).toBe(true);
  });
});
