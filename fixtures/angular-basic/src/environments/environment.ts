/**
 * The settings a build swaps out.
 *
 * `apiUrl` is what `services[].apiBaseEnv` names, and an address that starts
 * with it is an address whose path belongs to whichever service answers that
 * key. The extractor reads the un-suffixed file only.
 */
export const environment = {
  production: false,
  apiUrl: 'https://api.example.test',
};
