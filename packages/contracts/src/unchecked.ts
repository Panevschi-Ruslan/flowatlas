/**
 * Why a boundary could not be checked, and what would make it checkable.
 *
 * A report that quietly leaves out what it could not read teaches its reader
 * that "no errors" means "nothing is broken", which is the one thing it must
 * never mean. Every direction of every boundary ends up either compared or in
 * here with a sentence naming the thing to fix (I3).
 */
import type { Direction, UncheckedReason } from './types.js';

export interface UncheckedNote {
  message: string;
  hint: string;
}

/**
 * Which end of which half is missing a type.
 *
 * The same missing thing is a different job depending on where it is: on a
 * request the sender is a call and the receiver a handler, and on a response
 * they are the other way round. A hint that sends a reader to the wrong file is
 * worse than no hint.
 */
const missing = (direction: Direction, side: 'sender' | 'receiver'): UncheckedNote['hint'] => {
  if (direction === 'response') {
    return side === 'sender'
      ? 'Give the handler a return type. A handler that answers with nothing has no contract to check.'
      : 'Say what the call expects back: a generic on the request — `this.http.get<OrderDto>(…)`.';
  }
  return side === 'sender'
    ? 'Pass a typed value rather than a literal, so there is a declared shape to compare.'
    : 'Type what the handler is given: a `@Body()` or `@Payload()` parameter with a declared class.';
};

/** What is missing, and where to put it. `subject` names the symbol involved. */
export const uncheckedNote = (
  reason: UncheckedReason,
  subject: string,
  direction: Direction = 'request',
  detail?: string,
): UncheckedNote => {
  switch (reason) {
    case 'no-type-on-sender':
      return {
        message: `${subject} declares no type for what it sends`,
        hint: missing(direction, 'sender'),
      };
    case 'no-type-on-receiver':
      return {
        message: `${subject} declares no type for what it expects`,
        hint: missing(direction, 'receiver'),
      };
    case 'body-already-serialised':
      return {
        message: `${subject} sends its body as ${detail ?? 'text'}, which is how it travels rather than what is in it`,
        hint: 'Type the value before it is serialised and pass that, or annotate the call, so there is a shape to compare.',
      };
    case 'type-missing':
      return {
        message: `${subject} names ${detail ?? 'a type'} that is not in the registry`,
        hint: 'Rebuild without --no-types. If it persists, the type left the registry during the merge; file it against the linker.',
      };
    case 'type-kind-unsupported':
      return {
        message: `${detail ?? 'the type'} on ${subject} came from a package and was not read`,
        hint: 'Declare the shape in your own code, or list the package in sharedPackages so it is read in full.',
      };
    case 'ambiguous-handler':
      return {
        message: `${subject} is declared by more than one handler, and which one answers is decided by registration order`,
        hint: 'Two controllers declare the same method and path. Remove one; see flowatlas doctor.',
      };
    case 'channel-without-consumer':
      return {
        message: `${subject} is published to and nothing handles it`,
        hint: 'See flowatlas dead --kind channels. Annotate the handler with @Consumes if it is there but unreadable.',
      };
    case 'channel-without-producer':
      return {
        message: `${subject} is handled and nothing publishes to it`,
        hint: 'See flowatlas dead --kind channels. Annotate the publisher with @Emits if it is there but unreadable.',
      };
  }
};
