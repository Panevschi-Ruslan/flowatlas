export const handler = async (event: { Records: { body: string }[] }) => {
  for (const record of event.Records) {
    const change = JSON.parse(record.body) as { id: string; team: string };
    console.log(`team ${change.team}: ${change.id}`);
  }
};
