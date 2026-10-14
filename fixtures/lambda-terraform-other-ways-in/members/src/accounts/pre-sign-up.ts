import type { PreSignUpTriggerEvent } from 'aws-lambda';

/** Lets a member whose email is already verified in without confirming it again. */
export const handler = async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
  event.response.autoConfirmUser = event.request.userAttributes['email_verified'] === 'true';
  return event;
};
