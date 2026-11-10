import { GraphQLClient } from 'graphql-request';

import { getSdk } from './generated/sdk';

const client = new GraphQLClient(`${import.meta.env.VITE_OFFICE_URL}/office-api`);

/** The SDK codegen writes at install, handed the client every operation is sent with. */
export const officeSdk = () => getSdk(client);
