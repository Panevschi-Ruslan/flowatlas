/**
 * Services are imported lazily, so that a process loads only the ones it
 * runs. Each is started with the server's application.
 */
const services = {
  status: () => import('./status'),
} as const;

export default services;
