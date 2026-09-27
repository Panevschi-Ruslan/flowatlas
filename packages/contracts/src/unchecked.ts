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
    // Said without a direction of travel on purpose: the end that holds the wire
    // form is sometimes the one that serialised before sending and sometimes the
    // one that parses after receiving, and `subject` already names which end it
    // is. A sentence that guessed would tell half of them they send something
    // they receive.
    case 'body-already-serialised':
      return {
        message: `${subject} has ${detail ?? 'text'} where a shape should be, which is how a body travels rather than what is in it`,
        hint: 'Compare the shape rather than the wire: type the value before it is serialised, or the one it is parsed into, and pass that — or annotate this end, so there is a shape to compare.',
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
    // A procedure's input is recorded by the server half as the text of the
    // argument it was handed — `OrderQuery`, `ZCreateOrder` — and not as a shape
    // in the registry. Nearly always it is a validation schema, whose shape as a
    // type is the library's inference over it and resolves only where that
    // library is installed; in a clone nobody installed it is `any`, and a
    // comparison against `any` agrees with everything. So nothing is compared
    // and the sentence says why, rather than a verdict that compared nothing.
    case 'procedure-input-by-name':
      return {
        message:
          detail === undefined
            ? `${subject} declares no input the procedure reader could name, so what the caller sends is not compared with anything`
            : `${subject} takes ${detail}, which the graph holds by name rather than as a shape, so what the caller sends is not compared with it`,
        hint: 'Nothing to change in your code: the procedure reader records the input by the name it was written under. Comparing it needs the schema read as a shape, which a validation library\'s inference only yields where its package is installed.',
      };
    // The answer a client of a procedure gets is typed by inference from the
    // server's own tree, so both ends of it are one declaration. Comparing a
    // declaration with itself always agrees, which is the one verdict worse
    // than none.
    case 'procedure-output-inferred':
      return {
        message: `what ${subject} answers reaches its caller as a type inferred from the server's own tree, so the two ends are one declaration`,
        hint: 'Nothing to compare and nothing to change: the compiler holds both ends of this to the same type wherever the client is typed from the tree it calls.',
      };
    case 'channel-without-producer':
      return {
        message: `${subject} is handled and nothing publishes to it`,
        hint: 'See flowatlas dead --kind channels. Annotate the publisher with @Emits if it is there but unreadable.',
      };
  }
};
