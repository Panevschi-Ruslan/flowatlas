import { describe, expect, it } from 'vitest';
import { EXTRACTORS } from './build/extractor.js';
import { BUILD_STAMP, READER_PACKAGES, VERSION, builtAt, stampOf } from './version.js';

describe('the version this command reports', () => {
  it('is the one its own manifest declares', () => {
    // It was a literal until it drifted, and then it was read by name until the
    // package was renamed and it silently became `0.0.0` again. What identifies
    // the manifest is the command it installs.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(VERSION).not.toBe('0.0.0');
  });
});

describe('the build stamp the cache is keyed on', () => {
  it('covers every package the dispatch table sends a repository to', () => {
    // The defect this holds shut: a reader was added to the table and the stamp
    // was not told, so a tool rebuilt with it answered from the cache written
    // before it existed. Whatever is added there is covered here, or this fails
    // rather than the cache quietly going stale.
    for (const reader of new Set(Object.values(EXTRACTORS))) {
      expect(READER_PACKAGES).toContain(reader);
    }
  });

  it('covers the packages every read goes through, whatever the repository is', () => {
    expect(READER_PACKAGES).toEqual(expect.arrayContaining(['@flowatlas/core', '@flowatlas/linker']));
  });

  it('names packages that are really there, so none of them counts for nothing', () => {
    // Resolution failure is swallowed — it has to be, since a published build
    // bundles these and resolves none of them — which is exactly how a typo in
    // a name would contribute nothing and say nothing. In a checkout they all
    // resolve, and that is the only place this can be checked.
    for (const name of READER_PACKAGES) {
      expect({ name, built: builtAt(name) !== undefined }).toEqual({ name, built: true });
    }
  });

  it('moves when any one of those packages is rebuilt', () => {
    const at = new Map(READER_PACKAGES.map((name) => [name, 1_000]));
    const before = stampOf(READER_PACKAGES, (name) => at.get(name));
    for (const name of READER_PACKAGES) {
      const rebuilt = stampOf(READER_PACKAGES, (candidate) =>
        candidate === name ? 2_000 : at.get(candidate),
      );
      expect(rebuilt).not.toBe(before);
    }
  });

  it('is the version alone where nothing resolves, as in a published build', () => {
    expect(stampOf(READER_PACKAGES, () => undefined)).toBe(VERSION);
    expect(BUILD_STAMP.startsWith(VERSION)).toBe(true);
  });
});
