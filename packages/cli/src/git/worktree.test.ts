import { describe, expect, it } from 'vitest';
import { samePlace } from './worktree.js';

describe('one directory, spelled by git and by the OS (P199)', () => {
  it('takes git\'s forward slashes and the OS\'s backslashes for one place on Windows', () => {
    expect(samePlace('D:/a/flowatlas/orders', 'D:\\a\\flowatlas\\orders', true)).toBe(true);
    expect(samePlace('d:/a/flowatlas/orders/', 'D:\\a\\flowatlas\\orders', true)).toBe(true);
    expect(samePlace('C:/Users/runneradmin/Temp/x', 'C:\\Users\\RunnerAdmin\\Temp\\x', true)).toBe(true);
    expect(samePlace('D:/a/flowatlas/orders', 'D:\\a\\flowatlas\\orders-copy', true)).toBe(false);
    expect(samePlace('D:/a/flowatlas/orders', 'C:\\a\\flowatlas\\orders', true)).toBe(false);
  });

  it('keeps case on a file system that tells it apart', () => {
    expect(samePlace('/work/orders', '/work/orders/', false)).toBe(true);
    expect(samePlace('/work/Orders', '/work/orders', false)).toBe(false);
    expect(samePlace('/', '/', false)).toBe(true);
  });
});
