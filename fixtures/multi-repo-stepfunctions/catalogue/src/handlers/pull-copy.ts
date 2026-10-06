interface PullRequests {
  Records: { body: string }[];
}

const shelfOf = (copyId: string): string => copyId.split('-')[0] ?? 'returns';

/** Reads the queue the checkout workflow in `circulation` sends each copy to be pulled on. */
export const handler = async (event: PullRequests): Promise<{ shelves: string[] }> => ({
  shelves: event.Records.map((record) => shelfOf((JSON.parse(record.body) as { copyId: string }).copyId)),
});
