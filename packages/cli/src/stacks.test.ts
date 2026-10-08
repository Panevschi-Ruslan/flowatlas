import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTRACTORS, isFrontend } from './build/extractor.js';
import { isIncremental } from './build/session.js';
import { BROWSER_READERS } from './commands/extract.js';
import { halfOf, READERS, readerOf, typesReadBy } from './readers.js';
import {
  guessType,
  guessUnread,
  guessWorkspaceType,
  looksLike,
  looksLikeApplication,
  noReaderNote,
  UNKNOWN_TYPE,
} from './stacks.js';

describe('the stack a repository is built on', () => {
  it('names a type it can read', () => {
    expect(guessType({ dependencies: { '@nestjs/core': '10.0.0' } })).toBe('nestjs');
    expect(guessType({ dependencies: { '@angular/core': '17.0.0' } })).toBe('angular');
    expect(guessType({ dependencies: { express: '4.19.0' } })).toBe('express');
    expect(guessType({ dependencies: { fastify: '5.2.1' } })).toBe('fastify');
    expect(guessType({ dependencies: { koa: '2.15.0' } })).toBe('koa');
    expect(guessType({ dependencies: { react: '19.0.0' } })).toBe('react');
    expect(guessType({ dependencies: { next: '15.0.0' } })).toBe('nextjs');
  });

  it('looks in every dependency section', () => {
    expect(guessType({ devDependencies: { '@nestjs/core': '10.0.0' } })).toBe('nestjs');
    expect(guessType({ peerDependencies: { '@angular/core': '17.0.0' } })).toBe('angular');
    expect(guessUnread({ optionalDependencies: { vue: '3.4.0' } })).toBe('Vue');
  });

  it('says nothing about an empty manifest', () => {
    expect(guessType({})).toBe(UNKNOWN_TYPE);
    expect(guessUnread({})).toBeUndefined();
  });

  // Every NestJS application on the default platform declares Express, and both
  // are read, so the order decides which reader a repository gets rather than
  // whether it gets one. The most specific goes first.
  it('prefers the most specific type when a manifest declares two it can read', () => {
    const pkg = { dependencies: { '@nestjs/core': '10.0.0', express: '4.19.0' } };
    expect(guessType(pkg)).toBe('nestjs');
    expect(guessUnread(pkg)).toBeUndefined();
  });

  // The dependency that was a false signal. This framework declares Express and
  // registers no route on it — every route it serves is the path of a file — and
  // its admin panel is React, so a manifest that declares all three describes
  // one framework and two things the repository is not (R91).
  it('prefers the framework over the two dependencies it brings with it', () => {
    const pkg = {
      dependencies: { '@medusajs/medusa': '2.21.1', express: '4.21.2', react: '19.0.0' },
    };
    expect(guessType(pkg)).toBe('medusa');
    expect(guessType({ devDependencies: { '@medusajs/framework': '2.21.1' } })).toBe('medusa');
    expect(guessUnread(pkg)).toBeUndefined();
  });

  it('reads the two file-system routers described as rows (P38)', () => {
    expect(guessType({ dependencies: { '@remix-run/react': '2.0.0', react: '18.3.1' } })).toBe('remix');
    expect(guessType({ devDependencies: { '@sveltejs/kit': '2.8.0', svelte: '5.0.0' } })).toBe('sveltekit');
  });

  it('names the framework when there is no reader for it', () => {
    expect(guessUnread({ dependencies: { nuxt: '3.14.0' } })).toBe('Nuxt');
    expect(guessUnread({ dependencies: { vue: '3.5.0' } })).toBe('Vue');
    expect(guessUnread({ devDependencies: { svelte: '5.0.0' } })).toBe('Svelte');
  });

  // Every application built on the file-system router declares React too, and
  // both are read. It is a server type, so it wins by the rule rather than by
  // sitting above `react` in the table.
  it('prefers the file-system router over the framework it is built on', () => {
    const pkg = { dependencies: { next: '15.0.0', react: '19.0.0' } };
    expect(guessType(pkg)).toBe('nextjs');
    expect(guessUnread(pkg)).toBeUndefined();
  });

  /**
   * R88: a wiki app is Koa and React in one directory, and which reader it got was
   * decided by which of the two rows somebody had typed first. The server type
   * is the answer for every pairing of the two halves, because its reader reads
   * both halves and the browser reader reads one.
   */
  it('gives a repository that is both halves the reader that reads both', () => {
    for (const server of ['koa', 'express', 'fastify']) {
      for (const browser of ['react', '@angular/core']) {
        const pkg = { dependencies: { [server]: '1.0.0', [browser]: '1.0.0' } };
        expect(guessType(pkg)).toBe(server);
      }
    }
    expect(guessType({ dependencies: { '@nestjs/core': '10.0.0', react: '19.0.0' } })).toBe('nestjs');
  });

  it('says which half of a repository is declared beside the type it chose', () => {
    expect(noReaderNote({ dependencies: { koa: '2.15.0', react: '19.0.0' } })).toBe(
      'looks like koa; set its type to "koa"' +
        ' (it declares react as well, and the koa reader reads both halves)',
    );
  });

  it('still reads a repository that is only one half as that half', () => {
    expect(guessType({ dependencies: { react: '19.0.0', 'react-dom': '19.0.0' } })).toBe('react');
    expect(guessType({ dependencies: { '@angular/core': '17.0.0' } })).toBe('angular');
    expect(guessType({ dependencies: { koa: '2.15.0' } })).toBe('koa');
  });

  it('sends every type to the reader its row names', () => {
    for (const [type, , reader] of READERS) {
      expect({ type, reader: EXTRACTORS.get(type) }).toEqual({ type, reader });
      expect({ type, browser: isFrontend(type) }).toEqual({
        type,
        browser: halfOf(type) === 'browser',
      });
    }
  });

  it('says nothing about a manifest that gave nothing away', () => {
    expect(guessType({ dependencies: { lodash: '4.0.0' } })).toBe(UNKNOWN_TYPE);
    expect(guessUnread({ dependencies: { lodash: '4.0.0' } })).toBeUndefined();
    expect(noReaderNote({ dependencies: { lodash: '4.0.0' } })).toBeUndefined();
    expect(noReaderNote(undefined)).toBeUndefined();
  });

  it('writes the note a build prints beside a repository it skipped', () => {
    expect(noReaderNote({ dependencies: { nuxt: '3.14.0' } })).toBe('Nuxt, no reader yet');
  });

  // A service configured as `nest` has no reader, and the repository it points
  // at is a NestJS application. "Express, no reader yet" would be true of the
  // manifest and useless to the person reading it.
  it('says which type to set when the repository is one it can read', () => {
    const pkg = { dependencies: { '@nestjs/core': '10.0.0', express: '4.19.0' } };
    expect(noReaderNote(pkg)).toBe('looks like nestjs; set its type to "nestjs"');
    expect(noReaderNote({ dependencies: { express: '4.19.0' } })).toBe(
      'looks like express; set its type to "express"',
    );
  });
});

