/** GET /rides/{rideId}: one ride, behind a sign-in and an API key. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
