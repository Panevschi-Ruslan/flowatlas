import { createHash } from 'node:crypto';

/**
 * A short name for every node that a link can carry across a rebuild.
 *
 * A node's position in the page moves whenever a node with a smaller id comes
 * or goes, so a link naming a position opens some other node after the next
 * build. Its graph id does not move, but it is long (`db:api#src/orders.repo.ts:7`)
 * and the page does not ship it. A few characters of a hash of the id are both
 * short and stable: the same id spells the same key in every build.
 *
 * Six characters, the first a letter so a key is never mistaken for one of the
 * positions older links carry, the rest letters and digits: 1.6 billion keys,
 * so the odds that any two of twelve thousand nodes share one are about one in
 * twenty, and that a node added later takes the key of one already there about
 * one in a hundred thousand.
 *
 * When two ids do spell the same key, neither keeps it: each spells as many more
 * characters of its own hash as it takes to differ from the other, so each key
 * still depends on nothing but its id and the ids it collides with. The short
 * key they shared names both, and a link that carries it - made before the
 * second one arrived - is answered with the two to choose from, never with one
 * of them picked silently.
 */
export const KEY_WIDTH = 6;

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALPHABET = `0123456789${LETTERS}`;

/** Bytes a key is spelled from; one character per byte, so its length bounds a key's. */
export type Digest = (id: string) => Uint8Array;

export const sha256: Digest = (id) => createHash('sha256').update(id).digest();

const spell = (bytes: Uint8Array, length: number): string => {
  let key = LETTERS[bytes[0]! % LETTERS.length]!;
  for (let i = 1; i < length; i += 1) key += ALPHABET[bytes[i]! % ALPHABET.length];
  return key;
};

/**
 * The keys as shipped: every node's short key, `width` characters each, in node
 * order, as one string, which costs a quarter less than a list of strings; and
 * apart from that the longer key of each node whose short key another node also
 * spells, by position. A short key in `all` of a node in `longer` is shared, and
 * names every node that spells it.
 */
export interface PackedKeys {
  width: number;
  all: string;
  longer: Record<string, string>;
}

export interface KeyOptions {
  width?: number;
  digest?: Digest;
}

/** Every node's key, by position: short, unless another id spells the same one. */
export const stableKeys = (ids: readonly string[], options: KeyOptions = {}): PackedKeys => {
  const width = options.width ?? KEY_WIDTH;
  const digest = options.digest ?? sha256;
  const digests = ids.map(digest);
  const short = digests.map((bytes) => spell(bytes, width));

  const sharing = new Map<string, number[]>();
  short.forEach((key, i) => {
    const list = sharing.get(key);
    if (list === undefined) sharing.set(key, [i]);
    else list.push(i);
  });

  const longer: Record<string, string> = {};
  for (const members of sharing.values()) {
    if (members.length === 1) continue;
    for (const i of members) {
      const bytes = digests[i]!;
      let length = width + 1;
      const clashes = (at: number): boolean =>
        members.some((j) => j !== i && spell(digests[j]!, at) === spell(bytes, at));
      while (length <= bytes.length && clashes(length)) length += 1;
      if (length > bytes.length) {
        throw new Error(`two nodes spell the same key: ${ids[i]} and another; their ids must differ`);
      }
      longer[String(i)] = spell(bytes, length);
    }
  }
  return { width, all: short.join(''), longer };
};
