import { describe, expect, it } from 'vitest';
import { isTaken, type Takes } from './takes.js';

const CREATED: Takes = { kinds: ['objects:Created:*'] };
const COVERS: Takes = { kinds: ['objects:Created:*'], by: { field: 'Key', prefix: 'incoming/', suffix: '.png' } };

describe('what a consumer takes of its channel', () => {
  it('takes a kind by its family, or by itself', () => {
    expect(isTaken('objects:Created:Put', undefined, CREATED)).toEqual({ taken: 'static' });
    expect(isTaken('objects:Created:Put', undefined, { kinds: ['objects:Created:Put'] })).toEqual({ taken: 'static' });
    expect(isTaken('objects:Removed:Delete', undefined, CREATED)).toEqual({ taken: 'no' });
    expect(isTaken('objects:Created:Copy', undefined, { kinds: ['objects:Created:Put'] })).toEqual({ taken: 'no' });
  });

  it('meets a publish of any of a family and a consumer of one member as a guess', () => {
    expect(isTaken('objects:Created:*', undefined, { kinds: ['objects:Created:Put'] })).toMatchObject({ taken: 'heuristic' });
    expect(isTaken('objects:Created:*', undefined, CREATED)).toEqual({ taken: 'static' });
  });

  it('takes a value written out by its start and its end', () => {
    expect(isTaken('objects:Created:Put', { Key: ['incoming/a.png'] }, COVERS)).toEqual({ taken: 'static' });
    expect(isTaken('objects:Created:Put', { Key: ['incoming/a.jpg'] }, COVERS)).toEqual({ taken: 'no' });
    expect(isTaken('objects:Created:Put', { Key: ['thumbnails/a.png'] }, COVERS)).toEqual({ taken: 'no' });
  });

  it('takes a value written as a pattern where what it fixes says so, and guesses where the filter reaches past it', () => {
    expect(isTaken('objects:Created:Put', { Key: ['incoming/*.png'] }, COVERS)).toEqual({ taken: 'static' });
    expect(isTaken('objects:Created:Put', { Key: ['in*.png'] }, COVERS)).toEqual({
      taken: 'heuristic',
      because: 'Key is written as starting "in", and only one starting "incoming/" is taken',
    });
    expect(isTaken('objects:Created:Put', { Key: ['archive/*'] }, COVERS)).toEqual({ taken: 'no' });
  });

  it('guesses wherever the value filtered on is not read', () => {
    expect(isTaken('objects:Created:Put', undefined, COVERS)).toEqual({
      taken: 'heuristic',
      because: 'Key is not read, and only one starting "incoming/" and ending ".png" is taken',
    });
    expect(isTaken('objects:Removed:Delete', undefined, COVERS)).toEqual({ taken: 'no' });
  });

  it('takes any of several values that one does', () => {
    expect(isTaken('objects:Created:Put', { Key: ['a.txt', 'incoming/b.png'] }, COVERS)).toEqual({ taken: 'static' });
  });
});

describe('kinds a publish is also (P56)', () => {
  const MARKERS: Takes = {
    kinds: ['objects:Removed:Marker'],
    also: [{ kind: 'objects:Removed:Delete', as: 'objects:Removed:Marker', unless: 'Version' }],
  };

  it('takes a publish as the kind it also is, unless it wrote the field, read or not', () => {
    expect(isTaken('objects:Removed:Delete', undefined, MARKERS)).toEqual({ taken: 'static' });
    expect(isTaken('objects:Removed:Delete', { Version: ['v1'] }, MARKERS)).toEqual({ taken: 'no' });
    expect(isTaken('objects:Removed:Delete', { Version: [] }, MARKERS)).toEqual({ taken: 'no' });
    expect(isTaken('objects:Created:Put', undefined, MARKERS)).toEqual({ taken: 'no' });
  });

  it('still takes the kind as written', () => {
    expect(isTaken('objects:Removed:Delete', undefined, { ...MARKERS, kinds: ['objects:Removed:Delete'] })).toEqual({ taken: 'static' });
  });
});
