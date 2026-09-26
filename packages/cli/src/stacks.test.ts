import { describe, expect, it } from 'vitest';
import {
  guessType,
  guessUnread,
  guessWorkspaceType,
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

  it('names the framework when there is no reader for it', () => {
    expect(guessUnread({ dependencies: { nuxt: '3.14.0' } })).toBe('Nuxt');
    expect(guessUnread({ dependencies: { '@remix-run/react': '2.0.0' } })).toBe('Remix');
    expect(guessUnread({ devDependencies: { svelte: '5.0.0' } })).toBe('Svelte');
  });

  // Every application built on the file-system router declares React too, and
  // both are read, so the order decides which reader a repository gets. The
  // one that also finds the routes it answers goes first.
  it('prefers the file-system router over the framework it is built on', () => {
    const pkg = { dependencies: { next: '15.0.0', react: '19.0.0' } };
    expect(guessType(pkg)).toBe('nextjs');
    expect(guessUnread(pkg)).toBeUndefined();
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

  // PeerTube's `server/package.json` names a package, a version and an export
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
