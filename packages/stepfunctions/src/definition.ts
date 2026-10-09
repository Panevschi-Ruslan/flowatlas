import type { DefinitionPosition as Position, PathStep, PositionedDocument } from '@flowatlas/core';

/**
 * A state machine as a graph of named states, read from a positioned document.
 *
 * The definition is a composite: a `Parallel` state holds whole state machines
 * in its branches, and a `Map` state holds one as its item processor, each with
 * a `StartAt` and `States` of its own. Every consumer of a definition wants the
 * same flat answer to that - every state, where it is, and where control can go
 * from it - so the walk over the nesting is done once, here, and its result is
 * the list `states`. The emitter, the tests and anyone counting states iterate
 * that list; none of them recurses into a branch on its own.
 */

/** Every type of state the language has. */
export const STATE_TYPES = ['Task', 'Pass', 'Choice', 'Wait', 'Succeed', 'Fail', 'Parallel', 'Map'] as const;

export type StateType = (typeof STATE_TYPES)[number];

export const isStateType = (value: string): value is StateType =>
  (STATE_TYPES as readonly string[]).includes(value);

/**
 * How control reaches the next state, which is what an edge between two states
 * says about itself.
 *
 * `branch` is one branch of a `Parallel` starting, `item-processor` is the
 * machine a `Map` runs for each item starting; both go to the nested machine's
 * `StartAt`. `Retry` is not here: retrying runs the same state again, which is
 * a fact about the state rather than a way to another one.
 */
export const TRANSITION_KINDS = ['branch', 'item-processor', 'choice', 'default', 'next', 'catch'] as const;

export type TransitionKind = (typeof TRANSITION_KINDS)[number];

/** The expression language a state's fields are written in. */
export type QueryLanguage = 'JSONPath' | 'JSONata';

export interface Transition {
  readonly kind: TransitionKind;
  /** The state control goes to, by name. */
  readonly to: string;
  /** Where the field that names it is written. */
  readonly position?: Position;
  /** A `Choice` rule as written, without its `Next`. */
  readonly rule?: Readonly<Record<string, unknown>>;
  /** The errors a `Catch` catches, as written. */
  readonly errors?: readonly string[];
  /** Which branch of a `Parallel`, from 0. */
  readonly branch?: number;
  /** Which field holds a `Map`'s processor: the current name, or the older one. */
  readonly field?: 'ItemProcessor' | 'Iterator';
}

export interface State {
  readonly name: string;
  /** As written. One of `STATE_TYPES` in any definition the service accepts. */
  readonly type: string;
  readonly position?: Position;
  /**
   * The states it is nested in, outermost first: `[]` at the top, and for a
   * state in the second branch of `Notify`, `['Notify[1]']`.
   */
  readonly scope: readonly string[];
  readonly queryLanguage: QueryLanguage;
  /** `End: true`, or a type that always ends: `Succeed` and `Fail`. */
  readonly end: boolean;
  /**
   * Where control can go from here, in the order it gets there: nested machines
   * first, then the rules of a choice and its default, then `Next`, then the
   * catchers - and within each, the order the definition writes them in.
   */
  readonly transitions: readonly Transition[];
  /** The state's own fields, as written. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** Where the state is in the document, for asking where one of its fields is written. */
  readonly path: readonly PathStep[];
}

/** Something about a definition that keeps part of it from being read as written. */
export interface DefinitionProblem {
  readonly kind: 'not-a-state-machine' | 'unknown-state' | 'duplicate-state' | 'unknown-state-type';
  readonly message: string;
  readonly position?: Position;
  /** The state it is about, when it is about one. */
  readonly state?: string;
}

export interface StateMachine {
  readonly startAt: string;
  readonly queryLanguage: QueryLanguage;
  readonly comment?: string;
  readonly position?: Position;
  /** Every state, nested ones included, in the order the definition writes them. */
  readonly states: readonly State[];
  readonly problems: readonly DefinitionProblem[];
  /** Where any part of the document is written. */
  readonly at: (path: readonly PathStep[]) => Position | undefined;
}

