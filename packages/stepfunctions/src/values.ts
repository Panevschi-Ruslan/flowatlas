import { DEPLOYED_FORMS, deployedArn } from '@flowatlas/aws';
import { nameInForms } from '@flowatlas/core';
import type { State } from './definition.js';

/**
 * A field of a definition read as written, and only as written.
 *
 * A state names what it calls in a field, and the field is one of three
 * things: a literal, an expression the service evaluates when the state runs,
 * or text with a `${...}` placeholder that whatever deploys the definition
 * fills in first. Only the first is a name this tool may join on. The other two
 * are recorded with why they could not be read, and never evaluated, completed
 * or guessed at (I3): a function chosen by JSONPath is chosen at run time, and
 * the tool has nothing to say about which.
 */

/**
 * Why a field could not be read as a name before the machine runs.
 *
 * `jsonpath`   written under a `.$` key, so the service evaluates it
 * `jsonata`    written as `{% ... %}`, an expression the service evaluates
 * `intrinsic`  a `States.` function, evaluated by the service
 * `template`   holds a `${...}` placeholder nothing here could fill
 * `absent`     the field is not written at all
 * `not-text`   the field holds something other than a string
 * `not-a-name` a string, but not one that names anything of the kind asked for
 */
export const UNREAD_CAUSES = [
  'jsonpath',
  'jsonata',
  'intrinsic',
  'template',
  'absent',
  'not-text',
  'not-a-name',
] as const;

export type UnreadCause = (typeof UNREAD_CAUSES)[number];

export type Reading =
  | { readonly read: true; readonly value: string; readonly written: string }
  | {
      readonly read: false;
      readonly cause: UnreadCause;
      readonly written: string;
      /** For `template`: the placeholders nothing filled, as written inside `${}`. */
      readonly variables?: readonly string[];
    };

/**
 * What a `${name}` placeholder stands for, when whoever deploys the definition
 * says, and `undefined` when nothing does.
 *
 * Injected rather than looked up, because what fills a placeholder is a fact
 * about the file the definition is deployed from, not about the definition: a
 * template rendered with its variables bound answers for them, and a definition
 * read on its own answers for none.
 */
export type TemplateValues = (variable: string) => string | undefined;

export const NO_TEMPLATE_VALUES: TemplateValues = () => undefined;

const PLACEHOLDER = /\$\{([^}]*)\}/g;

const JSONATA = /^\s*\{%[\s\S]*%\}\s*$/;

const unread = (cause: UnreadCause, written: string, variables?: readonly string[]): Reading => ({
  read: false,
  cause,
  written,
  ...(variables === undefined ? {} : { variables }),
});

/** A value written in place, read: placeholders filled where `values` can fill them. */
export const readText = (written: unknown, values: TemplateValues = NO_TEMPLATE_VALUES): Reading => {
  if (written === undefined) return unread('absent', '');
  if (typeof written !== 'string') return unread('not-text', JSON.stringify(written));
  if (JSONATA.test(written)) return unread('jsonata', written);
  const unbound: string[] = [];
  const value = written.replace(PLACEHOLDER, (whole, name: string) => {
    const filled = values(name.trim());
    if (filled !== undefined) return filled;
    unbound.push(name.trim());
    return whole;
  });
  if (unbound.length > 0) return unread('template', written, unbound);
  return { read: true, value, written };
};

/** An expression under a `.$` key: a path, or an intrinsic function over paths. */
const evaluated = (written: unknown): Reading => {
  const text = typeof written === 'string' ? written : JSON.stringify(written);
  return unread(text.trim().startsWith('States.') ? 'intrinsic' : 'jsonpath', text);
};

/**
 * One field of a record, as the state's language says to read it: `key.$`
 * first, because in JSONPath that is how a field says it is evaluated, then
 * `key` itself.
 */
export const readField = (
  record: unknown,
  key: string,
  values: TemplateValues = NO_TEMPLATE_VALUES,
): Reading => {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return unread('absent', '');
  const fields = record as Readonly<Record<string, unknown>>;
  if (Object.hasOwn(fields, `${key}.$`)) return evaluated(fields[`${key}.$`]);
  return readText(Object.hasOwn(fields, key) ? fields[key] : undefined, values);
};

/**
 * The parameters a task is given, as a reader of one field at a time.
 *
 * `Parameters` in JSONPath and `Arguments` in JSONata. The whole of it may be an
 * expression - `Parameters.$`, or `Arguments` written as `{% ... %}` - and then
 * every field reads as that expression, because none of them is written
 * anywhere on its own.
 */
