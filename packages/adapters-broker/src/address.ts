import {
  ADDRESS_SEPARATOR,
  locatedSlots,
  nameWithin,
  type AwaitedPart,
  locatorApplies,
  locatorIsCondition,
  MOST_CHOICES,
  parameterBehind,
  type AddressPart,
  type FlowatlasConfig,
  type LocatedSlot,
  type LocatorContext,
  type LocatorSite,
  type NameLocator,
} from '@flowatlas/core';
import { Node, VariableDeclarationKind, type Node as TsNode, type ParameterDeclaration } from 'ts-morph';
import {
  isResolved,
  resolveChannelName,
  type ChannelResolution,
  type ChannelVia,
  type ResolvedChannel,
} from './channel-name.js';

/**
 * Reading an address that may be written in parts, and once per element of a list.
 *
 * Most transports name a message with one word written in one place, and every
 * reader of a channel used to ask exactly that: which expression is the name.
 * Two shapes did not fit. A client that sends commands names the message by
 * several words that only together say where it goes, and a client that sends a
 * batch names one address per entry of a list. Both are the same question asked
 * of more than one place, so the answer here is the old one - the first locator
 * that yields a readable name wins, a refusal names the place it looked - asked
 * once per part and once per element, and joined.
 *
 * A one-part address read once is exactly the answer the reader gave before
 * there were parts, which is what lets every description written before keep
 * reading as it did.
 */

/**
 * Where a description says its address is written, from whichever spelling it uses.
 *
 * Three spellings and one statement: `channelArg: n` is `channel: [argument n]`,
 * which is `address: [{ at: [argument n] }]`. `-1` has always meant "not an
 * argument at all", which reads as whatever `channel` says. Expanded here and
 * nowhere else, so the spellings cannot come to disagree.
 */
export const addressOf = (pattern: {
  readonly address?: readonly AddressPart[];
  readonly channel?: readonly NameLocator[];
  readonly channelArg: number;
}): readonly AddressPart[] =>
  pattern.address ?? [
    {
      at:
        pattern.channel ??
        (pattern.channelArg < 0 ? [] : [{ kind: 'argument', index: pattern.channelArg }]),
    },
  ];

/**
 * Whether a call is of the shape its pattern describes at all.
 *
 * A client that sends commands sends every kind through one method, and a
 * pattern naming the command it reads applies only to the calls that send one:
 * the rest are other operations, not publishes whose channel could not be read.
 * A pattern whose locators name no command applies wherever it matched.
 */
export const appliesAt = (
  site: LocatorSite,
  pattern: Parameters<typeof addressOf>[0] & { readonly payload?: readonly NameLocator[] },
): boolean => {
  const conditions = [
    ...addressOf(pattern).flatMap((part) => ('literal' in part ? [] : part.at)),
    ...(pattern.payload ?? []),
  ].filter(locatorIsCondition);
  return conditions.length === 0 || conditions.some((locator) => locatorApplies(site, locator));
};

/**
 * A part an address could not be read without, waiting for its value.
 *
 * The one refusal with a known remedy: a part that is the value of an
 * environment variable is read by whoever reads the deployment that sets it.
 * Recorded with the spellings the part may be written in, so that the reader
 * that finds the value arrives at the name this one would have. The shape is
 * the core's, because the linker is what completes it (P23).
 */
export type { AwaitedPart };

/** One address a call is sent to, and the message it carries there. */
export interface AddressedElement {
  readonly resolution: ChannelResolution;
  /** What the message is written as at this element, past `JSON.stringify`. */
  readonly payload?: TsNode;
  /**
   * The address with every unread part named by its variable, where nothing
   * but environment variables stood in the way.
   */
  readonly awaiting?: readonly AwaitedPart[];
  /**
   * The parameter of the enclosing function a one-part address is, where it is
   * one: the address is decided by whoever calls that function, and is read
   * there rather than here.
   */
  readonly parameter?: ParameterDeclaration;
  /** A one-part address as it is written, for a reader that keys on the writing. */
  readonly written?: string;
}

/**
 * The name inside a longer spelling of it - the core's, because the linker
 * reads a value of the environment through the same forms (P23).
 */
export { nameWithin };

const withForms = (resolved: ResolvedChannel, forms: readonly string[] | undefined): ResolvedChannel =>
  forms === undefined
    ? resolved
    : {
        ...resolved,
        name: nameWithin(resolved.name, forms),
        names: [...new Set(resolved.names.map((name) => nameWithin(name, forms)))],
      };

