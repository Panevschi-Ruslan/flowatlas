import { STATUS_URL } from '../lib/constants';
import { ADMIN_STATUS_URL } from '../lib/urls';

/** The checks, at a setting a chain of || reads second. */
export async function readChecks() {
  const res = await fetch(`${STATUS_URL}/checks`);
  return res.json();
}

/** The admin checks, under the branch the helper's argument takes. */
export async function readAdminChecks() {
  const res = await fetch(`${ADMIN_STATUS_URL}/checks`);
  return res.json();
}
