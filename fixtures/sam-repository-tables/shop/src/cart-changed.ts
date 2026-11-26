/** Runs on each change to the cart table, read from its stream. */
export const handler = async (event: { Records: { eventName: string }[] }) => {
  return event.Records.length;
};
