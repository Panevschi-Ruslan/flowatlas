import { type Client } from '@urql/core';

import { ProductsQueryDocument } from './graphql';
import { client as shopClient } from './client';

/** A helper handed the client to send with: the one every caller hands decides where it goes. */
const searchWith = async ({ client, first }: { client: Client; first: number }) => client.query(ProductsQueryDocument, { first }).toPromise();

export const searchProducts = (first: number) => searchWith({ client: shopClient, first });
