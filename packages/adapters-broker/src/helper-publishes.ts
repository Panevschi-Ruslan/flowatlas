import { join } from 'node:path';
import {
  definePass,
  isServiceSource,
  DISCRIMINATOR_META,
  lineAndColumnAt,
  makeChannelId,
  makeLeafId,
  MESSAGE_TYPE_UNREAD_META,
  MESSAGE_TYPES_META,
  type ExtractorPass,
} from '@flowatlas/core';
import { scopesOf, type PassContext, type Scope } from '@flowatlas/extract-scopes';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { feedLookupFor } from './feed-lookup.js';
import { channelsFrom, type HelperPublish } from './hub-feeders.js';
import { readMessageType } from './message-type.js';

/**
 * Publishes made through a function of the project's own that no broker
 * description names (P362).
 *
 * The configuration describes the broker clients; a project often wraps them,
 * or wraps a transport that is no broker at all - a per-scope hub's stub, a
 * request to another service - in a helper of its own, `BusService.publish(
 * channel, message)`, and calls it directly as often as through the clients
 * it describes. Each transport the helper ends at is a place a channel is
 * handed on: a write to a hub's stub, a publish a broker description reads
 * inside the helper whose channel is a parameter, a method marked as calling
 * another service (`@CallsService`) that is handed a channel. The walk out from
 * there (`hub-feeders.ts`) follows only the channel's value, and each call that
 * names the channel on the way is a publish of it: drawn as a producer of that
 * channel, named for the helper, its payload's type read as any producer's
 * is - unless the broker reader already drew that very call.
 */

/** The producer of a call to a helper, unless one is already drawn at that call. */
export const recordHelperPublishes = (ctx: PassContext, publishes: readonly HelperPublish[], scopeOf: (node: TsNode) => Scope | undefined): void => {
  for (const publish of publishes) {
    const { call } = publish;
    const file = ctx.fileOf(call);
    const { line, column } = lineAndColumnAt(call.getSourceFile(), call.getStart());
    const id = makeLeafId('producer', ctx.repo, file, line, column);
    // The broker reader's own reading of the call stands.
    if (ctx.builder.getNode(id) !== undefined) continue;
    const typed = readMessageType(publish.payload);
    const [first] = publish.channels;
    ctx.builder.addNode({
      id,
      type: 'producer',
      label: `event ${first ?? '?'}`,
      repo: ctx.repo,
      file,
      line,
      kind: 'event',
      meta: {
        kind: 'event',
        adapter: publish.helper,
        channelVia: 'helper',
        helper: publish.helper,
        ...(typed === undefined
          ? {}
          : 'types' in typed
            ? { [MESSAGE_TYPES_META]: [...typed.types], [DISCRIMINATOR_META]: typed.field }
            : { [MESSAGE_TYPE_UNREAD_META]: typed.why, [DISCRIMINATOR_META]: typed.field }),
      },
    });
    const scope = scopeOf(call);
    if (scope !== undefined) {
      scope.ensure();
      ctx.builder.addEdge({ from: scope.id, to: id, type: 'calls', confidence: publish.confidence, file, line });
    }
    const payload = publish.payload === undefined ? undefined : ctx.types.collectType(publish.payload.getType(), publish.payload);
    for (const name of publish.channels) {
      const channelId = makeChannelId(name);
      const known = ctx.builder.getNode(channelId);
      const adapters = [...new Set([...((known?.meta?.['adapters'] as string[] | undefined) ?? []), publish.helper])];
      const channel = ctx.builder.addNode({ id: channelId, type: 'channel', label: name, repo: ctx.repo, file, line, meta: { channelKind: 'channel', adapters } });
      channel.meta = { ...channel.meta, adapters };
      ctx.builder.addEdge({ from: id, to: channelId, type: 'emits', confidence: publish.confidence, file, line, ...(payload === undefined ? {} : { params: [payload] }) });
    }
  }
};

/** The scope a node is written in, by the body of the function around it. */
export const scopeFinder = (ctx: PassContext): ((node: TsNode) => Scope | undefined) => {
  let byBody: Map<TsNode, Scope> | undefined;
  return (node) => {
    if (byBody === undefined) {
      byBody = new Map();
      for (const scope of scopesOf(ctx)) if (!byBody.has(scope.body)) byBody.set(scope.body, scope);
    }
    for (let at = node.getParent(); at !== undefined; at = at.getParent()) {
      const found = byBody.get(at);
      if (found !== undefined) return found;
    }
    return undefined;
  };
};

/** A parameter of a method named as a channel. */
const CHANNEL_PARAMETER = /channel|topic|room/i;

/**
 * The transports a channel is handed to that no hub reading covers: a
 * method marked as calling another service that is handed a channel, and a
 * publish the broker reader drew whose channel is a parameter of the function
 * it is written in.
 */
const transportsIn = (ctx: PassContext): { value: TsNode; at: TsNode }[] => {
  const out: { value: TsNode; at: TsNode }[] = [];
  for (const source of ctx.project.getSourceFiles()) {
    if (!isServiceSource(source.getFilePath(), ctx.repoDir) || source.isDeclarationFile()) continue;
    for (const method of source.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
      if (!method.getDecorators().some((decorator) => decorator.getName() === 'CallsService')) continue;
      const parameter = method.getParameters().find((each) => CHANNEL_PARAMETER.test(each.getName()));
      const name = parameter?.getNameNode();
      if (name !== undefined && Node.isIdentifier(name)) out.push({ value: name, at: name });
    }
  }
  for (const producer of ctx.builder.nodes) {
    if (producer.type !== 'producer' || producer.meta?.['channelVia'] !== 'unresolved' || producer.file === undefined || producer.line === undefined) continue;
    const call = callAt(ctx, producer.file, producer.id);
    if (call === undefined) continue;
    const handed = call.getArguments().find((argument) => {
      const at = argument.asKind(SyntaxKind.Identifier);
      const declaration = at?.getSymbol()?.getDeclarations()[0];
      return declaration !== undefined && Node.isParameterDeclaration(declaration) && CHANNEL_PARAMETER.test(declaration.getName());
    });
    if (handed !== undefined) out.push({ value: handed, at: call });
  }
  return out;
};

/** The call a producer leaf was drawn at, by the line and column its id ends in. */
const callAt = (ctx: PassContext, file: string, id: string): CallExpression | undefined => {
  const match = /:(\d+):(\d+)$/.exec(id);
  if (match === null) return undefined;
  const source = ctx.project.getSourceFile(join(ctx.repoDir, file));
  if (source === undefined) return undefined;
  let position: number;
  try {
    position = source.compilerNode.getPositionOfLineAndCharacter(Number(match[1]) - 1, Number(match[2]) - 1);
  } catch {
    return undefined;
  }
  // The outermost call written there: `this.client().publish(…)` is the publish, not `this.client()`.
  let found: CallExpression | undefined;
  for (let at = source.getDescendantAtPos(position); at !== undefined && at.getStart() === position; at = at.getParent()) {
    if (Node.isCallExpression(at)) found = at;
  }
  return found;
};

export const extractHelperPublishes = (ctx: PassContext): void => {
  const transports = transportsIn(ctx);
  if (transports.length === 0) return;
  const lookup = feedLookupFor(ctx);
  const publishes = transports.flatMap(({ value, at }) => [...channelsFrom(value, at, lookup).publishes]);
  recordHelperPublishes(ctx, publishes, scopeFinder(ctx));
};

/** Run after the broker reader and the hub reader, before the types are read. */
export const helperPublishesPass: ExtractorPass<PassContext> = definePass('helper-publishes', extractHelperPublishes);
