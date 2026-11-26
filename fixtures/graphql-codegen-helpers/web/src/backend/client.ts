import { createClient, createRequest, type AnyVariables, type TypedDocumentNode } from '@urql/core';

import { SERVER_URL } from '../config';

export const client = createClient({ url: `${SERVER_URL}/graphql`, exchanges: [] });

type RunQueryOptions<T, V> = {
  query: TypedDocumentNode<T, V>;
  variables: V;
};

/** Every query of the shop goes through here: the document is the caller's. */
export const runQuery = async <T, V extends AnyVariables>(args: RunQueryOptions<T, V>) => {
  const request = createRequest<T, V>(args.query, args.variables);
  return client.executeQuery(request, { requestPolicy: 'network-only' }).toPromise();
};

/** A subscription, the document taken out of the options where they are written. */
export const runSubscription = <T, V extends AnyVariables>({ query, variables }: RunQueryOptions<T, V>) =>
  client.executeSubscription(createRequest(query, variables));

/** Every mutation of the shop goes through here. */
export const runMutation = <T, V extends AnyVariables>(mutation: TypedDocumentNode<T, V>, variables: V) =>
  client.mutation(mutation, variables).toPromise();