export interface ParameterReader {
  /** A field of the parameters, or of a record found inside them. */
  read(key: string, within?: unknown): Reading;
  /** A field of the parameters as written, for a classifier walking into one. */
  raw(key: string): unknown;
  /**
   * A field kept as written, under the key it is written with - `key.$` where
   * the service evaluates it - or `undefined` where it is not written at all.
   */
  written(key: string, within?: unknown): Readonly<Record<string, unknown>> | undefined;
}

export const parametersOf = (state: State, values: TemplateValues = NO_TEMPLATE_VALUES): ParameterReader => {
  const fields = state.fields;
  const whole: Reading | undefined = Object.hasOwn(fields, 'Parameters.$')
    ? evaluated(fields['Parameters.$'])
    : typeof fields['Arguments'] === 'string'
      ? readText(fields['Arguments'], values)
      : undefined;
  const record = fields['Arguments'] ?? fields['Parameters'];
  if (whole !== undefined && !whole.read) {
    return { read: () => whole, raw: () => undefined, written: () => undefined };
  }
  return {
    read: (key, within = record) => readField(within, key, values),
    written: (key, within = record) => {
      if (typeof within !== 'object' || within === null || Array.isArray(within)) return undefined;
      const fields = within as Readonly<Record<string, unknown>>;
      const written = [`${key}.$`, key].find((name) => Object.hasOwn(fields, name));
      return written === undefined ? undefined : { [written]: fields[written] };
    },
    raw: (key) =>
      typeof record === 'object' && record !== null && !Array.isArray(record)
        ? (record as Readonly<Record<string, unknown>>)[key]
        : undefined,
  };
};

/**
 * Stands in for a placeholder while a name is looked for around it.
 *
 * A character from the private-use area, written as an escape: nothing a
 * deployment names contains it, so a name that does was built from a
 * placeholder and is not a name.
 */
const MASK = '\uE000';

/**
 * A name taken out of what a field holds, by `extract`.
 *
 * A field that was read is handed over whole. A field with a placeholder in it
 * may still name something exactly - `arn:aws:lambda:${region}:${account}:function:notify-borrower`
 * names `notify-borrower` whatever the region turns out to be - so the
 * placeholders are masked, and the name counts only if no part of it was one.
 * Everything else stays unread with the cause it already had.
 */
export const nameIn = (reading: Reading, extract: (text: string) => string | undefined): Reading => {
  if (reading.read) {
    const name = extract(reading.value);
    return name === undefined ? unread('not-a-name', reading.written) : { read: true, value: name, written: reading.written };
  }
  if (reading.cause !== 'template') return reading;
  const name = extract(reading.written.replace(PLACEHOLDER, MASK));
  return name === undefined || name.includes(MASK) ? reading : { read: true, value: name, written: reading.written };
};

/**
 * A name of one kind out of what a field holds.
 *
 * The ARN or URL it may be written inside is read in the forms every reader of
 * a deployed name shares (`@flowatlas/aws`); `bare` reads the shorter ways a
 * field of this kind also accepts, and `valid` is what a name of the kind may
 * be made of, placeholders masked included, so text that only looks like one -
 * a sentence, a path - names nothing.
 */
const named =
  (kind: keyof typeof DEPLOYED_FORMS, valid: RegExp, bare?: (text: string) => string | undefined) =>
  (text: string): string | undefined => {
    const trimmed = text.trim();
    const name = nameInForms(trimmed, DEPLOYED_FORMS[kind]) ?? bare?.(trimmed);
    return name !== undefined && valid.test(name) ? name : undefined;
  };

const NAME = /^[A-Za-z0-9_\uE000-]+$/;
const QUEUE_OR_TOPIC = /^[A-Za-z0-9_\uE000-]+(?:\.fifo)?$/;

/**
 * A function, from its ARN or the shorter ways the service accepts -
 * `123456789012:function:notify-borrower`, `function:notify-borrower`,
 * `notify-borrower` - which are its ARN with the front left off; any version or
 * alias after it is dropped, since the name is what is deployed.
 */
export const functionName = named('function', NAME, (text) =>
  nameInForms(deployedArn('function', text.replace(/^(?:[^:]+:)?function:/, '')), DEPLOYED_FORMS.function),
);

/** A state machine, from its ARN, with any version or alias after it dropped. */
export const stateMachineName = named('workflow', NAME);

/** A queue, from its URL or its ARN. */
export const queueName = named('queue', QUEUE_OR_TOPIC);

/** A topic, from its ARN. */
export const topicName = named('topic', QUEUE_OR_TOPIC);

/** A table, from its name or its ARN. */
export const tableName = named('table', /^[A-Za-z0-9_.\uE000-]+$/, (text) => text);

/** An event bus, from its name or its ARN. */
export const eventBusName = named('bus', /^[A-Za-z0-9_./\uE000-]+$/, (text) => text);
