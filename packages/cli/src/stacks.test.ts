import { describe, expect, it } from 'vitest';
import { guessType, guessUnread, noReaderNote, UNKNOWN_TYPE } from './stacks.js';

describe('the stack a repository is built on', () => {
  it('names a type it can read', () => {
    expect(guessType({ dependencies: { '@nestjs/core': '10.0.0' } })).toBe('nestjs');
    expect(guessType({ dependencies: { '@angular/core': '17.0.0' } })).toBe('angular');
    expect(guessType({ dependencies: { express: '4.19.0' } })).toBe('express');
    expect(guessType({ dependencies: { fastify: '5.2.1' } })).toBe('fastify');
    expect(guessType({ dependencies: { koa: '2.15.0' } })).toBe('koa');
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
    expect(guessUnread({ dependencies: { next: '15.0.0' } })).toBe('Next.js');
    expect(guessUnread({ dependencies: { react: '18.2.0' } })).toBe('React');
    expect(guessUnread({ devDependencies: { svelte: '5.0.0' } })).toBe('Svelte');
  });

  it('says nothing about a manifest that gave nothing away', () => {
    expect(guessType({ dependencies: { lodash: '4.0.0' } })).toBe(UNKNOWN_TYPE);
    expect(guessUnread({ dependencies: { lodash: '4.0.0' } })).toBeUndefined();
    expect(noReaderNote({ dependencies: { lodash: '4.0.0' } })).toBeUndefined();
    expect(noReaderNote(undefined)).toBeUndefined();
  });

  it('writes the note a build prints beside a repository it skipped', () => {
    expect(noReaderNote({ dependencies: { next: '15.0.0' } })).toBe('Next.js, no reader yet');
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
