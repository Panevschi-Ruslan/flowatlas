import { resolve } from 'node:path';
import { parseConfig } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { deployedSourceDirectories } from './deployed-sources.js';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');
const config = parseConfig({});

/** The directories a deployment packages from are source roots of the service (R170). */
describe('the source directories a deployment names', () => {
  it('names a directory beside src that the tsconfig does not', () => {
    expect(deployedSourceDirectories(resolve(FIXTURES, 'lambda-functions-beside-src'), config)).toEqual([
      'functions',
    ]);
  });

  it('maps compiled output back to the source it came from', () => {
    // `dist/returns` is the returns function's package; the tsconfig compiled it from `src/returns`.
    expect(deployedSourceDirectories(resolve(FIXTURES, 'lambda-terraform-rest'), config)).toEqual([
      'src/loans',
      'src/reminders',
      'src/returns',
    ]);
  });

  it('names nothing for a repository whose deployment is not read', () => {
    expect(deployedSourceDirectories(resolve(FIXTURES, 'nest-basic'), config)).toEqual([]);
  });
});
