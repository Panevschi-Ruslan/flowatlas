declare global {
  interface Window {
    _env_?: Record<string, string | undefined>;
  }
}

/** Written into the page by the container's entrypoint, so one build serves every deployment. */
export const SERVER_URL = window._env_?.SERVER_URL || window.location.origin;
