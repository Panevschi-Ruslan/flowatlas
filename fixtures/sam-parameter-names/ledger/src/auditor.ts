export const handler = async (event: { Records: { body: string }[] }) => {
  for (const record of event.Records) console.log(`audit: ${record.body}`);
};
