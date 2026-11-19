/** Each plugin may add to the configuration; none moves the port. */
export async function applyPlugins(config: Record<string, any>) {
  return config;
}
