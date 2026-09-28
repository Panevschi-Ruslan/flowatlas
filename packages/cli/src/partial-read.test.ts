import { describe, expect, it } from 'vitest';
import { partialReadNotice } from './partial-read.js';

const nothingInstalled = (): boolean => false;
const allInstalled = (): boolean => true;

describe('the partial-read notice', () => {
  it('says so once when a repository has never been installed', () => {
    const notice = partialReadNotice([{ name: 'orders', dir: '/p/orders' }], 912, nothingInstalled);
    expect(notice).toContain('orders');
    expect(notice).toContain('912 types could not be resolved');
    expect(notice).toContain('partial read');
  });

  /**
   * The case R129 exists for. A repository whose dependencies are installed and
   * whose types are still unresolved - because something generates them - must
   * not be told to install anything, and the run can tell that much apart.
   */
  it('says nothing when the dependencies are installed and types are still unresolved', () => {
    expect(partialReadNotice([{ name: 'web', dir: '/p/web' }], 1180, allInstalled)).toBeUndefined();
  });

  it('says nothing when nothing went unresolved', () => {
    expect(partialReadNotice([{ name: 'orders', dir: '/p/orders' }], 0, nothingInstalled)).toBeUndefined();
  });

  /**
   * What it does not promise. Installing recovers what a package declares; one
   * target is 0 tables in both states because its client is generated, and the
   * sentence has to be true in front of that reader too.
   */
  it('never promises that an install recovers generated code', () => {
    const notice = partialReadNotice([{ name: 'web', dir: '/p/web' }], 1180, nothingInstalled) ?? '';
    expect(notice).toContain('recovers what a package declares');
    expect(notice).toContain('never what a package generates');
  });

  it('names every repository that has not been installed, and only those', () => {
    const notice = partialReadNotice(
      [
        { name: 'orders', dir: '/p/orders' },
        { name: 'web', dir: '/p/web' },
      ],
      12,
      (dir) => dir === '/p/web',
    );
    expect(notice).toContain('orders');
    expect(notice).not.toContain('web');
  });

  it('ignores a repository it cannot locate, rather than guessing at its state', () => {
    expect(partialReadNotice([{ name: 'orders', dir: '' }], 912, nothingInstalled)).toBeUndefined();
  });
});
