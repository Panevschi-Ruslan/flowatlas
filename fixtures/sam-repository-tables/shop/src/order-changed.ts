/** Runs on each change to the order table, read from its stream. */
export const handler = async (event: { Records: { eventName: string }[] }) => {
  return event.Records.length;
};
