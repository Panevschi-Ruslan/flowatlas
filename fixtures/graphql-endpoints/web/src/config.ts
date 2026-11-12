declare global {
  interface Window {
    __runtime?: { serverUrl?: string };
  }
}

/** Where the server is: handed to the page where it is served, or the page's own origin. */
export const SERVER_URL = window.__runtime?.serverUrl || window.location.origin;