describe('the stack one member of a workspace is built on', () => {
  const root = { dependencies: { express: '4.19.0', '@types/node': '22.0.0' } };

  // A video platform's `server/package.json` names a package, a version and an export
  // map of subpaths, and nothing else at all; the hundred and thirteen
  // dependencies the server has are at the workspace root. Read on its own it
  // gave nothing away, which is why the coverage harness had to be told it is an
  // Express service by hand.
  it('takes the workspace root for a member that declares nothing and exports no whole', () => {
    const server = { name: '@p/server', exports: { './*': { default: './dist/*' } } };
    expect(guessWorkspaceType(server, root)).toBe('express');
    expect(looksLikeApplication(server, root)).toBe(true);
  });

  it('takes a member at its word when it declares anything of its own', () => {
    const client = { name: '@p/client', devDependencies: { '@angular/core': '17.0.0' } };
    expect(guessWorkspaceType(client, root)).toBe('angular');

    const tests = { name: '@p/tests', devDependencies: { supertest: '7.0.0' } };
    expect(guessWorkspaceType(tests, root)).toBe(UNKNOWN_TYPE);
    expect(looksLikeApplication(tests, root)).toBe(false);
  });

  it('leaves a library alone, whichever way it says how to enter it', () => {
    for (const entry of [
      { main: 'dist/index.js' },
      { module: 'dist/index.mjs' },
      { bin: { tool: 'dist/cli.js' } },
      { exports: { '.': './dist/index.js' } },
      { exports: './dist/index.js' },
    ]) {
      const library = { name: '@p/lib', ...entry };
      expect(guessWorkspaceType(library, root)).toBe(UNKNOWN_TYPE);
      expect(looksLikeApplication(library, root)).toBe(false);
    }
  });

  it('is the plain guess when there is no workspace above', () => {
    const bare = { name: 'orders', dependencies: { express: '4.19.0' } };
    expect(guessWorkspaceType(bare, undefined)).toBe(guessType(bare));
    expect(guessWorkspaceType({ name: 'nothing' }, undefined)).toBe(UNKNOWN_TYPE);
  });
});

