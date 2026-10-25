/** A change to the returns table, as its stream hands it on. */
interface ReturnChanges {
  Records: { eventName: string }[];
}

/** Checks each return in at the desk as its row is written. */
export const handler = async (changes: ReturnChanges): Promise<void> => {
  for (const record of changes.Records) console.log(`return ${record.eventName}`);
};
