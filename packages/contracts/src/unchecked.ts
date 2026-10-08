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
      : 'Say what the call expects back: a generic on the request — `this.http.get<OrderDto>(…)`, `client.send<OrderDto>(…)` — or a typed parameter on the callback the answer is handed to.';
  }
  return side === 'sender'
    ? 'Pass a typed value rather than a literal, so there is a declared shape to compare.'
    : 'Type what the handler is given: a `@Body()` or `@Payload()` parameter with a declared class.';
};

/**
 * The same missing type at the end of a handler that reads its request and
 * answers through what it is handed (P29). Its signature says nothing either
 * way, so the sentence names what it does not state and the hint points at
 * where such a handler states it.
 */
const unstated = (direction: Direction, side: 'sender' | 'receiver', subject: string): UncheckedNote | undefined => {
  if (direction === 'response' && side === 'sender') {
    return {
      message: `${subject} answers through the response it is handed, and states no type for the answer`,
      hint: 'Hand the response a typed value, or type the response itself with what it answers, so there is a shape to compare.',
    };
  }
  if (direction === 'request' && side === 'receiver') {
    return {
      message: `${subject} reads no typed body from the request it is handed`,
      hint: "Type what the handler reads: the request's type argument for the body, or check the body with a validator, whose output is read as the shape.",
    };
  }
  return undefined;
};

/** What is missing, and where to put it. `subject` names the symbol involved. */
export const uncheckedNote = (
  reason: UncheckedReason,
  subject: string,
  direction: Direction = 'request',
  detail?: string,
  described = false,
): UncheckedNote => {
  if (described && (reason === 'no-type-on-sender' || reason === 'no-type-on-receiver')) {
    const said = unstated(direction, reason === 'no-type-on-sender' ? 'sender' : 'receiver', subject);
    if (said !== undefined) return said;
  }
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
    // The rest are a message delivered by a platform rather than handed over by
    // code (R172): compared through the wrapping it arrives in, where that and
    // what the far end reads of it are both known, and said here where not.
    case 'envelope-unread':
      return {
        message: `how ${subject} wraps what it hands its target is not known`,
        hint: 'Nothing to change in the code. A target handed something other than the message as delivered - an input rewritten on the way, a batch a pipe shapes - is not compared, because the message and what the target reads would not be the same thing.',
      };
    case 'message-unparsed':
      return {
        message: `${subject} does not parse the text at ${detail ?? 'the top'} of what it is handed into a declared type`,
        hint: 'Parse the message into a declared type where the handler reads it - `JSON.parse(text) as Order`, or into a variable declared with one - so there is a shape to compare.',
      };
    case 'message-undeclared':
      return {
        message:
          detail === undefined
            ? `${subject} declares no type of its own for what it is handed`
            : `${subject} declares no type for what is at ${detail} of what it is handed`,
        hint: "Type the handler's parameter with the message's own type inside it, so there is a shape to compare.",
      };
    case 'delivered-onward':
      return {
        message: `${subject} hands the message on to ${detail ?? 'another channel'} rather than to code`,
        hint: 'Nothing to change: the message is compared with what reads it where it is handed on to.',
      };
    case 'delivery-target-unread':
      return {
        message: `nothing ${subject} delivers to is code this project reads`,
        hint: 'The target is not code any configured service holds - an e-mail address, or a function no configured service deploys - so there is nothing to compare the message with. Configure the service that deploys it to compare it.',
      };
    case 'handler-unread':
      return {
        message: `the code ${subject} runs was not read for what it takes from what it is handed`,
        hint: 'Its handler is built by a call whose result is not a function this tool reads, or was not found; see the rows about it in flowatlas doctor. Export the function the platform calls, so there is a parameter to compare.',
      };
    case 'sender-forwards':
      return {
        message: `${subject} hands on what it is given, and nothing declares its shape`,
        hint: 'Nothing to change at this end. A message forwarded from a channel is compared from the publisher that wrote it when the forwarding wrapping is known; a request a route sends straight to a channel has no declared shape.',
      };
  }
};
