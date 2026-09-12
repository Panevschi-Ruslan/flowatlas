/**
 * The sentence a reader acts on.
 *
 * Written once, here, because the same disagreement is printed in four places —
 * the terminal, the document, the JSON file and the answer an agent gets — and
 * a finding whose wording changes with where it is read is a finding nobody can
 * search for.
 */
import type { FieldDiff, FindingKind } from './types.js';

/** Who the two ends are, when the caller knows. `the sender` when it does not. */
export interface Parties {
  sender?: string;
  receiver?: string;
}

const sender = (parties: Parties): string =>
  parties.sender === undefined ? 'the sender' : `sender ${parties.sender}`;

const receiver = (parties: Parties): string =>
  parties.receiver === undefined ? 'the receiver' : `receiver ${parties.receiver}`;

/** `` `items[].price: number` ``, or just the type when the whole shape is meant. */
const shown = (field: string, type: string | null): string =>
  field === '' ? `\`${type ?? 'nothing'}\`` : `\`${field}: ${type ?? 'nothing'}\``;

/** `` `items[].price` ``, or `the whole shape` at the top of the type. */
const named = (field: string): string => (field === '' ? 'the whole shape' : `\`${field}\``);

const SENTENCE: Record<FindingKind, (diff: FieldDiff, parties: Parties) => string> = {
  missing_required: (diff, parties) =>
    `${receiver(parties)} requires ${shown(diff.path, diff.expected)}; ${sender(parties)} does not send it`,
  type_mismatch: (diff, parties) => {
    // A collection JSON cannot carry is reported whatever the two declarations
    // say, including when they agree, so the usual "sends X where Y is
    // expected" would be beside the point and sometimes read as nonsense.
    if (diff.rule === 'set-map-json') {
      return `${named(diff.path)} is a Set or a Map; JSON carries neither, so what ${receiver(parties)} reads is whatever a replacer wrote by hand`;
    }
    return diff.path === ''
      ? `${sender(parties)} sends ${shown('', diff.actual)} where ${receiver(parties)} expects ${shown('', diff.expected)}`
      : `${sender(parties)} sends \`${diff.path}\` as \`${diff.actual ?? 'nothing'}\`; ${receiver(parties)} declares it \`${diff.expected ?? 'nothing'}\``;
  },
  optionality_mismatch: (diff, parties) =>
    diff.optionalOn === 'receiver'
      ? `${named(diff.path)} is optional for ${receiver(parties)} and always sent by ${sender(parties)}`
      : `${named(diff.path)} may be left out by ${sender(parties)} and is required by ${receiver(parties)}`,
  extra_field: (diff, parties) =>
    `${sender(parties)} sends ${shown(diff.path, diff.actual)}; ${receiver(parties)} declares no such field`,
};

/** The sentence for one disagreement, with the two services named when known. */
export const describeDiff = (diff: FieldDiff, parties: Parties = {}): string => {
  const sentence = SENTENCE[diff.kind](diff, parties);
  return diff.note === null || diff.note === undefined ? sentence : `${sentence}; ${diff.note}`;
};
