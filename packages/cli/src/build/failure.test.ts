import { describe, expect, it } from 'vitest';
import { readFailure } from './failure.js';

/**
 * What a reader that exhausted its heap leaves behind, as it was observed.
 *
 * Copied from a real run of one measured CMS monorepo with its dependencies
 * installed: the words that say what happened are in the middle, and the last
 * lines — the ones a tail takes — are addresses inside a dynamic library.
 */
const OUT_OF_MEMORY = [
  '<--- Last few GCs --->',
  '[41234:0x148008000]    54903 ms: Mark-Compact 4087.6 (4104.8) -> 4080.2 MB, 1842.5 / 0.0 ms',
  '',
  '<--- JS stacktrace --->',
  '',
  'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory',
  '----- Native stack trace -----',
  ' 1: 0x1047d0d48 node::Abort() [/opt/homebrew/Cellar/node/25.9.0_3/lib/libnode.141.dylib]',
  '104: 0x10495a0b0 node::NodeMainInstance::Run() [/opt/homebrew/Cellar/node/25.9.0_3/lib/libnode.141.dylib]',
  '105: 0x1048fdb98 node::Start(int, char**) [/opt/homebrew/Cellar/node/25.9.0_3/lib/libnode.141.dylib]',
  '106: 0x18de1c4e4 start [/usr/lib/dyld]',
].join('\n');

const died = (stderr: string, over: Record<string, unknown> = {}): unknown =>
  Object.assign(new Error('Command failed: node /x/flowatlas.js extract /repos/payload'), {
    code: 134,
    signal: null,
    stderr,
    ...over,
  });

const context = { repo: '../../repos/payload' };

describe('why a repository could not be read', () => {
  it('says a full heap in its own words, and not three frames of a stack trace', () => {
    const failure = readFailure(died(OUT_OF_MEMORY), { ...context, heapMb: 4288 });
    expect(failure.kind).toBe('out-of-memory');
    // The repository, the limit that did not hold, and what to do next.
    expect(failure.error).toContain('ran out of memory reading ../../repos/payload');
    expect(failure.error).toContain('under a limit of 4288 MB');
    expect(failure.error).toContain('--heap 8576');
    expect(failure.error).toContain('--concurrency 1');
    // What it used to say, which is the whole of the defect.
    expect(failure.error).not.toContain('libnode');
    expect(failure.error).not.toContain('dyld');
  });

  it('asks for a number rather than naming one when no limit was asked for', () => {
    const failure = readFailure(died(OUT_OF_MEMORY), context);
    expect(failure.error).toContain('under the limit the runtime chose for this machine');
    expect(failure.error).toContain('--heap <megabytes>');
  });

  it('quotes a reader that said something sensible, preferring the reason to the tail', () => {
    const failure = readFailure(
      died(['Error: no tsconfig in /repos/orders', 'at readConfig (/x/y.js:1:1)', 'at run (/x/y.js:2:2)'].join('\n')),
      context,
    );
    expect(failure.kind).toBe('unrecognised');
    expect(failure.error).toBe('exit 134: Error: no tsconfig in /repos/orders');
  });

  it('does not put a sentence about memory in front of every process that aborted', () => {
    // `SIGABRT` covers a great deal more than a full heap, and a reader whose
    // problem is not memory must not be sent to a memory flag.
    const failure = readFailure(died('', { code: null, signal: 'SIGABRT' }), context);
    expect(failure.kind).toBe('unrecognised');
    expect(failure.error).toContain('killed by SIGABRT');
  });

  it('still says how a silent process ended', () => {
    expect(readFailure(died(''), context).error).toContain('exit 134');
  });
});
