export const onPlaced = async (event: { detail: { id: string } }) => event.detail.id;

export const onAlert = async (event: { Records: { body: string }[] }) => event.Records.map((record) => JSON.parse(record.body) as unknown);