/**
 * What the agreement test became.
 *
 * There used to be a test here holding two declarations of one fact to each
 * other: the half in `stacks.ts` and `SERVER_TYPES` / `BROWSER_TYPES` /
 * `isFrontend` in `build/extractor.ts`. It had earned its place — a later branch
 * added a framework to both lists, and this is what would have caught a mismatch —
 * but there is one table for both to read now (R118), so holding it to itself
 * would assert nothing.
 *
 * The assertion worth keeping is the other direction, which the old test could
 * only half make: every reader this tool ships has a row, and every row names a
 * reader it ships. That is the drift still possible, because a reader is a
 * package, a dependency and a dispatch entry, none of which a table of strings can
 * derive. A reader added to `packages/` and to this command's manifest with no row
 * would read nothing and say nothing about it; a row naming a package nobody
 * depends on is a type that is configured, offered by `init` and unreadable.
 */
describe('the readers this tool ships', () => {
  // Read from this command's own manifest, and from nothing derived from the
  // table, because a reader is shipped by being depended on. `READER_PACKAGES`
  // would be the shorter spelling and it is the wrong one: it is the union of the
  // manifest and the table, so the table would be held to itself again.
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const shipped = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
    (name) => name.startsWith('@flowatlas/extractor-'),
  );

  it('has a row for every reader package this command depends on', () => {
    expect(shipped.length).toBeGreaterThan(0);
    for (const reader of shipped) {
      expect({ reader, reads: typesReadBy(reader) }).not.toEqual({ reader, reads: [] });
    }
  });

  it('names a reader it ships in every row', () => {
    for (const [type, , reader] of READERS) {
      expect({ type, reader, shipped: shipped.includes(reader) }).toEqual({
        type,
        reader,
        shipped: true,
      });
    }
  });

  /**
   * Every table a configured `type` is looked up in, asked about the words the
   * language puts on every object.
   *
   * The `type` is whatever somebody wrote in their configuration file, and while
   * these were object literals each of them answered `constructor` with a
   * function: a typo would have had a reader, a half, a browser flag and an
   * incremental session, and the first sign of it would have been whatever that
   * function did. They are `Map`s now, and the answer is the one a misspelling
   * deserves - there is no such reader (R134).
   */
  it('has no reader anywhere for a type spelled like a member every object has', () => {
    for (const type of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect({ type, reader: EXTRACTORS.get(type) }).toEqual({ type, reader: undefined });
      expect({ type, reader: readerOf(type) }).toEqual({ type, reader: undefined });
      expect({ type, half: halfOf(type) }).toEqual({ type, half: undefined });
      expect({ type, browser: isFrontend(type) }).toEqual({ type, browser: false });
      expect({ type, incremental: isIncremental(type) }).toEqual({ type, incremental: false });
      expect({ type, reader: BROWSER_READERS.get(type) }).toEqual({ type, reader: undefined });
    }
  });

  // The one place a reader is actually called for a repository that is only a
  // browser. A table of functions cannot be derived from a table of strings, so
  // the two are held to each other here instead.
  it('can call a browser reader for exactly the types whose reader reads a browser', () => {
    const browsers = [...new Set(READERS.map(([type]) => type))].filter(
      (type) => halfOf(type) === 'browser',
    );
    expect(browsers.sort()).toEqual([...BROWSER_READERS.keys()].sort());
  });
});

/**
 * What a repository with no way in looks like (R170): the first description that
 * applies, most telling first, and always something.
 */
describe('what a repository looks like', () => {
  const repository = (files: Record<string, string | object>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'flowatlas-looks-'));
    for (const [path, content] of Object.entries(files)) {
      writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
    }
    return dir;
  };

  it('names a deployment tool nothing reads before anything in the manifest', () => {
    const dir = repository({ 'serverless.yml': 'service: holds\n', 'package.json': { dependencies: { vue: '3.4.0' } } });
    expect(looksLike(dir, 'nestjs')).toBe('its functions are declared for the Serverless Framework, which nothing here reads yet');
  });

  it('names a framework nothing reads', () => {
    expect(looksLike(repository({ 'package.json': { dependencies: { svelte: '5.0.0' } } }), 'express')).toBe(
      'it is built on Svelte, which nothing here reads yet',
    );
  });

  it('names the type to set when the manifest declares one that is read', () => {
    expect(looksLike(repository({ 'package.json': { dependencies: { koa: '2.15.0' } } }), 'express')).toBe(
      'it looks like koa rather than express; set its type to "koa"',
    );
  });

  it('names a library', () => {
    expect(looksLike(repository({ 'package.json': { name: '@acme/stock', main: 'dist/index.js' } }), 'nestjs')).toMatch(
      /^it looks like a library/,
    );
  });

  it('says what was looked for when nothing else applies', () => {
    expect(looksLike(repository({ 'package.json': { dependencies: { express: '4.19.0' } } }), 'express')).toBe(
      'it is configured as express, and none of its code declares a route, a handler or a consumer that reader recognises',
    );
    expect(looksLike(repository({}), 'lambda')).toBe(
      'it has no package.json, and none of its files declares a way in that the lambda reader recognises',
    );
  });
});
