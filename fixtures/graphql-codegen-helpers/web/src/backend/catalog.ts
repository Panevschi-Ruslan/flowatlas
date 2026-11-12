import { ProductChangedDocument, ProductDocument, ProductsQueryDocument, RenameProductDocument, type ProductsQuery } from '~/backend/graphql';

import { runMutation, runQuery, runSubscription } from './client';

export const listProducts = (first?: number) => runQuery<ProductsQuery, { first?: number }>({ query: ProductsQueryDocument, variables: { first } });

export const getProduct = (id: string) => runQuery({ query: ProductDocument, variables: { id } });

export const renameProduct = (id: string, title: string) => runMutation(RenameProductDocument, { id, title });

export const watchProducts = () => runSubscription({ query: ProductChangedDocument, variables: {} });

/** A document chosen at run time: said where it is handed, not guessed. */
export const runNamed = (documents: Record<string, never>, name: string) => runQuery({ query: documents[name], variables: {} });
