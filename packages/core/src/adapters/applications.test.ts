import { describe, expect, it } from 'vitest';
import { applicationOfFile, applicationsIn, applicationsServing } from './applications.js';

const MAP = {
  names: ['ApiModule', 'WorkerModule'],
  of: {
    'svc#src/health.controller.ts:HealthController': ['ApiModule'],
    'svc#src/status.controller.ts:StatusController': ['ApiModule', 'WorkerModule'],
  },
};

describe('applicationsIn', () => {
  it('reads the map an extractor left on the context', () => {
    expect(applicationsIn({ applications: MAP })?.names).toEqual(['ApiModule', 'WorkerModule']);
  });

  it('answers nothing where no extractor wrote one', () => {
    expect(applicationsIn(undefined)).toBeUndefined();
    expect(applicationsIn({})).toBeUndefined();
  });

  // Plain data on the context, so the shape is checked rather than assumed: the
  // adapter that reads it may not import the reader that writes it.
  it('answers nothing for a value of the wrong shape', () => {
    expect(applicationsIn({ applications: { names: 'ApiModule' } })).toBeUndefined();
    expect(applicationsIn({ applications: { names: [], of: null } })).toBeUndefined();
  });
});

describe('applicationsServing', () => {
  it('names each application that mounts the declaration', () => {
    expect(applicationsServing(MAP, 'svc#src/status.controller.ts:StatusController')).toEqual([
      'ApiModule',
      'WorkerModule',
    ]);
  });

  it('qualifies nothing where the service creates one application', () => {
    const one = { names: ['ApiModule'], of: { 'svc#a.ts:A': ['ApiModule'] } };
    expect(applicationsServing(one, 'svc#a.ts:A')).toEqual([undefined]);
  });

  it('qualifies nothing where no applications were read', () => {
    expect(applicationsServing(undefined, 'svc#a.ts:A')).toEqual([undefined]);
    expect(applicationsServing({ names: [], of: {} }, 'svc#a.ts:A')).toEqual([undefined]);
  });

  // A declaration no application mounts is one the framework never sees. Naming
  // an application for it would assert something nothing read, so it keeps the
  // plain id it had before.
  it('qualifies nothing for a declaration no application mounts', () => {
    expect(applicationsServing(MAP, 'svc#src/orphan.controller.ts:Orphan')).toEqual([undefined]);
  });

  it('never answers with an empty list, so a caller can loop over it', () => {
    expect(applicationsServing(MAP, 'nothing').length).toBeGreaterThan(0);
  });
});

/**
 * The same question, asked of a file.
 *
 * A call site has nothing but the file it is written in, so a reader that wants
 * to know which application a request belongs to can only ask that — and it has
 * to get the answer the entries were minted with, or the two halves of one
 * address would disagree (R132).
 */
describe('applicationOfFile', () => {
  const DIRECTORIES = {
    names: ['.', 'examples/blog', 'examples/blog/packages/ui'],
    of: {
      '.': ['.'],
      'examples/blog': ['examples/blog'],
      'examples/blog/packages/ui': ['examples/blog/packages/ui'],
    },
    keyedBy: 'directory',
  };

  it('answers with the directory the file is under', () => {
    expect(applicationOfFile({ applications: DIRECTORIES }, 'examples/blog/src/client.ts')).toBe(
      'examples/blog',
    );
  });

  // An application inside another's directory is the one its own files belong
  // to, which is what makes the longest name the answer rather than the first.
  it('answers with the innermost application containing the file', () => {
    expect(
      applicationOfFile({ applications: DIRECTORIES }, 'examples/blog/packages/ui/src/button.tsx'),
    ).toBe('examples/blog/packages/ui');
  });

  it('answers with the root application for a file under none of the others', () => {
    expect(applicationOfFile({ applications: DIRECTORIES }, 'lib/store.ts')).toBe('.');
  });

  // The same judgement the ids go through: one address space needs no name, so
  // a call site in it is qualified by nothing either.
  it('qualifies nothing where the service holds one application', () => {
    const one = { names: ['.'], of: { '.': ['.'] }, keyedBy: 'directory' };
    expect(applicationOfFile({ applications: one }, 'lib/store.ts')).toBeUndefined();
  });

  // A symbol id is not a path. Prefix-matching one would answer a question
  // nothing asked, so a reader whose applications are declarations says nothing.
  it('answers nothing for a map keyed by declaration', () => {
    expect(applicationOfFile({ applications: MAP }, 'src/health.controller.ts')).toBeUndefined();
  });

  it('answers nothing where no extractor wrote a map', () => {
    expect(applicationOfFile(undefined, 'lib/store.ts')).toBeUndefined();
  });
});
