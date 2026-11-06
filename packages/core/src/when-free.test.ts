import { describe, expect, it } from 'vitest';
import { whenFree } from './when-free.js';

const held = (code: string): Error => Object.assign(new Error(code), { code });

describe('a change to a file another process holds', () => {
  it('is tried again while the file is held, and its answer returned', () => {
    let tries = 0;
    const answer = whenFree(() => {
      tries += 1;
      if (tries < 3) throw held(tries === 1 ? 'EPERM' : 'EBUSY');
      return 'moved';
    });
    expect([answer, tries]).toEqual(['moved', 3]);
  });

  it('gives up after its attempts with the last error, and at once on any other', () => {
    let tries = 0;
    expect(() => whenFree(() => { tries += 1; throw held('EACCES'); }, 3)).toThrow('EACCES');
    expect(tries).toBe(3);
    tries = 0;
    expect(() => whenFree(() => { tries += 1; throw held('ENOENT'); })).toThrow('ENOENT');
    expect(tries).toBe(1);
  });
});
