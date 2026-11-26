/**
 * What the platform hands the worker. The hub's namespace names no class in
 * its type: `wrangler.jsonc` binds it.
 */
export interface Env {
  BOARD_HUB: DurableObjectNamespace;
  HUB_TOKEN: string;
}

let current: Env | undefined;

/** Kept by the worker's `fetch` for code the request is not handed to. */
export const setWorkerEnv = (env: Env): void => {
  current = env;
};

export const getWorkerEnv = (): Env => {
  if (current === undefined) throw new Error('no environment yet');
  return current;
};
