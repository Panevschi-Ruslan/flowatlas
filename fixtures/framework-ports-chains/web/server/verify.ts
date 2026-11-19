import { APP_URL } from '../lib/constants';

/** Confirms an address change through the application's own API, on the server. */
export async function getServerSideProps(context: { query: { token?: string } }) {
  const params = new URLSearchParams({ token: context.query.token ?? '' });
  const response = await fetch(`${APP_URL}/api/auth/verify-email?${params.toString()}`, {
    method: 'POST',
  });
  return { props: { verified: response.ok } };
}
