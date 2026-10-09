import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({ region: 'eu-west-1' });

/**
 * Starts a workflow by its ARN. Which workflow is the caller's to say:
 * `stateMachineArn` is handed in.
 */
export const startWorkflow = async (stateMachineArn: string | undefined, input: unknown): Promise<string | undefined> => {
  const started = await sfn.send(new StartExecutionCommand({ stateMachineArn, input: JSON.stringify(input) }));
  return started.executionArn;
};
