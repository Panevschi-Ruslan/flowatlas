import { evaluateExpression, getDecorator, resolveTypeOrigin } from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { BrokerSpec, ChannelPrefix, EndpointCarrier } from './adapters/types.js';
import { receiverMatches } from './call-site.js';
import { trimEndpoint, type ChannelShaping } from './channel-name.js';

/**
 * Which endpoint a channel name is written under.
 *
 * Both ends of a socket have to answer this the same way, or the same event
 * lands on two nodes with one end each and joins nothing — invisibly, because
 * each half looks fine alone. That is how PeerTube read before this: the browser
 * named `live-videos/subscribe` from the address it opened, and the server named
 * a bare `subscribe` because its namespace was the value `io.of('/live-videos')`
 * returned and nothing read it (R102). So the question is asked here, once, by
 * every reader of a channel: the service reader for a publish, a subscription
 * and a decorated handler alike, and the browser reader for its two calls. How
 * an endpoint and a name then compose into one channel is `shapeChannelNames`.
 *
 * Where an endpoint can be stated, in the order it is looked for:
 *
 * - on the **value** the call is made on — the address a socket was opened on,
 *   the namespace `of(…)` selected, or the endpoint of the value a connection
 *   listener was registered on — followed through variables, fields and chains
 *   of the transport's own calls;
 * - on the **class**, as the option of a decorator the description names;
 * - nowhere, which is the root endpoint, said by saying nothing.
 */

/** The endpoint something states, or the text of whatever hid it. */
export type Endpoint = { readonly endpoint: string } | { readonly unreadable: string };

/**
 * What the transport has to say about the names written at one call site.
 *
 * Either the rules to apply, or the one case where an endpoint is stated and
 * cannot be read. The second is not a detail to shrug at: falling back to the
 * root would put every channel of a namespaced value on the node the
 * unnamespaced ones use, and quietly join ends that never meet. `stated` says
 * where the unreadable endpoint was, because the fix differs.
 */
export type EndpointShaping =
  | ChannelShaping
  | { readonly unreadable: string; readonly stated: 'class' | 'value' };

export const isUnreadable = (
  shaping: EndpointShaping,
): shaping is { readonly unreadable: string; readonly stated: 'class' | 'value' } =>
  'unreadable' in shaping;

/** A hole in a template, written as something no URL may contain. */
const HOLE = '\u0000';

/**
 * Where the path starts: after a scheme and host, or after a hole standing for one.
 *
 * The second half is the case that matters. Almost every browser writes the
 * origin as a settings key and the namespace beside it, so the address reads as
 * a hole followed by a path, and the path is written out even though the whole
 * string is not. A hole only counts as the origin when a slash follows it in the
 * source — `${base}/orders` says where the path begins, while `${base}` alone
 * could be an origin or an origin and a namespace, and guessing which is exactly
 * what must not happen here.
 */
const ORIGIN = /^(?:[a-z][a-z0-9+.-]*:\/\/[^/]*|\u0000[^/]*(?=\/))/i;

/**
 * The path part of an address, with the origin, the query and the slashes gone.
 *
 * An endpoint is the path it was opened on, so `http://host:3000/orders`,
 * `/orders` and `orders` all name the namespace a gateway declares as `orders`,
 * and a server's `of('/orders')` names it too.
 */
