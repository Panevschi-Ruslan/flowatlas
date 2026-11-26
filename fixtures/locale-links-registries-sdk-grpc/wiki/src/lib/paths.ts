/** The address of a settings screen: `/settings`, `/settings/members`. */
export function settingsPath(...segments: string[]): string {
  return segments.length === 0 ? '/settings' : `/settings/${segments.join('/')}`;
}

/** The address of an integration's settings: `/settings/integrations/calendar`. */
export function integrationPath(id: string): string {
  return `/settings/integrations/${id}`;
}
