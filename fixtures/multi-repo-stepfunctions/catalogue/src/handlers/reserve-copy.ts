interface ReserveRequest {
  titleId: string;
}

const firstFreeCopy = async (titleId: string): Promise<string | undefined> => `${titleId}-copy-1`;

export const handler = async (event: ReserveRequest): Promise<{ copyId: string }> => {
  const copyId = await firstFreeCopy(event.titleId);
  if (copyId === undefined) throw Object.assign(new Error('no copy is free'), { name: 'NoCopyAvailable' });
  return { copyId };
};
