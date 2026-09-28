/**
 * The settings a build swaps out, under the name the framework's own convention
 * gives them. `apiUrl` is named by `services[web].apiTarget`, so every address
 * rooted at it is known to reach `api`.
 */
export const environment = {
  production: false,
  apiUrl: 'https://api.example.test',
};
