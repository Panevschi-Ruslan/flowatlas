/** Lays `source` over `target`, one level deep. */
export function mergeConfig(target: Record<string, any>, source: Record<string, any>) {
  return { ...target, ...source };
}
