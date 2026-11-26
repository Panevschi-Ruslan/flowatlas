/** Answers every address under /plugins: the name and what is asked of it are the path's. */
export const handler = async (event: { path: string }): Promise<{ statusCode: number; body: string }> => ({
  statusCode: 200,
  body: JSON.stringify({ path: event.path }),
});
