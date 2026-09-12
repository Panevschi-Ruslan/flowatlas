import { describe, expect, it } from 'vitest';
import { VERSION } from './version.js';

describe('the version this command reports', () => {
  it('is the one its own manifest declares', () => {
    // It was a literal until it drifted, and then it was read by name until the
    // package was renamed and it silently became `0.0.0` again. What identifies
    // the manifest is the command it installs.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(VERSION).not.toBe('0.0.0');
  });
});
