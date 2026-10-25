import type { PostConfirmationTriggerEvent } from 'aws-lambda';

/** Welcomes a member once their account is confirmed. */
export const handler = async (event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> => {
  console.log(`welcome ${event.userName}`);
  return event;
};