/** The slot a list of slots holds at one element: a single place stands for every element. */
const slotAt = (slots: readonly LocatedSlot[], index: number): LocatedSlot =>
  slots.length === 1 ? slots[0] : slots[index];

/**
 * One part at one element.
 *
 * The first locator that yields a readable name wins, and a refusal names the
 * first place that was looked at - the reading every channel has always had.
 * Nothing written anywhere is the one case a description may fill in, and only
 * with the value it states.
 */
const readPart = (
  part: AddressPart,
  located: readonly (readonly LocatedSlot[])[],
  index: number,
  config: Pick<FlowatlasConfig, 'sharedPackages'>,
  fallback: string,
): ChannelResolution => {
  if ('literal' in part) return { name: part.literal, names: [part.literal], via: 'literal' };
  const written = located
    .map((slots) => slotAt(slots, index))
    .filter((slot): slot is NonNullable<LocatedSlot> => slot !== undefined);
  if (written.length === 0) {
    return part.absent === undefined
      ? { unresolved: 'channel-dynamic', text: fallback }
      : { name: part.absent, names: [part.absent], via: 'literal' };
  }
  const resolutions = written.map((slot) => resolveChannelName(slot.expression, config));
  const found = resolutions.find(isResolved) ?? (resolutions[0] as ChannelResolution);
  return isResolved(found) ? withForms(found, part.forms) : found;
};

/**
 * The parts of one element joined into its channels.
 *
 * Every combination of what each part can be, up to the same number of names
 * one address may stand for anywhere else; past it the address names too many
 * channels to be useful and is refused rather than cut short, because keeping
 * some of them would say the others are not reached. A part that could not be
 * read leaves the whole address unread: half an address joins nothing it should.
 */
const joined = (readings: readonly ChannelResolution[], fallback: string): ChannelResolution => {
  const failed = readings.find((reading) => !isResolved(reading));
  if (failed !== undefined) return failed;
  const parts = readings as readonly ResolvedChannel[];
  if (parts.length === 1) return parts[0] as ResolvedChannel;
  let names: string[] = [''];
  for (const [position, part] of parts.entries()) {
    if (names.length * part.names.length > MOST_CHOICES) return { unresolved: 'channel-dynamic', text: fallback };
    names = names.flatMap((head) =>
      part.names.map((name) => (position === 0 ? name : `${head}${ADDRESS_SEPARATOR}${name}`)),
    );
  }
  const via: ChannelVia = parts.some((part) => part.via === 'template')
    ? 'template'
    : (parts.at(-1) as ResolvedChannel).via;
  return {
    name: parts.map((part) => part.name).join(ADDRESS_SEPARATOR),
    names: [...new Set(names)],
    via,
  };
};

/**
 * The address with each part that waits on an environment variable named by it.
 *
 * Only where that is all that is missing and every other part is one name: an
 * address that is also built at run time somewhere else is not one variable
 * away from being read, and saying it is would promise a reader of the
 * deployment an answer it cannot give.
 */
const awaitingOf = (
  parts: readonly AddressPart[],
  readings: readonly ChannelResolution[],
): readonly AwaitedPart[] | undefined => {
  const awaited: AwaitedPart[] = [];
  for (const [position, reading] of readings.entries()) {
    const part = parts[position];
    if (isResolved(reading)) {
      if (reading.names.length !== 1) return undefined;
      awaited.push(reading.name);
      continue;
    }
    if (reading.unresolved !== 'channel-from-environment' || reading.variable === undefined) return undefined;
    const forms = part === undefined || 'literal' in part ? undefined : part.forms;
    awaited.push(forms === undefined ? { environment: reading.variable } : { environment: reading.variable, forms });
  }
  return awaited.some((each) => typeof each !== 'string') ? awaited : undefined;
};

/** How many links of `const` and `JSON.stringify` are followed to the message. */
const MOST_LINKS = 8;

/**
 * The value a message is made from, where it is sent as text.
 *
 * `JSON.stringify(loan)` sends the loan, and the receiver parses the loan back
 * out: comparing the two ends on `string` would compare nothing. The same seen
 * through a `const` the text was bound to a statement earlier.
 */
export const messageValue = (expression: TsNode): TsNode => {
  let current = expression;
  for (let link = 0; link < MOST_LINKS; link += 1) {
    if (Node.isParenthesizedExpression(current) || Node.isAsExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isCallExpression(current) && current.getExpression().getText() === 'JSON.stringify') {
      const [value] = current.getArguments();
      if (value === undefined) return current;
      current = value;
      continue;
    }
    if (Node.isIdentifier(current)) {
      const declaration = current.getSymbol()?.getDeclarations()[0];
      const initializer =
        declaration !== undefined &&
        Node.isVariableDeclaration(declaration) &&
        declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
          ? declaration.getInitializer()
          : undefined;
      if (initializer !== undefined && Node.isCallExpression(initializer)) {
        current = initializer;
        continue;
      }
    }
    return current;
  }
  return current;
};

