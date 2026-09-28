/**
 * Where a deployment mounts this service, which only the deployment knows.
 *
 * A notification service's shape: every committed settings file leaves it empty, and an
 * installation behind a proxy sets it. Nothing static settles it, so the part of
 * every address it decides is read as a hole.
 */
export const CONTEXT_PATH = process.env.API_CONTEXT_PATH ? `${process.env.API_CONTEXT_PATH}/` : '';
