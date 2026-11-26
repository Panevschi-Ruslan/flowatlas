export interface Settings {
  host?: string;
  port?: number;
}

/** The settings, filled in at start. */
export const settings: Settings = { host: '0.0.0.0' };

export function current(): Settings {
  return settings;
}