/** The message at one element: the first place a payload locator reached in full. */
const payloadAt = (
  located: readonly (readonly LocatedSlot[])[],
  index: number,
): TsNode | undefined => {
  for (const slots of located) {
    const slot = slotAt(slots, index);
    if (slot !== undefined && slot.reached) return messageValue(slot.expression);
  }
  return undefined;
};

/**
 * The parameter a value written in an address is, if it is one.
 *
 * `{ stateMachineArn }` names the value it copies through a symbol of its own,
 * which asking the property would miss.
 */
const parameterOf = (expression: TsNode): ParameterDeclaration | undefined => {
  const parent = expression.getParent();
  if (parent !== undefined && Node.isShorthandPropertyAssignment(parent)) {
    const declaration = parent.getValueSymbol()?.getDeclarations()[0];
    return declaration !== undefined && Node.isParameterDeclaration(declaration) ? declaration : undefined;
  }
  return parameterBehind(expression);
};

/** The one place a one-part address is written at an element, when it is written. */
const writtenAt = (located: readonly (readonly LocatedSlot[])[], index: number): TsNode | undefined =>
  located.map((slots) => slotAt(slots, index)).find((slot) => slot !== undefined)?.expression;

/**
 * Every address a call is sent to, one per element, with the message it carries.
 *
 * As many elements as the longest list a part's locators walked, and one when
 * none walked a list. The message is read at the same element as the address;
 * a payload that walks a list the address does not - a batch sent to one queue -
 * is read at its first element, because the address is one and so is the edge.
 */
export const readAddress = (
  site: LocatorSite,
  parts: readonly AddressPart[],
  payload: readonly NameLocator[] | undefined,
  context: LocatorContext,
  config: Pick<FlowatlasConfig, 'sharedPackages'>,
  fallback: string,
): AddressedElement[] => {
  const located = parts.map((part) =>
    'literal' in part ? [] : part.at.map((locator) => locatedSlots(site, locator, context)),
  );
  const payloads = (payload ?? []).map((locator) => locatedSlots(site, locator, context));
  const count = Math.max(1, ...located.flat().map((slots) => slots.length));
  return Array.from({ length: count }, (_, index) => {
    const readings = parts.map((part, position) =>
      readPart(part, located[position] ?? [], index, config, fallback),
    );
    const message = payloadAt(payloads, index);
    const awaiting = awaitingOf(parts, readings);
    const resolution = joined(readings, fallback);
    const written = parts.length === 1 ? writtenAt(located[0] ?? [], index) : undefined;
    const parameter = written === undefined || isResolved(resolution) ? undefined : parameterOf(written);
    return {
      resolution,
      ...(message === undefined ? {} : { payload: message }),
      ...(awaiting === undefined ? {} : { awaiting }),
      ...(parameter === undefined ? {} : { parameter }),
      ...(written === undefined ? {} : { written: written.getText() }),
    };
  });
};

/**
 * A one-part address read where a caller wrote it: the argument the caller
 * passed for the parameter the address is, read as the address would have been.
 */
export const readWritten = (
  expression: TsNode,
  part: AddressPart,
  config: Pick<FlowatlasConfig, 'sharedPackages'>,
): AddressedElement => {
  const readings = [readPart(part, [[{ expression, reached: true }]], 0, config, expression.getText().slice(0, 60))];
  const awaiting = awaitingOf([part], readings);
  return {
    resolution: joined(readings, expression.getText().slice(0, 60)),
    ...(awaiting === undefined ? {} : { awaiting }),
    written: expression.getText(),
  };
};

/**
 * Every element folded into one answer, for a reader that has one site and one
 * edge per channel: every name any element reached, or the first refusal when
 * none reached one.
 */
export const collapsed = (elements: readonly AddressedElement[]): ChannelResolution => {
  const resolved = elements
    .map((element) => element.resolution)
    .filter((resolution): resolution is ResolvedChannel => isResolved(resolution));
  const [first] = resolved;
  if (first === undefined) {
    return elements[0]?.resolution ?? { unresolved: 'channel-dynamic', text: '' };
  }
  return { ...first, names: [...new Set(resolved.flatMap((resolution) => resolution.names))] };
};
