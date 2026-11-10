export const handler = async (event: { Records: { body: string }[] }) => event.Records.map((record) => JSON.parse(record.body) as unknown);
