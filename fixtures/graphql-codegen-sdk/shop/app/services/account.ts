import gql from 'graphql-tag';

import { api, type CallOptions } from '~/api-client';

export const signIn = (email: string, options: CallOptions) => api.signIn({ email }, options).then((res) => res.signIn);

export const activeCart = (options: CallOptions) =>
  api
    .cart({}, options)
    .then((res) => res.cart);

export const payByCard = (options: CallOptions) => api.payByCard({}, options);

// The documents codegen reads to write the module above.
gql`
  mutation signIn($email: String!) {
    signIn(email: $email) {
      ...ShopperFields
    }
  }
`;

gql`
  query cart {
    cart {
      id
      total
    }
  }
`;

gql`
  mutation payByCard {
    payByCard
  }
`;