const endpointIn = (address: string): string => {
  const withoutOrigin = address.replace(ORIGIN, '');
  const query = withoutOrigin.search(/[?#]/);
  return trimEndpoint(query === -1 ? withoutOrigin : withoutOrigin.slice(0, query));
};

/** An address with its holes marked, so a reader can see whether a hole is in the path. */
const skeletonOf = (address: TsNode): string => {
  if (Node.isTemplateExpression(address)) {
    return (
      address.getHead().getLiteralText() +
      address
        .getTemplateSpans()
        .map((span) => HOLE + span.getLiteral().getLiteralText())
        .join('')
    );
  }
  // `base + '/orders'` is the same address as `${base}/orders`, written with
  // the operator the evaluator folds when both sides read (R102). When one side
  // does not, the side that does is still where the path is.
  if (Node.isBinaryExpression(address) && address.getOperatorToken().getText() === '+') {
    return pieceOf(address.getLeft()) + pieceOf(address.getRight());
  }
  return HOLE;
};

const pieceOf = (part: TsNode): string => {
  const value = evaluateExpression(part);
  return value.resolved && typeof value.value === 'string' ? value.value : skeletonOf(part);
};

/**
 * The endpoint an address names.
 *
 * The address is usually a settings key and a path written beside it, so the
 * whole string rarely reads as a constant while the part that matters always
 * does. What is asked is narrower than "what is this address": whether the
 * *path* is written out. A hole anywhere in the path means the endpoint is not
 * stated, and no address at all is the root.
 */
const endpointOfAddress = (address: TsNode | undefined): Endpoint => {
  if (address === undefined) return { endpoint: '' };
  const value = evaluateExpression(address);
  if (value.resolved && typeof value.value === 'string') return { endpoint: endpointIn(value.value) };
  const path = endpointIn(skeletonOf(address));
  if (path.includes(HOLE)) return { unreadable: address.getText().slice(0, 60) };
  return { endpoint: path };
};

/** How far a value is followed before it is taken to say nothing. */
const MOST_STEPS = 12;

/**
 * Every endpoint a field is given, in the class that owns it.
 *
 * A socket kept as a field and opened later is as ordinary as one opened in
 * place, and a namespace kept as a field is how a server publishes to it from
 * anywhere else in the class.
 */
const fieldValues = (owner: ClassDeclaration, name: string): TsNode[] => {
  const values: TsNode[] = [];
  const initializer = owner.getProperty(name)?.getInitializer();
  if (initializer !== undefined) values.push(initializer);
  owner.forEachDescendant((node) => {
    if (!Node.isBinaryExpression(node)) return;
    if (node.getOperatorToken().getText() !== '=') return;
    const left = node.getLeft();
    if (!Node.isPropertyAccessExpression(left)) return;
    if (!Node.isThisExpression(left.getExpression()) || left.getName() !== name) return;
    values.push(node.getRight());
  });
  return values;
};

/**
 * Follows a value back to where its endpoint is stated.
 *
 * Answers nothing when the value says nothing, which is different from saying
 * the root: a socket handed to a gateway's handler says nothing, and the class
 * may still declare the endpoint.
 */
const endpointOfValue = (
  value: TsNode,
  owner: ClassDeclaration | undefined,
  carrier: EndpointCarrier,
  steps: number,
): Endpoint | undefined => {
  if (steps > MOST_STEPS) return undefined;
  const next = (node: TsNode): Endpoint | undefined =>
    endpointOfValue(node, owner, carrier, steps + 1);
  const isTransport = (node: TsNode): boolean =>
    receiverMatches(resolveTypeOrigin(node), { receiverPackages: [...carrier.packages] });

  if (
    Node.isParenthesizedExpression(value) ||
    Node.isNonNullExpression(value) ||
    Node.isAsExpression(value)
  ) {
    return next(value.getExpression());
  }

  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    // Only the transport's own calls say anything about its endpoints.
    if (!isTransport(callee)) return undefined;
    // By the name it was declared with, so an import renamed at the call site,
    // or a field holding the factory, is still the call that opens a socket.
    const declared = resolveTypeOrigin(callee)?.typeName;
    if (declared !== undefined && carrier.opens.includes(declared)) {
      return endpointOfAddress(value.getArguments()[0]);
    }
    // An audience, a modifier, a middleware or a registration that returns its
    // receiver: every other call keeps the endpoint of what it was made on.
    return Node.isPropertyAccessExpression(callee) ? next(callee.getExpression()) : undefined;
  }

  if (Node.isPropertyAccessExpression(value)) {
    const subject = value.getExpression();
    if (Node.isThisExpression(subject)) {
      if (owner === undefined) return undefined;
      // Every value the field is given has to agree, or the field is on no one
      // endpoint that can be named.
      const found = fieldValues(owner, value.getName())
        .map(next)
        .filter((each): each is Endpoint => each !== undefined);
      const [first] = found;
      if (first === undefined) return undefined;
      const same = found.every((each) => JSON.stringify(each) === JSON.stringify(first));
      return same ? first : { unreadable: value.getText().slice(0, 60) };
    }
    // `socket.broadcast`, `io.sockets`: a property of the transport's is on the
    // endpoint of what it belongs to.
    return isTransport(value) ? next(subject) : undefined;
  }

  if (Node.isIdentifier(value)) {
    const declaration = value.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return undefined;
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      return initializer === undefined ? undefined : next(initializer);
    }
    // The connection a listener is handed is on the endpoint of whatever the
    // listener was registered on: `nsp.on('connection', (socket) => …)`.
    if (Node.isParameterDeclaration(declaration)) {
      const listener = declaration.getParent();
      if (!Node.isArrowFunction(listener) && !Node.isFunctionExpression(listener)) return undefined;
      if (listener.getParameters()[0] !== declaration) return undefined;
      const registration = listener.getParent();
      if (registration === undefined || !Node.isCallExpression(registration)) return undefined;
      const [event] = registration.getArguments();
      const name = event === undefined ? undefined : evaluateExpression(event);
      if (name?.resolved !== true || typeof name.value !== 'string') return undefined;
      if (!carrier.connection.includes(name.value)) return undefined;
      const callee = registration.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || !isTransport(callee)) return undefined;
      return next(callee.getExpression());
    }
  }
  return undefined;
};

