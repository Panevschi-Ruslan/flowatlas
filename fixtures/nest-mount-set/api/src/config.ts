/**
 * Where a deployment mounts this service, which only the deployment knows.
 *
 * Here one committed settings file sets it, so a join may not take it as empty
 * and the part of every address it decides stays a hole (R144).
 */
export const CONTEXT_PATH = process.env.API_CONTEXT_PATH ? `${process.env.API_CONTEXT_PATH}/` : '';
