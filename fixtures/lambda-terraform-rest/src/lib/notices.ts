export const sendNotice = async (borrowerId: string, channel: string, text: string): Promise<void> => {
  console.log(JSON.stringify({ borrowerId, channel, text }));
};
