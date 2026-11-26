import { resolve, sep } from 'node:path';
import { ANSWER_READ_META, ANSWER_UNREAD_META, answerFieldsRead, type AnswerStart, type FunctionLike } from '@flowatlas/core';
import { Node, type CallExpression, type Node as TsNode } from 'ts-morph';
import { AXIOS, FETCH, KY, OFETCH, UNFETCH, type RequestClient } from '../clients.js';
import type { ReactExtractContext } from '../context.js';

/**
 * Whether a client is one described: itself, or an instance of it holding a
 * base of its own (`ky.create({ prefixUrl })`, `axios.create({ baseURL })`),
 * which is a copy of the description with its base (P402).
 */
export const isClient = (client: RequestClient, described: RequestClient): boolean =>
  client === described || (client.name === described.name && client.package === described.package);

/**
 * How a client's answer comes back, for the fields its caller reads (P391):
 * the platform's `fetch` and ky hand a response whose body is `json()`,
 * axios one whose body is `data`, ofetch the body itself (its `raw` a
 * response whose body is `_data`). Undefined for a client whose answer is
 * not followed; the request then says its answer was not read.
 */
export const answerAsOf = (client: RequestClient, network: CallExpression): Pick<AnswerStart, 'comes' | 'state'> | undefined => {
  if (isClient(client, FETCH) || isClient(client, UNFETCH) || isClient(client, KY)) return { comes: 'promise', state: { kind: 'response', bodyKeys: [], bodyCalls: ['json'] } };
  if (isClient(client, AXIOS)) return { comes: 'promise', state: { kind: 'response', bodyKeys: ['data'], bodyCalls: [] } };
  if (isClient(client, OFETCH)) {
    const callee = network.getExpression();
    return Node.isPropertyAccessExpression(callee) && callee.getName() === 'raw'
      ? { comes: 'promise', state: { kind: 'response', bodyKeys: ['_data'], bodyCalls: [] } }
      : { comes: 'promise', state: { kind: 'payload', prefix: [] } };
  }
  return undefined;
};

/** The meta a request's node carries for the fields of its answer its caller reads (P391). */
export const answerMetaOf = (ctx: ReactExtractContext): ((start: AnswerStart, rootId: string) => Record<string, unknown>) => {
  const root = resolve(ctx.repoDir);
  const isOwn = (declaration: TsNode): boolean => {
    const file = declaration.getSourceFile();
    const path = file.getFilePath();
    return !file.isDeclarationFile() && !path.includes(`${sep}node_modules${sep}`) && !path.includes('/node_modules/') && resolve(path).startsWith(root);
  };
  const idOf = (fn: FunctionLike): string | undefined => {
    const indexed = ctx.functions.get(fn) ?? (fn.getParent() === undefined ? undefined : ctx.functions.get(fn.getParent()!));
    return indexed?.id;
  };
  return (start, rootId) => {
    const found = answerFieldsRead(start, { idOf, isOwn, rootId });
    const unread = [...found.unread, ...(found.cut === undefined ? [] : [{ line: start.call.getStartLineNumber(), why: `cut: ${found.cut}` }])];
    return { [ANSWER_READ_META]: found.reads, ...(unread.length === 0 ? {} : { [ANSWER_UNREAD_META]: unread }) };
  };
};

/** The calls a request was followed out through, innermost first, or the caller it is written for. */
export const throughOf = (network: CallExpression, site: TsNode, calls: readonly CallExpression[]): CallExpression[] =>
  calls.length > 0 ? [...calls] : site !== network && Node.isCallExpression(site) ? [site] : [];
