import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

/**
 * Starts a workflow by its ARN, the one way every function of the library does.
 *
 * Which workflow is the caller's to say: `stateMachineArn` is handed in.
 */
export class WorkflowClient {
  private readonly sfn = new SFNClient({ region: 'eu-west-1' });

  async start(stateMachineArn: string | undefined, input: unknown): Promise<string | undefined> {
    const started = await this.sfn.send(new StartExecutionCommand({ stateMachineArn, input: JSON.stringify(input) }));
    return started.executionArn;
  }
}

export const workflows = new WorkflowClient();