type Fields = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A container of states: the machine itself, a branch, or a processor. */
type Machine = Fields & { readonly StartAt: string; readonly States: Fields };

const isMachine = (value: unknown): value is Machine =>
  isRecord(value) && typeof value['StartAt'] === 'string' && isRecord(value['States']);

/**
 * The machine a `Map` runs for each item, under whichever name it is written.
 *
 * `ItemProcessor` is the current name and `Iterator` the one it replaced; a
 * definition carries one or the other, and the current one is asked first.
 */
const processorOf = (
  fields: Fields,
): { field: 'ItemProcessor' | 'Iterator'; machine: Machine } | undefined => {
  for (const field of ['ItemProcessor', 'Iterator'] as const) {
    const machine = fields[field];
    if (isMachine(machine)) return { field, machine };
  }
  return undefined;
};

const languageOf = (fields: Fields, inherited: QueryLanguage): QueryLanguage => {
  const written = fields['QueryLanguage'];
  return written === 'JSONata' || written === 'JSONPath' ? written : inherited;
};

/** The types of state that end an execution by being reached. */
const TERMINAL_TYPES: ReadonlySet<string> = new Set(['Succeed', 'Fail']);

type Locate = (path: readonly PathStep[]) => Position | undefined;

/** Builds a transition with a position only where the document kept one. */
const transition = (
  kind: TransitionKind,
  to: string,
  position: Position | undefined,
  extra: Partial<Transition> = {},
): Transition => ({ kind, to, ...(position === undefined ? {} : { position }), ...extra });

/**
 * One reader per field that names where control goes, in the order a state's
 * transitions are listed.
 *
 * A list rather than a branch per state type: the language puts each of these
 * fields on whichever types may carry it, and a reader that asked "is this a
 * Choice?" before looking for `Choices` would be restating the specification
 * and could disagree with it. A field is read wherever it is written.
 */
const TRANSITION_READERS: ReadonlyArray<(fields: Fields, path: readonly PathStep[], at: Locate) => Transition[]> = [
  (fields, path, at) => {
    const branches = fields['Branches'];
    if (!Array.isArray(branches)) return [];
    return branches.flatMap((branch, index) =>
      isMachine(branch)
        ? [transition('branch', branch.StartAt, at([...path, 'Branches', index, 'StartAt']), { branch: index })]
        : [],
    );
  },
  (fields, path, at) => {
    const found = processorOf(fields);
    if (found === undefined) return [];
    const { field, machine } = found;
    return [transition('item-processor', machine.StartAt, at([...path, field, 'StartAt']), { field })];
  },
  (fields, path, at) => {
    const choices = fields['Choices'];
    if (!Array.isArray(choices)) return [];
    return choices.flatMap((choice, index) => {
      if (!isRecord(choice) || typeof choice['Next'] !== 'string') return [];
      const { Next: next, ...rule } = choice;
      return [transition('choice', next as string, at([...path, 'Choices', index, 'Next']), { rule })];
    });
  },
  (fields, path, at) =>
    typeof fields['Default'] === 'string' ? [transition('default', fields['Default'], at([...path, 'Default']))] : [],
  (fields, path, at) =>
    typeof fields['Next'] === 'string' ? [transition('next', fields['Next'], at([...path, 'Next']))] : [],
  (fields, path, at) => {
    const catchers = fields['Catch'];
    if (!Array.isArray(catchers)) return [];
    return catchers.flatMap((catcher, index) => {
      if (!isRecord(catcher) || typeof catcher['Next'] !== 'string') return [];
      const errors = Array.isArray(catcher['ErrorEquals'])
        ? catcher['ErrorEquals'].filter((error): error is string => typeof error === 'string')
        : [];
      return [transition('catch', catcher['Next'], at([...path, 'Catch', index, 'Next']), { errors })];
    });
  },
];

/** Transitions that stay within the container of the state they leave. */
const WITHIN_SCOPE: ReadonlySet<TransitionKind> = new Set(['choice', 'default', 'next', 'catch']);

