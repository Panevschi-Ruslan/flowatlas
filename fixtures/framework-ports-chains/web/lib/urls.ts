/** An address under the admin part of an API, or the API itself. */
export function under(base: string | undefined, admin: boolean): string {
  if (admin) return `${base}/admin`;
  return base ?? '';
}

/** The status service's admin part: the branch the argument takes. */
export const ADMIN_STATUS_URL = under(process.env.STATUS_API_URL, true);
