import { formatTypeRef, type TypeRef, type TypeRefAst } from '@flowatlas/core';
import type { State, StateMachine } from './definition.js';

/**
 * What a workflow requires of the input it is started with, as far as its
 * first state says (R172).
 *
 * A state written in JSONPath reads its input by path: `"borrowerId.$":
 * "$.borrowerId"` fails the run when the input has no `borrowerId`. The paths
 * the first state reads through `InputPath`, `Parameters`, `ItemSelector` and
 * `ItemsPath` are therefore keys the input must have, written as a shape whose
 * values are unknown - only their presence is required. Later states read what
 * earlier ones left behind as much as what the input held, so they are not
 * asked; that is why the shape is a lower bound, and why the entry says the
 * rest of its input travels on.
 */

/** A path into the input: `$`, then keys. A context path, `$$`, reads no input. */
const INPUT_PATH = /(?<![$\w])\$((?:\.[^\s.,()'"[\]*$]+)*)/g;

/** The keys of every input path written in a text, each up to the first step that is not a plain key. */
const pathsIn = (text: string): string[][] =>
  [...text.matchAll(INPUT_PATH)].map((match) => (match[1] ?? '').split('.').filter((key) => key !== ''));

/** Every input path a field reads: the values of keys ending `.$`, at any depth, and intrinsic functions' arguments. */
const pathsOfTemplate = (value: unknown): string[][] => {
  if (Array.isArray(value)) return value.flatMap(pathsOfTemplate);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key.endsWith('.$') && typeof inner === 'string' ? pathsIn(inner) : pathsOfTemplate(inner),
  );
};

/** Nested keys, each required, as an inline shape whose leaves are unknown. */
interface Keys {
  [key: string]: Keys;
}

const shapeOf = (keys: Keys): TypeRefAst => {
  const names = Object.keys(keys).sort();
  if (names.length === 0) return { kind: 'primitive', name: 'unknown' };
  return {
    kind: 'object',
    fields: names.map((name) => ({ name, optional: false, type: shapeOf(keys[name] as Keys) })),
  };
};

const add = (keys: Keys, path: readonly string[]): void => {
  let level = keys;
  for (const key of path) level = level[key] ??= {};
};

/** The input paths the state reads, relative to the input it is started with; `undefined` when it discards its input. */
const readPaths = (state: State): string[][] | undefined => {
  const inputPath = state.fields['InputPath'];
  if (inputPath === null) return undefined;
  const [prefix = []] = typeof inputPath === 'string' ? pathsIn(inputPath) : [[]];
  const relative = [
    ...pathsOfTemplate(state.fields['Parameters']),
    ...pathsOfTemplate(state.fields['ItemSelector']),
    ...(typeof state.fields['ItemsPath'] === 'string' ? pathsIn(state.fields['ItemsPath']) : []),
  ];
  return [prefix, ...relative.map((path) => [...prefix, ...path])].filter((path) => path.length > 0);
};

/**
 * The shape of input the machine's first state requires, or `undefined` when
 * it requires nothing it says: a state written in JSONata, a state that reads
 * its input whole, or a first state that is not at the top of the machine.
 */
export const requiredInput = (machine: StateMachine): TypeRef | undefined => {
  const first = machine.states.find((state) => state.name === machine.startAt && state.scope.length === 0);
  if (first === undefined || first.queryLanguage !== 'JSONPath') return undefined;
  const paths = readPaths(first);
  if (paths === undefined || paths.length === 0) return undefined;
  const keys: Keys = {};
  for (const path of paths) add(keys, path);
  return formatTypeRef(shapeOf(keys));
};
