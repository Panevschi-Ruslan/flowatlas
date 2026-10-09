import AWS from 'aws-sdk';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** Version 2 of the SDK, still in place in the oldest function of the service. */
const stepFunctions = new AWS.StepFunctions({ region: 'eu-west-1' });

const LOAN_APPROVAL = 'arn:aws:states:eu-west-1:111122223333:stateMachine:lending-loan-approval';

/** POST /loans/{loanId}/renewals: a renewal is approved the way a loan is. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loanId = event.pathParameters?.['loanId'] ?? '';
  await stepFunctions.startExecution({ stateMachineArn: LOAN_APPROVAL, input: JSON.stringify({ loanId, renewal: true }) }).promise();
  return { statusCode: 202, body: '' };
};
