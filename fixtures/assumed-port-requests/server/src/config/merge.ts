import { defaults } from './defaults';

export interface ServerConfig {
  apiOptions: { hostname: string; port: number; storeApiPath: string };
}

/** The configuration handed in, laid over the defaults key by key. */
export function mergeConfig(given: Partial<ServerConfig>): ServerConfig {
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    out[key] = { ...(out[key] as object), ...(value as object) };
  }
  return out as unknown as ServerConfig;
}
