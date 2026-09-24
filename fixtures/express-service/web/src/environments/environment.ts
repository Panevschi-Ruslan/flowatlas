/**
 * `apiUrl` is named by `services[web].apiTarget`, so what is rooted at it
 * reaches `api`. It stops at the host, exactly as the real one does.
 */
export const environment = {
  production: false,
  apiUrl: 'https://orders.example.test',
};
