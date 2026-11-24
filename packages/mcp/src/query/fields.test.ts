import { describe, expect, it } from 'vitest';
import { shapeFields } from './fields.js';

describe('the fields of a shape', () => {
  it('gives up on a type that is made of itself, never walking it forever', () => {
    // A JSON-like alias, `type Json = string | Json[]`: its members name it again.
    const db = { type: (id: string) => ({ members: [id, 'string'] }) };
    expect(() => shapeFields(db as never, 'type:api#Json')).not.toThrow();
    expect(shapeFields(db as never, 'type:api#Json')).toBeUndefined();
  });
});
