/** Counts the orders placed and changed, for the daily report. */
export const handler = async (event: { Records: unknown[] }): Promise<void> => {
  console.log(`tallied ${event.Records.length}`);
};
