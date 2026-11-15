const isPlain = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Lays `overrides` over `base`, key by key, at every depth. */
export function mergeConfig<T>(base: T, overrides: Partial<T>): T {
  for (const key in overrides) {
    const value = (overrides as any)[key];
    if (isPlain(value) && isPlain((base as any)[key])) mergeConfig((base as any)[key], value);
    else (base as any)[key] = value;
  }
  return base;
}
