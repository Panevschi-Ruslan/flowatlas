interface CheckoutNotifications {
  Records: { Sns: { Message: string } }[];
}

const loansHeld = new Map<string, number>();

/** Subscribed to the topic the checkout workflow in `circulation` publishes each loan on. */
export const handler = async (event: CheckoutNotifications): Promise<{ recorded: number }> => {
  for (const record of event.Records) {
    const { borrowerId } = JSON.parse(record.Sns.Message) as { borrowerId: string };
    loansHeld.set(borrowerId, (loansHeld.get(borrowerId) ?? 0) + 1);
  }
  return { recorded: event.Records.length };
};
