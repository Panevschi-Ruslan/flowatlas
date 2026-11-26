import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { FlowatlasError } from '@flowatlas/core';
import { PLAIN_BROWSER_TYPE as READER_TYPE } from '@flowatlas/extractor-react';
import { afterEach, describe, expect, it } from 'vitest';
import { scanCandidates } from './commands/init.js';
import { linkRepos } from './commands/link.js';
import { halfOf, readerOf, REACT_EXTRACTOR } from './readers.js';
import { guessType, isPlainBrowserCode, PLAIN_BROWSER_TYPE } from './stacks.js';

/** A booking page of plain HTML and scripts beside the service it books with (P284). */
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/browser-gateway-address');

const temporary: string[] = [];
afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

const scratch = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-plain-browser-')));
  temporary.push(dir);
  return dir;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const silent = (): void => undefined;

describe('plain browser code (P284)', () => {
  it('is a type the browser reader reads, which no manifest gives away', () => {
    expect(PLAIN_BROWSER_TYPE).toBe(READER_TYPE);
    expect(readerOf(PLAIN_BROWSER_TYPE)).toBe(REACT_EXTRACTOR);
    expect(halfOf(PLAIN_BROWSER_TYPE)).toBe('browser');
    expect(guessType({})).toBe('unknown');
    expect(guessType({ dependencies: { browser: '1.0.0', null: '1.0.0' } })).toBe('unknown');
  });

  it('is a directory with a page at its top and scripts, and nothing to build them', () => {
    const root = scratch();
    write(join(root, 'page/index.html'), '<script src="js/app.js"></script>');
    write(join(root, 'page/js/app.js'), 'fetch("/orders");');
    expect(isPlainBrowserCode(join(root, 'page'))).toBe(true);
    // No page, or no script: not one.
    write(join(root, 'scripts/js/app.js'), 'fetch("/orders");');
    expect(isPlainBrowserCode(join(root, 'scripts'))).toBe(false);
    write(join(root, 'static/index.html'), '<p>hello</p>');
    expect(isPlainBrowserCode(join(root, 'static'))).toBe(false);
    // TypeScript, or a manifest anywhere in it: something builds it.
    write(join(root, 'built/index.html'), '');
    write(join(root, 'built/js/app.js'), '');
    write(join(root, 'built/src/main.ts'), '');
    expect(isPlainBrowserCode(join(root, 'built'))).toBe(false);
    write(join(root, 'packaged/index.html'), '');
    write(join(root, 'packaged/app.js'), '');
    write(join(root, 'packaged/package.json'), '{}');
    expect(isPlainBrowserCode(join(root, 'packaged'))).toBe(false);
  });

  it('is linked as such, and a directory that is nothing still is not', () => {
    const config = join(scratch(), 'flowatlas.config.json');
    const linked = linkRepos([join(FIXTURE, 'bookings'), join(FIXTURE, 'web')], { config, mcp: false, dryRun: true, print: silent });
    expect(linked.added.map((service) => [service.name, service.type])).toEqual([
      ['bookings', 'lambda'],
      ['web', PLAIN_BROWSER_TYPE],
    ]);
    expect(() => linkRepos([join(FIXTURE, 'bookings/src')], { config, mcp: false, dryRun: true, print: silent })).toThrow(FlowatlasError);
  });

  it('is offered by init beside the service', () => {
    const scan = scratch();
    cpSync(join(FIXTURE, 'bookings'), join(scan, 'bookings'), { recursive: true });
    cpSync(join(FIXTURE, 'web'), join(scan, 'web'), { recursive: true });
    const found = scanCandidates(scan, join(scan, 'flowatlas'));
    expect(found.map((candidate) => [candidate.name, candidate.type])).toEqual([
      ['bookings', 'lambda'],
      ['web', PLAIN_BROWSER_TYPE],
    ]);
  });
});
