const config = {
  schema: 'http://localhost:3000/office-api',
  documents: ['src/gql/**/*.graphql'],
  generates: {
    'src/generated/sdk.ts': {
      plugins: ['typescript', 'typescript-operations', 'typescript-graphql-request'],
    },
  },
};

export default config;