/**
 * Reads a state machine out of a document.
 *
 * Never throws. A document that is not a state machine at all comes back with
 * no states and one problem saying so; a transition to a state that does not
 * exist is kept - it is what the definition says - and a problem names it, so
 * whoever draws the graph can decide what to do with an edge to nowhere.
 */
export const readStateMachine = (document: PositionedDocument): StateMachine => {
  const at: Locate = (path) => document.at(path);
  const root = document.value;
  const position = at([]);
  const located = position === undefined ? {} : { position };

  if (!isMachine(root)) {
    return {
      startAt: '',
      queryLanguage: 'JSONPath',
      ...located,
      states: [],
      problems: [
        {
          kind: 'not-a-state-machine',
          message: 'the document has no StartAt naming a state and no States holding them',
          ...located,
        },
      ],
      at,
    };
  }

  const states: State[] = [];
  const problems: DefinitionProblem[] = [];
  const seen = new Set<string>();
  const problem = (entry: DefinitionProblem): void => {
    problems.push(entry);
  };

  const walk = (
    container: Machine,
    path: readonly PathStep[],
    scope: readonly string[],
    inherited: QueryLanguage,
  ): void => {
    const names = new Set(Object.keys(container.States));
    if (!names.has(container.StartAt)) {
      const where = at([...path, 'StartAt']);
      problem({
        kind: 'unknown-state',
        message: `StartAt names ${JSON.stringify(container.StartAt)}, which is not a state ${scope.length === 0 ? 'of the machine' : `of ${scope[scope.length - 1]}`}`,
        ...(where === undefined ? {} : { position: where }),
      });
    }

    for (const [name, raw] of Object.entries(container.States)) {
      const statePath = [...path, 'States', name];
      const where = at(statePath);
      const placed = where === undefined ? {} : { position: where };
      if (!isRecord(raw)) {
        problem({ kind: 'unknown-state-type', message: `${name} is not an object`, state: name, ...placed });
        continue;
      }
      if (seen.has(name)) {
        problem({
          kind: 'duplicate-state',
          message: `${name} is the name of two states; a name must be unique across the whole machine`,
          state: name,
          ...placed,
        });
        continue;
      }
      seen.add(name);

      const type = typeof raw['Type'] === 'string' ? raw['Type'] : '';
      if (!isStateType(type)) {
        problem({
          kind: 'unknown-state-type',
          message: `${name} has type ${JSON.stringify(type)}, which is not a type of state`,
          state: name,
          ...placed,
        });
      }

      const transitions = TRANSITION_READERS.flatMap((read) => read(raw, statePath, at));
      for (const each of transitions) {
        if (!WITHIN_SCOPE.has(each.kind) || names.has(each.to)) continue;
        problem({
          kind: 'unknown-state',
          message: `${name} goes to ${JSON.stringify(each.to)} (${each.kind}), which is not a state beside it`,
          state: name,
          ...(each.position === undefined ? placed : { position: each.position }),
        });
      }

      const language = languageOf(raw, inherited);
      states.push({
        name,
        type,
        ...placed,
        scope,
        queryLanguage: language,
        end: raw['End'] === true || TERMINAL_TYPES.has(type),
        transitions,
        fields: raw,
        path: statePath,
      });

      // Nested machines straight after the state that holds them, so the list
      // reads in the order the document does.
      const branches = raw['Branches'];
      if (Array.isArray(branches)) {
        branches.forEach((branch, index) => {
          if (isMachine(branch)) walk(branch, [...statePath, 'Branches', index], [...scope, `${name}[${index}]`], language);
        });
      }
      const processor = processorOf(raw);
      if (processor !== undefined) walk(processor.machine, [...statePath, processor.field], [...scope, name], language);
    }
  };

  const queryLanguage = languageOf(root, 'JSONPath');
  walk(root, [], [], queryLanguage);

  const comment = typeof root['Comment'] === 'string' ? root['Comment'] : undefined;
  return {
    startAt: root.StartAt,
    queryLanguage,
    ...(comment === undefined ? {} : { comment }),
    ...located,
    states,
    problems,
    at,
  };
};
