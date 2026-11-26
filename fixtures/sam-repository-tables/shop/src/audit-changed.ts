/** Runs on each change to the audit table, read from its stream. */
export const handler = async (event: { Records: { eventName: string }[] }) => {
  return event.Records.length;
};
