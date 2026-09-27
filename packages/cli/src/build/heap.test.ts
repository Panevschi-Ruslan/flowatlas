import { describe, expect, it } from 'vitest';
import { heapAlreadyAsked, heapArgs, heapMbFor, MOST_MB } from './heap.js';

const GB = 1024 * 1024 * 1024;

/** A 36 GB machine whose runtime gave itself about 4 GB, which is what was measured. */
const machine = { totalBytes: 36 * GB, ownLimitBytes: 4288 * 1024 * 1024 };

describe('how much heap a reader is given', () => {
  it('raises the limit far enough for the largest repository measured', () => {
    // payload with its dependencies installed peaks at 10.0 GB of resident
    // memory and dies under 8192 MB. One reader on this machine has to be given
    // more than that or the tool goes on dying of its own default.
    const heap = heapMbFor({ ...machine, readers: 1 });
    expect(heap).toBe(MOST_MB);
    expect(heap).toBeGreaterThan(8192);
  });

  it('divides the machine by the readers that will run at once', () => {
    // Four repositories being read together get a quarter of the share each, and
    // eight of them get a share smaller than the runtime's own default, which is
    // the case below.
    expect(heapMbFor({ ...machine, readers: 4 })).toBe(6912);
    expect(heapMbFor({ ...machine, readers: 8 })).toBeUndefined();
  });

  it('leaves the runtime alone when a share of the machine is less than it chose', () => {
    // A small machine reading several repositories: asking for less than the
    // default would turn a build that worked into one that does not.
    expect(heapMbFor({ totalBytes: 8 * GB, ownLimitBytes: 4096 * 1024 * 1024, readers: 8 })).toBeUndefined();
  });

  it('never asks for more than the ceiling it can point at a measurement for', () => {
    expect(heapMbFor({ totalBytes: 512 * GB, ownLimitBytes: 32 * GB, readers: 1 })).toBeUndefined();
    expect(heapMbFor({ totalBytes: 512 * GB, ownLimitBytes: 4 * GB, readers: 1 })).toBe(MOST_MB);
  });

  it('does what it was told, over anything it would have worked out', () => {
    expect(heapMbFor({ ...machine, readers: 8, asked: 512 })).toBe(512);
    expect(heapMbFor({ ...machine, readers: 1, asked: 40_000 })).toBe(40_000);
  });

  it('stands aside where a limit has already been asked for', () => {
    expect(heapMbFor({ ...machine, readers: 1, alreadySet: true })).toBeUndefined();
    expect(heapAlreadyAsked({ NODE_OPTIONS: '--max-old-space-size=2048' }, [])).toBe(true);
    expect(heapAlreadyAsked({ NODE_OPTIONS: '--enable-source-maps' }, ['--max_old_space_size=99'])).toBe(true);
    expect(heapAlreadyAsked({}, [])).toBe(false);
  });

  it('puts nothing on a command line when there is nothing to change', () => {
    expect(heapArgs(undefined)).toEqual([]);
    expect(heapArgs(6144)).toEqual(['--max-old-space-size=6144']);
  });
});
