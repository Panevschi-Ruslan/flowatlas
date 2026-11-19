import { createClient, createRequest, type AnyVariables, type TypedDocumentNode } from '@urql/core';
import { flow } from 'fp-ts/function';

export const client = createClient({ url: '/shop-graphql', exchanges: [] });

type RunQueryOptions<T, V> = {
  query: TypedDocumentNode<T, V>;
  variables: V;
};

/** Every query of the store goes through here: the document is the caller's. */
export const runQuery = <T, V extends AnyVariables>(args: RunQueryOptions<T, V>) =>
  client.executeQuery(createRequest<T, V>(args.query, args.variables), { requestPolicy: 'network-only' }).toPromise();

/** The same, with what an expired session answers set aside: made by composing, not written as a function. */
export const runQuietQuery = flow(runQuery, (result) => result.then((answer) => (answer.error?.message === 'auth/fail' ? null : answer)));