/** The endpoint the class declares, when the description says where a class does. */
const endpointOfClass = (
  owner: ClassDeclaration | undefined,
  shape: ChannelPrefix,
): Endpoint | undefined => {
  if (owner === undefined) return undefined;
  const decorator = getDecorator(owner, shape.classDecorator);
  if (decorator === undefined) return undefined;
  for (const argument of decorator.getArguments()) {
    if (!Node.isObjectLiteralExpression(argument)) continue;
    const property = argument.getProperty(shape.optionKey);
    if (property === undefined || !Node.isPropertyAssignment(property)) continue;
    const initializer = property.getInitializer();
    if (initializer === undefined) return { unreadable: property.getText() };
    const value = evaluateExpression(initializer);
    if (!value.resolved || typeof value.value !== 'string') {
      return { unreadable: initializer.getText() };
    }
    return { endpoint: trimEndpoint(value.value) };
  }
  return undefined;
};

/**
 * What the transport says about the names written at one site.
 *
 * `receiver` is the value a call is made on, and is absent for a decorated
 * handler, which has only its class to go by. `owner` is absent for a call
 * written outside any class. The reserved names apply wherever the call is.
 */
export const endpointShapingAt = (
  spec: BrokerSpec,
  owner: ClassDeclaration | undefined,
  receiver?: TsNode,
): EndpointShaping => {
  const reserved = spec.reservedChannels;
  const base: ChannelShaping = reserved === undefined ? {} : { reserved };
  const shape = spec.channelPrefix;
  if (shape === undefined) return base;
  const carried =
    receiver === undefined || shape.carriedBy === undefined
      ? undefined
      : endpointOfValue(receiver, owner, shape.carriedBy, 0);
  if (carried !== undefined) {
    return 'unreadable' in carried
      ? { unreadable: carried.unreadable, stated: 'value' }
      : { ...base, prefix: carried.endpoint, separator: shape.separator };
  }
  const declared = endpointOfClass(owner, shape);
  if (declared === undefined) return base;
  return 'unreadable' in declared
    ? { unreadable: declared.unreadable, stated: 'class' }
    : { ...base, prefix: declared.endpoint, separator: shape.separator };
};

/**
 * The row for a site whose endpoint is stated and cannot be read.
 *
 * One wording per place it was stated, whichever reader found it, so the same
 * problem reads the same way from both ends of a channel.
 */
export const unreadableEndpointRow = (
  shaping: { readonly unreadable: string; readonly stated: 'class' | 'value' },
  spec: BrokerSpec,
  file: string,
  line: number,
  symbol: string,
): { file: string; line: number; reason: 'channel-dynamic'; hint: string; symbol: string } => ({
  file,
  line,
  reason: 'channel-dynamic',
  hint:
    shaping.stated === 'class'
      ? `The ${spec.channelPrefix?.optionKey ?? 'endpoint'} this class declares cannot be read, so neither can any channel name under it. Write it as a literal or a constant.`
      : 'The address this socket was opened on cannot be read, so neither can the namespace its events belong to. Write the path beside the settings key rather than inside it.',
  symbol: `${symbol} -> ${shaping.unreadable.slice(0, 60)}`,
});
