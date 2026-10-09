export interface Notice {
  borrowerId: string;
  subject: string;
}

const outbox: Notice[] = [];

export const sendNotice = async (notice: Notice): Promise<void> => {
  outbox.push(notice);
};
