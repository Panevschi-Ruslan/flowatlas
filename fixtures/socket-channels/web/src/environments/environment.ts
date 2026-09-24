export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
};

/** Which endpoint the live feed opens, decided by the deployment. */
declare const settings: { readonly feedNamespace: string };

export const feedNamespace = settings.feedNamespace;
