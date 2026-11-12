/** Shared by the application and the server, both of which Nuxt 4 imports it for. */
export const slugify = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, '-');
