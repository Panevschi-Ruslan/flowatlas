/**
 * `apiUrl` is named by `services[web].apiTarget`, so what is rooted at it
 * reaches `api`. It stops at the host, exactly as the real one does, which is
 * why every path written against it leaves the `/api` prefix out.
 */
export const environment = {
  production: false,
  apiUrl: 'https://api.example.test',
};
